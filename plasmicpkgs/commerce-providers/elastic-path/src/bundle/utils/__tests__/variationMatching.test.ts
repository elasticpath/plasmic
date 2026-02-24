/**
 * @jest-environment jsdom
 */

const {
  getOptionsFromSkuId,
  findMatchingVariant,
} = require("../variationMatching");

describe("getOptionsFromSkuId", () => {
  it("returns option path for a matching leaf SKU", () => {
    const matrix = {
      "opt-red": {
        "opt-512": "child-red-512",
        "opt-1tb": "child-red-1tb",
      },
      "opt-blue": {
        "opt-512": "child-blue-512",
      },
    };

    expect(getOptionsFromSkuId("child-red-512", matrix)).toEqual([
      "opt-red",
      "opt-512",
    ]);
    expect(getOptionsFromSkuId("child-red-1tb", matrix)).toEqual([
      "opt-red",
      "opt-1tb",
    ]);
    expect(getOptionsFromSkuId("child-blue-512", matrix)).toEqual([
      "opt-blue",
      "opt-512",
    ]);
  });

  it("returns undefined for non-matching SKU", () => {
    const matrix = {
      "opt-red": {
        "opt-512": "child-red-512",
      },
    };

    expect(getOptionsFromSkuId("non-existent", matrix)).toBeUndefined();
  });

  it("handles flat (single-variation) matrix", () => {
    const matrix = {
      "opt-red": "child-red",
      "opt-blue": "child-blue",
    };

    expect(getOptionsFromSkuId("child-red", matrix)).toEqual(["opt-red"]);
    expect(getOptionsFromSkuId("child-blue", matrix)).toEqual(["opt-blue"]);
  });

  it("handles deeply nested (3+ variations) matrix", () => {
    const matrix = {
      "opt-red": {
        "opt-512": {
          "opt-wifi": "child-red-512-wifi",
          "opt-cellular": "child-red-512-cell",
        },
      },
    };

    expect(getOptionsFromSkuId("child-red-512-wifi", matrix)).toEqual([
      "opt-red",
      "opt-512",
      "opt-wifi",
    ]);
  });

  it("returns undefined for empty matrix", () => {
    expect(getOptionsFromSkuId("any-id", {})).toBeUndefined();
  });
});

describe("findMatchingVariant", () => {
  const parentInfo = {
    id: "parent-1",
    isParent: true,
    loading: false,
    children: [
      { id: "child-red-512", name: "Red 512GB", sku: "RED-512" },
      { id: "child-blue-512", name: "Blue 512GB", sku: "BLUE-512" },
      { id: "child-red-1tb", name: "Red 1TB", sku: "RED-1TB" },
    ],
    variations: [
      {
        id: "var-color",
        name: "Color",
        options: [
          { id: "opt-red", name: "Red" },
          { id: "opt-blue", name: "Blue" },
        ],
      },
      {
        id: "var-capacity",
        name: "Capacity",
        options: [
          { id: "opt-512", name: "512GB" },
          { id: "opt-1tb", name: "1TB" },
        ],
      },
    ],
    variationMatrix: {
      "opt-red": {
        "opt-512": "child-red-512",
        "opt-1tb": "child-red-1tb",
      },
      "opt-blue": {
        "opt-512": "child-blue-512",
      },
    },
  };

  it("finds matching variant for complete selections", () => {
    const selections = { "var-color": "Red", "var-capacity": "512GB" };
    const result = findMatchingVariant(selections, parentInfo);
    expect(result).toEqual(
      expect.objectContaining({ id: "child-red-512", name: "Red 512GB" })
    );
  });

  it("finds different variant for different selections", () => {
    const selections = { "var-color": "Red", "var-capacity": "1TB" };
    const result = findMatchingVariant(selections, parentInfo);
    expect(result).toEqual(
      expect.objectContaining({ id: "child-red-1tb", name: "Red 1TB" })
    );
  });

  it("returns null for empty selections", () => {
    expect(findMatchingVariant({}, parentInfo)).toBeNull();
  });

  it("returns null for incomplete selections (not all variations selected)", () => {
    const selections = { "var-color": "Red" }; // missing capacity
    expect(findMatchingVariant(selections, parentInfo)).toBeNull();
  });

  it("returns null when parent has no children", () => {
    const noChildren = { ...parentInfo, children: undefined };
    const selections = { "var-color": "Red", "var-capacity": "512GB" };
    expect(findMatchingVariant(selections, noChildren as any)).toBeNull();
  });

  it("returns null when parent has no variationMatrix", () => {
    const noMatrix = { ...parentInfo, variationMatrix: undefined };
    const selections = { "var-color": "Red", "var-capacity": "512GB" };
    expect(findMatchingVariant(selections, noMatrix as any)).toBeNull();
  });

  it("returns null when no child matches the selected combination", () => {
    // Blue 1TB doesn't exist in the matrix
    const selections = { "var-color": "Blue", "var-capacity": "1TB" };
    const result = findMatchingVariant(selections, parentInfo);
    expect(result).toBeNull();
  });

  it("returns null when variation name does not match any option", () => {
    const selections = {
      "var-color": "NonExistentColor",
      "var-capacity": "512GB",
    };
    const result = findMatchingVariant(selections, parentInfo);
    expect(result).toBeNull();
  });

  it("handles parent with no variations array", () => {
    const noVariations = { ...parentInfo, variations: undefined };
    const selections = { "var-color": "Red", "var-capacity": "512GB" };
    // variations.length would be 0 (from default []), selections.length is 2 → not equal → null
    expect(findMatchingVariant(selections, noVariations as any)).toBeNull();
  });
});
