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

const tokenCache = new Map<string, CachedToken>();
const pendingMints = new Map<string, Promise<string>>();

const TOKEN_REFRESH_SKEW_SECONDS = 60;

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
