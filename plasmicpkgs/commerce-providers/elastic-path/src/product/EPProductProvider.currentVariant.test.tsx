/** @jest-environment jsdom */

/**
 * What EPProductProvider publishes as `currentVariant`.
 *
 * The picker resolves the chosen child and writes its id to the `ProductVariant`
 * form field; the provider turns that into a product-shaped object the buybox
 * can read. Before that existed, a PDP price bound to `currentProduct` quoted
 * the parent — $20.00 on the page against $15.00 in the cart.
 *
 * The sibling test file mocks DataProvider without its `data`, so this one
 * carries its own harness that keeps it.
 */
import React, { useEffect } from "react";
import { act, render, screen } from "@testing-library/react";
import { useFormContext } from "react-hook-form";

jest.mock("@plasmicapp/host", () => {
  const actual = jest.requireActual("@plasmicapp/host");
  return {
    ...actual,
    usePlasmicCanvasContext: () => undefined,
    DataProvider: ({
      children,
      name,
      data,
    }: {
      children: React.ReactNode;
      name: string;
      data?: unknown;
    }) => (
      <div data-testid={`dp-${name}`} data-value={JSON.stringify(data ?? null)}>
        {children}
      </div>
    ),
  };
});

let mockProductData: unknown = undefined;
jest.mock("./use-product", () => ({
  __esModule: true,
  default: () => ({ data: mockProductData, isLoading: false, error: undefined }),
}));

const { EPProductProvider } =
  require("./EPProductProvider") as typeof import("./EPProductProvider");

const price = (amount: number) => ({
  amount,
  currency: "USD",
  float_price: amount / 100,
  formatted: `$${(amount / 100).toFixed(2)}`,
});

const PARENT = {
  id: "parent-1",
  attributes: { name: "Sandle", sku: "sandle", description: "A sandle" },
  meta: {
    display_price: { without_tax: price(2000), with_tax: price(2400) },
  },
  images: [],
  variations: [],
  childProducts: [
    {
      id: "child-sm",
      name: "Sandle",
      sku: "sandlesm",
      price: price(1500),
      optionIds: ["opt-sm"],
      images: [],
    },
    {
      id: "child-nopric",
      name: "Sandle",
      sku: "sandlexl",
      price: undefined,
      optionIds: ["opt-xl"],
      images: [],
    },
  ],
};

/** Stands in for the picker: writes the chosen child id into the form. */
function ChooseVariant({ id }: { id?: string }) {
  const { setValue } = useFormContext();
  useEffect(() => {
    if (id) setValue("ProductVariant", id);
  }, [id, setValue]);
  return null;
}

function readVariant() {
  const node = screen.getByTestId("dp-currentVariant");
  return JSON.parse(node.getAttribute("data-value") ?? "null");
}

async function renderWith(variantId?: string) {
  mockProductData = PARENT;
  await act(async () => {
    render(
      <EPProductProvider productId="parent-1">
        <ChooseVariant id={variantId} />
      </EPProductProvider>
    );
  });
}

describe("EPProductProvider — currentVariant", () => {
  afterEach(() => {
    mockProductData = undefined;
  });

  it("publishes nothing until a variant is chosen", async () => {
    await renderWith(undefined);

    expect(readVariant()).toBeNull();
  });

  it("publishes the chosen child, shaped like a product", async () => {
    await renderWith("child-sm");

    const variant = readVariant();
    expect(variant.id).toBe("child-sm");
    expect(variant.attributes.sku).toBe("sandlesm");
    expect(variant.meta.display_price.without_tax.formatted).toBe("$15.00");
  });

  it("does not carry the parent's tax-inclusive price on the child", async () => {
    // A child reports only without_tax. Keeping the parent's with_tax would
    // answer a tax-inclusive binding with a different product's money.
    await renderWith("child-sm");

    expect(readVariant().meta.display_price.with_tax).toBeUndefined();
  });

  it("keeps the parent's non-price fields", async () => {
    await renderWith("child-sm");

    expect(readVariant().attributes.description).toBe("A sandle");
  });

  it("gives a child with no price of its own no price at all", async () => {
    // It cannot be bought at the parent's price — EP rejects the add — so
    // quoting one would be a lie.
    await renderWith("child-nopric");

    const variant = readVariant();
    expect(variant.id).toBe("child-nopric");
    expect(variant.meta.display_price).toBeUndefined();
  });

  it("publishes nothing for an id that matches no child", async () => {
    await renderWith("not-a-child");

    expect(readVariant()).toBeNull();
  });
});
