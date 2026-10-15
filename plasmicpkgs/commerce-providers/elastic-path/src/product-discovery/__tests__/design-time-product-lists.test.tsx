/**
 * @jest-environment jsdom
 *
 * #662: EP Product List Provider and EP Related Products Provider on the
 * Studio canvas and on a published page. The network is the only stub: the
 * design-time route answers, fails, or is not mounted.
 */
import { PlasmicQueryDataProvider } from "@plasmicapp/query";
import { render, screen, waitFor } from "@testing-library/react";
import React from "react";

let mockInCanvas = false;
jest.mock("@plasmicapp/host", () => ({
  ...jest.requireActual("@plasmicapp/host"),
  usePlasmicCanvasContext: () => (mockInCanvas ? {} : undefined),
}));

const { CommerceProviderComponent } =
  require("../../registerCommerceProvider") as typeof import("../../registerCommerceProvider");
const { EPProductListProvider } =
  require("../EPProductListProvider") as typeof import("../EPProductListProvider");
const { EPRelatedProductsProvider } =
  require("../EPRelatedProductsProvider") as typeof import("../EPRelatedProductsProvider");
const { EPProductGrid, epProductGridMeta } =
  require("../EPProductGrid") as typeof import("../EPProductGrid");
const { EPProductField } =
  require("../../product-extensions/composable/EPProductField") as typeof import("../../product-extensions/composable/EPProductField");
const { resetEpCanvasArtboard } =
  require("../../ep-server-functions/design-realm") as typeof import("../../ep-server-functions/design-realm");
const { resetEpDesignRouteWarning } =
  require("../../ep-server-functions/design-fetch") as typeof import("../../ep-server-functions/design-fetch");
const { DataProvider } =
  require("@plasmicapp/host") as typeof import("@plasmicapp/host");
import { mockProduct } from "../../utils/design-time-data";

const STORE_PRODUCTS = [
  mockProduct({
    id: "p-1",
    name: "Store Trail Runner",
    amount: 12000,
    images: [{ url: "https://cdn.example/runner.png", alt: "Trail runner" }],
  }),
  mockProduct({
    id: "p-2",
    name: "Store Rain Shell",
    amount: 21000,
    images: [{ url: "https://cdn.example/shell.png", alt: "Rain shell" }],
  }),
];
const STORE_RELATED = [
  mockProduct({ id: "p-9", name: "Store Gaiters", amount: 3500 }),
];

type Reply =
  | { status: number; body: unknown }
  | { throws: Error }
  | "hang";

let replies: Record<string, Reply> = {};
const requested: string[] = [];

function stubResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => null },
    json: async () => body,
    text: async () => (typeof body === "string" ? body : JSON.stringify(body)),
  } as unknown as Response;
}

function fakeFetch(input: RequestInfo | URL): Promise<Response> {
  const url = typeof input === "string" ? input : String(input);
  requested.push(url);
  const reply = replies[url];
  if (reply === "hang") return new Promise(() => {});
  if (reply && "throws" in reply) return Promise.reject(reply.throws);
  if (reply) return Promise.resolve(stubResponse(reply.status, reply.body));
  return Promise.resolve(stubResponse(404, "<html>Not Found</html>"));
}

function page(products: unknown[]) {
  return {
    data: products,
    meta: {
      results: { total: products.length },
      page: { limit: 12, offset: 0 },
    },
  };
}

const slots = {
  loadingContent: <span>loading-slot</span>,
  errorContent: <span>error-slot</span>,
  emptyContent: <span>empty-slot</span>,
};

function Card() {
  return <EPProductField field="name" />;
}

function Page(props: { children: React.ReactNode; clientId?: string }) {
  return (
    <PlasmicQueryDataProvider provider={() => new Map()}>
      <CommerceProviderComponent
        clientId={"clientId" in props ? props.clientId : "a-public-store-id"}
        host="euwest.api.elasticpath.com"
      >
        {props.children}
      </CommerceProviderComponent>
    </PlasmicQueryDataProvider>
  );
}

function renderList(
  props: Record<string, unknown> = {},
  page: { clientId?: string } = {}
) {
  render(
    <Page {...page}>
      <EPProductListProvider {...slots} {...props}>
        <EPProductGrid>
          <Card />
        </EPProductGrid>
      </EPProductListProvider>
    </Page>
  );
}

function renderRelated(
  props: Record<string, unknown> = {},
  currentProduct?: unknown
) {
  const provider = (
    <EPRelatedProductsProvider {...slots} {...props}>
      <EPProductGrid>
        <Card />
      </EPProductGrid>
    </EPRelatedProductsProvider>
  );
  render(
    <Page>
      {currentProduct === undefined ? (
        provider
      ) : (
        <DataProvider name="currentProduct" data={currentProduct}>
          {provider}
        </DataProvider>
      )}
    </Page>
  );
}

