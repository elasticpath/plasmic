/**
 * EPSearchHits — repeater for catalog search results.
 *
 * Wraps `useHits()` from react-instantsearch and normalizes each hit through
 * the shared `normalizeSearchHit` (ADR-0011 D7) to the unified `currentProduct`
 * shape used across the PDP and EPProductGrid. Designers reuse the same card
 * layouts and the same field components across listing and search.
 *
 * Per hit it publishes the tiered, progressively-disclosed data surface:
 *   - Tier 0 — drop an `EPProductField` and pick a field from the dropdown
 *     (resolves here via the `currentProduct.rawData` bridge).
 *   - Tier 1 — `$ctx.currentProduct.fields.<key>`, the slug-free flattening of
 *     the configured `primaryExtensionTemplate` (discoverable, null-safe).
 *   - Tier 2 — `$ctx.productExtensions["<slug>"].field`, the ADR-0007 slug-keyed
 *     Proxy map, scoped per hit.
 *   - Tier 3 — raw `currentProduct.extensions` / `currentProduct.rawData`.
 *
 * Search-specific extras (`_highlightedName`, `_snippetedDescription`, `_score`,
 * `rawHit`) ride along on `currentProduct` for advanced use.
 *
 * The mock (canvas) and runtime paths share one presentational render
 * (`HitsList`) fed `NormalizedHit[]` — the data wrapper above owns the
 * InstantSearch hook, the inner is pure (#305 headless styling contract, D9).
 */

import {
  DataProvider,
  repeatedElement,
  useSelector,
  usePlasmicCanvasContext,
} from "@plasmicapp/host";
import registerComponent, {
  CodeComponentMeta,
} from "@plasmicapp/host/registerComponent";
import React, { useMemo } from "react";
import { Registerable } from "../registerable";
import { MOCK_SEARCH_PRODUCTS } from "./design-time-data";
import { MOCK_EXTENSIONS_RAW } from "../utils/extensions-mock";
import {
  DEFAULT_PRODUCT_PATH_PREFIX,
  normalizeSearchHit,
} from "../utils/normalize-hit";
import type { NormalizedHit } from "../utils/normalize-hit";
import type { Product } from "../types/product";

type PreviewState = "auto" | "withData";

// Default grid layout — applied as inline style so it survives Plasmic's
// className filter (which strips display/grid props from code component
// instances).
//
// `align-self: stretch` keeps the grid full-width when its parent is a flex
// container with `align-items: center` (a common Plasmic page layout).
// Without it the grid collapses to its `min-content` (one column) because
// flex defaults each child to `align-self: auto`.
function buildHitsGridStyle(
  gridTemplateColumns: string,
  gap: string
): React.CSSProperties {
  return {
    display: "grid",
    gridTemplateColumns,
    gap,
    width: "100%",
    alignSelf: "stretch",
  };
}

const DEFAULT_GRID_TEMPLATE_COLUMNS = "repeat(auto-fill, minmax(220px, 1fr))";
const DEFAULT_GRID_GAP = "24px";

interface EPSearchHitsProps {
  children?: React.ReactNode;
  className?: string;
  gridTemplateColumns?: string;
  gridGap?: string;
  productPathPrefix?: string;
  primaryExtensionTemplate?: string;
  previewState?: PreviewState;
}

/**
 * Build a search-hit-shaped record from a design-time mock Product so the
 * canvas runs through the *same* `normalizeSearchHit` as runtime (mock == runtime
 * shape, D9). Carries the shared mock extensions so the Tier-1 `fields` and the
 * Tier-2 map populate when authoring hit cards in the canvas.
 */
function mockProductToHit(product: Product): Record<string, any> {
  return {
    objectID: product.id,
    attributes: {
      name: product.name,
      slug: product.slug ?? "",
      sku: product.sku ?? "",
      description: product.description,
      extensions: MOCK_EXTENSIONS_RAW,
    },
    main_image: { link: { href: product.images[0]?.url } },
    meta: {
      display_price: {
        without_tax: {
          float_price: product.price.value,
          currency: product.price.currencyCode ?? "USD",
        },
      },
    },
  };
}

export const epSearchHitsMeta: CodeComponentMeta<EPSearchHitsProps> = {
  name: "plasmic-commerce-ep-search-hits",
  displayName: "EP Search Hits",
  section: "EP Catalog Search",
  description:
    "Repeats children for each search result. Exposes currentProduct (same shape as the PDP) — drop EP Product Field, bind currentProduct.fields.<key>, or use $ctx.productExtensions — plus search extras. Must be inside EP Catalog Search Provider.",
  props: {
    children: {
      type: "slot",
      // Batteries-included but unstyled (D8): a working card built from the
      // Tier-0 field components. Renders against mock data with zero bindings,
      // so a designer styles up from a correct structure. `highlight: auto`
      // shows the <mark>-matched name/abstract in a real search hit.
      defaultValue: [
        {
          type: "vbox",
          styles: { alignItems: "flex-start", gap: "4px" },
          children: [
            {
              type: "component",
              name: "plasmic-commerce-ep-product-field",
              props: { field: "name", highlight: "auto" },
            },
            {
              type: "component",
              name: "plasmic-commerce-ep-product-field",
              props: { field: "description", highlight: "auto" },
            },
            {
              type: "component",
              name: "plasmic-commerce-ep-product-field",
              props: { field: "price" },
            },
          ],
        },
      ],
    },
    gridTemplateColumns: {
      type: "string",
      displayName: "Grid Template Columns",
      description:
        "CSS grid-template-columns value applied to the hits container. Defaults to a responsive auto-fill. Plasmic strips display/grid styles set in the canvas Style panel from code components, so this prop is the supported way to override the layout.",
      defaultValue: DEFAULT_GRID_TEMPLATE_COLUMNS,
    },
    gridGap: {
      type: "string",
      displayName: "Grid Gap",
      description: "CSS gap between hit cards.",
      defaultValue: DEFAULT_GRID_GAP,
    },
    productPathPrefix: {
      type: "string",
      displayName: "Product Path Prefix",
      description:
        "Route prefix used to build each hit's currentProduct.path link (prefix + '/' + slug). Set this to match the storefront's PDP route, e.g. \"/products\".",
      defaultValue: DEFAULT_PRODUCT_PATH_PREFIX,
    },
    primaryExtensionTemplate: {
      type: "string",
      displayName: "Primary Extension Template",
      description:
        'Raw template slug (e.g. "products(iso-standard)") whose fields flatten onto the discoverable, slug-free $ctx.currentProduct.fields.<key> namespace. Leave empty to skip — the slug-keyed $ctx.productExtensions map and raw extensions are always available.',
      defaultValue: "",
    },
    previewState: {
      type: "choice",
      options: ["auto", "withData"],
      defaultValue: "auto",
      displayName: "Preview State",
      advanced: true,
    },
  } as any,
  importPath: "@elasticpath/plasmic-ep-commerce-elastic-path",
  importName: "EPSearchHits",
  parentComponentName: "plasmic-commerce-ep-catalog-search-provider",
  providesData: true,
};

