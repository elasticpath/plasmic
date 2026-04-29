/**
 * EP server-function proxy route (PRD-273 follow-up).
 *
 * Backs the browser-only fallback that the registered `ep*` server
 * functions use when running in a browser context with no
 * AsyncLocalStorage session — Studio canvas and the data-query preview
 * panel. The route reads the better-auth session cookie that SSR also
 * reads, dispatches to the matching server function under
 * `withEpSession`, and returns its JSON result.
 *
 * Consumer mounts at `app/api/ep/proxy/[fn]/route.ts`:
 *
 *   import { createEpProxyRoutes } from
 *     "@elasticpath/plasmic-ep-commerce-elastic-path/server";
 *   import { epAuth } from "@/lib/ep-auth";
 *
 *   const routes = createEpProxyRoutes(epAuth);
 *   export const POST = routes.handle;
 *   export const OPTIONS = routes.options;
 *
 * CORS: when Studio (`localhost:3003`) previews against a consumer at
 * a different origin (`localhost:3456`), browsers preflight OPTIONS
 * and require explicit `Access-Control-Allow-Credentials` + matching
 * `Access-Control-Allow-Origin`. The factory accepts a list of
 * allowed origins and reflects them on response.
 */
import {
  epAddCartItem,
  epGetCart,
  epGetProduct,
  epGetProductList,
  epGetRelatedProducts,
  epRemoveCartItem,
  epUpdateCartItem,
} from "../../ep-server-functions";
import type {
  EpAddCartItemInput,
  EpRemoveCartItemInput,
  EpUpdateCartItemInput,
} from "../../ep-server-functions";
import { withEpSession } from "../../ep-server-functions/session-context";
import type { EpCtx } from "../../ep-server-functions/build-ep-ctx";
import type { EpAuth } from "./create-ep-auth-better";
import { persistCartId } from "./persist-cart-id";

const MUTATION_FNS = new Set(["addCartItem", "updateCartItem", "removeCartItem"]);

interface ProxyRouteContext {
  params: Promise<{ fn?: string }> | { fn?: string };
}

interface SessionShape {
  session: {
    accessToken: string;
    host: string;
    clientId: string;
    expires: number;
    locale?: string;
  } | null;
  cart: { id: string } | null;
  user?: { accountId?: string } | null;
}

function parseCookies(cookieHeader: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of cookieHeader.split(";")) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    const name = part.slice(0, eq).trim();
    if (!name) continue;
    out[name] = decodeURIComponent(part.slice(eq + 1).trim());
  }
  return out;
}

const FN_DISPATCH: Record<
  string,
  (args: Record<string, unknown>) => Promise<unknown>
> = {
  getProduct: (args) => epGetProduct(args as { id: string }),
  getCart: () => epGetCart(),
  getProductList: (args) => epGetProductList(args as never),
  getRelatedProducts: (args) =>
    epGetRelatedProducts(
      args as { productId: string; relationshipSlug: string; limit?: number }
    ),
  addCartItem: (args) => epAddCartItem(args as unknown as EpAddCartItemInput),
  updateCartItem: (args) =>
    epUpdateCartItem(args as unknown as EpUpdateCartItemInput),
  removeCartItem: (args) =>
    epRemoveCartItem(args as unknown as EpRemoveCartItemInput),
};

export interface CreateEpProxyRoutesOptions {
  /**
   * Origins permitted to call the proxy with credentials. Defaults to
   * common Studio dev origins (`http://localhost:3003`, `http://127.0.0.1:3003`).
   * In production, set this to whatever Studio host the team uses.
   */
  allowedOrigins?: string[];
}

export interface EpProxyRoutes {
  handle: (request: Request, context: ProxyRouteContext) => Promise<Response>;
  options: (request: Request) => Response;
}

const DEFAULT_ALLOWED_ORIGINS = [
  "http://localhost:3003",
  "http://127.0.0.1:3003",
];

export function createEpProxyRoutes(
  epAuth: EpAuth,
  opts?: CreateEpProxyRoutesOptions
): EpProxyRoutes {
  const allowed = new Set(opts?.allowedOrigins ?? DEFAULT_ALLOWED_ORIGINS);

  function corsHeaders(request: Request): Record<string, string> {
    const origin = request.headers.get("origin");
    if (origin && allowed.has(origin)) {
      return {
        "Access-Control-Allow-Origin": origin,
        "Access-Control-Allow-Credentials": "true",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
        Vary: "Origin",
      };
    }
    return {};
  }

  return {
    options(request) {
      return new Response(null, {
        status: 204,
        headers: corsHeaders(request),
      });
    },

    async handle(request, context) {
      const cors = corsHeaders(request);
      const params =
        context.params instanceof Promise
          ? await context.params
          : context.params;
      const fnName = params.fn ?? "";
      const dispatch = FN_DISPATCH[fnName];
      if (!dispatch) {
        return new Response(
          JSON.stringify({ error: "unknown_fn", fn: fnName }),
          {
            status: 404,
            headers: { "Content-Type": "application/json", ...cors },
          }
        );
      }

      const args = (await request.json().catch(() => ({}))) as Record<
        string,
        unknown
      >;

      const cookies = parseCookies(request.headers.get("cookie") ?? "");
      const sessionResult = (await epAuth.api.getSession({
        cookies,
        headers: Object.fromEntries(request.headers.entries()),
      })) as SessionShape;

      const session = sessionResult.session;
      if (!session?.accessToken) {
        // No session at all — the caller isn't a recognised shopper.
        // Return a soft 200 with the function's empty/null shape so the
        // browser-side caller's fallback chain treats it like SSR's
        // "no session" case.
        return new Response("null", {
          status: 200,
          headers: { "Content-Type": "application/json", ...cors },
        });
      }

      // Run the function inside `withEpSession` — same path SSR uses.
      // The function reads its auth via `getCurrentEpSession()` and
      // makes the EP REST call directly with the shopper's bearer.
      // The session itself already carries host/clientId/accessToken,
      // so we don't need to re-fetch the loader bundle to build ctx.
      const epCtx: EpCtx = {
        accessToken: session.accessToken,
        host: session.host,
        clientId: session.clientId,
        serverCartMode: false,
        cartId: sessionResult.cart?.id ?? undefined,
        accountId: sessionResult.user?.accountId ?? undefined,
        locale: session.locale,
      };

      let result: unknown;
      try {
        result = await withEpSession(epCtx, () => dispatch(args));
      } catch (err) {
        return new Response(
          JSON.stringify({
            error: "dispatch_failed",
            message: (err as Error)?.message,
          }),
          {
            status: 500,
            headers: { "Content-Type": "application/json", ...cors },
          }
        );
      }

      // For mutation dispatches, the function may have auto-created a
      // cart. Detect a cartId mismatch between the input session and the
      // returned cart, and forward the better-auth Set-Cookie headers
      // that /ep/cart emits so the browser session catches up.
      const setCookies: string[] = [];
      if (MUTATION_FNS.has(fnName)) {
        const resultCartId = (result as { id?: string } | null)?.id;
        if (resultCartId && resultCartId !== epCtx.cartId) {
          setCookies.push(
            ...(await persistCartId(epAuth, request, resultCartId))
          );
        }
      }

      const headers = new Headers({
        "Content-Type": "application/json",
        ...cors,
      });
      for (const c of setCookies) headers.append("Set-Cookie", c);
      return new Response(JSON.stringify(result ?? null), {
        status: 200,
        headers,
      });
    },
  };
}
