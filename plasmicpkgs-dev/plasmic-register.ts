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

function register() {
  registerFetch(PLASMIC);
  registerGraphQL(PLASMIC);
  registerPlasmicCms(PLASMIC);
  registerPlasmicCmsComponents(PLASMIC);
  registerStrapi(PLASMIC);
  registerStrapiComponents(PLASMIC);
  registerCommerce(PLASMIC);
  registerShopify(PLASMIC);
  registerElasticPath(PLASMIC);
  registerVideo(PLASMIC);
}

const useDevNames = true; // set true to avoid conflicting with production hostless names
if (useDevNames) {
  registerWithDevMeta(PLASMIC, register);
} else {
  register();
}
