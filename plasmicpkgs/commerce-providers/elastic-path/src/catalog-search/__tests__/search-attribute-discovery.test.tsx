/**
 * @jest-environment jsdom
 */
import React from "react";
import { act, render } from "@testing-library/react";

const mockUsePlasmicCanvasContext = jest.fn();

jest.mock("@plasmicapp/host", () => ({
  DataProvider: ({ children, name, data }: any) => (
    <div data-provider={name} data-provider-data={JSON.stringify(data)}>
      {children}
    </div>
  ),
  repeatedElement: (_index: number, children: React.ReactNode) => children,
  usePlasmicCanvasContext: () => mockUsePlasmicCanvasContext(),
}));

jest.mock("@plasmicapp/host/registerComponent", () => ({
  __esModule: true,
  default: jest.fn(),
}));

jest.mock("react-instantsearch", () => ({
  useRefinementList: jest.fn(),
  useMenu: jest.fn(),
  useHierarchicalMenu: jest.fn(),
  useRange: jest.fn(),
}));

const { EPRefinementList, epRefinementListMeta } =
  require("../EPRefinementList") as typeof import("../EPRefinementList");
const { EPHierarchicalMenu, epHierarchicalMenuMeta } =
  require("../EPHierarchicalMenu") as typeof import("../EPHierarchicalMenu");
const { EPRangeFilter, epRangeFilterMeta } =
  require("../EPRangeFilter") as typeof import("../EPRangeFilter");
const { resetSearchAttributeDiscovery } =
  require("../search-attributes") as typeof import("../search-attributes");

const STORE_ATTRIBUTES = [
  { path: "meta.search.categories.lvl0", numeric: false },
  { path: "meta.search.categories.lvl1", numeric: false },
  { path: "meta.search.categories.lvl10", numeric: false },
  { path: "meta.search.categories.lvl2", numeric: false },
  { path: "price.USD.float_price", numeric: true },
  { path: "rating", numeric: true },
  { path: "tags", numeric: false },
];

function optionsOf(meta: any, prop: string, props: any, ctx: any) {
  const control = meta.props[prop];
  expect(control.type).toBe("choice");
  expect(typeof control.options).toBe("function");
  const options = control.options(props, ctx);
  expect(Array.isArray(options)).toBe(true);
  return options.map((o: any) => (typeof o === "object" ? o.value : o));
}

describe("attribute dropdowns", () => {
  const ctx = { attributes: STORE_ATTRIBUTES };

  it("offers every field the store can filter on to the refinement list", () => {
    expect(optionsOf(epRefinementListMeta, "attribute", {}, ctx)).toEqual(
      STORE_ATTRIBUTES.map((a) => a.path)
    );
  });

  it("offers only numeric fields to the range filter", () => {
    expect(optionsOf(epRangeFilterMeta, "attribute", {}, ctx)).toEqual([
      "price.USD.float_price",
      "rating",
    ]);
  });

  it("offers each level hierarchy to the hierarchical menu, levels in order", () => {
    expect(optionsOf(epHierarchicalMenuMeta, "attributes", {}, ctx)).toEqual([
      "meta.search.categories.lvl0,meta.search.categories.lvl1,meta.search.categories.lvl2,meta.search.categories.lvl10",
    ]);
  });

  it("keeps a saved value the store does not report, so the control still shows it", () => {
    expect(
      optionsOf(
        epRefinementListMeta,
        "attribute",
        { attribute: "extensions.products(specs).product_kind" },
        ctx
      )[0]
    ).toBe("extensions.products(specs).product_kind");
    expect(
      optionsOf(epRangeFilterMeta, "attribute", { attribute: "weight" }, ctx)[0]
    ).toBe("weight");
    expect(
      optionsOf(
        epHierarchicalMenuMeta,
        "attributes",
        { attributes: "categories.lvl0,categories.lvl1" },
        ctx
      )[0]
    ).toBe("categories.lvl0,categories.lvl1");
  });

  it("lists only the saved value before the store has answered", () => {
    expect(optionsOf(epRefinementListMeta, "attribute", {}, null)).toEqual([]);
    expect(
      optionsOf(epRangeFilterMeta, "attribute", { attribute: "rating" }, null)
    ).toEqual(["rating"]);
  });

  it("guesses no default", () => {
    expect((epRefinementListMeta.props as any).attribute.defaultValue).toBe(
      undefined
    );
    expect(
      (epHierarchicalMenuMeta.props as any).attributes.defaultValue
    ).toBe(undefined);
    expect((epRangeFilterMeta.props as any).attribute.defaultValue).toBe(
      undefined
    );
  });
});

