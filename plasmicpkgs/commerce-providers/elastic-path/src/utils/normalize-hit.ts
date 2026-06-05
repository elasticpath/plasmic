/**
 * normalizeSearchHit — the search-side product normalizer (ADR-0011 D7 / D1).
 *
 * Produces a `SearchHitProduct`: the shared base `Product` contract every
 * normalizer emits, plus a typed search superset
 * (`_highlighted*` / `_score` / `_rawTypesenseHit` / `rawHit`) and the tiered,
 * designer-bindable surface (`fields` + the slug-keyed `extensionsMap`).
 *
 * It shares the same primitives the PDP path (`normalizeProduct`) uses —
 * `formatCurrency`, `buildExtensionsMap`, `normalizeExtensions`, `isPresent` —
 * so a hit's `currentProduct` is shape-identical to the PDP's. That is what
 * lets the ADR-0006 field components and the `currentProduct.fields.<key>`
 * bindings work unchanged across PDP and search. The input-key mapping (the EP
 * catalog-search field-name conventions) stays here, per-source; the *contract*
 * is shared.
 *
 * Absent base fields read as absent (`isPresent` is false for `""`/`[]`/`{}`)
 * and every map access is null-safe (the `buildExtensionsMap` Proxy), so no
 * binding against a missing field can throw.
 */

import type { Product } from "../types/product";
import type { ExtensionFieldMap, ProductExtensionsMap } from "./extensions-map";
import { buildExtensionsMap } from "./extensions-map";
import { formatCurrency } from "./formatCurrency";
import { normalizeExtensions } from "./field-format";

export const DEFAULT_PRODUCT_PATH_PREFIX = "/product";

// 1x1 transparent gif — keeps the <img src> attribute non-empty so the browser
// doesn't issue a self-referential request (and React's empty-string warning
// stays silent) while the surrounding styles render the visual placeholder.
const TRANSPARENT_PIXEL =
  "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";

const EMPTY_FIELDS: ExtensionFieldMap = Object.freeze({});

/**
 * The search superset of the shared base `Product`. Adds the InstantSearch
 * extras and the tiered designer surface; every added member is additive, so a
 * `SearchHitProduct` is assignable wherever a `Product` is expected (the
 * Tier-0 "same components across PDP and search" guarantee).
 */
export interface SearchHitProduct extends Product {
  /**
   * Base `ProductPrice` plus the pre-formatted, currency-aware string the
   * search backend supplies. Optional/additive: the PDP path doesn't set it,
   * and the `EPProductField` "Price (formatted)" leaf formats currency itself,
   * so cross-source parity holds through the field component regardless.
   */
  price: Product["price"] & { formatted?: string };
  /**
   * Tier 1 — flat, slug-free map of the configured primary extension
   * template's fields, e.g. `currentProduct.fields.title`. Always an object
   * (frozen `{}` when the template is unset or absent), so `.fields.<key>`
   * never throws and reads `undefined` for a missing key.
   */
  fields: ExtensionFieldMap;
  /**
   * Tier 3 — the raw `attributes.extensions` block exactly as it arrived on
   * the hit (`extensions["products(slug)"].field`). Retained for back-compat
   * and advanced use; prefer `fields` (Tier 1) or the `productExtensions` map
   * (Tier 2).
   */
  extensions: Record<string, unknown>;
  /** Highlighted (`<mark>`-wrapped) name, when the query matched it. */
  _highlightedName?: string;
  /** Highlighted (`<mark>`-wrapped) full description, when matched. */
  _highlightedDescription?: string;
  /** Snippeted (`<mark>`-wrapped excerpt) description, when matched. */
  _snippetedDescription?: string;
  /** Relevance score, when the backend exposes one. */
  _score?: number;
  /** The untouched Typesense hit, for advanced escape-hatch bindings. */
  _rawTypesenseHit?: Record<string, unknown>;
  /** The untouched InstantSearch hit. */
  rawHit: Record<string, unknown>;
}

/** A normalized hit: the bindable product plus its per-hit, null-safe slug map. */
export interface NormalizedHit {
  product: SearchHitProduct;
  /**
   * Tier 2 — the ADR-0007 slug-keyed, null-safe Proxy map, scoped to this hit.
   * Published per hit as `$ctx.productExtensions`, identical in shape to the
   * PDP provider's map.
   */
  extensionsMap: ProductExtensionsMap;
}

export interface NormalizeHitOptions {
  productPathPrefix?: string;
  /**
   * Raw template slug (e.g. `products(iso-standard)`) whose fields flatten onto
   * `currentProduct.fields`. Unset → `fields` is an empty object.
   */
  primaryExtensionTemplate?: string;
}

/** The hit wire path for the EP `attributes.extensions` block. */
function readHitExtensions(hit: Record<string, any>): Record<string, unknown> {
  return hit.attributes?.extensions || hit.extensions || {};
}

/**
 * Normalize an InstantSearch hit to the shared base `Product` shape plus the
 * search superset. The EP catalog-search adapter surfaces various field-name
 * conventions; this resolves each one.
 */
