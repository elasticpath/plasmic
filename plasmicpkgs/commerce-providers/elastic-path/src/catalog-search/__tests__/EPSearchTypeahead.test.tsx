/**
 * @jest-environment jsdom
 */

import React from "react";

const mockUsePlasmicCanvasContext = jest.fn();
const mockUsePlasmicCanvasComponentInfo = jest.fn();

jest.mock("@plasmicapp/host", () => ({
  DataProvider: ({
    children,
    name,
    data,
  }: {
    children: React.ReactNode;
    name: string;
    data: unknown;
  }) => (
    <div data-provider={name} data-provider-data={JSON.stringify(data)}>
      {children}
    </div>
  ),
  repeatedElement: (_index: number, children: React.ReactNode) => children,
  usePlasmicCanvasContext: () => mockUsePlasmicCanvasContext(),
  usePlasmicCanvasComponentInfo: (...args: unknown[]) =>
    mockUsePlasmicCanvasComponentInfo(...args),
}));

jest.mock("@plasmicapp/host/registerComponent", () => ({
  __esModule: true,
  default: jest.fn(),
}));

const mockEpMultiSearch = jest.fn();
jest.mock("../../ep-server-functions/multiSearch", () => ({
  __esModule: true,
  epMultiSearch: (...args: unknown[]) => mockEpMultiSearch(...args),
}));

import { act, fireEvent, render, screen } from "@testing-library/react";
import { describeHeadlessStylingContract } from "./headless-styling-contract";

const {
  EPSearchTypeahead,
  epSearchTypeaheadMeta,
  registerEPSearchTypeahead,
  searchPageUrl,
} = require("../EPSearchTypeahead") as typeof import("../EPSearchTypeahead");
const { MOCK_SEARCH_PRODUCTS } =
  require("../design-time-data") as typeof import("../design-time-data");

function setEditorMode(inEditor: boolean) {
  mockUsePlasmicCanvasContext.mockReturnValue(inEditor ? {} : null);
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const slug = (name: string) => name.toLowerCase().replace(/\s+/g, "-");

function searchResponse(names: string[]) {
  return {
    results: [
      {
        found: names.length,
        hits: names.map((name, i) => ({
          document: {
            id: `id-${slug(name)}`,
            type: "product",
            attributes: { name, slug: slug(name), sku: `SKU-${i}` },
            meta: {
              display_price: {
                without_tax: { amount: 1999, currency: "USD", formatted: "$19.99" },
              },
            },
            relationships: { main_image: { data: { id: `image-${i}` } } },
          },
          highlight: { name: { value: `<mark>${name}</mark>` } },
        })),
      },
    ],
    included: {
      main_images: names.map((_, i) => ({
        id: `image-${i}`,
        link: { href: `https://images.test/${i}.png` },
      })),
    },
  };
}

function renderTypeahead(
  props: Partial<React.ComponentProps<typeof EPSearchTypeahead>> = {},
  card: React.ReactNode = <span data-testid="card">card</span>
) {
  return render(
    <EPSearchTypeahead
      loadingContent={<span data-testid="loading">Searching</span>}
      emptyContent={<span data-testid="empty">No products found</span>}
      errorContent={<span data-testid="error">Search failed</span>}
      {...props}
    >
      {card}
    </EPSearchTypeahead>
  );
}

const combobox = () => screen.getByRole("combobox") as HTMLInputElement;
const options = () => screen.queryAllByRole("option");

function type(value: string) {
  fireEvent.change(combobox(), { target: { value } });
}

function press(key: string) {
  fireEvent.keyDown(combobox(), { key });
}

async function wait(ms: number) {
  await act(async () => {
    jest.advanceTimersByTime(ms);
  });
}

function published(container: Element, name: string): any[] {
  return Array.from(
    container.querySelectorAll(`[data-provider="${name}"]`)
  ).map((el) => JSON.parse(el.getAttribute("data-provider-data")!));
}

function searchedTerms(): string[] {
  return mockEpMultiSearch.mock.calls.map((call) => call[0].searches[0].q);
}

const originalLocation = window.location;

beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();
  mockEpMultiSearch.mockReset();
  mockEpMultiSearch.mockResolvedValue(searchResponse([]));
  setEditorMode(false);
  mockUsePlasmicCanvasComponentInfo.mockReturnValue({ isSelected: false });
  delete (window as any).location;
  (window as any).location = { assign: jest.fn() };
});

