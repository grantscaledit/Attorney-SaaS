import { describe, expect, it } from "vitest";
import { mapPracticeArea } from "./field-map";

describe("practice area mapping", () => {
  it.each([
    ["IRS notice / tax problem", "tax"],
    ["Forming an LLC", "business"],
    ["Wills and trusts", "estate"],
    ["Probate of a parent's estate", "estate"],
    ["Estate tax question", null],
    ["Something else", null],
    [null, null],
  ] as const)("%s -> %s", (input, expected) => {
    expect(mapPracticeArea(input)).toBe(expected);
  });
});
