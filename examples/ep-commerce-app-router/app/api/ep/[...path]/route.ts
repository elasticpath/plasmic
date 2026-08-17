/**
 * Mounts the EP auth handler at /api/ep/* (PRD #273).
 *
 * Powered by better-auth via `epAuth.handler` (the underlying betterAuth
 * instance from `createBetterEpAuth`). Exposes:
 *
 *   POST /api/ep/ep/anonymous       → mint anonymous session
 *   POST /api/ep/ep/refresh         → rotate EP token
 *   POST /api/ep/ep/cart            → set epCartId on session
 *   POST /api/ep/ep/account/login   → persist account fields
 *   POST /api/ep/ep/account/logout  → strip account fields
 *   GET  /api/ep/get-session        → read current session, minus the
 *                                     shopper's EP credentials
 *
 * The legacy `withEpProviderHeaders` wrapper is no longer needed — the
 * `resolveConfig` callback inside `lib/ep-auth.ts` pulls clientId/host
 * from the Plasmic loader bundle on every request.
 */
import { createEpAuthRoutes } from "@elasticpath/plasmic-ep-commerce-elastic-path/server";
import { epAuth } from "@/lib/ep-auth";

export const { GET, POST } = createEpAuthRoutes(epAuth);
