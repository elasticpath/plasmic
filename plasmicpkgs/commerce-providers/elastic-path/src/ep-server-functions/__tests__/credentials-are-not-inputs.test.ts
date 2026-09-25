/**
 * The proxy route forwards the browser's JSON body verbatim into the target
 * function. If any read function still took credentials from that body, a
 * caller could choose which shopper the server acts as. None of them do:
 * the shopper envelope is the only identity input.
 *
 * Jest's default environment is node, so `shouldUseProxy()` is false and each
 * function returns its empty shape without reaching the browser proxy branch.
 */
const sdk = {
  getByContextProduct: jest.fn(),
  getByContextChildProducts: jest.fn(),
  getByContextAllProducts: jest.fn(),
  getByContextProductsForNode: jest.fn(),
  getByContextAllRelatedProducts: jest.fn(),
  getACart: jest.fn(),
  getStock: jest.fn(),
  listLocations: jest.fn(),
  configureByContextProduct: jest.fn(),
  postMultiSearch: jest.fn(),
};

jest.mock("@epcc-sdk/sdks-shopper", () => ({
  createShopperClient: jest.fn(() => ({
    client: { interceptors: { request: { use: jest.fn() } } },
  })),
  getByContextProduct: (...a: unknown[]) => sdk.getByContextProduct(...a),
  getByContextChildProducts: (...a: unknown[]) =>
    sdk.getByContextChildProducts(...a),
  getByContextAllProducts: (...a: unknown[]) =>
    sdk.getByContextAllProducts(...a),
  getByContextProductsForNode: (...a: unknown[]) =>
    sdk.getByContextProductsForNode(...a),
  getByContextAllRelatedProducts: (...a: unknown[]) =>
    sdk.getByContextAllRelatedProducts(...a),
  getACart: (...a: unknown[]) => sdk.getACart(...a),
  getStock: (...a: unknown[]) => sdk.getStock(...a),
  listLocations: (...a: unknown[]) => sdk.listLocations(...a),
  configureByContextProduct: (...a: unknown[]) =>
    sdk.configureByContextProduct(...a),
  postMultiSearch: (...a: unknown[]) => sdk.postMultiSearch(...a),
}));

/* eslint-disable @typescript-eslint/no-var-requires */
const { epGetProduct } = require("../getProduct");
const { epGetProductList } = require("../getProductList");
const { epGetProductPage } = require("../getProductPage");
const { epGetRelatedProducts } = require("../getRelatedProducts");
const { epGetCart } = require("../getCart");
const { epGetStock } = require("../getStock");
const { epGetLocations } = require("../getLocations");
const { epGetBaseProducts } = require("../getBaseProducts");
const { epGetBundleOptionProducts } = require("../getBundleOptionProducts");
const { epConfigureBundle } = require("../configureBundle");
const { epMultiSearch } = require("../multiSearch");
/* eslint-enable @typescript-eslint/no-var-requires */

const SMUGGLED = {
  accessToken: "someone-elses-token",
  host: "https://api.test.elasticpath.com",
  clientId: "cid-abc",
  cartId: "someone-elses-cart",
};

beforeEach(() => {
  Object.values(sdk).forEach((m) => m.mockReset());
});

function expectNoEpCall() {
  Object.entries(sdk).forEach(([name, m]) => {
    expect([name, m.mock.calls.length]).toEqual([name, 0]);
  });
}

// One case per function that takes an input object. Each supplies credentials
// the way a crafted request body would, and must act on none of them.
const CASES: Array<[string, () => Promise<unknown>]> = [
  ["getProduct", () => epGetProduct({ id: "p1", auth: SMUGGLED })],
  ["getProductList", () => epGetProductList({ auth: SMUGGLED })],
  ["getProductPage", () => epGetProductPage({ auth: SMUGGLED })],
  [
    "getRelatedProducts",
    () =>
      epGetRelatedProducts({
        productId: "p1",
        relationshipSlug: "CRP_related_products",
        auth: SMUGGLED,
      }),
  ],
  ["getCart", () => epGetCart({ auth: SMUGGLED })],
  ["getStock", () => epGetStock({ productIds: ["p1"], auth: SMUGGLED })],
  ["getLocations", () => epGetLocations({ auth: SMUGGLED })],
  [
    "getBaseProducts",
    () => epGetBaseProducts({ productIds: ["p1"], auth: SMUGGLED }),
  ],
  [
    "getBundleOptionProducts",
    () => epGetBundleOptionProducts({ productIds: ["p1"], auth: SMUGGLED }),
  ],
  [
    "configureBundle",
    () =>
      epConfigureBundle({
        bundleId: "b1",
        selectedOptions: { o1: { c1: 1 } },
        auth: SMUGGLED,
      }),
  ],
  [
    "multiSearch",
    () => epMultiSearch({ searches: [{ type: "product" }], auth: SMUGGLED }),
  ],
];

describe("credentials in the request body", () => {
  // Some of these return an empty shape and some throw "no EP session".
  // Either is fine. What must hold is that no call reaches Elastic Path
  // carrying the credentials the body supplied.
  it.each(CASES)(
    "do not let %s act as another shopper",
    async (_name, call) => {
      await call().catch(() => undefined);
      expectNoEpCall();
    }
  );
});
