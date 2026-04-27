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
function makeStorage(): SessionStorage {
  if (typeof window === "undefined") {
    try {
      // Hide the require from bundlers via eval — webpack would otherwise
      // try to resolve `async_hooks` for the client bundle and fail.
      // eslint-disable-next-line no-eval
      const req = eval("require") as NodeRequire;
      const { AsyncLocalStorage } = req("async_hooks");
      return new AsyncLocalStorage<EpSessionContext>();
    } catch {
      // fall through to no-op
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