afterEach(() => {
  jest.useRealTimers();
  (window as any).location = originalLocation;
});

describe("registration", () => {
  it("registers a standalone component, outside any search provider", () => {
    expect(epSearchTypeaheadMeta.name).toBe(
      "plasmic-commerce-ep-search-typeahead"
    );
    expect(epSearchTypeaheadMeta.importName).toBe("EPSearchTypeahead");
    expect(epSearchTypeaheadMeta.parentComponentName).toBeUndefined();
    expect(epSearchTypeaheadMeta.providesData).toBe(true);

    const loader = { registerComponent: jest.fn() };
    registerEPSearchTypeahead(loader as any);
    expect(loader.registerComponent).toHaveBeenCalledWith(
      EPSearchTypeahead,
      epSearchTypeaheadMeta
    );
  });

  it("defaults to a short, debounced list that submits to /search", () => {
    const props = epSearchTypeaheadMeta.props as Record<string, any>;
    expect(props.debounceMs.defaultValue).toBe(300);
    expect(props.minQueryLength.defaultValue).toBe(2);
    expect(props.maxHits.defaultValue).toBe(5);
    expect(props.searchPagePath.defaultValue).toBe("/search");
    expect(props.queryParam.defaultValue).toBe("search[query]");
    for (const slot of [
      "input",
      "children",
      "loadingContent",
      "emptyContent",
      "errorContent",
    ]) {
      expect(props[slot].type).toBe("slot");
    }
  });
});

describe("searching", () => {
  it("waits for a pause in typing, then sends one search", async () => {
    renderTypeahead();

    for (const value of ["b", "bo", "boo", "boot"]) {
      type(value);
      await wait(100);
    }
    expect(mockEpMultiSearch).not.toHaveBeenCalled();

    await wait(200);
    expect(mockEpMultiSearch).toHaveBeenCalledTimes(1);
    expect(mockEpMultiSearch).toHaveBeenCalledWith({
      searches: [
        { type: "search", q: "boot", query_by: "name,description", per_page: 5 },
      ],
      include: ["main_image"],
    });
  });

  it("uses the configured debounce", async () => {
    renderTypeahead({ debounceMs: 50 });

    type("boots");
    await wait(49);
    expect(mockEpMultiSearch).not.toHaveBeenCalled();
    await wait(1);
    expect(searchedTerms()).toEqual(["boots"]);
  });

  it("does not search below the minimum query length", async () => {
    renderTypeahead();

    type("b");
    await wait(1000);
    expect(mockEpMultiSearch).not.toHaveBeenCalled();
    expect(combobox().getAttribute("aria-expanded")).toBe("false");

    type("bo");
    await wait(300);
    expect(searchedTerms()).toEqual(["bo"]);
  });

  it("counts the minimum length on the trimmed query", async () => {
    renderTypeahead({ minQueryLength: 3 });

    type("  bo  ");
    await wait(1000);
    expect(mockEpMultiSearch).not.toHaveBeenCalled();

    type("  boo ");
    await wait(300);
    expect(searchedTerms()).toEqual(["boo"]);
  });

  it("asks for at most Max Hits, and lists no more than that", async () => {
    mockEpMultiSearch.mockResolvedValue(searchResponse(["A", "B", "C"]));
    renderTypeahead({ maxHits: 2 });

    type("boots");
    await wait(300);

    expect(mockEpMultiSearch.mock.calls[0][0].searches[0].per_page).toBe(2);
    expect(options()).toHaveLength(2);
  });

  it("applies Query By and Base Filter as EP Catalog Search Provider does", async () => {
    renderTypeahead({
      queryBy: "name",
      baseFilter: "meta.product_types:!=child",
    });

    type("boots");
    await wait(300);

    expect(mockEpMultiSearch.mock.calls[0][0].searches[0]).toEqual({
      type: "search",
      q: "boots",
      query_by: "name",
      per_page: 5,
      filter_by: "(meta.product_types:!=child)",
    });
  });

  it("ignores a response to a query the shopper has typed past", async () => {
    const first = deferred<unknown>();
    const second = deferred<unknown>();
    mockEpMultiSearch
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    renderTypeahead();

    type("boo");
    await wait(300);
    type("boots");

    await act(async () => first.resolve(searchResponse(["Old Boot"])));
    expect(screen.queryByText("Old Boot")).toBeNull();
    expect(options()).toHaveLength(0);

    await wait(300);
    await act(async () => second.resolve(searchResponse(["Rain Boot"])));
    expect(options()).toHaveLength(1);
    expect(screen.getByTestId("card")).toBeTruthy();
    const [product] = published(document.body, "currentProduct");
    expect(product.attributes.name).toBe("Rain Boot");
  });

  it("keeps the latest results when an older request answers last", async () => {
    const first = deferred<unknown>();
    const second = deferred<unknown>();
    mockEpMultiSearch
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    renderTypeahead();

    type("boo");
    await wait(300);
    type("boots");
    await wait(300);
    expect(searchedTerms()).toEqual(["boo", "boots"]);

    await act(async () => second.resolve(searchResponse(["Rain Boot"])));
    await act(async () => first.resolve(searchResponse(["Old Boot"])));

    const names = published(document.body, "currentProduct").map(
      (product) => product.attributes.name
    );
    expect(names).toEqual(["Rain Boot"]);
  });
});

