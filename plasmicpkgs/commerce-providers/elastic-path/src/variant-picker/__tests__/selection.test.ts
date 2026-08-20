import type { Product } from "../../types/product";
import { findChildProduct, initialSelection } from "../selection";

const product = {
  id: "base-1",
  variations: [
    {
      id: "var-size",
      name: "Size",
      options: [
        { id: "opt-s", name: "Small" },
        { id: "opt-m", name: "Medium" },
      ],
    },
    {
      id: "var-colour",
      name: "Colour",
      options: [
        { id: "opt-red", name: "Red" },
        { id: "opt-blue", name: "Blue" },
      ],
    },
  ],
  childProducts: [
    { id: "child-s-red", optionIds: ["opt-s", "opt-red"], name: "", images: [] },
    { id: "child-m-blue", optionIds: ["opt-m", "opt-blue"], name: "", images: [] },
  ],
} as unknown as Product;

describe("findChildProduct", () => {
  it("resolves the child whose options match every choice", () => {
    const child = findChildProduct(product, {
      "var-size": "Medium",
      "var-colour": "Blue",
    });

    expect(child?.id).toBe("child-m-blue");
  });

  it("selects nothing until every variation is chosen", () => {
    expect(findChildProduct(product, { "var-size": "Medium" })).toBeUndefined();
  });

  it("selects nothing when a chosen option no longer resolves", () => {
    // "Med" is what a saved selection holds after the option was renamed in
    // Commerce Manager; the first child is a different variant at a different
    // price, so it must not stand in.
    expect(
      findChildProduct(product, {
        "var-size": "Med",
        "var-colour": "Blue",
      })
    ).toBeUndefined();
  });

  it("selects nothing when no child carries the chosen combination", () => {
    expect(
      findChildProduct(product, {
        "var-size": "Small",
        "var-colour": "Blue",
      })
    ).toBeUndefined();
  });

  it("selects nothing when the product has no children", () => {
    expect(
      findChildProduct({ ...product, childProducts: [] }, {
        "var-size": "Medium",
        "var-colour": "Blue",
      })
    ).toBeUndefined();
  });
});

describe("initialSelection", () => {
  it("reads a child product back into the option names the picker shows", () => {
    expect(initialSelection(product, "child-m-blue")).toEqual({
      "var-size": "Medium",
      "var-colour": "Blue",
    });
  });
});
