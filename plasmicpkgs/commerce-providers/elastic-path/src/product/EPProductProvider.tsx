/**
 * EPProductProvider — fetches a single product by ID and exposes it to
 * descendants via `<DataProvider name="currentProduct">`.
 *
 * Companion to EPProductListProvider / EPRelatedProductsProvider: drop it
 * on a PDP wrapped around the product-detail UI and bind text / image /
 * other plain HTML nodes to `$ctx.currentProduct.*`. Client code components
 * that read `useSelector("currentProduct")` (EPProductVariantPicker,
 * EPAddToCartButton, EPStockProvider, …) keep working unchanged.
 *
 * Data fetching uses the SWR-backed `useProduct` hook, which runs through
 * `useMutablePlasmicQueryData`. When the surrounding Next.js route calls
 * `extractPlasmicQueryData(<PlasmicComponent/>)` before rendering, the
 * product fetch fires during the prepass — on the server — and the result
 * is hydrated into the client cache via `PlasmicRootProvider`'s
 * `prefetchedQueryData`. No client-side waterfall, no flash of placeholder.
 *
 * Intentionally does NOT implement `getServerInfo`: that path depends on
 * `GlobalContextMeta.getServerInfo` (issue #246) which is reverted in this
 * repo pending an upstream PR. See PRD #228 and issue #247 — the prefetch
 * path is the planned approach today.
 */

import {
  DataProvider,
  usePlasmicCanvasContext,
} from "@plasmicapp/host";
import registerComponent, {
  CodeComponentMeta,
} from "@plasmicapp/host/registerComponent";
import React, { useMemo } from "react";
import { FormProvider, useForm, useWatch } from "react-hook-form";
import { Registerable } from "../registerable";
import useProduct from "./use-product";
import { createLogger } from "../utils/logger";
import type { Product } from "../types/product";
import { mockProduct } from "../utils/design-time-data";
import { extractRawExtensions, normalizeExtensions } from "../utils/field-format";
import { buildExtensionsMap } from "../utils/extensions-map";
import { MOCK_EXTENSION_TEMPLATES } from "../utils/extensions-mock";

const log = createLogger("EPProductProvider");

function ProductFormScope({ children }: { children: React.ReactNode }) {
  const methods = useForm();
  return <FormProvider {...methods}>{children}</FormProvider>;
}

/**
 * Publishes the child product the shopper has actually chosen as
 * `currentVariant`.
 *
 * EPVariationPicker resolves the matching child and writes its id to the
 * `ProductVariant` form field, but kept the child itself in a React context of
 * its own — so nothing outside the picker could read it. A buybox price bound to
 * `currentProduct` therefore showed the *parent's* price while the cart charged
 * the child's: $20.00 on the page, $15.00 at checkout for the same click.
 *
 * This sits inside the form scope (to watch the field) and above the content (so
 * the buybox, not just the picker's own subtree, can read it).
 */
function CurrentVariantScope({
  product,
  children,
}: {
  product: Product | undefined;
  children: React.ReactNode;
}) {
  const variantId = useWatch({ name: "ProductVariant" }) as
    | string
    | undefined;

  const currentVariant = useMemo(() => {
    if (!variantId || !product) return undefined;
    const child = product.childProducts?.find((c) => c?.id === variantId);
    if (!child) return undefined;

    // A ChildProduct is flat (`name`, `sku`, `price`); everything that reads a
    // product — Studio bindings, EP Product Field's field catalog — looks under
    // `attributes` and `meta.display_price`. Project it onto the product shape
    // so the variant is a drop-in for `currentProduct`.
    //
    // `display_price` carries only `without_tax`, which is all a child reports.
    // Keeping the parent's `with_tax` would quote the parent's tax-inclusive
    // price against the child's net one.
    return {
      ...product,
      id: child.id,
      attributes: {
        ...(product.attributes ?? {}),
        name: child.name || product.attributes?.name,
        sku: child.sku ?? product.attributes?.sku,
      },
      // A variant with no photo of its own shows the product's, which is
      // reasonable in a way that inheriting a price is not.
      images: child.images.length > 0 ? child.images : product.images,
      meta: {
        ...(product.meta ?? {}),
        // Always the child's own price, even when that means none: inheriting
        // the parent's would quote a price this variant cannot be bought at.
        display_price:
          child.price || child.priceWithTax
            ? { without_tax: child.price, with_tax: child.priceWithTax }
            : undefined,
      },
    } as Product;
  }, [product, variantId]);

  return (
    <DataProvider name="currentVariant" data={currentVariant}>
      {children}
    </DataProvider>
  );
}

