import { describe, expect, it } from "vitest";
import { classifyText, conventionalName, missingPagesNote } from "./classify";
import { appearsIn, parseDate, parseNotice, reconcile } from "./notice-parser";
import { NOTICE_CASES } from "./evals/notices.cases";

describe("parseDate", () => {
  it.each([
    ["October 1, 2026", "2026-10-01"],
    ["Oct. 1, 2026", "2026-10-01"],
    ["Sept 14 2026", "2026-09-14"],
    ["10/01/2026", "2026-10-01"],
    ["2024-02-29", "2024-02-29"],
    ["2025-02-29", null],
    ["13/01/2026", null],
    ["Smarch 1, 2026", null],
  ])("%s -> %s", (input, want) => {
    expect(parseDate(input)).toBe(want);
  });
});

describe("reconcile", () => {
  const text = NOTICE_CASES[0]!.text;
  const parsed = parseNotice(text);
  it("marks agreement and keeps the parser on conflict", () => {
    const r = reconcile(text, parsed, {
      noticeType: "CP2000",
      amountDue: "3,999.00",
      respondBy: "October 30, 2026",
    });
    expect(r.provenance.noticeType).toBe("both");
    expect(r.provenance.respondBy).toBe("both");
    // $3,999.00 is not in the text: ignored, not a conflict.
    expect(r.fields.amountDue).toBe("3,214.00");
    expect(r.provenance.amountDue).toBe("parser");
  });
  it("accepts a model value only when it appears in the text", () => {
    const blank = { ...parsed, respondBy: null, noticeDate: null };
    const r = reconcile(text, blank, { respondBy: "2026-10-30", noticeDate: "2027-01-01" });
    expect(r.fields.respondBy).toBe("2026-10-30");
    expect(r.provenance.respondBy).toBe("model");
    expect(r.fields.noticeDate).toBeNull();
  });
  it("flags a real disagreement", () => {
    const r = reconcile(text, parsed, { noticeDate: "October 30, 2026" });
    expect(r.provenance.noticeDate).toBe("conflict");
    expect(r.fields.noticeDate).toBe("2026-09-30");
  });
  it("appearsIn matches dates in any printed form", () => {
    expect(appearsIn("Respond by Oct. 30, 2026", "2026-10-30")).toBe(true);
    expect(appearsIn("Respond by Oct. 30, 2026", "2026-10-31")).toBe(false);
  });
});

describe("classifyText", () => {
  it.each([
    [NOTICE_CASES[0]!.text, "irs_notice"],
    [NOTICE_CASES[16]!.text, "state_tax_notice"],
    ["LAST WILL AND TESTAMENT OF PAT SAMPLE", "will"],
    ["CERTIFICATE OF DEATH State of Texas", "death_certificate"],
    ["Statement period Aug 1 - Aug 31. Beginning balance $10", "bank_statement"],
    ["Company Agreement of Sample Holdings LLC", "operating_agreement"],
    ["Wage and Income Transcript Tax Period Requested: December, 2024", "tax_transcript"],
    ["Grocery list: eggs, milk", "other"],
  ])("%#", (text, type) => {
    expect(classifyText(text).docType).toBe(type);
  });
});

describe("naming and completeness", () => {
  it("names files by the firm convention, without unsafe characters", () => {
    expect(
      conventionalName({
        receivedOn: "2026-10-11",
        docType: "irs_notice",
        detail: "CP2000 2024",
        matterNumber: "2026-0007",
        ext: "pdf",
      }),
    ).toBe("2026-10-11 IRS notice CP2000 2024 - 2026-0007.pdf");
    expect(
      conventionalName({
        receivedOn: "2026-10-11",
        docType: "other",
        detail: 'a/b:"c"',
        matterNumber: "2026-0001",
        ext: "jpg",
      }),
    ).toBe("2026-10-11 Other a b c - 2026-0001.jpg");
  });
  it("notices missing pages", () => {
    expect(missingPagesNote(["Page 1 of 3", "Page 3 of 3"])).toBe(
      "The document says it has 3 pages; page 2 is missing.",
    );
    expect(missingPagesNote(["Page 1 of 2", "Page 2 of 2"])).toBeNull();
    expect(missingPagesNote(["no markers"])).toBeNull();
  });
});