export function EPSearchHits(props: EPSearchHitsProps) {
  const {
    children,
    className,
    gridTemplateColumns = DEFAULT_GRID_TEMPLATE_COLUMNS,
    gridGap = DEFAULT_GRID_GAP,
    productPathPrefix = DEFAULT_PRODUCT_PATH_PREFIX,
    primaryExtensionTemplate = "",
    previewState = "auto",
  } = props;

  const inEditor = !!usePlasmicCanvasContext();
  const useMock =
    previewState === "withData" || (previewState === "auto" && inEditor);

  const gridStyle = buildHitsGridStyle(gridTemplateColumns, gridGap);

  if (useMock) {
    return (
      <MockSearchHits
        className={className}
        gridStyle={gridStyle}
        productPathPrefix={productPathPrefix}
        primaryExtensionTemplate={primaryExtensionTemplate}
      >
        {children}
      </MockSearchHits>
    );
  }

  return (
    <EPSearchHitsInner
      className={className}
      gridStyle={gridStyle}
      productPathPrefix={productPathPrefix}
      primaryExtensionTemplate={primaryExtensionTemplate}
    >
      {children}
    </EPSearchHitsInner>
  );
}

/** Pure presentational render shared by the mock and runtime data wrappers. */
function HitsList(props: {
  items: NormalizedHit[];
  children?: React.ReactNode;
  className?: string;
  gridStyle: React.CSSProperties;
}) {
  const { items, children, className, gridStyle } = props;

  if (items.length === 0) return null;

  return (
    <div
      className={className}
      role="list"
      aria-label="Search results"
      data-ep-search-hits=""
      style={gridStyle}
    >
      {items.map(({ product, extensionsMap }, i) => (
        <div key={product.id || i} role="listitem">
          <DataProvider name="currentProduct" data={product}>
            <DataProvider name="productExtensions" data={extensionsMap}>
              <DataProvider name="currentProductIndex" data={i}>
                {repeatedElement(i, children)}
              </DataProvider>
            </DataProvider>
          </DataProvider>
        </div>
      ))}
    </div>
  );
}

function MockSearchHits(props: {
  children?: React.ReactNode;
  className?: string;
  gridStyle: React.CSSProperties;
  productPathPrefix: string;
  primaryExtensionTemplate: string;
}) {
  const {
    children,
    className,
    gridStyle,
    productPathPrefix,
    primaryExtensionTemplate,
  } = props;

  const items = useMemo(
    () =>
      MOCK_SEARCH_PRODUCTS.map((p) =>
        normalizeSearchHit(
          mockProductToHit(p),
          p.price.currencyCode ?? "USD",
          { productPathPrefix, primaryExtensionTemplate }
        )
      ),
    [productPathPrefix, primaryExtensionTemplate]
  );

  return (
    <HitsList items={items} className={className} gridStyle={gridStyle}>
      {children}
    </HitsList>
  );
}

function EPSearchHitsInner(props: {
  children?: React.ReactNode;
  className?: string;
  gridStyle: React.CSSProperties;
  productPathPrefix: string;
  primaryExtensionTemplate: string;
}) {
  const {
    children,
    className,
    gridStyle,
    productPathPrefix,
    primaryExtensionTemplate,
  } = props;

  const { useHits } = require("react-instantsearch");
  const { hits } = useHits();

  // Read currencyCode from parent EPCatalogSearchProvider's DataProvider context
  const catalogSearchData = useSelector("catalogSearchData") as
    | { currencyCode?: string }
    | undefined;
  const currencyCode = catalogSearchData?.currencyCode || "USD";

  const items = useMemo(
    () =>
      (hits || []).map((hit: Record<string, any>) =>
        normalizeSearchHit(hit, currencyCode, {
          productPathPrefix,
          primaryExtensionTemplate,
        })
      ),
    [hits, currencyCode, productPathPrefix, primaryExtensionTemplate]
  );

  return (
    <HitsList items={items} className={className} gridStyle={gridStyle}>
      {children}
    </HitsList>
  );
}

export function registerEPSearchHits(
  loader?: Registerable,
  customMeta?: CodeComponentMeta<EPSearchHitsProps>
) {
  const doRegisterComponent: typeof registerComponent = (...args) =>
    loader ? loader.registerComponent(...args) : registerComponent(...args);
  doRegisterComponent(EPSearchHits, customMeta ?? epSearchHitsMeta);
}
