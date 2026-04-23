/**
 * Server-safe registration orchestration — no "use client" directive.
 *
 * Registers only the pieces that are SAFE to touch from a server route:
 *   - Custom functions (from the `/server` subpath — plain Node code,
 *     no React, no "use client" directive).
 *
 * Component registration is deliberately NOT done here — the EP main
 * entry carries `"use client"` (prepended at build time by
 * build-server.mjs) which makes `registerAll` uncallable from server
 * context. Components get registered via plasmic-register-components.ts
 * (itself `"use client"`), which runs during SSR of the client-component
 * tree in the catchall page — at that point the React dispatcher is set
 * correctly and component refs are webpack-bundled alongside Next's
 * React, so hooks work end-to-end.
 *
 * Imported by:
 * - `plasmic-init-client.tsx` (runs in the "use client" graph; components
 *   register via plasmic-register-components that's imported alongside)
 * - `app/api/plasmic-registry/route.ts` (for MCP dev-host sync — this
 *   route captures functions only; MCP reads components via the iframe
 *   registry)
 * - `app/[[...catchall]]/page.tsx` (side-effect import so server queries
 *   find their registered functions before `unstable__getServerQueriesData`)
 */
import { PLASMIC } from "@/plasmic-init";
import { registerWithDevMeta } from "@/plasmic-register-dev-meta";
import { registerEpCustomFunctions } from "@elasticpath/plasmic-ep-commerce-elastic-path/server";

export function registerAllPackages(plasmic: typeof PLASMIC) {
  // devMeta wrapping applies the `$dev` suffix so function names match
  // what Studio saved into the project's server-query ops. Without
  // this the map has `getProduct` but generated query code calls
  // `__fn_ep__getProduct$dev` → "fetcher is not a function" at SSR.
  registerWithDevMeta(plasmic, () => {
    registerEpCustomFunctions(plasmic);
  });
}

registerAllPackages(PLASMIC);
