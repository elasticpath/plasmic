/**
 * Session-free catalog route for Studio design time (ADR-0003).
 *
 * A designer editing in Studio has to see their own store's catalog — real
 * names, real images, the store's own extension slugs and hierarchy node ids,
 * none of which a fixture can supply. The shopper session cannot serve that:
 * better-auth's `SameSite=Lax` cookie never reaches Studio's editing frame
 * once a customer hosts their app host on their own registrable domain.
 *
 * So this is a separate file, not a branch in `proxy-routes.ts`. "Never reads
 * the session" is a property of what this file imports. It has no cookie
 * parser, no `getSession` call and no cart writer, and nothing here may grow
 * one: the route runs under a bare implicit token that belongs to no shopper.
 *
 * It is a **closed list of declared names, not a forwarder**, which is the
 * opposite of the rule the session proxy follows. The proxy can forward
 * because the shopper's credential is the boundary; this route cannot,
 * because its implicit token is public *and* can write to `/carts` and
 * `/checkout` — an open forwarder here is an open proxy with a write surface
 * on the customer's own origin.
 *
 * Consumer mounts at `app/api/ep/design/[fn]/route.ts`:
 *
 *   import { createEpDesignRoutes } from
 *     "@elasticpath/plasmic-ep-commerce-elastic-path/server";
 *   import { epAuth } from "@/lib/ep-auth";
 *
 *   const routes = createEpDesignRoutes(epAuth);
 *   export const POST = routes.handle;
 *   export const OPTIONS = routes.options;
 *
 * CORS is `*` with no credentials and no origin gate: it serves what the
 * store's public client id already unlocks, and a gate on a credential-free
 * public-data route buys nothing. `trustedOrigins` stays shopper-only
 * (ADR-0001) and must never gain an entry for this route.
 */
// Imported per module rather than through the package's server-function
// barrel, so the closed list below is structural: a name this file does not
// import is a name it cannot dispatch.
import { epGetProduct } from "../../ep-server-functions/getProduct";
import { epGetProductList } from "../../ep-server-functions/getProductList";
import { epGetProductPage } from "../../ep-server-functions/getProductPage";
import { epGetRelatedProducts } from "../../ep-server-functions/getRelatedProducts";
import {
  epDesignFnNotServedMessage,
  isEpDesignFnName,
} from "../../ep-server-functions/design-fn-names";
import type { EpDesignFnName } from "../../ep-server-functions/design-fn-names";
import { withEpSession } from "../../ep-server-functions/session-context";
import type { EpAuth } from "./create-ep-auth-better";
import { mintImplicitEpToken, resolveEpStore } from "./implicit-token";
import { isTrustedDevEnvironment } from "./production-guard";

/**
 * Declared, not subtracted. Every name here is readable by anyone who can
 * reach the consumer's origin, so the list is written out rather than derived
 * from the proxy's dispatch table — otherwise the next session-scoped
 * operation added there becomes anonymously readable by omission.
 */
const DESIGN_FN_DISPATCH: Record<
  EpDesignFnName,
  (args: Record<string, unknown>) => Promise<unknown>
> = {
  getProduct: (args) => epGetProduct(args as { id: string }),
  getProductList: (args) => epGetProductList(args as never),
  getProductPage: (args) => epGetProductPage(args as never),
  getRelatedProducts: (args) =>
    epGetRelatedProducts(
      args as { productId: string; relationshipSlug: string; limit?: number }
    ),
};

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

interface DesignRouteContext {
  params: Promise<{ fn?: string }>;
}

export interface EpDesignRoutes {
  handle: (request: Request, context: DesignRouteContext) => Promise<Response>;
  options: () => Response;
}

interface CachedToken {
  token: string;
  expiresAtMs: number;
}

/**
 * Implicit tokens live an hour, and minting one per request doubles every
 * design-time read's latency. Keyed by host and client id so a consumer whose
 * `resolveConfig` moves stores does not serve the old store's token.
 */
const tokenCache = new Map<string, CachedToken>();
const pendingMints = new Map<string, Promise<string>>();

/** Re-mint this long before expiry, so a token never expires mid-request. */
const TOKEN_REFRESH_SKEW_SECONDS = 60;

/** Test seam. */
export function resetEpDesignTokenCache(): void {
  tokenCache.clear();
  pendingMints.clear();
}

async function implicitTokenFor(
  host: string,
  clientId: string
): Promise<string> {
  const key = `${host}|${clientId}`;
  const cached = tokenCache.get(key);
  if (cached && cached.expiresAtMs > Date.now()) return cached.token;

  const inFlight = pendingMints.get(key);
  if (inFlight) return inFlight;

  const mint = mintImplicitEpToken(clientId, host)
    .then((data) => {
      if (!data.access_token) {
        throw new Error("EP OAuth returned no access_token");
      }
      const lifetime = data.expires_in > 0 ? data.expires_in : 3600;
      tokenCache.set(key, {
        token: data.access_token,
        expiresAtMs:
          Date.now() +
          Math.max(lifetime - TOKEN_REFRESH_SKEW_SECONDS, 0) * 1000,
      });
      return data.access_token;
    })
    .finally(() => {
      pendingMints.delete(key);
    });

  pendingMints.set(key, mint);
  return mint;
}

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });
}

export function createEpDesignRoutes(epAuth: EpAuth): EpDesignRoutes {
  /**
   * `epAuth.config` rather than a new option, and the resolver as well as the
   * static pair: a consumer reading its store from the Plasmic bundle
   * bootstraps the factory with placeholders, so the static pair alone names a
   * store that does not exist.
   */
  const store = epAuth.config;

  return {
    options() {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    },

    async handle(request, context) {
      const params = await context.params;
      const fnName = params.fn ?? "";
      if (!isEpDesignFnName(fnName)) {
        return jsonResponse(
          {
            error: "not_served",
            code: "design_fn_not_served",
            fn: fnName,
            message: epDesignFnNotServedMessage(fnName),
          },
          404
        );
      }

      const args = (await request.json().catch(() => ({}))) as Record<
        string,
        unknown
      >;

      try {
        const { clientId, host } = await resolveEpStore(
          store,
          "createEpDesignRoutes.resolveConfig"
        );
        if (!clientId || !host) {
          throw new Error(
            "createEpDesignRoutes: no clientId/host to mint an implicit token with"
          );
        }
        const accessToken = await implicitTokenFor(host, clientId);
        const result = await withEpSession(
          {
            accessToken,
            host,
            clientId,
          },
          () => DESIGN_FN_DISPATCH[fnName](args)
        );
        return jsonResponse(result ?? null, 200);
      } catch (err) {
        const correlationId = crypto.randomUUID();
        console.error(
          `[ep-commerce] design dispatch_failed fn=${fnName} correlationId=${correlationId}`,
          err
        );
        return jsonResponse(
          isTrustedDevEnvironment()
            ? {
                error: "dispatch_failed",
                code: "dispatch_failed",
                correlationId,
                message: (err as Error)?.message,
              }
            : {
                error: "dispatch_failed",
                code: "dispatch_failed",
                correlationId,
              },
          500
        );
      }
    },
  };
}
