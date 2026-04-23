import {
  createEpAuth,
  extractEpProviderConfig,
  type EpProviderBundleConfig,
} from "@elasticpath/plasmic-ep-commerce-elastic-path/server";
import { PLASMIC } from "@/plasmic-init";

/**
 * EP Auth singleton.
 *
 * clientId + host come from the EP Provider global-context configured in
 * Studio — not from `.env.local`. We bootstrap with dummy values so the
 * factory validates, and then every server-side call path overrides via the
 * middleware-header escape hatch in `createEpSession`:
 *
 *     headers["x-ep-client-id"] ?? config.clientId
 *     headers["x-ep-host"]      ?? config.host
 *
 * The only env var still consulted is `CHECKOUT_SESSION_SECRET`, which is a
 * real secret and belongs in env.
 */
export const epAuth = createEpAuth({
  clientId: "bootstrap-placeholder",
  host: "https://useast.api.elasticpath.com",
  checkout: {
    sessionSecret:
      process.env.CHECKOUT_SESSION_SECRET ?? "dev-secret-min-16-chars",
  },
});

/**
 * Lazily resolve (and cache) the EP Provider config from the Plasmic loader
 * bundle. The config is static per Plasmic project version, so caching for
 * the lifetime of the Node process is fine — in dev, Next restarts on
 * `plasmic-init.ts` changes, and the project-level config is part of the
 * bundle which gets refetched when the project version bumps.
 */
let _configPromise: Promise<EpProviderBundleConfig | null> | null = null;
export function getEpProviderConfig(): Promise<EpProviderBundleConfig | null> {
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
      return extractEpProviderConfig(data);
    })();
  }
  return _configPromise;
}

/**
 * Headers to forward to `epAuth.api.getSession` so the session picks up the
 * Studio-configured clientId/host instead of the bootstrap placeholder.
 */
export async function epProviderHeaders(
  prefetchedData?: unknown
): Promise<Record<string, string>> {
  const fromData = prefetchedData
    ? extractEpProviderConfig(prefetchedData as any)
    : null;
  const config = fromData ?? (await getEpProviderConfig());
  if (!config) return {};
  return {
    "x-ep-client-id": config.clientId,
    "x-ep-host": config.host,
  };
}
