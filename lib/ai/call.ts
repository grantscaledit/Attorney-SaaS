import { createHash } from "node:crypto";
import type { z } from "zod";
import { execute } from "@/lib/commands/execute";
import { log } from "@/lib/log";
import { maskDeep, maskText, type MaskKind } from "@/lib/masking";
import { recordAiRun } from "@/modules/ai/commands/record-run";
import { estimateCost, modelFor, type ModelTier } from "./models";
import { getAiTransport, type Effort } from "./transport";

/**
 * The only way LexDesk calls an LLM (rule 3):
 *
 * 1. Masks every identifier in the system prompt and messages (rule 6).
 * 2. Calls the model for the tier with structured output for `schema`.
 * 3. Validates the response with Zod; anything else is a failed run.
 * 4. Records the run in ai_runs: prompt hash, model, tokens, cost, masked
 *    output. The prompt text itself is never stored.
 *
 * Callers never send model output anywhere directly: drafts go to the
 * approval queue or through lib/ai/guard.ts first (rules 4 and 5).
 */

export type AiCallSpec<S extends z.ZodType> = {
  purpose: string;
  automationId?: string;
  /** Bump when the prompt changes, so runs and evals can be compared by version. */
  promptVersion: string;
  tier: ModelTier;
  effort?: Effort;
  maxTokens?: number;
  system: string;
  messages: { role: "user" | "assistant"; content: string }[];
  schema: S;
  entity?: { type: string; id: string };
};

export type AiCallResult<T> =
  | { ok: true; output: T; runId: string; model: string }
  | {
      ok: false;
      reason: "not_configured" | "refused" | "invalid_output" | "error";
      runId: string;
      detail?: string;
    };

const REQUEST = (purpose: string) => ({ ip: null, userAgent: null, requestId: `ai:${purpose}` });

export async function aiCall<S extends z.ZodType>(
  spec: AiCallSpec<S>,
): Promise<AiCallResult<z.output<S>>> {
  const model = modelFor(spec.tier);
  const counts: Partial<Record<MaskKind, number>> = {};
  const mask = (text: string) => {
    const r = maskText(text);
    for (const [k, n] of Object.entries(r.found))
      counts[k as MaskKind] = (counts[k as MaskKind] ?? 0) + n;
    return r.text;
  };
  const system = mask(spec.system);
  const messages = spec.messages.map((m) => ({ role: m.role, content: mask(m.content) }));
  const promptHash = createHash("sha256")
    .update(JSON.stringify({ model, system, messages }))
    .digest("hex");

  const base = {
    purpose: spec.purpose,
    automationId: spec.automationId ?? null,
    model,
    promptHash,
    promptVersion: spec.promptVersion,
    maskedCounts: counts as Record<string, number>,
    entityType: spec.entity?.type ?? null,
    entityId: spec.entity?.id ?? null,
  };
  const record = async (
    fields: Partial<z.input<typeof recordAiRun.input>> & {
      status: z.input<typeof recordAiRun.input>["status"];
    },
  ): Promise<string> => {
    const r = await execute(
      recordAiRun,
      { type: "system", label: `ai:${spec.purpose}` },
      {
        servedModel: null,
        stopReason: null,
        refusalCategory: null,
        inputTokens: null,
        outputTokens: null,
        cacheReadTokens: null,
        costUsd: null,
        latencyMs: null,
        output: null,
        error: null,
        ...base,
        ...fields,
      },
      { request: REQUEST(spec.purpose) },
    );
    return r.runId;
  };

  const transport = getAiTransport();
  if (!transport) {
    const runId = await record({ status: "not_configured" });
    return { ok: false, reason: "not_configured", runId };
  }

  const started = Date.now();
  let response;
  try {
    response = await transport.complete({
      model,
      system,
      messages,
      schema: spec.schema,
      effort: spec.effort ?? "medium",
      maxTokens: spec.maxTokens ?? 4000,
    });
  } catch (err) {
    log.error("ai call failed", { purpose: spec.purpose, model, err });
    const runId = await record({
      status: "error",
      latencyMs: Date.now() - started,
      error: err instanceof Error ? err.message.slice(0, 500) : "unknown error",
    });
    return { ok: false, reason: "error", runId };
  }

  const usage = {
    servedModel: response.servedModel,
    stopReason: response.stopReason,
    refusalCategory: response.refusalCategory,
    inputTokens: response.usage.inputTokens,
    outputTokens: response.usage.outputTokens,
    cacheReadTokens: response.usage.cacheReadTokens,
    costUsd: estimateCost(response.servedModel, response.usage),
    latencyMs: Date.now() - started,
  };

  if (response.stopReason === "refusal") {
    const runId = await record({ status: "refused", ...usage });
    return { ok: false, reason: "refused", runId, detail: response.refusalCategory ?? undefined };
  }

  let parsed: z.ZodSafeParseResult<z.output<S>>;
  try {
    parsed = spec.schema.safeParse(JSON.parse(response.text)) as z.ZodSafeParseResult<z.output<S>>;
  } catch {
    const runId = await record({
      status: "invalid_output",
      ...usage,
      error: "response was not JSON",
    });
    return { ok: false, reason: "invalid_output", runId };
  }
  if (!parsed.success) {
    const detail = parsed.error.issues
      .slice(0, 3)
      .map((i) => `${i.path.join(".")}: ${i.message}`)
      .join("; ");
    const runId = await record({ status: "invalid_output", ...usage, error: detail.slice(0, 500) });
    return { ok: false, reason: "invalid_output", runId, detail };
  }

  // The model should never echo an identifier back; mask again in case it does.
  const output = maskDeep(parsed.data);
  const runId = await record({ status: "succeeded", ...usage, output });
  return { ok: true, output, runId, model: response.servedModel };
}
