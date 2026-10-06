/**
 * @jest-environment jsdom
 *
 * Seam 1 of #553: the token surface stated as behaviour.
 *
 * Render the storefront tree and let every provider fetch. Each request the
 * browser makes must address the storefront's own origin — a request to an
 * Elastic Path host would mean a credential the browser holds.
 */
import { DataProvider } from "@plasmicapp/host";
import { act, render } from "@testing-library/react";
import React from "react";
import { EPCartProvider } from "../cart-provider/EPCartProvider";
import { EPPromoCodeInput } from "../checkout/composable/EPPromoCodeInput";
import { createEpIdentityClient } from "../identity/client";
import { EP_IDENTITY_OPERATION_NAMES } from "../identity/operations";
import { EPProductProvider } from "../product/EPProductProvider";
import { EPProductListProvider } from "../product-discovery/EPProductListProvider";
import { EPRelatedProductsProvider } from "../product-discovery/EPRelatedProductsProvider";
import { CommerceProviderComponent } from "../registerCommerceProvider";
import { EPStockProvider } from "../stock/EPStockProvider";
import { createMultiSearchClient } from "../catalog-search/multi-search-client";
import {
  epAddCartItem,
  epApplyPromoCode,
  epRemoveCartItem,
  epRemovePromoCode,
  epUpdateCartItem,
} from "../ep-server-functions/cart-mutations";
import { epConfigureBundle } from "../ep-server-functions/configureBundle";
import { epGetBaseProducts } from "../ep-server-functions/getBaseProducts";
import { epGetBundleOptionProducts } from "../ep-server-functions/getBundleOptionProducts";
import { epGetCart } from "../ep-server-functions/getCart";
import { epGetLocations } from "../ep-server-functions/getLocations";
import { epGetProduct } from "../ep-server-functions/getProduct";
import { epGetProductList } from "../ep-server-functions/getProductList";
import { epGetProductPage } from "../ep-server-functions/getProductPage";
import { epGetRelatedProducts } from "../ep-server-functions/getRelatedProducts";
import { epGetStock } from "../ep-server-functions/getStock";
import { epMultiSearch } from "../ep-server-functions/multiSearch";
import { epPlaceOrder } from "../ep-server-functions/place-order";

/** Any host that is not this page's own. */
const PAGE_ORIGIN = "http://localhost";

const requested: string[] = [];

function recordingFetch(input: RequestInfo | URL): Promise<Response> {
  const url =
    typeof input === "string"
      ? input
      : input instanceof URL
        ? input.href
        : input.url;
  requested.push(url);
  // jsdom has no `Response`, so the stub is the slice of it the callers read.
  return Promise.resolve({
    ok: true,
    status: 200,
    json: async () => ({ data: [], included: {}, meta: {} }),
    text: async () => "{}",
  } as unknown as Response);
}

function originOf(url: string): string {
  return new URL(url, PAGE_ORIGIN).origin;
}

/**
 * A page the way a designer assembles one: the provider that holds the store
 * configuration, wrapping the components that read from Elastic Path.
 */
function Storefront() {
  return (
    <CommerceProviderComponent
      clientId="a-public-store-id"
      host="https://euwest.api.elasticpath.com"
    >
      <EPCartProvider />
      <EPProductListProvider limit={12} />
      <DataProvider name="currentProduct" data={{ id: "prod-1" }}>
        <EPProductProvider productId="prod-1">
          <EPStockProvider />
        </EPProductProvider>
        <EPRelatedProductsProvider productId="prod-1" />
      </DataProvider>
      <EPPromoCodeInput />
    </CommerceProviderComponent>
  );
}

/**
 * Every operation a component can reach from the browser, called directly.
 * Mounting cannot reach the mutations — they need an interaction — and a
 * listed-by-name set fails loudly when a new operation forgets the proxy.
 */
async function callEveryOperation(): Promise<void> {
  const identity = createEpIdentityClient();
  await Promise.allSettled([
    epGetCart(),
    epGetProduct({ id: "prod-1" }),
    epGetProductList({ limit: 1 }),
    epGetProductPage({ limit: 1 }),
    epGetRelatedProducts({ productId: "prod-1" }),
    epGetBaseProducts({ productIds: ["prod-1"] }),
    epGetBundleOptionProducts({ productIds: ["prod-1"] }),
    epGetStock({ productIds: ["prod-1"] }),
    epGetLocations(),
    epMultiSearch({ searches: [{ collection: "products" }] }),
    epConfigureBundle({ bundleId: "bundle-1", selectedOptions: {} }),
    epAddCartItem({ productId: "prod-1", quantity: 1 }),
    epUpdateCartItem({ itemId: "item-1", quantity: 2 }),
    epRemoveCartItem({ itemId: "item-1" }),
    epApplyPromoCode({ code: "SAVE10" }),
    epRemovePromoCode({ code: "SAVE10" }),
    epPlaceOrder({ customer: { email: "buyer@example.com", name: "Buyer" } }),
    createMultiSearchClient().post({
      body: { searches: [{ collection: "products" }] },
    }),
    ...EP_IDENTITY_OPERATION_NAMES.map((name) =>
      (identity[name] as (input?: unknown) => Promise<unknown>)({})
    ),
  ]);
}

describe("every request the browser makes is same-origin", () => {
  const realFetch = globalThis.fetch;

  beforeEach(() => {
    requested.length = 0;
    globalThis.fetch = recordingFetch as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  it("holds while a storefront page mounts and fetches", async () => {
    await act(async () => {
      render(<Storefront />);
    });

    expect(requested.length).toBeGreaterThan(0);
    expect(requested.filter((url) => originOf(url) !== PAGE_ORIGIN)).toEqual([]);
  });

  it("holds across every operation a component can reach", async () => {
    await act(async () => {
      await callEveryOperation();
    });

    expect(requested.length).toBeGreaterThan(0);
    expect(requested.filter((url) => originOf(url) !== PAGE_ORIGIN)).toEqual([]);
  });

  it("would report a request that reached Elastic Path", async () => {
    await globalThis.fetch("https://euwest.api.elasticpath.com/v2/products");

    expect(requested.filter((url) => originOf(url) !== PAGE_ORIGIN)).toEqual([
      "https://euwest.api.elasticpath.com/v2/products",
    ]);
  });
});
