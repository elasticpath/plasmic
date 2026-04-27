/**
 * Cart server routes (PRD #273).
 *
 * Catch-all that dispatches:
 *   GET    /api/ep/cart                      → cart contents
 *   POST   /api/ep/cart/items                → add item (creates cart if needed)
 *   PUT    /api/ep/cart/items/:id            → update item quantity
 *   DELETE /api/ep/cart/items/:id            → remove item
 *
 * Each call reads the better-auth session, talks to EP's REST API
 * server-side using the session's accessToken. The cartId is sourced
 * from / persisted into the session's `epCartId` field — single source
 * of truth.
 *
 * Next routing prefers `/api/ep/cart/[[...path]]` over the catch-all
 * `/api/ep/[...path]` for any URL starting `/api/ep/cart/...`, so the
 * better-auth handler at the parent path keeps handling /ep/anonymous,
 * /ep/refresh, etc.
 */
import { createCartRoutes } from "@elasticpath/plasmic-ep-commerce-elastic-path/server";
import { epAuth } from "@/lib/ep-auth";

const routes = createCartRoutes(epAuth);

export const GET = routes.handle;
export const POST = routes.handle;
export const PUT = routes.handle;
export const DELETE = routes.handle;
