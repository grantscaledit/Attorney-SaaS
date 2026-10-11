import { describe, expect, it } from "vitest";
import {
  matchNames,
  normalizeOrganization,
  normalizePerson,
  splitNames,
  trigramSimilarity,
} from "./names";

describe("name normalization", () => {
  it.each([
    ["Robert Smith", "robert smith"],
    ["Bob Smith", "robert smith"],
    ["Smith, Robert J.", "robert smith"],
    ["Mr. Robert J Smith Jr.", "robert smith"],
    ["LIZ O'NEIL", "elizabeth oneil"],
  ])("%s -> %s", (input, expected) => expect(normalizePerson(input)).toBe(expected));

  it.each([
    ["Acme Widgets, LLC", "acme widgets"],
    ["The Acme Widgets Company", "acme widgets"],
    ["ACME WIDGETS L.L.C.", "acme widgets"],
  ])("%s -> %s", (input, expected) => expect(normalizeOrganization(input)).toBe(expected));
});

describe("trigram similarity matches pg_trgm's definition", () => {
  it("identical strings are 1, disjoint are 0", () => {
    expect(trigramSimilarity("robert smith", "robert smith")).toBe(1);
    expect(trigramSimilarity("abc", "xyz")).toBe(0);
  });
});

describe("name matching", () => {
  it.each([
    ["Robert Smith", "Bob Smith", "nickname"],
    ["Smith, Robert", "Robert Smith", "nickname"],
    ["Robert Smith", "R. Smith", "same_surname_initial"],
    ["Jonathan Smyth", "Jonathon Smith", "similar_spelling"],
    ["Acme Widgets LLC", "Acme Widgets, Inc.", "exact"],
    ["Acme Widgets", "Acme Widgets Holdings LLC", "name_contains"],
    ["Maria Delacruz", "Delacruz Maria", "reordered"],
  ] as const)("%s ~ %s (%s)", (a, b, reason) => {
    expect(matchNames(a, b)?.reason).toBe(reason);
  });

  it.each([
    ["Robert Smith", "Mary Smith"],
    ["Acme Widgets", "Apex Gadgets"],
    ["John Brown", "Joan Browning"],
  ])("no hit: %s vs %s", (a, b) => expect(matchNames(a, b)).toBeNull());
});

describe("splitting answers into names", () => {
  it("splits lists and drops relationships and non-names", () => {
    expect(splitNames("Acme LLC and my partner Robert Smith; Jane Doe")).toEqual([
      "Acme LLC",
      "Robert Smith",
      "Jane Doe",
    ]);
    expect(splitNames("just me")).toEqual([]);
    expect(splitNames("n/a")).toEqual([]);
  });
});
