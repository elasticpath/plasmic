/**
 * Tests for common utility functions (withoutNils, dedup).
 *
 * Why: These helpers are used throughout the normalize pipeline.
 * withoutNils filters null/undefined from arrays while preserving the type,
 * dedup removes duplicates via Set. Both are safety nets for API responses
 * that may contain gaps or repeated entries.
 */

import { withoutNils, dedup } from "../common";

describe("withoutNils", () => {
  it("removes null values from array", () => {
    expect(withoutNils([1, null, 2, null, 3])).toEqual([1, 2, 3]);
  });

  it("removes undefined values from array", () => {
    expect(withoutNils([1, undefined, 2, undefined, 3])).toEqual([1, 2, 3]);
  });

  it("removes both null and undefined", () => {
    expect(withoutNils(["a", null, "b", undefined, "c"])).toEqual([
      "a",
      "b",
      "c",
    ]);
  });

  it("returns empty array when all values are nil", () => {
    expect(withoutNils([null, undefined, null])).toEqual([]);
  });

  it("returns same values when no nils present", () => {
    expect(withoutNils([1, 2, 3])).toEqual([1, 2, 3]);
  });

  it("returns empty array for empty input", () => {
    expect(withoutNils([])).toEqual([]);
  });

  it("preserves falsy non-nil values (0, false, empty string)", () => {
    expect(withoutNils([0, false, "", null, undefined])).toEqual([
      0,
      false,
      "",
    ]);
  });
});

describe("dedup", () => {
  it("removes duplicate numbers", () => {
    expect(dedup([1, 2, 2, 3, 3, 3])).toEqual([1, 2, 3]);
  });

  it("removes duplicate strings", () => {
    expect(dedup(["a", "b", "a", "c", "b"])).toEqual(["a", "b", "c"]);
  });

  it("preserves order of first occurrence", () => {
    expect(dedup([3, 1, 2, 1, 3])).toEqual([3, 1, 2]);
  });

  it("returns empty array for empty input", () => {
    expect(dedup([])).toEqual([]);
  });

  it("returns same array when no duplicates", () => {
    expect(dedup([1, 2, 3])).toEqual([1, 2, 3]);
  });

  it("handles single-element array", () => {
    expect(dedup([42])).toEqual([42]);
  });
});
