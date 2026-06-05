/**
 * buildPageItems — windowed page-item model (ADR-0011 D4).
 */

import { buildPageItems } from "../pagination-window";

describe("buildPageItems", () => {
  const noop = () => {};

  it("returns [] when there are no pages", () => {
    expect(buildPageItems([], 0, 0, noop)).toEqual([]);
  });

  it("emits one page item per page with first/last/current flags", () => {
    const items = buildPageItems([0, 1, 2, 3], 4, 1, noop);
    expect(items.map((i) => i.label)).toEqual(["1", "2", "3", "4"]);
    expect(items[0].isFirst).toBe(true);
    expect(items[3].isLast).toBe(true);
    expect(items[1].isCurrent).toBe(true);
    expect(items.every((i) => i.type === "page")).toBe(true);
  });

  it("inserts a leading anchor + ellipsis when the window starts past page 1", () => {
    // window [5,6,7] of 20 pages, current 6
    const items = buildPageItems([5, 6, 7], 20, 6, noop);
    expect(items[0]).toMatchObject({ type: "page", label: "1", isFirst: true });
    expect(items[1].type).toBe("ellipsis");
    expect(items[1].label).toBe("…");
    // window pages follow
    expect(items.slice(2, 5).map((i) => i.label)).toEqual(["6", "7", "8"]);
  });

  it("inserts a trailing ellipsis + last-page anchor when the window ends early", () => {
    const items = buildPageItems([5, 6, 7], 20, 6, noop);
    const last = items[items.length - 1];
    expect(last).toMatchObject({ type: "page", label: "20", isLast: true });
    expect(items[items.length - 2].type).toBe("ellipsis");
  });

  it("does not insert an ellipsis when the window is adjacent to the anchor", () => {
    // window [1,2,3] of 5: page 0 anchor is adjacent to page 1 → no gap
    const items = buildPageItems([1, 2, 3], 5, 2, noop);
    expect(items.map((i) => i.label)).toEqual(["1", "2", "3", "4", "5"]);
    expect(items.some((i) => i.type === "ellipsis")).toBe(false);
  });

  it("binds each page item's goTo to its own 0-indexed page", () => {
    const goTo = jest.fn();
    const items = buildPageItems([0, 1, 2], 3, 0, goTo);
    items[2].goTo!();
    expect(goTo).toHaveBeenCalledWith(2);
  });
});
