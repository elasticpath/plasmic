/**
 * Registers EP server-side custom functions with the Plasmic loader so they
 * are invokable from Studio Server Queries (per PRD #262).
 *
 * Usage in `plasmic-init.ts`:
 *     import { PLASMIC } from "@/plasmic-init";
 *     import { registerEpCustomFunctions } from "@elasticpath/plasmic-ep-commerce-elastic-path";
 *     registerEpCustomFunctions(PLASMIC);
 *
 * Functions are registered under the `ep` namespace; designers reference
 * them as `ep.getProduct(...)` in the Server Query builder.
 */

import {
  epAddCartItem,
  epApplyCartAdjustment,
  epRemoveCartItem,
  epUpdateCartItem,
} from "./cart-mutations";
import { epGetCart } from "./getCart";
import { epGetProduct } from "./getProduct";
import { epGetProductList } from "./getProductList";
import { epGetProductPage } from "./getProductPage";
import { epGetRelatedProducts } from "./getRelatedProducts";

// `meta` stays `any`: CustomFunctionMeta is re-declared in both
// @plasmicapp/host and loader-react, so any stricter shape rejects a loader.
interface Registerable {
  registerFunction: (fn: any, meta: any) => void;
}

const IMPORT_PATH = "@elasticpath/plasmic-ep-commerce-elastic-path/server";

interface EpFunctionSpec {
  fn: (...args: any[]) => any;
  name: string;
  description: string;
  /**
   * When true, registers the function as a mutation (a Studio Server Query
   * the designer invokes to *change* state, not to read it). Cart writes set
   * this so Studio surfaces them as actions rather than data sources.
   *
   * Exhaustive with `isQuery`: Studio's pickers filter on one or the other
   * (`ServerQueryOpPicker` -> `mode === "mutation" ? fn.isMutation : fn.isQuery`),
   * so a function flagged as neither is invisible in both. Registration
   * derives `isQuery` from this field rather than repeating it per spec.
   */
  isMutation?: boolean;
  /**
   * Flat parameter schema. Each entry corresponds to a top-level key in
   * the Studio Server Query `args` editor. Designers bind each value to
   * a JS expression (e.g. `id` ↔ `$ctx.params.slug`). Studio canvas
   * evaluates each expression with `$ctx` in scope; nesting them inside
   * a single object-literal expression breaks that eval path because
   * Plasmic's canvas runtime injects `$ctx` per-arg, not per-sub-expression.
   *
   * The package's Plasmic loader reassembles flat args into the single
   * input object every `ep.*` function expects (e.g. `epGetProduct({id})`),
   * so we keep the function signature ergonomic while preserving canvas
   * compatibility.
   */
  params: { name: string; type: string; description?: string }[];
}

