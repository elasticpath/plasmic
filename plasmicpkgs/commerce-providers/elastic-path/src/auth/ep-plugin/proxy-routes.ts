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
 * CORS reflects the auth instance's resolved `trustedOrigins` (ADR-0001).
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
import { parseCookieHeader } from "../../utils/cookie-header";
import type { EpAuth } from "./create-ep-auth-better";
import { enforceOriginGate, isTrustedOrigin } from "./origin-gate";
import { persistCartId } from "./persist-cart-id";
import { isTrustedDevEnvironment } from "./production-guard";

const MUTATION_FNS = new Set(["addCartItem", "updateCartItem", "removeCartItem"]);

/**
 * Maps a dispatch failure to a stable code. `message` is withheld in
 * production, so the code is the only failure detail a browser caller can
 * branch on there.
 */
function classifyDispatchError(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err ?? "");
  if (/not enough stock|insufficient stock/i.test(message)) {
    return "insufficient_stock";
  }
  if (/no cart on session|no EP session/i.test(message)) {
    return "no_session";
  }
  return "dispatch_failed";
}

/** Promised `params` only — see the note on `CartRouteContext`. */
interface ProxyRouteContext {
  params: Promise<{ fn?: string }>;
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

export interface EpProxyRoutes {
  handle: (request: Request, context: ProxyRouteContext) => Promise<Response>;
  options: (request: Request) => Response;
}

export function createEpProxyRoutes(epAuth: EpAuth): EpProxyRoutes {
  const trustedOrigins = epAuth.config.trustedOrigins;

  function corsHeaders(request: Request): Record<string, string> {
    const origin = request.headers.get("origin");
    if (origin && isTrustedOrigin(origin, trustedOrigins)) {
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
      const gate = enforceOriginGate(request, trustedOrigins);
      if (gate) return gate;

      const cors = corsHeaders(request);
      const params = await context.params;
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

      const cookies = parseCookieHeader(request.headers.get("cookie") ?? "");
      const sessionResult = (await epAuth.api.getSession({
        cookies,
        headers: Object.fromEntries(request.headers.entries()),
      })) as SessionShape;

      const session = sessionResult.session;
      if (!session?.accessToken) {
        // Reads soft-fail to the function's empty shape, matching SSR's
        // "no session" case. Mutations must not: a 200 body is
        // indistinguishable from a successful write.
        if (MUTATION_FNS.has(fnName)) {
          return new Response(
            JSON.stringify({ error: "no_session", code: "no_session" }),
            {
              status: 401,
              headers: { "Content-Type": "application/json", ...cors },
            }
          );
        }
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
        const correlationId = crypto.randomUUID();
        console.error(
          `[ep-commerce] proxy dispatch_failed fn=${fnName} correlationId=${correlationId}`,
          err
        );
        const code = classifyDispatchError(err);
        return new Response(
          JSON.stringify(
            isTrustedDevEnvironment()
              ? {
                  error: "dispatch_failed",
                  code,
                  correlationId,
                  message: (err as Error)?.message,
                }
              : { error: "dispatch_failed", code, correlationId }
          ),
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