const shownNames = () =>
  screen.queryAllByRole("listitem").map((item) => item.textContent);

beforeEach(() => {
  mockInCanvas = false;
  replies = {};
  requested.length = 0;
  resetEpCanvasArtboard();
  resetEpDesignRouteWarning();
  global.fetch = jest.fn(fakeFetch) as unknown as typeof fetch;
  jest.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("EP Product List Provider on the canvas", () => {
  beforeEach(() => {
    mockInCanvas = true;
  });

  it("shows the store's products from the design-time route", async () => {
    replies["/api/ep/design/getProductPage"] = {
      status: 200,
      body: page(STORE_PRODUCTS),
    };

    renderList();

    await waitFor(() =>
      expect(shownNames()).toEqual(["Store Trail Runner", "Store Rain Shell"])
    );
  });

  it.each<[string, Reply | undefined]>([
    ["the route is not mounted", undefined],
    ["the route fails", { status: 500, body: { error: "boom" } }],
    ["the network fails", { throws: new TypeError("Failed to fetch") }],
  ])("shows labelled sample products when %s", async (_, reply) => {
    if (reply) replies["/api/ep/design/getProductPage"] = reply;

    renderList();

    await waitFor(() => expect(shownNames()).toHaveLength(6));
    expect(shownNames().every((name) => name?.startsWith("Sample "))).toBe(
      true
    );
    expect(requested).toContain("/api/ep/design/getProductPage");
  });

  it("shows Loading Content while the route answers", () => {
    replies["/api/ep/design/getProductPage"] = "hang";

    renderList();

    expect(screen.getByText("loading-slot")).toBeTruthy();
  });

  it("shows Empty Content when the store has no matching products", async () => {
    replies["/api/ep/design/getProductPage"] = { status: 200, body: page([]) };

    renderList();

    await screen.findByText("empty-slot");
  });

  it("shows labelled sample products when no store is configured", () => {
    renderList({}, { clientId: undefined });

    expect(shownNames()).toHaveLength(6);
    expect(requested).toEqual([]);
  });
});

const FORCED_SLOT: Record<string, string | undefined> = {
  loading: "loading-slot",
  error: "error-slot",
  empty: "empty-slot",
  withData: undefined,
};

describe.each(Object.keys(FORCED_SLOT))(
  'EP Product List Provider with Preview State "%s"',
  (previewState) => {
    it("shows the forced state on the canvas without fetching", () => {
      mockInCanvas = true;

      renderList({ previewState });

      const slot = FORCED_SLOT[previewState];
      if (slot) {
        expect(screen.getByText(slot)).toBeTruthy();
      } else {
        expect(shownNames()).toHaveLength(6);
      }
      expect(requested).toEqual([]);
    });

    it("fetches the store's products on a published page", async () => {
      replies["/api/ep/proxy/getProductPage"] = {
        status: 200,
        body: page(STORE_PRODUCTS),
      };

      renderList({ previewState });

      await waitFor(() =>
        expect(shownNames()).toEqual(["Store Trail Runner", "Store Rain Shell"])
      );
    });
  }
);

describe('EP Product Grid with Preview State "withData"', () => {
  function renderGrid() {
    render(
      <Page>
        <EPProductListProvider {...slots}>
          <EPProductGrid previewState="withData">
            <Card />
          </EPProductGrid>
        </EPProductListProvider>
      </Page>
    );
  }

  it("shows sample products on the canvas", async () => {
    mockInCanvas = true;
    replies["/api/ep/design/getProductPage"] = {
      status: 200,
      body: page(STORE_PRODUCTS),
    };

    renderGrid();

    await waitFor(() => expect(shownNames()).toHaveLength(6));
    expect(shownNames().every((name) => name?.startsWith("Sample "))).toBe(
      true
    );
  });

  it("shows the store's products on a published page", async () => {
    replies["/api/ep/proxy/getProductPage"] = {
      status: 200,
      body: page(STORE_PRODUCTS),
    };

    renderGrid();

    await waitFor(() =>
      expect(shownNames()).toEqual(["Store Trail Runner", "Store Rain Shell"])
    );
  });
});

describe("EP Related Products Provider on the canvas", () => {
  beforeEach(() => {
    mockInCanvas = true;
  });

  it("shows the store's related products from the design-time route", async () => {
    replies["/api/ep/design/getRelatedProducts"] = {
      status: 200,
      body: STORE_RELATED,
    };

    renderRelated({ productId: "p-1" });

    await waitFor(() => expect(shownNames()).toEqual(["Store Gaiters"]));
  });

  it("looks up the product the page's EP Product Provider holds", async () => {
    replies["/api/ep/design/getRelatedProducts"] = {
      status: 200,
      body: STORE_RELATED,
    };

    renderRelated({}, { id: "p-1" });

    await waitFor(() => expect(shownNames()).toEqual(["Store Gaiters"]));
  });

  it.each<[string, unknown]>([
    ["no product is chosen", undefined],
    ["the product is the sample product", { id: "mock-product" }],
  ])("shows labelled sample products when %s", (_, currentProduct) => {
    renderRelated({}, currentProduct);

    expect(shownNames()).toHaveLength(4);
    expect(shownNames().every((name) => name?.startsWith("Sample "))).toBe(
      true
    );
    expect(requested).toEqual([]);
  });

  it.each<[string, Reply | undefined]>([
    ["the route is not mounted", undefined],
    ["the route fails", { status: 500, body: { error: "boom" } }],
  ])("shows labelled sample products when %s", async (_, reply) => {
    if (reply) replies["/api/ep/design/getRelatedProducts"] = reply;

    renderRelated({ productId: "p-1" });

    await waitFor(() => expect(shownNames()).toHaveLength(4));
    expect(shownNames().every((name) => name?.startsWith("Sample "))).toBe(
      true
    );
  });

  it("shows Loading Content while the route answers", () => {
    replies["/api/ep/design/getRelatedProducts"] = "hang";

    renderRelated({ productId: "p-1" });

    expect(screen.getByText("loading-slot")).toBeTruthy();
  });

  it("shows Empty Content when the product has no related products", async () => {
    replies["/api/ep/design/getRelatedProducts"] = { status: 200, body: [] };

    renderRelated({ productId: "p-1" });

    await screen.findByText("empty-slot");
  });
});

describe.each(Object.keys(FORCED_SLOT))(
  'EP Related Products Provider with Preview State "%s"',
  (previewState) => {
    it("shows the forced state on the canvas without fetching", () => {
      mockInCanvas = true;

      renderRelated({ previewState, productId: "p-1" });

      const slot = FORCED_SLOT[previewState];
      if (slot) {
        expect(screen.getByText(slot)).toBeTruthy();
      } else {
        expect(shownNames()).toHaveLength(4);
      }
      expect(requested).toEqual([]);
    });

    it("fetches the store's related products on a published page", async () => {
      replies["/api/ep/proxy/getRelatedProducts"] = {
        status: 200,
        body: STORE_RELATED,
      };

      renderRelated({ previewState, productId: "p-1" });

      await waitFor(() => expect(shownNames()).toEqual(["Store Gaiters"]));
    });
  }
);

describe("a newly inserted EP Product Grid", () => {
  const components: Record<string, React.ComponentType<any>> = {
    "plasmic-commerce-ep-product-field": EPProductField,
  };

  function fromDefault(element: any, key?: number): React.ReactNode {
    if (Array.isArray(element)) return element.map(fromDefault);
    switch (element.type) {
      case "text":
        return <span key={key}>{element.value}</span>;
      case "img":
        return <img key={key} src={element.src} />;
      case "vbox":
      case "hbox":
      case "box":
        return <div key={key}>{fromDefault(element.children ?? [])}</div>;
      case "component": {
        const Component = components[element.name];
        if (!Component) throw new Error(`unmapped ${element.name}`);
        return <Component key={key} {...element.props} />;
      }
      default:
        throw new Error(`unmapped element ${element.type}`);
    }
  }

  it("shows each product's name, price and image with no binding", async () => {
    replies["/api/ep/proxy/getProductPage"] = {
      status: 200,
      body: page(STORE_PRODUCTS),
    };
    const defaultCard = (epProductGridMeta.props as any).children.defaultValue;

    render(
      <Page>
        <EPProductListProvider {...slots}>
          <EPProductGrid>{fromDefault(defaultCard)}</EPProductGrid>
        </EPProductListProvider>
      </Page>
    );

    await waitFor(() => expect(shownNames()).toHaveLength(2));
    const [first] = screen.getAllByRole("listitem");
    expect(first.textContent).toContain("Store Trail Runner");
    expect(first.textContent).toContain("$120.00");
    const image = first.querySelector("img");
    expect(image?.getAttribute("src")).toBe("https://cdn.example/runner.png");
    expect(image?.getAttribute("alt")).toBe("Trail runner");
  });
});
