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
 *
 * Why eval-require for @plasmicapp/host:
 *   The published @plasmicapp/host dist carries a `"use client"` directive. If
 *   webpack bundles it, Next's RSC runtime treats every export as a client
 *   reference — making `registerFunction`/`registerComponent` uncallable from
 *   server API routes. The natural fix (add the package to serverExternalPackages)
 *   forces Node's require to load a separate copy of React; that second React
 *   has its own dispatcher slot, which Next never sets during SSR → calls like
 *   `useContext` in globalContext components return null mid-render.
 *   The `eval("require")` trick sidesteps webpack's static analysis at THIS
 *   call site only — the host module is loaded via plain Node require at
 *   runtime (directive becomes a no-op string), while the rest of the app
 *   keeps webpack-bundled @plasmicapp/host so SSR renders use one React
 *   instance with a properly-set dispatcher.
 *
 * Usage (in plasmic-register.ts):
 *   import { withRegistryCapture } from "@elasticpath/plasmic-mcp-registry";
 *   const CAPTURED = typeof window === "undefined" ? withRegistryCapture(PLASMIC) : PLASMIC;
 */

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

interface HostRegistration {
  registerComponent: (component: unknown, meta: unknown) => void;
  registerGlobalContext: (component: unknown, meta: unknown) => void;
  registerFunction: (fn: unknown, meta: unknown) => void;
  registerToken: (token: unknown) => void;
  registerTrait: (trait: string, meta: unknown) => void;
}

let _host: HostRegistration | undefined;

function host(): HostRegistration {
  if (!_host) {
    // eval("require") avoids webpack's static-import analysis. Webpack
    // would otherwise see this as an import of @plasmicapp/host, read the
    // package's `"use client"` directive, and mark every export as a
    // client reference — which would make these functions uncallable
    // from server routes.
    // eslint-disable-next-line no-eval
    const nodeRequire = eval("require") as NodeRequire;
    _host = nodeRequire("@plasmicapp/host") as HostRegistration;
  }
  return _host;
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
  // Forwarding to `plasmic.register*` is intentionally omitted: the loader's
  // own register methods are noops server-side, AND with `@plasmicapp/host`
  // now bundled into Next's RSC graph (no longer in serverExternalPackages),
  // those methods carry the package's `"use client"` marker — invoking them
  // from a server route trips Next's RSC boundary protection
  // ("registerFunction is on the client"). The capture wrapper exists solely
  // to populate `@plasmicapp/host`'s globalThis registries via the
  // eval-required `host()` reference, which is what the MCP / API route
  // reads back via `getFullRegistry()`.
  return {
    ...plasmic,
    registerComponent(component: unknown, meta: unknown) {
      host().registerComponent(component, meta);
    },
    registerGlobalContext(component: unknown, meta: unknown) {
      host().registerGlobalContext(component, meta);
    },
    registerFunction(fn: unknown, meta: unknown) {
      host().registerFunction(fn, meta);
    },
    registerToken(token: unknown) {
      host().registerToken(token);
    },
    registerTrait(trait: string, meta: unknown) {
      host().registerTrait(trait, meta);
    },
  } as T;
}