/**
 * Design-time mock used inside Studio / MCP preview when no canvas product
 * is available. Keys match the normalized Product shape so bindings like
 * `$ctx.currentProduct.name` resolve to something sensible at design time.
 */
const MOCK_PRODUCT: Product = mockProduct({
  id: "mock-product",
  name: "Sample Product",
  description:
    "This is a placeholder product shown only at design time. Add a real product ID (or bind productId to $ctx.params.slug) to fetch live data.",
  slug: "sample-product",
  sku: "MOCK-SKU",
  amount: 13500,
  currency: "CHF",
  formatted: "CHF 135.00",
  images: [
    {
      url: "https://picsum.photos/seed/ep-product/800/800",
      alt: "Sample product",
    },
  ],
});

type PreviewState = "auto" | "withData" | "loading" | "error" | "empty";

interface EPProductProviderProps {
  children?: React.ReactNode;
  loadingContent?: React.ReactNode;
  errorContent?: React.ReactNode;
  emptyContent?: React.ReactNode;
  productId?: string;
  /**
   * Pre-fetched product data. When bound (typically to a Plasmic Server
   * Query result like `$q.product.data`), the component skips its
   * internal SWR fetch and publishes the supplied product via DataProvider.
   * This is the SSR path — the fetch runs in Next's RSC layer via
   * `ep.getProduct` before hydration. Leave unset to use the legacy
   * client-side fetch based on `productId`. `null` signals "fetched,
   * nothing found" (renders the empty slot).
   */
  product?: Product | null;
  previewState?: PreviewState;
  className?: string;
}

export const epProductProviderMeta: CodeComponentMeta<EPProductProviderProps> =
  {
    name: "plasmic-commerce-ep-product-provider",
    displayName: "EP Product Provider",
    description:
      "Fetches a single product from Elastic Path by ID and exposes it as `currentProduct` to children. Bind productId to $ctx.params.slug on a /product/[slug] page to wire up a PDP end-to-end.",
    props: {
      children: {
        type: "slot",
        defaultValue: [
          {
            type: "text",
            value: "Drop product UI here. Bind text / images to $ctx.currentProduct.*",
          },
        ],
      },
      loadingContent: {
        type: "slot",
        displayName: "Loading Content",
        defaultValue: { type: "text", value: "Loading product..." },
      },
      errorContent: {
        type: "slot",
        displayName: "Error Content",
        defaultValue: { type: "text", value: "Failed to load product" },
      },
      emptyContent: {
        type: "slot",
        displayName: "Empty Content",
        defaultValue: { type: "text", value: "Product not found" },
      },
      productId: {
        type: "string",
        displayName: "Product ID",
        description:
          "Elastic Path product ID. Usually bound to $ctx.params.slug on /product/[slug] pages.",
      },
      product: {
        type: "object",
        displayName: "Product (pre-fetched)",
        description:
          "Bind to a Plasmic Server Query result (e.g. $q.product.data) to SSR the product from the catch-all route instead of fetching client-side. Leave empty to use the legacy client-fetch path based on Product ID.",
        advanced: true,
      },
      previewState: {
        type: "choice",
        options: ["auto", "withData", "loading", "error", "empty"],
        defaultValue: "auto",
        displayName: "Preview State",
        description:
          "Controls which state is rendered inside Studio / MCP preview. `auto` uses real data when available, falling back to a mock product.",
      },
    },
    providesData: true,
    importPath: "@elasticpath/plasmic-ep-commerce-elastic-path",
    importName: "EPProductProvider",
  };