describe("discovery on the canvas", () => {
  let fetchMock: jest.Mock;
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    resetSearchAttributeDiscovery();
    mockUsePlasmicCanvasContext.mockReturnValue({});
    (window as any).__CanvasPkgs = {};
    fetchMock = jest.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => STORE_ATTRIBUTES,
    }));
    globalThis.fetch = fetchMock as any;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    delete (window as any).__CanvasPkgs;
  });

  async function settle() {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
  }

  it("hands the store's fields to Studio from the design-time route", async () => {
    const setControlContextData = jest.fn();

    render(
      <EPRefinementList setControlContextData={setControlContextData as any} />
    );
    await settle();

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/ep/design/getSearchAttributes",
      expect.objectContaining({ method: "POST" })
    );
    expect(setControlContextData).toHaveBeenLastCalledWith({
      attributes: STORE_ATTRIBUTES,
    });
  });

  it("asks the store once for all three filters", async () => {
    const setControlContextData = jest.fn();

    render(
      <>
        <EPRefinementList setControlContextData={setControlContextData as any} />
        <EPHierarchicalMenu
          setControlContextData={setControlContextData as any}
        />
        <EPRangeFilter setControlContextData={setControlContextData as any} />
      </>
    );
    await settle();

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("renders the canvas exactly as before", async () => {
    const plain = render(
      <>
        <EPRefinementList attribute="tags" />
        <EPHierarchicalMenu />
        <EPRangeFilter>
          <span>range</span>
        </EPRangeFilter>
      </>
    );
    const before = plain.container.innerHTML;
    plain.unmount();

    const discovering = render(
      <>
        <EPRefinementList
          attribute="tags"
          setControlContextData={jest.fn() as any}
        />
        <EPHierarchicalMenu setControlContextData={jest.fn() as any} />
        <EPRangeFilter setControlContextData={jest.fn() as any}>
          <span>range</span>
        </EPRangeFilter>
      </>
    );
    await settle();

    expect(discovering.container.innerHTML).toBe(before);
  });

  it("asks nothing when Studio is not collecting control data", async () => {
    render(<EPRefinementList />);
    await settle();

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("leaves the dropdown at the saved value when the route cannot answer", async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 404,
      json: async () => ({ code: "route_not_found" }),
    });
    jest.spyOn(console, "warn").mockImplementation(() => {});
    const setControlContextData = jest.fn();

    render(
      <EPRefinementList setControlContextData={setControlContextData as any} />
    );
    await settle();

    const passed = setControlContextData.mock.calls.map((c) => c[0]);
    expect(passed.every((d) => !d?.attributes?.length)).toBe(true);
  });

  it.each([
    [
      "answers with an error",
      () =>
        fetchMock.mockResolvedValueOnce({
          ok: false,
          status: 500,
          json: async () => ({}),
        }),
    ],
    [
      "cannot be reached",
      () => fetchMock.mockRejectedValueOnce(new TypeError("network down")),
    ],
  ])("asks again on a later render after the route %s", async (_label, fail) => {
    fail();
    jest.spyOn(console, "warn").mockImplementation(() => {});
    jest.spyOn(console, "error").mockImplementation(() => {});
    const first = render(
      <EPRefinementList setControlContextData={jest.fn() as any} />
    );
    await settle();
    first.unmount();

    const setControlContextData = jest.fn();
    render(
      <EPRefinementList setControlContextData={setControlContextData as any} />
    );
    await settle();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(setControlContextData).toHaveBeenLastCalledWith({
      attributes: STORE_ATTRIBUTES,
    });
  });
});
