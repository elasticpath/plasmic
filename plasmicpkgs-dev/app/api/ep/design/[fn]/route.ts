import { PLASMIC } from "@/plasmic-init";
import {
  createEpDesignRoutes,
  extractEpProviderConfig,
  type EpProviderBundleConfig,
} from "@elasticpath/plasmic-ep-commerce-elastic-path/server";

const STORE_TTL_MS = 5_000;

let memo: {
  config: Promise<EpProviderBundleConfig | null>;
  expiresAtMs: number;
} | null = null;

async function readBundleStore(
  hostAllowlist: readonly string[]
): Promise<EpProviderBundleConfig | null> {
  const data = await PLASMIC.maybeFetchComponentData();
  return extractEpProviderConfig(data, { hostAllowlist });
}

const routes = createEpDesignRoutes({
  resolveConfig: async ({ hostAllowlist }) => {
    if (!memo || memo.expiresAtMs <= Date.now()) {
      memo = {
        config: readBundleStore(hostAllowlist),
        expiresAtMs: Date.now() + STORE_TTL_MS,
      };
    }
    const current = memo;
    const config = await current.config.catch(() => null);
    if (!config && memo === current) memo = null;
    return config;
  },
});

export const POST = routes.handle;
export const OPTIONS = routes.options;
