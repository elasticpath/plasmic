"use client";

/**
 * Client-side component registration.
 *
 * The EP dist has `"use client"` so webpack bundles it into the same
 * client-component graph as Next's React (one React instance, one
 * dispatcher). Calling `registerAll` from a "use client" module is a
 * normal client-to-client import — no client-reference wrapping.
 *
 * SSR of the catchall page reaches this code through the PlasmicRoot
 * Provider chain: Next renders the client component tree server-side
 * for the initial HTML, and the registration side-effect runs during
 * that render with the dispatcher correctly set. Server queries and
 * component rendering both see the populated registry.
 *
 * The registration is gated by a module-level guard so it runs exactly
 * once per process lifetime.
 */

import { PLASMIC } from "@/plasmic-init";
import { registerAll as registerElasticPath } from "@elasticpath/plasmic-ep-commerce-elastic-path";
import { registerWithDevMeta } from "@/plasmic-register-dev-meta";

let _registered = false;

/**
 * Registers all EP components on the given loader. Idempotent —
 * subsequent calls are no-ops so re-renders don't double-register.
 */
export function registerComponentsInner(plasmic: typeof PLASMIC) {
  if (_registered) return;
  _registered = true;
  registerWithDevMeta(plasmic, () => {
    registerElasticPath(plasmic);
  });
}
