import { describe, expect, it } from "vitest";
import { containsIdentifiers, maskText } from "@/lib/masking";
import { looksLikeTaxNotice, parseNotice } from "../notice-parser";
import { NOTICE_CASES } from "./notices.cases";

/*
 * B3 deterministic eval: every golden notice, masked first exactly as the
 * pipeline does, yields the fields a reviewer would read off the page, and
 * no full identifier survives masking. Runs on every CI build.
 */

describe("eval: B3 notice fields (Phase 3 acceptance)", () => {
  expect(NOTICE_CASES.length).toBeGreaterThanOrEqual(20);
  it.each(NOTICE_CASES)("$name", ({ text, expect: want }) => {
    const masked = maskText(text).text;
    expect(containsIdentifiers(masked)).toBe(false);
    expect(parseNotice(masked)).toEqual(want);
  });
  it("routes notices, and only notices, to triage", () => {
    for (const c of NOTICE_CASES) {
      expect(looksLikeTaxNotice(maskText(c.text).text), c.name).toBe(c.expect.agency !== null);
    }
  });
});
