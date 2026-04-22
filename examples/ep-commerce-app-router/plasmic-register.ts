/**
 * Shared component registration — no "use client" directive.
 *
 * Registers all code component packages with the Plasmic loader so globalThis
 * registries are populated. Imported by:
 * - plasmic-init-client.tsx (client-side, for PlasmicCanvasHost / RootProvider)
 * - app/api/plasmic-registry/route.ts (server-side, for MCP dev host sync)
 */
import { PLASMIC } from "@/plasmic-init";
import { registerWithDevMeta } from "@/plasmic-register-dev-meta";
import { registerAll as registerElasticPath } from "@elasticpath/plasmic-ep-commerce-elastic-path";
import { registerEpCustomFunctions } from "@elasticpath/plasmic-ep-commerce-elastic-path/server";

export function registerAllPackages(plasmic: typeof PLASMIC) {
  function register() {
    registerElasticPath(plasmic);
    // Server-side custom functions exposed as $$.ep.getProduct / getCart /
    // getProductList / getRelatedProducts for Studio Server Queries (PRD #262).
    // The metadata lets Studio's query builder surface them; Next's RSC
    // runtime invokes the actual function bodies during
    // PLASMIC.unstable__getServerQueriesData() at SSR time.
    registerEpCustomFunctions(plasmic);
  }

  const useDevNames = true;
  if (useDevNames) {
    registerWithDevMeta(plasmic, register);
  } else {
    register();
  }
}

registerAllPackages(PLASMIC);
