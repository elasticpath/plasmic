/**
 * Cart server routes (PRD #273) — server-side cart operations backed by
 * the better-auth session.
 *
 * Replaces the cart-handling logic from the deleted legacy auth/handler.ts.
 * The shopper-context client hooks (`shopper-context/use-cart.ts`,
 * `use-add-item.ts`, etc.) call:
 *
 *   GET    /api/ep/cart                      → returns full cart with items
 *   POST   /api/ep/cart/items                → add item (creates cart if needed)
 *   PUT    /api/ep/cart/items/:id            → update item quantity
 *   DELETE /api/ep/cart/items/:id            → remove item
 *
 * Consumer mounts this in a single catch-all route file:
 *
 *   // app/api/ep/cart/[[...path]]/route.ts
 *   import { createCartRoutes } from
 *     "@elasticpath/plasmic-ep-commerce-elastic-path/server";
 *   import { epAuth } from "@/lib/ep-auth";
 *
 *   const routes = createCartRoutes(epAuth);
 *   export const GET = routes.handle;
 *   export const POST = routes.handle;
 *   export const PUT = routes.handle;
 *   export const DELETE = routes.handle;
 *
 * Each request reads the session via `epAuth.api.getSession({cookies, headers})`,
 * pulls accessToken/host/clientId/cartId out of the session_data cookie, and
 * calls EP's REST API directly. When a new cart is created (first POST
 * without an existing cart), the handler updates `session.epCartId` by
 * invoking the plugin's /ep/cart endpoint and forwarding the Set-Cookie
 * headers that better-auth's nextCookies() plugin emits.
 */
import type { EpAuth } from "../auth/ep-plugin/create-ep-auth-better";
import { enforceOriginGate } from "../auth/ep-plugin/origin-gate";
import { persistCartId } from "../auth/ep-plugin/persist-cart-id";
import { parseCookieHeader } from "../utils/cookie-header";

/**
 * Next 15 always hands route handlers a promised `params`, and its build-time
 * route validator structurally diffs this type against
 * `{ params: Promise<SegmentParams> }` — a `Promise<T> | T` union fails that
 * check and breaks `next build` for every TypeScript consumer. `await`
 * still accepts a plain object at runtime, so callers that pass one
 * directly keep working.
 */
interface CartRouteContext {
  params: Promise<{ path?: string[] }>;
}

interface SessionShape {
  session: {
    accessToken: string;
    host: string;
    clientId: string;
    expires: number;
  } | null;
  cart: { id: string } | null;
}

async function callEp(
  session: NonNullable<SessionShape["session"]>,
  path: string,
  init?: RequestInit
): Promise<Response> {
  return fetch(`${session.host}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      "EP-Inventories-Multi-Location": "true",
      Authorization: `Bearer ${session.accessToken}`,
      ...((init?.headers as Record<string, string>) ?? {}),
    },
  });
}

function jsonResponse(
  body: unknown,
  init?: ResponseInit & { extraSetCookies?: string[] }
): Response {
  const headers = new Headers({ "Content-Type": "application/json" });
  if (init?.headers) {
    new Headers(init.headers).forEach((v: string, k: string) =>
      headers.append(k, v)
    );
  }
  for (const c of init?.extraSetCookies ?? []) {
    headers.append("Set-Cookie", c);
  }
  return new Response(JSON.stringify(body), {
    status: init?.status ?? 200,
    headers,
  });
}

export interface CartRoutes {
  handle: (request: Request, context: CartRouteContext) => Promise<Response>;
}

export function createCartRoutes(epAuth: EpAuth): CartRoutes {
  return {
    async handle(request, context) {
      const gate = enforceOriginGate(request, epAuth.config.trustedOrigins);
      if (gate) return gate;

      const cookies = parseCookieHeader(request.headers.get("cookie") ?? "");
      const sessionResult = (await epAuth.api.getSession({
        cookies,
        headers: Object.fromEntries(request.headers.entries()),
      })) as SessionShape;

      const session = sessionResult.session;
      if (!session?.accessToken) {
        return jsonResponse(
          { error: "no_session", message: "No EP session — visit a page first to bootstrap." },
          { status: 401 }
        );
      }

      const params = await context.params;
      const path = params.path ?? [];
      const method = request.method;

      // ─── GET /cart ─── return full cart with items ─────────────────────
      if (path.length === 0 && method === "GET") {
        const cartId = sessionResult.cart?.id;
        if (!cartId) {
          return jsonResponse({ items: [], meta: null });
        }
        const epRes = await callEp(
          session,
          `/v2/carts/${cartId}?include=items`
        );
        if (!epRes.ok) {
          return jsonResponse({ items: [], meta: null });
        }
        const data = (await epRes.json()) as any;
        return jsonResponse({
          items: data.included?.items ?? [],
          meta: data.data?.meta ?? null,
        });
      }

      // ─── POST /cart/items ─── add an item (creates cart on first add) ──
      if (path.length === 1 && path[0] === "items" && method === "POST") {
        const body = await request.json().catch(() => ({}));
        let cartId = sessionResult.cart?.id;

        if (!cartId) {
          // Create a new cart in EP.
          const createRes = await callEp(session, "/v2/carts", {
            method: "POST",
            body: JSON.stringify({
              data: { name: "Cart", description: "Shopping cart" },
            }),
          });
          if (!createRes.ok) {
            return jsonResponse(
              { error: "cart_create_failed" },
              { status: 502 }
            );
          }
          const created = (await createRes.json()) as any;
          cartId = created.data?.id;
          if (!cartId) {
            return jsonResponse({ error: "cart_create_failed" }, { status: 502 });
          }
        }

        const epRes = await callEp(session, `/v2/carts/${cartId}/items`, {
          method: "POST",
          body: JSON.stringify(body),
        });
        const epData = await epRes.json().catch(() => ({}));

        // Persist the cartId onto the session if this was a fresh cart.
        const extraSetCookies = !sessionResult.cart?.id
          ? await persistCartId(epAuth, request, cartId)
          : [];

        return jsonResponse(epData, {
          status: epRes.ok ? 200 : epRes.status,
          extraSetCookies,
        });
      }

      // ─── PUT /cart/items/:id ─── update item quantity ─────────────────
      if (path.length === 2 && path[0] === "items" && method === "PUT") {
        const itemId = path[1];
        const cartId = sessionResult.cart?.id;
        if (!cartId) {
          return jsonResponse({ error: "no_cart" }, { status: 404 });
        }
        const body = await request.json().catch(() => ({}));
        const epRes = await callEp(
          session,
          `/v2/carts/${cartId}/items/${encodeURIComponent(itemId)}`,
          {
            method: "PUT",
            body: JSON.stringify(body),
          }
        );
        const epData = await epRes.json().catch(() => ({}));
        return jsonResponse(epData, {
          status: epRes.ok ? 200 : epRes.status,
        });
      }

      // ─── DELETE /cart/items/:id ─── remove an item ─────────────────────
      if (path.length === 2 && path[0] === "items" && method === "DELETE") {
        const itemId = path[1];
        const cartId = sessionResult.cart?.id;
        if (!cartId) {
          return jsonResponse({ error: "no_cart" }, { status: 404 });
        }
        const epRes = await callEp(
          session,
          `/v2/carts/${cartId}/items/${encodeURIComponent(itemId)}`,
          { method: "DELETE" }
        );
        if (!epRes.ok) {
          return jsonResponse(
            { error: "delete_failed" },
            { status: epRes.status }
          );
        }
        return jsonResponse({ success: true });
      }

      return jsonResponse(
        { error: "not_found", method, path },
        { status: 404 }
      );
    },
  };
}
