/**
 * Shared component registration — no "use client" directive.
 *
 * Registers all code component packages with the Plasmic loader,
 * populating globalThis.__PlasmicComponentRegistry. Imported by both:
 * - plasmic-init-client.tsx (client-side, for PlasmicCanvasHost / PlasmicRootProvider)
 * - app/api/plasmic-registry/route.ts (server-side, for MCP dev host sync)
 */
import { PLASMIC } from "@/plasmic-init";
import { registerWithDevMeta } from "@/plasmic-register-dev-meta";
import { registerAll as registerElasticPath } from "@elasticpath/plasmic-ep-commerce-elastic-path";
import { registerAllCmsFunctions as registerPlasmicCms } from "@plasmicpkgs/cms";
import { registerAll as registerCommerce } from "@plasmicpkgs/commerce";
import { registerAll as registerShopify } from "@plasmicpkgs/commerce-shopify";
import { registerFetch } from "@plasmicpkgs/fetch";
import { registerGraphQL } from "@plasmicpkgs/graphql";
import { registerVideo } from "@plasmicpkgs/plasmic-basic-components";
import { registerAll as registerPlasmicCmsComponents } from "@plasmicpkgs/plasmic-cms";
import { registerAll as registerStrapiComponents } from "@plasmicpkgs/plasmic-strapi";
import { registerStrapi } from "@plasmicpkgs/strapi";

export function registerAllPackages(plasmic: typeof PLASMIC) {
  function register() {
    registerFetch(plasmic);
    registerGraphQL(plasmic);
    registerPlasmicCms(plasmic);
    registerPlasmicCmsComponents(plasmic);
    registerStrapi(plasmic);
    registerStrapiComponents(plasmic);
    registerCommerce(plasmic);
    registerShopify(plasmic);
    registerElasticPath(plasmic);
    registerVideo(plasmic);
  }

  const useDevNames = true; // set true to avoid conflicting with production hostless names
  if (useDevNames) {
    registerWithDevMeta(plasmic, register);
  } else {
    register();
  }
}

// Auto-register on import (for client-side usage)
registerAllPackages(PLASMIC);