export function normalizeSearchHit(
  hit: Record<string, any>,
  currencyCode: string,
  options: NormalizeHitOptions = {}
): NormalizedHit {
  const {
    productPathPrefix = DEFAULT_PRODUCT_PATH_PREFIX,
    primaryExtensionTemplate = "",
  } = options;

  const name = hit.ep_name || hit.name || hit.attributes?.name || "";
  const slug = hit.ep_slug || hit.slug || hit.attributes?.slug || "";
  const sku = hit.ep_sku || hit.sku || hit.attributes?.sku || "";
  const description =
    hit.ep_description || hit.description || hit.attributes?.description || "";

  // Image: prefer the inlined `main_image` record that EPCatalogSearchProvider
  // requests via `include: ["main_image"]` (adapter v0.1.0+ resolves the
  // included block against each hit's relationship reference). Fallbacks cover
  // catalogs that already denormalize a URL onto the hit root.
  const imageUrl =
    hit.main_image?.link?.href ||
    hit.ep_main_image?.link?.href ||
    hit.ep_main_image_url ||
    hit.main_image_url ||
    "";

  // Price resolution — EP catalog search exposes prices in two shapes
  // depending on catalog config:
  //   1. `meta.display_price.without_tax`  → preferred; pre-formatted, currency-aware
  //   2. `attributes.price[CURRENCY].amount` (in cents) → raw fallback
  // We also keep the older `ep_price` / `price` paths for back-compat with
  // search backends that flatten the price object onto the hit root.
  const displayPrice =
    hit.meta?.display_price?.without_tax ||
    hit.meta?.display_price?.with_tax ||
    null;
  const attrPriceObj =
    hit.attributes?.price?.[currencyCode] || hit.attributes?.price?.USD || null;
  const flatPriceObj =
    hit.ep_price?.[currencyCode] ||
    hit.price?.[currencyCode] ||
    hit.ep_price?.USD ||
    hit.price?.USD ||
    null;
  const priceValue =
    displayPrice?.float_price ??
    flatPriceObj?.float_price ??
    flatPriceObj?.amount ??
    (attrPriceObj?.amount != null ? attrPriceObj.amount / 100 : undefined) ??
    hit.price?.value ??
    0;
  const priceCurrency = displayPrice?.currency || currencyCode || "USD";
  const formatted =
    displayPrice?.formatted || formatCurrency(priceValue, priceCurrency);

  // Highlight results from InstantSearch.
  //
  // The EP catalog-search backend keys highlights by the BARE query_by field
  // names (`name`, `description`) while the document nests them under
  // `attributes.…` — the adapter's document-driven highlight walk therefore
  // drops them from `_highlightResult`/`_snippetResult`. Recover from the raw
  // Typesense hit (`highlight.<field>.{value,snippet}`), keeping the adapter
  // paths as fallbacks for backends where they do line up.
  const highlighted = hit._highlightResult || hit._highlight || {};
  const snippeted = hit._snippetResult || {};
  const rawTypesenseHit = hit._rawTypesenseHit;
  const rawHighlight = rawTypesenseHit?.highlight || {};
  const highlightedName =
    rawHighlight.name?.value ||
    rawHighlight.name?.snippet ||
    highlighted.ep_name?.value ||
    highlighted.name?.value ||
    highlighted.attributes?.name?.value ||
    undefined;
  const highlightedDescription =
    rawHighlight.description?.value ||
    highlighted.ep_description?.value ||
    highlighted.description?.value ||
    highlighted.attributes?.description?.value ||
    undefined;
  // Snippet = the shortened, `<mark>`-highlighted excerpt Typesense builds for
  // long fields (e.g. a description/abstract snippet on a hit card).
  const snippetedDescription =
    rawHighlight.description?.snippet ||
    snippeted.description?.value ||
    snippeted.attributes?.description?.value ||
    undefined;

  // Template extensions — the catalog-search document carries the same
  // `attributes.extensions` block as the shopper product API. Build the
  // tiered surface from the shared primitives:
  //   - `extensions` (Tier 3): the raw block, untouched.
  //   - `extensionsMap` (Tier 2): the null-safe slug-keyed Proxy (ADR-0007),
  //     published per hit as `$ctx.productExtensions`.
  //   - `fields` (Tier 1): the primary template's fields flattened slug-free.
  const rawExtensions = readHitExtensions(hit);
  const extensionsMap = buildExtensionsMap(normalizeExtensions(rawExtensions));
  const fields: ExtensionFieldMap = primaryExtensionTemplate
    ? extensionsMap[primaryExtensionTemplate]
    : EMPTY_FIELDS;

  // Strip the trailing slash so both "/product" and "/product/" work.
  const pathPrefix = (productPathPrefix || DEFAULT_PRODUCT_PATH_PREFIX).replace(
    /\/+$/,
    ""
  );
  const id = hit.objectID || hit.id || "";

  const product: SearchHitProduct = {
    id,
    name,
    slug,
    sku,
    description,
    // PDP route — configurable via the `productPathPrefix` prop so storefronts
    // with a different route shape (e.g. `/products`, `/en/products`) link
    // correctly. Falls back to an id-based URL when the hit lacks a slug.
    path: `${pathPrefix}/${slug || id}`,
    images: [{ url: imageUrl || TRANSPARENT_PIXEL, alt: name }],
    // A search hit carries no variant data; an empty array is the honest
    // base-contract value (presence reads absent) and keeps the shape
    // identical to the PDP's `Product`.
    variants: [],
    price: { value: priceValue, currencyCode: priceCurrency, formatted },
    options: [],
    extensions: rawExtensions,
    fields,
    // The search document has the shopper-product shape ({attributes, id,
    // meta, …}), so wrapping it as `{ data: hit }` matches the PDP's `rawData`
    // contract (see extractRawExtensions in utils/field-format.ts) and lets the
    // ADR-0006 field components resolve inside hit cards unchanged.
    rawData: { data: hit } as Product["rawData"],
    _highlightedName: highlightedName,
    _highlightedDescription: highlightedDescription,
    _snippetedDescription: snippetedDescription,
    _score: hit._score ?? hit._rankingInfo?.relevance ?? undefined,
    _rawTypesenseHit: rawTypesenseHit,
    rawHit: hit,
  };

  return { product, extensionsMap };
}
