import type { EpMultiSearchResponse } from "../ep-server-functions/multiSearch";
import type { Product } from "../types/product";
import { completePrice } from "../utils/price";
import {
  DEFAULT_PRODUCT_PATH_PREFIX,
  productPath,
} from "../utils/product-path";

/** 1x1 transparent gif — keeps `<img src>` non-empty so the browser issues no
 * self-referential request while the surrounding styles render a placeholder. */
const TRANSPARENT_PIXEL =
  "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";

/** What a search hit carries that a product does not. */
export interface SearchHitMeta {
  /** PDP route, built from `productPathPrefix` and the hit's slug or id. */
  path: string;
  highlightedName?: string;
  highlightedDescription?: string;
  snippetedDescription?: string;
  score?: number;
  raw: Record<string, any>;
}

/**
 * A catalog-search hit as an Elastic Path product.
 *
 * The search document already has the shopper-product shape
 * (`{ id, attributes, meta }`), so this fills in the fallbacks for backends
 * that flatten fields onto the hit root and joins the image the adapter
 * inlines — nothing else is reshaped.
 */
export function hitToProduct(
  hit: Record<string, any>,
  currencyCode: string
): Product {
  const attributes = {
    ...(hit.attributes ?? {}),
    name: hit.attributes?.name || hit.ep_name || hit.name || "",
    slug: hit.attributes?.slug || hit.ep_slug || hit.slug || "",
    sku: hit.attributes?.sku || hit.ep_sku || hit.sku || "",
    description:
      hit.attributes?.description || hit.ep_description || hit.description || "",
  };

  const imageUrl =
    hit.main_image?.link?.href ||
    hit.ep_main_image?.link?.href ||
    hit.ep_main_image_url ||
    hit.main_image_url ||
    "";

  // EP catalog search reports price in `meta.display_price` when the catalog is
  // configured for it, and otherwise flattens an amount onto the document.
  const displayPrice =
    hit.meta?.display_price?.without_tax || hit.meta?.display_price?.with_tax;
  const flat =
    hit.attributes?.price?.[currencyCode] ||
    hit.attributes?.price?.USD ||
    hit.ep_price?.[currencyCode] ||
    hit.price?.[currencyCode] ||
    hit.ep_price?.USD ||
    hit.price?.USD;
  const price = completePrice(
    displayPrice ?? {
      amount: flat?.amount ?? 0,
      currency: flat?.currency ?? currencyCode,
      float_price: flat?.float_price,
    }
  );

  return {
    id: hit.objectID || hit.id || "",
    type: "product",
    attributes,
    meta: { ...(hit.meta ?? {}), display_price: { without_tax: price } },
    images: [{ url: imageUrl || TRANSPARENT_PIXEL, alt: attributes.name }],
    variations: [],
    childProducts: [],
  };
}

/**
 * The search-side facts about a hit: where it links, and what the backend
 * highlighted.
 *
 * The EP catalog-search backend keys highlights by the BARE `query_by` field
 * names while the document nests them under `attributes.…`, so the adapter's
 * document-driven walk drops them — recover from the raw Typesense hit and keep
 * the adapter paths as fallbacks for backends where they line up.
 */
export function hitToSearchMeta(
  hit: Record<string, any>,
  product: Product,
  productPathPrefix: string = DEFAULT_PRODUCT_PATH_PREFIX
): SearchHitMeta {
  const highlighted = hit._highlightResult || hit._highlight || {};
  const snippeted = hit._snippetResult || {};
  const rawHighlight = hit._rawTypesenseHit?.highlight || {};

  return {
    path: productPath(product, productPathPrefix),
    highlightedName:
      rawHighlight.name?.value ||
      rawHighlight.name?.snippet ||
      highlighted.ep_name?.value ||
      highlighted.name?.value ||
      highlighted.attributes?.name?.value ||
      undefined,
    highlightedDescription:
      rawHighlight.description?.value ||
      highlighted.ep_description?.value ||
      highlighted.description?.value ||
      highlighted.attributes?.description?.value ||
      undefined,
    snippetedDescription:
      rawHighlight.description?.snippet ||
      snippeted.description?.value ||
      snippeted.attributes?.description?.value ||
      undefined,
    score: hit._score ?? hit._rankingInfo?.relevance ?? undefined,
    raw: hit,
  };
}

export function searchResponseHits(
  response: EpMultiSearchResponse | null | undefined
): Record<string, any>[] {
  const result = response?.results?.[0] as
    | { hits?: Array<Record<string, any>> }
    | undefined;
  const images = (response?.included as Record<string, any> | undefined)
    ?.main_images as Array<Record<string, any>> | undefined;

  return (result?.hits ?? []).map((raw) => {
    const document: Record<string, any> =
      raw && typeof raw.document === "object" && raw.document
        ? raw.document
        : raw;
    const imageId = document.relationships?.main_image?.data?.id;
    const image = imageId
      ? images?.find((candidate) => candidate?.id === imageId)
      : undefined;
    return {
      ...document,
      objectID: document.id,
      _rawTypesenseHit: raw,
      ...(image ? { main_image: image } : {}),
    };
  });
}
