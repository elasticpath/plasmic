/**
 * Shared registration orchestration — no "use client" directive so server
 * routes (e.g. `/api/plasmic-registry` for MCP dev-host sync) can call it.
 *
 * Conditional split:
 *   - `plasmic-register-components.ts` carries the full component surface
 *     (EP main entry, which is `"use client"` in its dist). Dynamically
 *     imported only when we're in a browser context — calling it server-side
 *     would fail with "Attempted to call registerAll from the server but it's
 *     on the client".
 *   - `registerEpCustomFunctions` comes from the `/server` subpath (not
 *     `"use client"`) so it can register server-queryable functions from
 *     both server and client contexts.
 *
 * Imported by:
 * - `plasmic-init-client.tsx` (client-side, for PlasmicCanvasHost / RootProvider)
 * - `app/api/plasmic-registry/route.ts` (server-side, for MCP dev host sync —
 *   server path registers functions only; components come from the iframe's
 *   window.__PlasmicComponentRegistry once the client loads).
 */
import { PLASMIC } from "@/plasmic-init";
import { registerWithDevMeta } from "@/plasmic-register-dev-meta";
import { registerEpCustomFunctions } from "@elasticpath/plasmic-ep-commerce-elastic-path/server";

export function registerAllPackages(plasmic: typeof PLASMIC) {
  // Apply devMeta wrapping to BOTH function and component registrations.
  // Function registrations go through registerWithDevMeta so the registered
  // name carries the `$dev` suffix — matching the devName that Studio saved
  // into the project's server-query ops. Without this the server-side
  // function map has `getProduct` but the generated query code calls
  // `__fn_ep__getProduct$dev` → "fetcher is not a function" at SSR.
  registerWithDevMeta(plasmic, () => {
    // Server-safe: registers ep.getProduct$dev etc. via the loader's
    // own registerFunction. Runs in both server (API routes + catchall
    // SSR) and client (canvas) contexts.
    registerEpCustomFunctions(plasmic);

    // Components are a "use client" surface in the EP dist — webpack
    // treats their imports as client references on server builds, so we
    // guard component registration behind `typeof window` and defer the
    // module load to a dynamic require (avoids server-side static
    // resolution of the "use client" entry entirely).
    if (typeof window !== "undefined") {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { registerComponentsInner } = require("./plasmic-register-components");
      registerComponentsInner(plasmic);
    }
  });
}

registerAllPackages(PLASMIC);
