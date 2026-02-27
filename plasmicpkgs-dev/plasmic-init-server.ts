/**
 * Server-compatible component registration — no "use client" directive.
 *
 * This file mirrors plasmic-init-client.tsx but can be imported from
 * server-side API routes (which cannot import "use client" modules).
 * It populates globalThis.__PlasmicComponentRegistry so that
 * @elasticpath/plasmic-registry can read the registered component metadata.
 */
import { PLASMIC } from "@/plasmic-init";
import { registerWithDevMeta } from "@/plasmic-register-dev-meta";
import { registerAllCmsFunctions as registerPlasmicCms } from "@plasmicpkgs/cms";
import { registerAll as registerCommerce } from "@plasmicpkgs/commerce";
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
  registerVideo(PLASMIC);
}

const useDevNames = true;
if (useDevNames) {
  registerWithDevMeta(PLASMIC, register);
} else {
  register();
}
