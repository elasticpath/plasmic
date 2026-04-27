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
  paramShape: string;
}

const EP_FUNCTIONS: EpFunctionSpec[] = [
  {
    fn: epGetProduct,
    name: "getProduct",
    description:
      "Fetch a single EP product by ID, server-side. Returns null when the product is missing.",
    paramShape:
      "{ id: string; auth: { accessToken, host, clientId, cartId?, accountId?, locale? } }",
  },
  {
    fn: epGetCart,
    name: "getCart",
    description:
      "Fetch the current cart, server-side. Returns null when there is no cart or the cart is unreachable.",
    paramShape:
      "{ auth: { accessToken, host, clientId, cartId, accountId?, locale? } }",
  },
  {
    fn: epGetProductList,
    name: "getProductList",
    description:
      "Fetch a list of products with optional filter/sort/limit, server-side. Returns an empty array on error.",
    paramShape:
      "{ limit?: number; search?: string; categoryId?: string; sort?: string; auth: {...} }",
  },
  {
    fn: epGetRelatedProducts,
    name: "getRelatedProducts",
    description:
      "Fetch products related to the given product by EP custom-relationship slug. Returns an empty array on error.",
    paramShape:
      "{ productId: string; relationshipSlug: string; limit?: number; auth: {...} }",
  },
];

const registered = new WeakSet<Registerable>();

export function registerEpCustomFunctions(loader: Registerable): void {
  if (registered.has(loader)) return;
  registered.add(loader);

  for (const spec of EP_FUNCTIONS) {
    loader.registerFunction(spec.fn as (...args: unknown[]) => unknown, {
      name: spec.name,
      namespace: "ep",
      importPath: IMPORT_PATH,
      description: spec.description,
      params: [
        {
          name: "input",
          type: "object",
          description: spec.paramShape,
        },
      ],
    });
  }
}
