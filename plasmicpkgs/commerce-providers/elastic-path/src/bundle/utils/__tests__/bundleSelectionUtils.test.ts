/**
 * @jest-environment jsdom
 */

const {
  sortByOrder,
  convertSelectionsForAPI,
  areSelectionsEqual,
  getDefaultSelections,
} = require("../bundleSelectionUtils");

describe("sortByOrder", () => {
  it("sorts items by sort_order ascending", () => {
    const items = [
      { name: "C", sort_order: 3 },
      { name: "A", sort_order: 1 },
      { name: "B", sort_order: 2 },
    ];
    const sorted = sortByOrder(items);
    expect(sorted.map((i: any) => i.name)).toEqual(["A", "B", "C"]);
  });

  it("places null sort_order at the end", () => {
    const items = [
      { name: "B", sort_order: 2 },
      { name: "No order", sort_order: null },
      { name: "A", sort_order: 1 },
    ];
    const sorted = sortByOrder(items);
    expect(sorted.map((i: any) => i.name)).toEqual(["A", "B", "No order"]);
  });

  it("places undefined sort_order at the end", () => {
    const items = [
      { name: "B", sort_order: 2 },
      { name: "No order" },
      { name: "A", sort_order: 1 },
    ];
    const sorted = sortByOrder(items);
    expect(sorted.map((i: any) => i.name)).toEqual(["A", "B", "No order"]);
  });

  it("returns empty array for empty input", () => {
    expect(sortByOrder([])).toEqual([]);
  });

  it("does not mutate the original array", () => {
    const items = [
      { name: "B", sort_order: 2 },
      { name: "A", sort_order: 1 },
    ];
    sortByOrder(items);
    expect(items[0].name).toBe("B");
  });
});

describe("convertSelectionsForAPI", () => {
  it("passes through simple keys unchanged", () => {
    const result = convertSelectionsForAPI({
      component1: { "option-1": 1, "option-2": 2 },
    });
    expect(result).toEqual({
      component1: { "option-1": 1, "option-2": 2 },
    });
  });

  it("transforms parentId:childId keys to use childId only", () => {
    const result = convertSelectionsForAPI({
      component1: { "parent-1:child-1": 1 },
    });
    expect(result).toEqual({
      component1: { "child-1": 1 },
    });
  });

  it("handles mixed simple and parent:child keys", () => {
    const result = convertSelectionsForAPI({
      component1: { "simple-1": 1, "parent-1:child-1": 2 },
    });
    expect(result).toEqual({
      component1: { "simple-1": 1, "child-1": 2 },
    });
  });

  it("excludes BundleConfiguration field", () => {
    const result = convertSelectionsForAPI({
      component1: { "option-1": 1 },
      BundleConfiguration: { some: 1 } as any,
    });
    expect(result).toEqual({
      component1: { "option-1": 1 },
    });
    expect(result.BundleConfiguration).toBeUndefined();
  });

  it("excludes ConfiguredBundleId field", () => {
    const result = convertSelectionsForAPI({
      component1: { "option-1": 1 },
      ConfiguredBundleId: { some: 1 } as any,
    });
    expect(result).toEqual({
      component1: { "option-1": 1 },
    });
    expect(result.ConfiguredBundleId).toBeUndefined();
  });

  it("returns empty object for empty input", () => {
    expect(convertSelectionsForAPI({})).toEqual({});
  });

  it("handles multiple components", () => {
    const result = convertSelectionsForAPI({
      processor: { "opt-1": 1 },
      memory: { "mem-1": 2 },
      storage: { "parent-1:child-1": 1 },
    });
    expect(result).toEqual({
      processor: { "opt-1": 1 },
      memory: { "mem-1": 2 },
      storage: { "child-1": 1 },
    });
  });
});

describe("areSelectionsEqual", () => {
  it("returns true for identical selections", () => {
    const sel = { component1: { "opt-1": 1 } };
    expect(areSelectionsEqual(sel, { ...sel })).toBe(true);
  });

  it("returns true for empty selections", () => {
    expect(areSelectionsEqual({}, {})).toBe(true);
  });

  it("returns false when component counts differ", () => {
    expect(
      areSelectionsEqual({ c1: { "opt-1": 1 } }, { c1: { "opt-1": 1 }, c2: { "opt-2": 1 } })
    ).toBe(false);
  });

  it("returns false when option keys differ", () => {
    expect(
      areSelectionsEqual(
        { c1: { "opt-1": 1 } },
        { c1: { "opt-2": 1 } }
      )
    ).toBe(false);
  });

  it("returns false when quantities differ", () => {
    expect(
      areSelectionsEqual(
        { c1: { "opt-1": 1 } },
        { c1: { "opt-1": 2 } }
      )
    ).toBe(false);
  });

  it("returns false when a component key is missing in second object", () => {
    expect(
      areSelectionsEqual({ c1: { "opt-1": 1 } }, { c2: { "opt-1": 1 } })
    ).toBe(false);
  });

  it("returns false when option counts differ within a component", () => {
    expect(
      areSelectionsEqual(
        { c1: { "opt-1": 1, "opt-2": 1 } },
        { c1: { "opt-1": 1 } }
      )
    ).toBe(false);
  });
});