describe("hits", () => {
  it("publishes currentProduct, currentHit and currentProductIndex as EP Search Hits does", async () => {
    mockEpMultiSearch.mockResolvedValue(
      searchResponse(["Rain Boot", "Snow Boot"])
    );
    const { container } = renderTypeahead();

    type("boot");
    await wait(300);

    const products = published(container, "currentProduct");
    expect(products).toHaveLength(2);
    expect(products[0]).toMatchObject({
      id: "id-rain-boot",
      type: "product",
      attributes: { name: "Rain Boot", slug: "rain-boot", sku: "SKU-0" },
      images: [{ url: "https://images.test/0.png", alt: "Rain Boot" }],
    });
    expect(products[0].meta.display_price.without_tax.formatted).toBe("$19.99");

    const hits = published(container, "currentHit");
    expect(hits[1]).toMatchObject({
      path: "/product/snow-boot",
      highlightedName: "<mark>Snow Boot</mark>",
    });

    expect(published(container, "currentProductIndex")).toEqual([0, 1]);
  });

  it("builds currentHit.path from Product Path Prefix", async () => {
    mockEpMultiSearch.mockResolvedValue(searchResponse(["Rain Boot"]));
    const { container } = renderTypeahead({ productPathPrefix: "/products/" });

    type("boot");
    await wait(300);

    expect(published(container, "currentHit")[0].path).toBe(
      "/products/rain-boot"
    );
  });

  it("shows Loading Content until the first answer arrives", async () => {
    const pending = deferred<unknown>();
    mockEpMultiSearch.mockReturnValue(pending.promise);
    renderTypeahead();

    type("boot");
    expect(screen.queryByTestId("loading")).toBeNull();
    await wait(300);
    expect(screen.getByTestId("loading")).toBeTruthy();
    expect(screen.queryByRole("listbox")).toBeNull();

    await act(async () => pending.resolve(searchResponse(["Rain Boot"])));
    expect(screen.queryByTestId("loading")).toBeNull();
    expect(options()).toHaveLength(1);
  });

  it("shows Empty Content when nothing matches", async () => {
    mockEpMultiSearch.mockResolvedValue(searchResponse([]));
    renderTypeahead();

    type("zzz");
    await wait(300);

    expect(screen.getByTestId("empty")).toBeTruthy();
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("shows Error Content when the search fails, not Empty Content", async () => {
    mockEpMultiSearch.mockRejectedValue(new Error("search is down"));
    renderTypeahead();

    type("boot");
    await wait(300);

    expect(screen.getByTestId("error")).toBeTruthy();
    expect(screen.queryByTestId("empty")).toBeNull();
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("publishes the typeahead's own state as searchTypeaheadData", async () => {
    mockEpMultiSearch.mockResolvedValue(searchResponse(["Rain Boot"]));
    const { container } = renderTypeahead();

    type("rain boot");
    await wait(300);

    expect(published(container, "searchTypeaheadData")[0]).toEqual({
      query: "rain boot",
      status: "success",
      isOpen: true,
      hitCount: 1,
      searchPageUrl: "/search?search%5Bquery%5D=rain+boot",
    });
  });
});

describe("combobox behaviour", () => {
  async function openWith(names: string[]) {
    mockEpMultiSearch.mockResolvedValue(searchResponse(names));
    type("boot");
    await wait(300);
  }

  it("marks up the input as a combobox that controls a listbox of options", async () => {
    renderTypeahead();
    expect(combobox().getAttribute("aria-expanded")).toBe("false");
    expect(combobox().getAttribute("aria-autocomplete")).toBe("list");

    await openWith(["Rain Boot", "Snow Boot"]);

    const listbox = screen.getByRole("listbox");
    expect(combobox().getAttribute("aria-expanded")).toBe("true");
    expect(combobox().getAttribute("aria-controls")).toBe(listbox.id);
    expect(options()).toHaveLength(2);
    expect(options().every((o) => o.getAttribute("aria-selected") === "false"))
      .toBe(true);
  });

  it("moves the active hit with the arrow keys, wrapping at either end", async () => {
    renderTypeahead();
    await openWith(["A", "B", "C"]);
    const active = () => combobox().getAttribute("aria-activedescendant");

    expect(active()).toBeNull();
    press("ArrowDown");
    expect(active()).toBe(options()[0].id);
    expect(options()[0].getAttribute("aria-selected")).toBe("true");
    press("ArrowDown");
    press("ArrowDown");
    expect(active()).toBe(options()[2].id);
    press("ArrowDown");
    expect(active()).toBe(options()[0].id);
    press("ArrowUp");
    expect(active()).toBe(options()[2].id);
    press("ArrowUp");
    expect(active()).toBe(options()[1].id);
    expect(options()[1].getAttribute("aria-selected")).toBe("true");
    expect(options()[0].getAttribute("aria-selected")).toBe("false");
  });

  it("starts from the last hit when ArrowUp is pressed first", async () => {
    renderTypeahead();
    await openWith(["A", "B", "C"]);

    press("ArrowUp");
    expect(combobox().getAttribute("aria-activedescendant")).toBe(
      options()[2].id
    );
  });

  it("closes on Escape, reopens on ArrowDown, and clears on a second Escape", async () => {
    renderTypeahead();
    await openWith(["A", "B"]);

    press("Escape");
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(combobox().getAttribute("aria-expanded")).toBe("false");
    expect(combobox().value).toBe("boot");

    press("ArrowDown");
    expect(options()).toHaveLength(2);

    press("Escape");
    press("Escape");
    expect(combobox().value).toBe("");
  });

  it("closes when focus leaves the typeahead", async () => {
    render(
      <>
        <EPSearchTypeahead>
          <span>card</span>
        </EPSearchTypeahead>
        <button>elsewhere</button>
      </>
    );
    await openWith(["A"]);
    expect(screen.getByRole("listbox")).toBeTruthy();

    fireEvent.focusOut(combobox(), {
      relatedTarget: screen.getByText("elsewhere"),
    });
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("stays open while focus moves within the typeahead", async () => {
    renderTypeahead(
      {},
      <a href="/somewhere" data-testid="card-link">
        card
      </a>
    );
    await openWith(["A"]);

    fireEvent.focusOut(combobox(), {
      relatedTarget: screen.getByTestId("card-link"),
    });
    expect(screen.getByRole("listbox")).toBeTruthy();
  });

  it("goes to the active hit's path on Enter when the card has no link", async () => {
    renderTypeahead();
    await openWith(["Rain Boot", "Snow Boot"]);

    press("ArrowDown");
    press("ArrowDown");
    press("Enter");

    expect(window.location.assign).toHaveBeenCalledWith("/product/snow-boot");
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("follows the card's own link on Enter", async () => {
    const followed = jest.fn((event: React.MouseEvent) =>
      event.preventDefault()
    );
    renderTypeahead(
      {},
      <a href="/designer-route" onClick={followed}>
        card
      </a>
    );
    await openWith(["Rain Boot"]);

    press("ArrowDown");
    press("Enter");

    expect(followed).toHaveBeenCalledTimes(1);
    expect(window.location.assign).not.toHaveBeenCalled();
  });

  it("leaves Enter to the form when no hit is active", async () => {
    renderTypeahead();
    await openWith(["Rain Boot"]);

    press("Enter");
    expect(window.location.assign).not.toHaveBeenCalled();
    expect(screen.getByRole("listbox")).toBeTruthy();
  });
});

describe("choosing a hit and submitting", () => {
  it("goes to currentHit.path when a hit with no link is clicked", async () => {
    mockEpMultiSearch.mockResolvedValue(searchResponse(["Rain Boot"]));
    renderTypeahead();
    type("boot");
    await wait(300);

    fireEvent.click(screen.getByTestId("card"));

    expect(window.location.assign).toHaveBeenCalledWith("/product/rain-boot");
  });

  it("lets a click on the card's link navigate by itself", async () => {
    const followed = jest.fn((event: React.MouseEvent) =>
      event.preventDefault()
    );
    mockEpMultiSearch.mockResolvedValue(searchResponse(["Rain Boot"]));
    renderTypeahead(
      {},
      <a href="/designer-route" onClick={followed}>
        card
      </a>
    );
    type("boot");
    await wait(300);

    fireEvent.click(screen.getByText("card"));

    expect(followed).toHaveBeenCalledTimes(1);
    expect(window.location.assign).not.toHaveBeenCalled();
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("goes to the search page with the query on submit", () => {
    const { container } = renderTypeahead();
    type("  red boots ");

    fireEvent.submit(container.querySelector("form")!);

    expect(window.location.assign).toHaveBeenCalledWith(
      "/search?search%5Bquery%5D=red+boots"
    );
  });

  it("uses Search Page Path and Query Parameter", () => {
    const { container } = renderTypeahead({
      searchPagePath: "/find",
      queryParam: "q",
    });
    type("boots");

    fireEvent.submit(container.querySelector("form")!);

    expect(window.location.assign).toHaveBeenCalledWith("/find?q=boots");
  });

  it("names the input with the query parameter, so the form works before hydration", () => {
    const { container } = renderTypeahead();
    const form = container.querySelector("form")!;

    expect(form.getAttribute("role")).toBe("search");
    expect(form.getAttribute("action")).toBe("/search");
    expect(form.getAttribute("method")).toBe("get");
    expect(combobox().name).toBe("search[query]");
  });
});

describe("searchPageUrl", () => {
  it("goes to the page alone for an empty query", () => {
    expect(searchPageUrl("/search", "q", "   ")).toBe("/search");
  });

  it("appends to a path that already has a query string", () => {
    expect(searchPageUrl("/search?sort=price", "q", "boots")).toBe(
      "/search?sort=price&q=boots"
    );
  });
});

describe("Search Input slot", () => {
  it("wires the designer's input and keeps its own handlers", async () => {
    const designerChange = jest.fn();
    renderTypeahead({
      input: (
        <input
          className="designer-input"
          placeholder="Find boots"
          onChange={designerChange}
        />
      ),
    });

    const input = combobox();
    expect(input.className).toBe("designer-input");
    expect(input.placeholder).toBe("Find boots");
    expect(input.getAttribute("aria-label")).toBe("Search products");

    type("boots");
    expect(designerChange).toHaveBeenCalledTimes(1);
    await wait(300);
    expect(searchedTerms()).toEqual(["boots"]);
  });

  it("keeps the designer's own accessible name", () => {
    renderTypeahead({ input: <input aria-label="Search the store" /> });
    expect(combobox().getAttribute("aria-label")).toBe("Search the store");
  });
});

describe("on the Studio canvas", () => {
  beforeEach(() => setEditorMode(true));

  it("never searches", async () => {
    renderTypeahead({ previewState: "withData" });
    type("boots");
    await wait(1000);
    expect(mockEpMultiSearch).not.toHaveBeenCalled();
  });

  it("stays closed until the typeahead is selected", () => {
    renderTypeahead();
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("shows sample products while the typeahead is selected", () => {
    mockUsePlasmicCanvasComponentInfo.mockReturnValue({ isSelected: true });
    const { container } = renderTypeahead();

    const names = published(container, "currentProduct").map(
      (product) => product.attributes.name
    );
    expect(names).toEqual(
      MOCK_SEARCH_PRODUCTS.slice(0, 5).map((p) => p.attributes.name)
    );
  });

  it.each([
    ["loading", "loading"],
    ["empty", "empty"],
    ["error", "error"],
  ] as const)("pins %s content open", (previewState, testId) => {
    renderTypeahead({ previewState });
    expect(screen.getByTestId(testId)).toBeTruthy();
  });

  it("does not navigate on submit", () => {
    const { container } = renderTypeahead();
    type("boots");
    fireEvent.submit(container.querySelector("form")!);
    expect(window.location.assign).not.toHaveBeenCalled();
  });
});

describeHeadlessStylingContract({
  componentName: "EPSearchTypeahead",
  leafSelector: "[data-ep-search-typeahead]",
  renderInEditor: ({ className }) => (
    <EPSearchTypeahead className={className} previewState="withData">
      <span>card</span>
    </EPSearchTypeahead>
  ),
  renderAtRuntime: ({ className }) => (
    <EPSearchTypeahead className={className}>
      <span>card</span>
    </EPSearchTypeahead>
  ),
  setEditorMode,
});
