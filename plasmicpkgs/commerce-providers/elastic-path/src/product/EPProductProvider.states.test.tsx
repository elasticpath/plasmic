/** @jest-environment jsdom */

/**
 * Which slot EP Product Provider renders, and what it publishes as
 * `currentProduct`, for each outcome of the product read — at runtime and on
 * the Studio canvas.
 */
import React from "react";
import { render, screen } from "@testing-library/react";

let mockInCanvas = false;
jest.mock("@plasmicapp/host", () => {
  const actual = jest.requireActual("@plasmicapp/host");
  return {
    ...actual,
    usePlasmicCanvasContext: () => (mockInCanvas ? {} : undefined),
    DataProvider: ({
      children,
      name,
      data,
    }: {
      children: React.ReactNode;
      name: string;
      data?: unknown;
    }) => (
      <div data-testid={`dp-${name}`} data-id={(data as any)?.id ?? ""}>
        {children}
      </div>
    ),
  };
});

let mockSwr: { data?: unknown; isLoading: boolean; error?: unknown } = {
  data: undefined,
  isLoading: false,
  error: undefined,
};
jest.mock("./use-product", () => ({
  __esModule: true,
  default: () => mockSwr,
}));

const { EPProductProvider } =
  require("./EPProductProvider") as typeof import("./EPProductProvider");

const PRODUCT = { id: "prod-1", attributes: { name: "Shirt" } };

function renderProvider(props: Record<string, unknown> = {}) {
  render(
    <EPProductProvider
      loadingContent={<span>loading-slot</span>}
      errorContent={<span>error-slot</span>}
      emptyContent={<span>empty-slot</span>}
      {...props}
    >
      <span>children-slot</span>
    </EPProductProvider>
  );
}

const slot = () =>
  ["loading-slot", "error-slot", "empty-slot", "children-slot"].find((s) =>
    screen.queryByText(s)
  );
const publishedId = () =>
  screen.getByTestId("dp-currentProduct").getAttribute("data-id");

beforeEach(() => {
  mockInCanvas = false;
  mockSwr = { data: undefined, isLoading: false, error: undefined };
});

describe.each([
  ["at runtime", false],
  ["on the canvas", true],
])("EPProductProvider %s", (_, inCanvas) => {
  beforeEach(() => {
    mockInCanvas = inCanvas;
  });

  it("renders the found product", () => {
    mockSwr = { data: PRODUCT, isLoading: false };
    renderProvider({ productId: "shirt" });

    expect(slot()).toBe("children-slot");
    expect(publishedId()).toBe("prod-1");
  });

  it("renders the empty slot when the reference names no product", () => {
    mockSwr = { data: null, isLoading: false };
    renderProvider({ productId: "gone" });

    expect(slot()).toBe("empty-slot");
  });

  it("renders the empty slot when a pre-fetched read found nothing", () => {
    renderProvider({ product: null, productId: "gone" });

    expect(slot()).toBe("empty-slot");
  });

  it("renders a pre-fetched product with no product reference bound", () => {
    renderProvider({ product: PRODUCT });

    expect(slot()).toBe("children-slot");
    expect(publishedId()).toBe("prod-1");
  });
});

describe("EPProductProvider when the read fails", () => {
  beforeEach(() => {
    mockSwr = { data: undefined, isLoading: false, error: new Error("503") };
  });

  it("renders the error slot at runtime", () => {
    renderProvider({ productId: "shirt" });

    expect(slot()).toBe("error-slot");
    expect(publishedId()).toBe("");
  });

  it("renders the sample product on the canvas", () => {
    mockInCanvas = true;
    renderProvider({ productId: "shirt" });

    expect(slot()).toBe("children-slot");
    expect(publishedId()).toBe("mock-product");
  });
});

describe("EPProductProvider with no product reference", () => {
  it("renders the empty slot at runtime", () => {
    renderProvider();

    expect(slot()).toBe("empty-slot");
    expect(publishedId()).toBe("");
  });

  it("renders the sample product on the canvas", () => {
    mockInCanvas = true;
    renderProvider();

    expect(slot()).toBe("children-slot");
    expect(publishedId()).toBe("mock-product");
  });
});

describe("EPProductProvider previewState on the canvas", () => {
  beforeEach(() => {
    mockInCanvas = true;
  });

  it.each([
    ["loading", "loading-slot"],
    ["error", "error-slot"],
    ["empty", "empty-slot"],
  ])("renders the %s slot over a found product", (previewState, expected) => {
    mockSwr = { data: PRODUCT, isLoading: false };
    renderProvider({ productId: "shirt", previewState });

    expect(slot()).toBe(expected);
  });

  it("renders the sample product for withData over a reference that found nothing", () => {
    mockSwr = { data: null, isLoading: false };
    renderProvider({ productId: "gone", previewState: "withData" });

    expect(slot()).toBe("children-slot");
    expect(publishedId()).toBe("mock-product");
  });

  it("is ignored at runtime", () => {
    mockInCanvas = false;
    mockSwr = { data: PRODUCT, isLoading: false };
    renderProvider({ productId: "shirt", previewState: "empty" });

    expect(slot()).toBe("children-slot");
  });
});

it("renders the loading slot while the read runs", () => {
  mockSwr = { data: undefined, isLoading: true };
  renderProvider({ productId: "shirt" });

  expect(slot()).toBe("loading-slot");
});
