import { describe, expect, it } from "vitest";
import { containsIdentifiers, maskDeep, maskText } from "./index";

describe("identifier masking (rule 6)", () => {
  it.each([
    ["My SSN is 123-45-6789.", "My SSN is [SSN ending 6789].", "ssn"],
    ["ssn 123 45 6789", "ssn [SSN ending 6789]", "ssn"],
    ["EIN 12-3456789 for the LLC", "EIN [EIN ending 6789] for the LLC", "ein"],
    ["my number is 123456789", "my number is [tax ID ending 6789]", "tin"],
    ["card 4111 1111 1111 1111 exp 09/27", "card [card number ending 1111] exp 09/27", "card"],
    ["4111-1111-1111-1111", "[card number ending 1111]", "card"],
    ["account number 000123456789", "account number [account number ending 6789]", "account"],
    ["checking acct: 4455 6677 88", "checking acct: [account number ending 7788]", "account"],
    ["routing 111000025", "routing [routing number ending 0025]", "routing"],
    ["DOB: 03/14/1962", "DOB: [date of birth removed]", "dob"],
    ["I was born on March 14, 1962", "I was born on [date of birth removed]", "dob"],
    ["date of birth 1962-03-14", "date of birth [date of birth removed]", "dob"],
  ] as const)("%s", (input, expected, kind) => {
    const r = maskText(input);
    expect(r.text).toBe(expected);
    expect(r.found[kind]).toBe(1);
  });

  it.each([
    "Call me at (214) 555-0142 or 214-555-0142 or +12145550142 or 2145550142",
    "I got a CP2000 for tax year 2022 saying I owe $12,345.67",
    "Notice dated 03/14/2026, respond by 04/13/2026",
    "The LLC was formed in 2019 with 3 owners",
    "4111 1111 1111 1112 is not a valid card",
    "Invoice 1234567890123",
  ])("leaves ordinary details alone: %s", (input) => {
    expect(maskText(input).text).toBe(input);
  });

  it("masks several identifiers in one message and reports counts only", () => {
    const r = maskText("SSN 123-45-6789, spouse 987-65-4321, EIN 12-3456789");
    expect(r.text).not.toMatch(/123-45|987-65|3456789/);
    expect(r.found).toEqual({ ssn: 2, ein: 1 });
  });

  it("is idempotent", () => {
    const once = maskText("SSN 123-45-6789, card 4111111111111111").text;
    expect(maskText(once).text).toBe(once);
    expect(containsIdentifiers(once)).toBe(false);
  });

  it("masks every string in a nested record", () => {
    const out = maskDeep({ a: "ssn 123-45-6789", b: [{ c: "dob 1/2/1970" }], n: 3 });
    expect(JSON.stringify(out)).not.toMatch(/123-45|1\/2\/1970/);
    expect(out.n).toBe(3);
  });
});
