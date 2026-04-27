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

import { epGetProduct } from "./getProduct";
import { epGetCart } from "./getCart";
import { epGetProductList } from "./getProductList";
import { epGetRelatedProducts } from "./getRelatedProducts";

interface Registerable {
  registerFunction: (
    fn: (...args: unknown[]) => unknown,
    meta: Record<string, unknown>
  ) => void;
}

const IMPORT_PATH = "@elasticpath/plasmic-ep-commerce-elastic-path/server";

interface EpFunctionSpec {
  fn: (...args: any[]) => any;
  name: string;
  description: string;
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
    params: [
      { name: "id", type: "string", description: "EP product UUID." },
    ],
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
    fn: epGetRelatedProducts,
    name: "getRelatedProducts",
    description:
      "Fetch products related to the given product by EP custom-relationship slug. Returns an empty array on error.",
    params: [
      { name: "productId", type: "string", description: "Source product UUID." },
      { name: "relationshipSlug", type: "string", description: "EP custom-relationship slug, e.g. CRP_related_products." },
      { name: "limit", type: "number", description: "Page size." },
    ],
  },
];

const registered = new WeakSet<Registerable>();

export function registerEpCustomFunctions(loader: Registerable): void {
  if (registered.has(loader)) return;
  registered.add(loader);

  for (const spec of EP_FUNCTIONS) {
    // Adapter: Plasmic calls registered functions with one positional
    // arg per declared param. Our `ep.*` functions consume a single
    // input object (`epGetProduct({id})`). Reassemble.
    const paramNames = spec.params.map((p) => p.name);
    const adapted = (...positionalArgs: unknown[]) => {
      const input: Record<string, unknown> = {};
      paramNames.forEach((name, i) => {
        if (positionalArgs[i] !== undefined) input[name] = positionalArgs[i];
      });
      return spec.fn(input);
    };

    loader.registerFunction(adapted as (...args: unknown[]) => unknown, {
      name: spec.name,
      namespace: "ep",
      importPath: IMPORT_PATH,
      description: spec.description,
      params: spec.params,
    });
  }
}