describe("getDefaultSelections", () => {
  it("selects default option for required components", () => {
    const components = {
      processor: {
        name: "Processor",
        min: 1,
        max: 1,
        options: [
          { id: "opt-1", quantity: 1, default: true },
          { id: "opt-2", quantity: 1, default: false },
        ],
      },
    };

    const result = getDefaultSelections(components);
    expect(result).toEqual({
      processor: { "opt-1": 1 },
    });
  });

  it("falls back to first option when no default is marked", () => {
    const components = {
      processor: {
        name: "Processor",
        min: 1,
        max: 1,
        options: [
          { id: "opt-1", quantity: 1, default: false },
          { id: "opt-2", quantity: 1, default: false },
        ],
      },
    };

    const result = getDefaultSelections(components);
    expect(result).toEqual({
      processor: { "opt-1": 1 },
    });
  });

  it("does not select defaults for optional components (min=0)", () => {
    const components = {
      extras: {
        name: "Extras",
        min: 0,
        max: 3,
        options: [
          { id: "ext-1", quantity: 1, default: true },
        ],
      },
    };

    const result = getDefaultSelections(components);
    expect(result.extras).toBeUndefined();
  });

  it("preserves existing selections and does not override them", () => {
    const components = {
      processor: {
        name: "Processor",
        min: 1,
        max: 1,
        options: [
          { id: "opt-1", quantity: 1, default: true },
          { id: "opt-2", quantity: 1, default: false },
        ],
      },
    };

    const existing = { processor: { "opt-2": 1 } };
    const result = getDefaultSelections(components, existing);
    expect(result).toEqual({
      processor: { "opt-2": 1 },
    });
  });

  it("uses option.quantity for the default quantity", () => {
    const components = {
      memory: {
        name: "Memory",
        min: 1,
        max: 4,
        options: [
          { id: "mem-1", quantity: 2, default: true },
        ],
      },
    };

    const result = getDefaultSelections(components);
    expect(result).toEqual({
      memory: { "mem-1": 2 },
    });
  });

  it("defaults quantity to 1 when option has no quantity", () => {
    const components = {
      processor: {
        name: "Processor",
        min: 1,
        max: 1,
        options: [{ id: "opt-1", default: true }],
      },
    };

    const result = getDefaultSelections(components);
    expect(result).toEqual({
      processor: { "opt-1": 1 },
    });
  });

  it("handles components with no options", () => {
    const components = {
      processor: {
        name: "Processor",
        min: 1,
        max: 1,
        options: [],
      },
    };

    const result = getDefaultSelections(components);
    // No selection possible
    expect(result.processor).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Regression: what Elastic Path refuses to accept in selected_options
// ---------------------------------------------------------------------------
describe("convertSelectionsForAPI — rejected payload shapes", () => {
  it("drops a deselected option rather than sending quantity 0", () => {
    // A single zero fails the whole add with "Must be greater than or equal
    // to 1", so deselecting one option used to break add-to-cart for the
    // entire bundle.
    const result = convertSelectionsForAPI({
      games: { "game-a": 1, "game-b": 0 },
    });
    expect(result).toEqual({ games: { "game-a": 1 } });
  });

  it("drops negative quantities too", () => {
    const result = convertSelectionsForAPI({
      games: { "game-a": -1, "game-b": 2 },
    });
    expect(result).toEqual({ games: { "game-b": 2 } });
  });

  it("drops the bare parent once one of its variations is selected", () => {
    // Sending both counts as two selections against the component's max, and
    // a parent product is not purchasable in its own right.
    const result = convertSelectionsForAPI({
      material: { "parent-1:child-9": 1, "parent-1": 1 },
    });
    expect(result).toEqual({ material: { "child-9": 1 } });
  });

  it("keeps an unrelated parent that has no variation selected", () => {
    const result = convertSelectionsForAPI({
      gift: { "parent-1:child-9": 1, "parent-2": 1 },
    });
    expect(result).toEqual({ gift: { "child-9": 1, "parent-2": 1 } });
  });

  it("leaves a component empty when every selection was zeroed", () => {
    const result = convertSelectionsForAPI({ games: { "game-a": 0 } });
    expect(result).toEqual({ games: {} });
  });
});
