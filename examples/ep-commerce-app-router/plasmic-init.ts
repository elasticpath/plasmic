import { initPlasmicLoader } from "@plasmicapp/loader-nextjs/react-server-conditional";
import { registerEpCustomFunctions } from "@elasticpath/plasmic-ep-commerce-elastic-path/server";

export const PLASMIC = initPlasmicLoader({
  projects: [
    {
      // "Elastic Path Storefront Starter" — installs the
      // `commerce-elastic-path` hostless package, so the EP components arrive
      // in the loader bundle and this app registers none of them.
      id: process.env.PLASMIC_PROJECT_ID ?? "65UjdrFuQCqxjbr7466uEz",
      token: process.env.PLASMIC_PROJECT_TOKEN!,
    },
  ],
  // Codegen origin, not the Studio origin. The Studio origin serves the SPA
  // shell, so the loader fails on it with "Error parsing JSON response:
  // Unexpected token '<'".
  host:
    process.env.PLASMIC_HOST ??
    "https://codegen.integration.storefront.elasticpath.com",
  // Dev reads the project's latest unpublished state so Studio edits show up on
  // reload — without this, a server query added in Studio is absent from the
  // bundle and components fall back to their own client-side fetch. Production
  // builds pin to the last published version.
  preview: process.env.NODE_ENV !== "production",
  // Required to receive server-queries exec modules
  // (serverQueriesExecFuncFileName per page) in the bundle.
  platformOptions: { nextjs: { appDir: true } },
});

// Register the Elastic Path server functions here (not in
// plasmic-init-client.tsx) so they're available on the server to prefetch
// Studio Server Queries, as well as on the client, where Studio reads the
// registry to populate its Server Query dropdown.
registerEpCustomFunctions(PLASMIC);
