import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type { z } from "zod";
import { env } from "@/lib/env";
import { supportsRefusalFallback } from "./models";

export type Effort = "low" | "medium" | "high";

export type TransportRequest = {
  model: string;
  system: string;
  messages: { role: "user" | "assistant"; content: string }[];
  schema: z.ZodType;
  effort: Effort;
  maxTokens: number;
};

export type TransportResponse = {
  /** Concatenated text blocks: the JSON document structured output produces. */
  text: string;
  servedModel: string;
  stopReason: string | null;
  refusalCategory: string | null;
  usage: { inputTokens: number; outputTokens: number; cacheReadTokens: number };
};

/** How LexDesk reaches a model. Tests and the demo seed install a scripted one. */
export interface AiTransport {
  complete(req: TransportRequest): Promise<TransportResponse>;
}

/**
 * Anthropic Messages API through the official SDK. Structured output via
 * `output_config.format` (the response is a JSON document matching the
 * schema); explicit effort; and, on models that support it, the server-side
 * refusal fallback (`fallbacks: "default"`), so a safety decline is retried on
 * another model inside the same call instead of failing the automation.
 */
export class AnthropicTransport implements AiTransport {
  private readonly client: Anthropic;

  constructor(apiKey: string) {
    this.client = new Anthropic({ apiKey, maxRetries: 2, timeout: 120_000 });
  }

  async complete(req: TransportRequest): Promise<TransportResponse> {
    const fallback = supportsRefusalFallback(req.model);
    const response = await this.client.beta.messages.create({
      model: req.model,
      max_tokens: req.maxTokens,
      system: req.system,
      messages: req.messages,
      output_config: { effort: req.effort, format: zodOutputFormat(req.schema) },
      ...(fallback
        ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const }
        : {}),
    });
    const text = response.content
      .map((b) => (b.type === "text" ? b.text : ""))
      .join("")
      .trim();
    return {
      text,
      servedModel: response.model,
      stopReason: response.stop_reason ?? null,
      refusalCategory:
        response.stop_reason === "refusal" ? (response.stop_details?.category ?? null) : null,
      usage: {
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
        cacheReadTokens: response.usage.cache_read_input_tokens ?? 0,
      },
    };
  }
}

const globalForAi = globalThis as unknown as { __lexdeskAi?: AiTransport | null };

/** The configured transport, or null when ANTHROPIC_API_KEY is not set. */
export function getAiTransport(): AiTransport | null {
  if (globalForAi.__lexdeskAi !== undefined) return globalForAi.__lexdeskAi;
  const key = env().ANTHROPIC_API_KEY;
  globalForAi.__lexdeskAi = key ? new AnthropicTransport(key) : null;
  return globalForAi.__lexdeskAi;
}

/** Tests and the demo seed install a scripted transport (or null for "not configured"). */
export function setAiTransport(transport: AiTransport | null | undefined): void {
  if (transport === undefined) delete globalForAi.__lexdeskAi;
  else globalForAi.__lexdeskAi = transport;
}
