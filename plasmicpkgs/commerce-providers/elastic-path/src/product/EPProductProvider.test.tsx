/**
 * @jest-environment jsdom
 *
 * Regression for FormProvider on EPProductProvider: child mount effects that
 * seed form values (e.g. EPStockProvider copying `?location=` into
 * SelectedLocationSlug) must survive. A parent `useEffect` + `reset()` runs
 * after child effects and would wipe them; keyed ProductFormScope remounts
 * instead.
 */

import React, { useEffect } from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useFormContext } from "react-hook-form";

jest.mock("@plasmicapp/host", () => {
  const actual = jest.requireActual("@plasmicapp/host");
  return {
    ...actual,
    usePlasmicCanvasContext: () => undefined,
    DataProvider: ({
      children,
      name,
    }: {
      children: React.ReactNode;
      name: string;
      data?: unknown;
    }) => <div data-testid={`data-provider-${name}`}>{children}</div>,
  };
});

jest.mock("./use-product", () => ({
  __esModule: true,
  default: () => ({ data: undefined, isLoading: false, error: undefined }),
}));

const { EPProductProvider } = require("./EPProductProvider") as typeof import("./EPProductProvider");

const PRODUCT_A = {
  id: "prod-a",
  name: "Product A",
  slug: "product-a",
  price: { value: 0, currencyCode: "USD" },
  images: [],
  variants: [],
  options: [],
};

const PRODUCT_B = {
  ...PRODUCT_A,
  id: "prod-b",
  name: "Product B",
  slug: "product-b",
};

/**
 * Mirrors EPStockProvider's mount seed: set SelectedLocationSlug once when
 * empty. Uses stable setValue/getValues deps (not the whole form object).
 */
function SeedLocationFromMount() {
  const { setValue, getValues, watch } = useFormContext();
  useEffect(() => {
    if (!getValues("SelectedLocationSlug")) {
      setValue("SelectedLocationSlug", "from-url");
    }
  }, [setValue, getValues]);
  const slug = watch("SelectedLocationSlug") as string | undefined;
  return (
    <>
      <span data-testid="seeded-slug">{slug ?? ""}</span>
      <button
        type="button"
        data-testid="stamp-slug"
        onClick={() => setValue("SelectedLocationSlug", "stamped")}
      >
        stamp
      </button>
    </>
  );
}

describe("EPProductProvider FormProvider", () => {
  it("keeps values set by a child mount effect (no parent reset wipe)", async () => {
    render(
      <EPProductProvider product={PRODUCT_A as any} productId={PRODUCT_A.id}>
        <SeedLocationFromMount />
      </EPProductProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId("seeded-slug").textContent).toBe("from-url");
    });
  });

  it("starts a fresh form when the product id changes", async () => {
    const { rerender } = render(
      <EPProductProvider product={PRODUCT_A as any} productId={PRODUCT_A.id}>
        <SeedLocationFromMount />
      </EPProductProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId("seeded-slug").textContent).toBe("from-url");
    });

    act(() => {
      fireEvent.click(screen.getByTestId("stamp-slug"));
    });
    expect(screen.getByTestId("seeded-slug").textContent).toBe("stamped");

    rerender(
      <EPProductProvider product={PRODUCT_B as any} productId={PRODUCT_B.id}>
        <SeedLocationFromMount />
      </EPProductProvider>
    );

    // New ProductFormScope → empty form → mount effect seeds again.
    // If the old form instance were reused, "stamped" would still be there
    // and the empty-guard would skip seeding.
    await waitFor(() => {
      expect(screen.getByTestId("seeded-slug").textContent).toBe("from-url");
    });
  });
});
