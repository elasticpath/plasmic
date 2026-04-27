/**
 * Demo wiring for PRD #273 — better-auth-backed EP session.
 *
 * Parallel to lib/ep-auth.ts (the legacy hand-rolled auth). When this
 * file is mounted via the new /api/ep-better/[[...all]] route, designers
 * and integrators can curl through the better-auth flow end-to-end:
 *
 *   POST /api/ep-better/ep/anonymous → mints + cookies
 *   GET  /api/ep-better/get-session  → reads cookies, returns session+EP fields
 *
 * The legacy /api/ep/* path is unaffected — both run side by side until
 * better-auth reaches feature parity, then we swap.
 */
import { betterAuth } from "better-auth";
import { epPlugin } from "@elasticpath/plasmic-ep-commerce-elastic-path/server";
import { getEpProviderConfig } from "@/lib/ep-auth";

const SECRET =
  process.env.CHECKOUT_SESSION_SECRET ??
  "dev-secret-min-48-chars-long-enough-for-better-auth-jwe-cache";

const EP_HOST =
  process.env.EP_HOST ?? "https://useast.api.elasticpath.com";
const EP_CLIENT_ID =
  process.env.EP_CLIENT_ID ?? "bootstrap-placeholder";

export const epBetterAuth = betterAuth({
  secret: SECRET,
  baseURL: process.env.NEXT_PUBLIC_BASE_URL ?? "http://localhost:3456",
  // Mount under /api/ep-better/ so the demo route file at
  // app/api/ep-better/[[...all]]/route.ts can dispatch correctly.
  basePath: "/api/ep-better",
  plugins: [
    epPlugin({
      // Static fallback only — bootstrap-placeholder cannot mint EP tokens.
      // resolveConfig() pulls real clientId/host from the Plasmic loader
      // bundle on each request, matching the legacy auth's
      // `epProviderHeaders()` middleware-header pattern.
      clientId: EP_CLIENT_ID,
      host: EP_HOST,
      resolveConfig: async () => {
        const config = await getEpProviderConfig();
        if (!config) return null;
        return { clientId: config.clientId, host: config.host };
      },
    }),
  ],
  // Stateless: no `database` option. Sessions live in the JWE
  // session_data cookie (spike-verified pattern, see PRD #273).
  session: {
    cookieCache: {
      enabled: true,
      strategy: "jwe" as any,
      refreshCache: true,
    },
  } as any,
});
