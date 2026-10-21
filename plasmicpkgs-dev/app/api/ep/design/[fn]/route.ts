import { PLASMIC } from "@/plasmic-init";
import {
  createEpDesignRoutes,
  extractEpProviderConfig,
  type EpProviderBundleConfig,
} from "@elasticpath/plasmic-ep-commerce-elastic-path/server";

let resolved: Promise<EpProviderBundleConfig | null> | null = null;

async function readBundleStore(
  hostAllowlist: readonly string[]
): Promise<EpProviderBundleConfig | null> {
  const pages = await PLASMIC.fetchPages();
  if (pages.length === 0) return null;
  const data = await PLASMIC.maybeFetchComponentData(pages[0].path);
  return extractEpProviderConfig(data, { hostAllowlist });
}

const routes = createEpDesignRoutes({
  resolveConfig: async ({ hostAllowlist }) => {
    resolved ??= readBundleStore(hostAllowlist);
    const config = await resolved.catch(() => null);
    if (!config) resolved = null;
    return config;
  },
});

export const POST = routes.handle;
export const OPTIONS = routes.options;
