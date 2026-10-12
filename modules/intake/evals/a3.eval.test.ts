import { describe, expect, it } from "vitest";
import { escalationReasons, seeksAdvice } from "@/lib/ai/guard";
import { A3_CASES, A3_EVAL_NOW } from "./a3.cases";

/*
 * A3 deterministic gate: each golden message goes straight to a person or on
 * to the model, as expected. Runs on every CI build; the live-model half of
 * these cases runs with `pnpm eval`.
 */

describe("eval: A3 routes each message before any model call", () => {
  expect(A3_CASES.length).toBeGreaterThanOrEqual(20);
  it.each(A3_CASES)("$name -> $route", ({ message, route }) => {
    const handoff = escalationReasons(message, A3_EVAL_NOW).length > 0 || seeksAdvice(message);
    expect(handoff ? "handoff" : "reply").toBe(route);
  });
});
