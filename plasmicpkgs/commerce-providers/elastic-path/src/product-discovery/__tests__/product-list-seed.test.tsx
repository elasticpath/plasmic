/**
 * @jest-environment jsdom
 *
 * Server-rendered seed (`initialPage`) on EPProductListProvider — issue #377.
 *
 * The provider must render a page fetched server-side without repeating the
 * request in the browser, and must fall back to its own fetch the moment the
 * seed stops describing what the shopper is looking at.
 */

import React from "react";

const mockUseProductList = jest.fn();
const mockUsePlasmicCanvasContext = jest.fn();

jest.mock("@plasmicapp/host", () => ({
  DataProvider: ({
    children,
    name,
    data,
  }: {
    children: React.ReactNode;
    name: string;
    data: any;
  }) => (
    <div
      data-testid={`data-provider-${name}`}
      data-provider-data={JSON.stringify(data)}
    >
      {children}
    </div>
  ),
  usePlasmicCanvasContext: () => mockUsePlasmicCanvasContext(),
}));

jest.mock("@plasmicapp/host/registerComponent", () => ({
  __esModule: true,
  default: jest.fn(),
}));

jest.mock("../use-product-list", () => ({
  useProductList: (...a: unknown[]) => mockUseProductList(...a),
}));

import { act, render, screen } from "@testing-library/react";

const { EPProductListProvider } =
  require("../EPProductListProvider") as typeof import("../EPProductListProvider");

const seedProduct = (id: string) => ({
  id,
  type: "product",
  attributes: { name: id },
  images: [],
  variations: [],
  childProducts: [],
});

const SEED = {
  data: [seedProduct("seed-1"), seedProduct("seed-2")],
  meta: { results: { total: 57 }, page: { limit: 24, offset: 0 } },
};

function fetched(products: any[], totalCount = 99) {
  return { products, totalCount, isLoading: false, error: null, refetch: jest.fn() };
}

function gridData() {
  const node = screen.getByTestId("data-provider-productGridData");
  return JSON.parse(node.getAttribute("data-provider-data")!);
}

function lastOptions() {
  return mockUseProductList.mock.calls[mockUseProductList.mock.calls.length - 1][0];
}

beforeEach(() => {
  jest.clearAllMocks();
  mockUsePlasmicCanvasContext.mockReturnValue(undefined);
  mockUseProductList.mockReturnValue(fetched([seedProduct("client-1")]));
});

describe("EPProductListProvider initialPage", () => {
  it("renders the seeded page without fetching in the browser", () => {
    render(
      <EPProductListProvider initialPage={SEED}>
        <div>children</div>
      </EPProductListProvider>
    );

    expect(lastOptions().skip).toBe(true);
    const data = gridData();
    expect(data.products.map((p: any) => p.id)).toEqual(["seed-1", "seed-2"]);
    expect(data.totalCount).toBe(57);
    expect(data.isLoading).toBe(false);
  });

  it("takes its page size from the seed, not the Page Size prop", () => {
    render(
      <EPProductListProvider initialPage={SEED} pageSize={12}>
        <div>children</div>
      </EPProductListProvider>
    );

    const data = gridData();
    expect(data.pageSize).toBe(24);
    expect(data.totalPages).toBe(3);
    expect(data.summary).toBe("Showing 1-24 of 57 products");
    expect(lastOptions().pageSize).toBe(24);
  });

  /**
   * Studio canvas does not execute server queries, so the binding arrives as
   * an unresolved Promise. Treating that as data would leave the canvas empty.
   */
  it("falls through to the client fetch when the binding is an unresolved Promise", () => {
    render(
      <EPProductListProvider initialPage={Promise.resolve(SEED)}>
        <div>children</div>
      </EPProductListProvider>
    );

    expect(lastOptions().skip).toBe(false);
    expect(gridData().products.map((p: any) => p.id)).toEqual(["client-1"]);
  });

  it.each([
    ["an empty object", {}],
    ["a bare array", [seedProduct("x")]],
    ["null", null],
    ["undefined", undefined],
  ])("falls through to the client fetch for %s", (_label, value) => {
    render(
      <EPProductListProvider initialPage={value as any}>
        <div>children</div>
      </EPProductListProvider>
    );

    expect(lastOptions().skip).toBe(false);
  });

  it("keeps an empty seeded page distinct from a loading one", () => {
    render(
      <EPProductListProvider
        initialPage={{
          data: [],
          meta: { results: { total: 0 }, page: { limit: 24, offset: 0 } },
        }}
        emptyContent={<div>nothing here</div>}
      >
        <div>children</div>
      </EPProductListProvider>
    );

    expect(screen.getByText("nothing here")).toBeTruthy();
    expect(gridData().isEmpty).toBe(true);
  });

  /**
   * setSort survives only so an interaction already wired to it does not
   * throw. It must not discard the seed or re-fetch.
   */
  it("does nothing when the deprecated setSort is invoked", () => {
    const ref = React.createRef<any>();
    render(
      <EPProductListProvider ref={ref} initialPage={SEED}>
        <div>children</div>
      </EPProductListProvider>
    );

    act(() => ref.current.setSort("price-asc"));

    expect(lastOptions().skip).toBe(true);
    expect(lastOptions().page).toBe(0);
    expect(gridData().products.map((p: any) => p.id)).toEqual([
      "seed-1",
      "seed-2",
    ]);
  });

  it("discards the seed on page change", () => {
    const ref = React.createRef<any>();
    render(
      <EPProductListProvider ref={ref} initialPage={SEED}>
        <div>children</div>
      </EPProductListProvider>
    );

    act(() => ref.current.nextPage());

    expect(lastOptions().skip).toBe(false);
    expect(lastOptions().page).toBe(1);
  });

  /**
   * Without seeding the append buffer the grid would flash back to a
   * client-fetched page 0 on the first "Load more".
   */
  it("appends onto the seeded products in load-more mode", () => {
    const ref = React.createRef<any>();
    mockUseProductList.mockReturnValue(
      fetched([seedProduct("page2-1")], 57)
    );

    render(
      <EPProductListProvider ref={ref} initialPage={SEED}>
        <div>children</div>
      </EPProductListProvider>
    );

    act(() => ref.current.loadMore());

    expect(gridData().products.map((p: any) => p.id)).toEqual([
      "seed-1",
      "seed-2",
      "page2-1",
    ]);
  });
});
