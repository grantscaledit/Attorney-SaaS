import type { AiTransport, TransportRequest, TransportResponse } from "./transport";

/**
 * A transport that answers from a script instead of a model. Used by tests,
 * the deterministic eval runs, and the demo seed (rule 12: demo mode never
 * calls a live service). The script sees the masked request.
 */
export type ScriptStep =
  { output: unknown } | { refuse: true } | { text: string } | { throw: string };

export class ScriptedTransport implements AiTransport {
  readonly requests: TransportRequest[] = [];
  constructor(private readonly script: (req: TransportRequest) => ScriptStep) {}

  async complete(req: TransportRequest): Promise<TransportResponse> {
    this.requests.push(req);
    const step = this.script(req);
    if ("throw" in step) throw new Error(step.throw);
    const usage = {
      inputTokens: Math.ceil(req.system.length / 4),
      outputTokens: 50,
      cacheReadTokens: 0,
    };
    if ("refuse" in step) {
      return {
        text: "",
        servedModel: req.model,
        stopReason: "refusal",
        refusalCategory: "test",
        usage,
      };
    }
    const text = "text" in step ? step.text : JSON.stringify(step.output);
    return { text, servedModel: req.model, stopReason: "end_turn", refusalCategory: null, usage };
  }
}
