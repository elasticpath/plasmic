import {
  createBetterEpAuth,
  extractEpProviderConfig,
  type EpProviderBundleConfig,
} from "@elasticpath/plasmic-ep-commerce-elastic-path/server";
import { PLASMIC } from "@/plasmic-init";

/**
 * EP Auth singleton (PRD #273).
 *
 * Backed by better-auth (`@elasticpath/plasmic-ep-commerce-elastic-path`'s
 * `createBetterEpAuth`). Stateless mode — no DB; sessions live entirely in
 * the JWE `session_data` cookie.
 *
 * `clientId` + `host` come from the EP Provider global-context configured
 * in Studio. We bootstrap with dummy values so the factory validates, then
 * the per-request `resolveConfig` callback pulls the real values from the
 * Plasmic loader bundle on every call. (Replaces the legacy
 * `x-ep-client-id` middleware-header hack from pre-#273.)
 *
 * Env vars consulted:
 *   - CHECKOUT_SESSION_SECRET — used as the better-auth JWE secret AND the
 *     checkout-session HMAC secret. Required in production.
 *   - EP_PASSWORD_PROFILE_ID — which password profile account members sign
 *     in against. Only needed when the store's authentication realm holds
 *     more than one; with a single profile the package finds it.
 */
const SECRET = process.env.CHECKOUT_SESSION_SECRET;

export const epAuth = createBetterEpAuth({
  clientId: "bootstrap-placeholder",
  host: "https://useast.api.elasticpath.com",
  secret: SECRET,
  baseURL: process.env.NEXT_PUBLIC_BASE_URL ?? "http://localhost:3456",
  basePath: "/api/ep",
  passwordProfileId: process.env.EP_PASSWORD_PROFILE_ID,
  resolveConfig: async ({ hostAllowlist }) => {
    const config = await getEpProviderConfig(hostAllowlist);
    if (!config) return null;
    return { clientId: config.clientId, host: config.host };
  },
  ...(SECRET ? { checkout: { sessionSecret: SECRET } } : {}),
});

/**
 * Lazily resolve (and cache) the EP Provider config from the Plasmic loader
 * bundle. The config is static per Plasmic project version, so caching for
 * the lifetime of the Node process is fine — in dev, Next restarts on
 * `plasmic-init.ts` changes, and the project-level config is part of the
 * bundle which gets refetched when the project version bumps.
 */
let _configPromise: Promise<EpProviderBundleConfig | null> | null = null;
export function getEpProviderConfig(
  hostAllowlist: readonly string[]
): Promise<EpProviderBundleConfig | null> {
  if (!_configPromise) {
    _configPromise = (async () => {
      // The EP Provider globalContext config is part of the project bundle —
      // present in the prefetchedData for ANY page in the project. We don't
      // know which pages the user's project has, so resolve one via
      // fetchPages and use its path. Avoids hardcoding "/" which returns
      // null on projects without a homepage route.
      const pages = await PLASMIC.fetchPages();
      if (pages.length === 0) return null;
      const data = await PLASMIC.maybeFetchComponentData(pages[0].path);
      return extractEpProviderConfig(data, { hostAllowlist });
    })();
  }
  return _configPromise;
}