const EP_FUNCTIONS: EpFunctionSpec[] = [
  {
    fn: epGetProduct,
    name: "getProduct",
    description:
      "Fetch a single EP product by ID, server-side. Returns null when the product is missing.",
    params: [{ name: "id", type: "string", description: "EP product UUID." }],
  },
  {
    fn: epGetCart,
    name: "getCart",
    description:
      "Fetch the current cart, server-side. Returns null when there is no cart or the cart is unreachable.",
    params: [],
  },
  {
    fn: epGetProductList,
    name: "getProductList",
    description:
      "Fetch a list of products with optional filter/sort/limit, server-side. Returns an empty array on error.",
    params: [
      { name: "limit", type: "number", description: "Page size." },
      { name: "search", type: "string", description: "Search query." },
      { name: "categoryId", type: "string", description: "EP hierarchy ID." },
      { name: "sort", type: "string", description: "Sort key." },
    ],
  },
  {
    fn: epGetProductPage,
    name: "getProductPage",
    description:
      "Fetch one page of products with the total count, server-side. Returns Elastic Path's envelope: `data` plus `meta.results.total` and `meta.page`. Use this over getProductList when the page needs pagination controls.",
    params: [
      { name: "limit", type: "number", description: "Page size." },
      {
        name: "offset",
        type: "number",
        description: "Zero-based record offset.",
      },
      { name: "search", type: "string", description: "Search query." },
      { name: "categoryId", type: "string", description: "EP hierarchy ID." },
      { name: "sort", type: "string", description: "Sort key." },
    ],
  },
  {
    fn: epGetRelatedProducts,
    name: "getRelatedProducts",
    description:
      "Fetch products related to the given product by EP custom-relationship slug. Returns an empty array on error.",
    params: [
      {
        name: "productId",
        type: "string",
        description: "Source product UUID.",
      },
      {
        name: "relationshipSlug",
        type: "string",
        description: "EP custom-relationship slug, e.g. CRP_related_products.",
      },
      { name: "limit", type: "number", description: "Page size." },
    ],
  },
  {
    fn: epAddCartItem,
    name: "addCartItem",
    isMutation: true,
    description:
      "Add an item to the current shopper's cart. Auto-creates a cart on the first add. Throws on backend error.",
    params: [
      { name: "productId", type: "string", description: "EP product UUID." },
      {
        name: "quantity",
        type: "number",
        description: "Number of units to add.",
      },
      {
        name: "sku",
        type: "string",
        description:
          "Variant SKU (optional, overrides productId for SKU-based variants).",
      },
      {
        name: "customInputs",
        type: "object",
        description: "Custom inputs (e.g. _selectedOptions, gift messages).",
      },
    ],
  },
  {
    fn: epApplyCartAdjustment,
    name: "applyCartAdjustment",
    isMutation: true,
    description:
      "Add a labelled, bounded adjustment line (fee/handling/shipping) to the current cart, computed server-side. The EP cart re-prices and the new total is what checkout charges; a shopper cannot forge or remove it. amountMinor is in minor currency units (e.g. cents) and must be ≥ 0.",
    params: [
      {
        name: "label",
        type: "string",
        description: 'Line label shown in the cart, e.g. "Handling fee".',
      },
      {
        name: "amountMinor",
        type: "number",
        description:
          "Adjustment amount in minor currency units (e.g. cents). Must be ≥ 0.",
      },
      {
        name: "kind",
        type: "string",
        description: 'Adjustment family: "fee", "handling", or "shipping".',
      },
      {
        name: "quantity",
        type: "number",
        description: "Units of the adjustment (optional, default 1).",
      },
    ],
  },
  {
    fn: epUpdateCartItem,
    name: "updateCartItem",
    isMutation: true,
    description:
      "Update the quantity of a line item in the current cart. Throws when no cart exists.",
    params: [
      { name: "itemId", type: "string", description: "EP cart item UUID." },
      { name: "quantity", type: "number", description: "New quantity." },
    ],
  },
  {
    fn: epRemoveCartItem,
    name: "removeCartItem",
    isMutation: true,
    description:
      "Remove a line item from the current cart. Throws when no cart exists.",
    params: [
      { name: "itemId", type: "string", description: "EP cart item UUID." },
    ],
  },
];

type AdaptedFunction = (...args: unknown[]) => unknown;

// Plasmic calls registered functions with one positional arg per declared
// param. Our `ep.*` functions consume a single input object
// (`epGetProduct({id})`). Reassemble.
function adaptToPositionalArgs(spec: EpFunctionSpec): AdaptedFunction {
  const paramNames = spec.params.map((p) => p.name);
  return (...positionalArgs: unknown[]) => {
    const input: Record<string, unknown> = {};
    paramNames.forEach((name, i) => {
      if (positionalArgs[i] !== undefined) input[name] = positionalArgs[i];
    });
    return spec.fn(input);
  };
}

const ADAPTED: Record<string, AdaptedFunction> = {};
for (const spec of EP_FUNCTIONS) {
  ADAPTED[spec.name] = adaptToPositionalArgs(spec);
}

// `registerFunction` has no `importName`, so Studio stores `meta.name` as the
// symbol the loader imports from `IMPORT_PATH`. Generated code emits
// `import { getProduct } from ".../server"` and calls it positionally, so the
// bare names must resolve to the adapted forms, not the object-input `ep*`
// originals.
export const getProduct = ADAPTED.getProduct;
export const getCart = ADAPTED.getCart;
export const getProductList = ADAPTED.getProductList;
export const getProductPage = ADAPTED.getProductPage;
export const getRelatedProducts = ADAPTED.getRelatedProducts;
export const addCartItem = ADAPTED.addCartItem;
export const applyCartAdjustment = ADAPTED.applyCartAdjustment;
export const updateCartItem = ADAPTED.updateCartItem;
export const removeCartItem = ADAPTED.removeCartItem;

export const EP_FUNCTION_NAMES = EP_FUNCTIONS.map((spec) => spec.name);

const registered = new WeakSet<Registerable>();

export function registerEpCustomFunctions(loader: Registerable): void {
  if (registered.has(loader)) return;
  registered.add(loader);

  for (const spec of EP_FUNCTIONS) {
    loader.registerFunction(ADAPTED[spec.name], {
      name: spec.name,
      namespace: "ep",
      importPath: IMPORT_PATH,
      description: spec.description,
      params: spec.params,
      ...(spec.isMutation
        ? { isMutation: spec.isMutation }
        : { isQuery: true }),
    });
  }
}
