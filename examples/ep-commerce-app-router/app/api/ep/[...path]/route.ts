import { toNextJsHandler } from "@elasticpath/plasmic-ep-commerce-elastic-path/server";
import { epAuth, epProviderHeaders } from "@/lib/ep-auth";

const handlers = toNextJsHandler(epAuth);

/**
 * Wraps a Next app-router handler so every request carries the EP Provider
 * config from the Studio global context (clientId, host) as
 * `x-ep-client-id` / `x-ep-host` headers — the override path already wired
 * into `createEpSession`. This avoids requiring clientId/host in
 * `.env.local`; `epAuth` itself is constructed with placeholders that are
 * never actually used because the middleware-header path always wins.
 */
function withEpProviderHeaders(
  handler: (req: Request, ctx?: any) => Promise<Response>
) {
  return async function (req: Request, ctx?: any): Promise<Response> {
    const extra = await epProviderHeaders();
    if (Object.keys(extra).length === 0) {
      return handler(req, ctx);
    }
    const headers = new Headers(req.headers);
    for (const [k, v] of Object.entries(extra)) headers.set(k, v);
    const forwarded = new Request(req.url, {
      method: req.method,
      headers,
      body:
        req.method === "GET" || req.method === "HEAD"
          ? undefined
          : await req.clone().arrayBuffer(),
    });
    return handler(forwarded, ctx);
  };
}

export const GET = withEpProviderHeaders(handlers.GET);
export const POST = withEpProviderHeaders(handlers.POST);
export const PATCH = withEpProviderHeaders(handlers.PATCH);
export const DELETE = withEpProviderHeaders(handlers.DELETE);
