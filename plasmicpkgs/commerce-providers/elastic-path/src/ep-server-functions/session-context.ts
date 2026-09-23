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
 */
function loadAsyncHooks(): typeof import("async_hooks") | null {
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
  try {
    // eslint-disable-next-line no-eval
    const req = eval("require") as NodeRequire;
    return req("async_hooks") as typeof import("async_hooks");
  } catch {
    return null;
  }
}

function makeStorage(): SessionStorage {
  if (typeof window === "undefined") {
    const asyncHooks = loadAsyncHooks();
    if (asyncHooks) {
      return new asyncHooks.AsyncLocalStorage<EpSessionContext>();
    }
    // Saying so is the point: the silent version of this made every `ep.*`
    // call return null with nothing to go on.
    console.warn(
      "[ep-commerce] Could not load `async_hooks`, so the EP session scope " +
        "is inert and every `ep.*` call will return null or []. Native ES " +
        "modules need Node 20.16+ / 22.3+ for `process.getBuiltinModule`."
    );
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
