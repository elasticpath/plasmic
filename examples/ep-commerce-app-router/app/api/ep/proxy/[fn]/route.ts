/**
 * Browser-side proxy route for EP server functions (PRD #273 follow-up).
 *
 * Backs the canvas / data-query-preview path that the registered `ep*`
 * functions fall through to when running in a browser context with no
 * AsyncLocalStorage session. Each call:
 *   1. reads the better-auth session cookie that SSR also reads,
 *   2. dispatches to the matching `ep*` server function under
 *      `withEpSession`, and
 *   3. returns its JSON result.
 *
 * Has zero impact on the shopper-facing first render — that path runs
 * `ep*` functions in-process via `withEpSession` in the catchall page.
 */
import { createEpProxyRoutes } from "@elasticpath/plasmic-ep-commerce-elastic-path/server";
import { epAuth } from "@/lib/ep-auth";

const routes = createEpProxyRoutes(epAuth);

export const POST = routes.handle;
export const OPTIONS = routes.options;