export function EPProductProvider(props: EPProductProviderProps) {
  const {
    children,
    loadingContent,
    errorContent,
    emptyContent,
    productId,
    product: prefetchedProduct,
    previewState = "auto",
    className,
  } = props;

  const inCanvas = !!usePlasmicCanvasContext();

  // SSR path — when a caller passes `product` (typically bound to a Plasmic
  // Server Query result), we skip the SWR hook entirely. This avoids a
  // duplicate client-side request and removes the loading flicker.
  //
  // Studio canvas quirk: Plasmic does not execute server queries in
  // canvas — the binding `$q.product.data` evaluates to an unresolved
  // Promise rather than a Product object. Treat any Promise (or other
  // non-object) as "not prefetched" so canvas falls through to the SWR
  // path and fetches via `productId` directly.
  const isPromiseLike =
    prefetchedProduct != null &&
    typeof (prefetchedProduct as any).then === "function";
  const hasPrefetched =
    prefetchedProduct !== undefined &&
    !isPromiseLike &&
    typeof prefetchedProduct === "object";

  const swr = useProduct({ id: hasPrefetched ? undefined : productId });
  const product = hasPrefetched
    ? prefetchedProduct
    : (swr.data as Product | undefined);
  const isLoading = hasPrefetched ? false : swr.isLoading;
  const error = hasPrefetched ? undefined : swr.error;

  const effectiveState: Exclude<PreviewState, "auto"> | "withData" = (() => {
    if (inCanvas && previewState !== "auto") return previewState;
    if (isLoading && !product) return "loading";
    if (error && !product) return "error";
    if (!productId || (!product && !isLoading && !error)) {
      // Canvas with no productId → render mock so designers see SOMETHING
      return inCanvas ? "withData" : "empty";
    }
    return "withData";
  })();

  // Decide which product value flows through DataProvider. Studio canvas
  // with no real data falls back to MOCK so bindings resolve; runtime
  // empty/error states deliberately pass `undefined` so child components
  // can distinguish "no product" from "loading".
  const dataProduct: Product | undefined = (() => {
    if (effectiveState === "withData") {
      return product ?? (inCanvas ? MOCK_PRODUCT : undefined);
    }
    if (inCanvas && (effectiveState === "loading" || effectiveState === "error" || effectiveState === "empty")) {
      return MOCK_PRODUCT;
    }
    return undefined;
  })();

  const content = (() => {
    switch (effectiveState) {
      case "loading":
        return loadingContent;
      case "error":
        return errorContent;
      case "empty":
        return emptyContent;
      default:
        return children;
    }
  })();

  // Flat, null-safe map of the product's extensions, keyed by raw template
  // slug (e.g. `products(iso-standard)`), published alongside currentProduct so
  // designers bind `$ctx.productExtensions['<slug>'].<field>` instead of the
  // raw `currentProduct.attributes.extensions[...]` chain.
  // Design-time parity: this provider's own MOCK_PRODUCT carries no extensions,
  // so fall back to the shared mock templates in canvas — keeping the map
  // populated and consistent with the field dropdowns.
  const productExtensions = useMemo(() => {
    const live = normalizeExtensions(extractRawExtensions(dataProduct));
    const templates =
      inCanvas && live.length === 0 ? MOCK_EXTENSION_TEMPLATES : live;
    return buildExtensionsMap(templates);
  }, [dataProduct, inCanvas]);

  return (
    <DataProvider name="currentProduct" data={dataProduct}>
      <DataProvider name="productExtensions" data={productExtensions}>
        <ProductFormScope key={dataProduct?.id}>
          <CurrentVariantScope product={dataProduct}>
            <div className={className} data-ep-product-provider="">
              {content}
            </div>
          </CurrentVariantScope>
        </ProductFormScope>
      </DataProvider>
    </DataProvider>
  );
}

export function registerEPProductProvider(
  loader?: Registerable,
  customMeta?: CodeComponentMeta<EPProductProviderProps>
) {
  const doRegisterComponent: typeof registerComponent = (...args) =>
    loader ? loader.registerComponent(...args) : registerComponent(...args);
  doRegisterComponent(
    EPProductProvider,
    customMeta ?? epProductProviderMeta
  );
}
