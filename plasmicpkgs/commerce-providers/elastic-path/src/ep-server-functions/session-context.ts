import type { EpCtx } from "./build-ep-ctx";

export type EpSessionContext = EpCtx;

interface SessionStorage {
  run<T>(session: EpSessionContext, callback: () => T): T;
  getStore(): EpSessionContext | undefined;
}

// `async_hooks` is a Node-only built-in. This module is reachable from
// the CLIENT bundle (plasmic-register.ts → registerEpCustomFunctions →
// epGetProduct → here), so we must load cleanly when the module is
// unresolvable. The browser fallback is a no-op storage: callbacks still
// run, but every read returns `undefined`. That matches the contract
// every `ep.*` function already enforces — they fail-soft to `null` /
// `[]` outside an active session.
/** Node, as opposed to a browser, a web worker or an edge runtime. */
function isNodeRuntime(): boolean {
  try {
    return (
      typeof process !== "undefined" &&
      Boolean((process as { versions?: { node?: string } }).versions?.node)
    );
  } catch {
    // A `process` shim whose accessors throw is still not Node.
    return false;
  }
}

/**
 * Reaches `async_hooks` without a bare import, so no bundler tries to resolve
 * it for the client bundle. Two ways in, tried in order, because neither
 * covers every environment on its own:
 *
 *   - `process.getBuiltinModule` works in both module formats, and is the only
 *     one that works under native ESM. Node 20.16+ / 22.3+.
 *   - `eval("require")` covers older Node, but only under CommonJS: native ESM
 *     has no `require` at all, so Node below 20.16 running as ES modules has
 *     no route in and the scope degrades to the no-op below.
 *
 * Returns null rather than throwing, whatever the runtime turns out to be.
 * This module is reachable from the browser bundle, so a throw here would
 * crash the import rather than degrade.
 */
function loadAsyncHooks(): typeof import("async_hooks") | null {
  if (typeof process !== "undefined") {
    const fromBuiltin = (
      process as unknown as {
        getBuiltinModule?: (id: string) => typeof import("async_hooks");
      }
    ).getBuiltinModule;
    if (typeof fromBuiltin === "function") {
      try {
        const mod = fromBuiltin.call(process, "async_hooks");
        if (mod?.AsyncLocalStorage) return mod;
      } catch {
        // Fall through and try `require` rather than giving up here.
      }
    }
  }
  try {
    // eslint-disable-next-line no-eval
    const req = eval("require") as NodeRequire;
    const mod = req("async_hooks") as typeof import("async_hooks");
    return mod?.AsyncLocalStorage ? mod : null;
  } catch {
    return null;
  }
}

function makeStorage(): SessionStorage {
  if (typeof window === "undefined") {
    let asyncHooks: typeof import("async_hooks") | null = null;
    try {
      asyncHooks = loadAsyncHooks();
    } catch {
      asyncHooks = null;
    }
    if (asyncHooks) {
      try {
        return new asyncHooks.AsyncLocalStorage<EpSessionContext>();
      } catch {
        // A stub that answered the shape check but cannot construct.
      }
    }
    // Only Node is expected to have this. Saying so anywhere else would be
    // noise in every edge and worker runtime, which never had it to lose.
    try {
      if (isNodeRuntime()) {
        console.warn(
          "[ep-commerce] Could not load `async_hooks`, so the EP session " +
            "scope is inert and every `ep.*` call will return null or []. " +
            "Native ES " +
            "modules need Node 20.16+ / 22.3+ for `process.getBuiltinModule`."
        );
      }
    } catch {
      // Reporting the problem must not become a second problem.
    }
  }
  return {
    run<T>(_session: EpSessionContext, callback: () => T): T {
      return callback();
    },
    getStore(): EpSessionContext | undefined {
      return undefined;
    },
  };
}

const storage = makeStorage();

export function withEpSession<T>(
  session: EpSessionContext,
  callback: () => Promise<T> | T
): Promise<T> | T {
  return storage.run(session, callback);
}

export function getCurrentEpSession(): EpSessionContext | undefined {
  return storage.getStore();
}
