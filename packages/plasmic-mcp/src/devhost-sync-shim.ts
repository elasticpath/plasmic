/**
 * Fake dev-host window shim.
 *
 * Studio's `CodeComponentsRegistry` (platform/wab/src/wab/shared/code-components/
 * code-components.ts:503) reads registered components, contexts, tokens,
 * traits, functions, and libraries from globals on a Window-like object:
 * `__PlasmicComponentRegistry`, `__PlasmicContextRegistry`, etc.
 *
 * The MCP fetches a JSON-serialized snapshot of these same registries via
 * the dev host's `/api/plasmic-registry` endpoint. This shim rehydrates the
 * snapshot into the {component, meta} pair shape that `CodeComponentsRegistry`
 * expects — with stub no-op React-component impls, since Studio's ingestion
 * path (`addNewRegisteredComponents`) only reads `meta`.
 */

import type { FullRegistryData } from "./devhost-sync.js";

const NOOP_COMPONENT: any = () => null;
const NOOP_FN: any = () => undefined;

export interface FakeDevHostWindow {
  __PlasmicComponentRegistry: Array<{ component: unknown; meta: unknown }>;
  __PlasmicContextRegistry: Array<{ component: unknown; meta: unknown }>;
  __PlasmicTokenRegistry: unknown[];
  __PlasmicTraitRegistry: unknown[];
  __PlasmicFunctionsRegistry: Array<{ fn: unknown; meta: unknown }>;
  __PlasmicLibraryRegistry: unknown[];
}

export function createFakeDevHostWindow(
  registry: FullRegistryData
): FakeDevHostWindow {
  return {
    __PlasmicComponentRegistry: registry.components.map((meta: unknown) => ({
      component: NOOP_COMPONENT,
      meta,
    })),
    __PlasmicContextRegistry: registry.contexts.map((meta: unknown) => ({
      component: NOOP_COMPONENT,
      meta,
    })),
    __PlasmicTokenRegistry: [...registry.tokens],
    __PlasmicTraitRegistry: [...registry.traits],
    // Functions follow the same `{fn, meta}` shape Studio's
    // `CodeComponentsRegistry` expects — `registeredFunctionId(r)` reads
    // `r.meta.namespace` / `r.meta.name`. Without the meta wrapper the
    // whole ingestion pass crashes when any function is registered.
    __PlasmicFunctionsRegistry: registry.functions.map((meta: unknown) => ({
      fn: NOOP_FN,
      meta,
    })),
    __PlasmicLibraryRegistry: [],
  };
}
