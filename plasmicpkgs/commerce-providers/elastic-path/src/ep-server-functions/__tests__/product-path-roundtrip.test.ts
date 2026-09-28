export {};

// The link builder and the product read are two halves of one contract: the
// path EP Search Hits links to must name a product `ep.getProduct` can read.
// This drives both halves against one mocked catalog.

const mockGetByContextProduct = jest.fn();
const mockGetByContextAllProducts = jest.fn();

jest.mock("@epcc-sdk/sdks-shopper", () => ({
  createShopperClient: jest.fn(() => ({
    client: { interceptors: { request: { use: jest.fn() } } },
  })),
  getByContextProduct: (...args: unknown[]) =>
    mockGetByContextProduct(...args),
  getByContextAllProducts: (...args: unknown[]) =>
    mockGetByContextAllProducts(...args),
  getByContextChildProducts: jest.fn(),
}));

jest.mock("../proxy-fetch", () => ({
  shouldUseProxy: () => false,
  callEpProxy: jest.fn(),
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { epGetProduct } = require("../getProduct");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { withEpSession } = require("../session-context");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { hitToProduct, productPath } = require("../../catalog-search/EPSearchHits");

const SESSION = {
  accessToken: "token-abc",
  host: "https://api.test.elasticpath.com",
  clientId: "client-xyz",
};

const CATALOG = [
  { id: "3f0c6d1e-8a2b-4c5d-9e7f-0a1b2c3d4e5f", slug: "blue-shirt" },
  { id: "7b8c9d0e-1f2a-4b3c-8d4e-5f6a7b8c9d0e", slug: "" },
].map(({ id, slug }) => ({
  id,
  type: "product",
  attributes: { name: `Product ${id}`, ...(slug ? { slug } : {}) },
  meta: { product_types: [] },
}));

beforeEach(() => {
  mockGetByContextProduct.mockImplementation(async ({ path }: any) => {
    const row = CATALOG.find((p) => p.id === path.product_id);
    return row
      ? { data: { data: row, included: {} } }
      : { error: { errors: [] }, response: { status: 404 } };
  });
  mockGetByContextAllProducts.mockImplementation(async ({ query }: any) => {
    const slug = /^eq\(slug,(.*)\)$/.exec(query.filter)?.[1];
    const rows = CATALOG.filter((p) => p.attributes.slug === slug);
    return { data: { data: rows, included: {} } };
  });
});

describe("a search hit's product path names a product ep.getProduct reads", () => {
  it.each([
    ["carries a slug", CATALOG[0]],
    ["carries no slug", CATALOG[1]],
  ])("when the hit %s", async (_, row) => {
    const hit = { objectID: row.id, attributes: row.attributes };
    const path: string = productPath(hitToProduct(hit, "USD"), "/product");
    const reference = path.replace(/^\/product\//, "");

    const product = await withEpSession(SESSION, () =>
      epGetProduct({ id: reference })
    );

    expect(product?.id).toBe(row.id);
  });
});
