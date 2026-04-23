"use client";

/**
 * Client-only component registration. Imported dynamically from
 * `plasmic-register.ts` guarded by `typeof window !== "undefined"` so
 * the server bundle never reaches the `"use client"` boundary on the
 * EP main entry (which would make the register function uncallable
 * from the server — see the /api/plasmic-registry route).
 *
 * Called from INSIDE registerWithDevMeta's callback so the `$dev`
 * suffix applies uniformly to every registration.
 */

import { PLASMIC } from "@/plasmic-init";
import { registerAll as registerElasticPath } from "@elasticpath/plasmic-ep-commerce-elastic-path";

export function registerComponentsInner(plasmic: typeof PLASMIC) {
  registerElasticPath(plasmic);
}
