/**
 * Server-side registry capture.
 *
 * Problem: The Plasmic server loader's registerComponent/registerGlobalContext/etc.
 * are noops — they don't populate globalThis.__PlasmicComponentRegistry. The client
 * loader does call @plasmicapp/host's functions, but on the server (API routes) the
 * globals stay empty.
 *
 * Solution: Wrap the PLASMIC loader object so that each registration call ALSO
 * invokes @plasmicapp/host's corresponding function, which writes to globalThis.
 * This is safe on the server — the host functions just push to arrays, no React hooks.
 *
 * Usage (in plasmic-register.ts):
 *   import { withRegistryCapture } from "@elasticpath/plasmic-mcp-registry";
 *   const CAPTURED = typeof window === "undefined" ? withRegistryCapture(PLASMIC) : PLASMIC;
 *   // Then register packages with CAPTURED instead of PLASMIC
 */
import {
  registerComponent,
  registerGlobalContext,
  registerFunction,
  registerToken,
  registerTrait,
} from "@plasmicapp/host";

/**
 * Minimal interface for a PLASMIC-like object that has registration methods.
 * We don't import the full loader types to avoid a dependency on @plasmicapp/loader-*.
 */
interface PlasmicLike {
  registerComponent: (component: unknown, meta: unknown) => void;
  registerGlobalContext?: (component: unknown, meta: unknown) => void;
  registerFunction?: (fn: unknown, meta: unknown) => void;
  registerToken?: (token: unknown) => void;
  registerTrait?: (trait: string, meta: unknown) => void;
  [key: string]: unknown;
}

/**
 * Wraps a PLASMIC loader object so that registration calls also populate
 * the globalThis registries via @plasmicapp/host's functions.
 *
 * On the client this is unnecessary (the client loader already calls host
 * functions). Use this only on the server side (API routes).
 *
 * @param plasmic - The PLASMIC loader instance from initPlasmicLoader()
 * @returns A wrapped object with the same interface
 */
export function withRegistryCapture<T extends PlasmicLike>(plasmic: T): T {
  return {
    ...plasmic,
    registerComponent(component: unknown, meta: unknown) {
      plasmic.registerComponent(component, meta);
      registerComponent(component as any, meta as any);
    },
    registerGlobalContext(component: unknown, meta: unknown) {
      plasmic.registerGlobalContext?.(component, meta);
      registerGlobalContext(component as any, meta as any);
    },
    registerFunction(fn: unknown, meta: unknown) {
      plasmic.registerFunction?.(fn, meta);
      registerFunction(fn as any, meta as any);
    },
    registerToken(token: unknown) {
      plasmic.registerToken?.(token);
      registerToken(token as any);
    },
    registerTrait(trait: string, meta: unknown) {
      plasmic.registerTrait?.(trait, meta);
      registerTrait(trait, meta as any);
    },
  } as T;
}
