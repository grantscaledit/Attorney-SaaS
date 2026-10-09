import { describe, expect, it } from "vitest";
import { diffSnapshots } from "./diff";

describe("diffSnapshots", () => {
  it("lists changed, added and removed fields", () => {
    expect(diffSnapshots({ a: 1, b: 2, c: [1] }, { a: 1, b: 3, c: [1, 2], d: "x" })).toEqual([
      { field: "b", before: 2, after: 3 },
      { field: "c", before: [1], after: [1, 2] },
      { field: "d", before: null, after: "x" },
    ]);
  });

  it("treats a create (null before) as all fields added", () => {
    expect(diffSnapshots(null, { name: "A" })).toEqual([{ field: "name", before: null, after: "A" }]);
  });

  it("returns nothing for identical snapshots", () => {
    expect(diffSnapshots({ a: { b: 1 } }, { a: { b: 1 } })).toEqual([]);
  });
});
