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
      // Neither form is a bare import, so no bundler resolves `async_hooks`
      // for the client bundle. `getBuiltinModule` works in both module
      // formats; the `eval` is the fallback for Node below 20.16 / 22.3,
      // where native ESM has no `require` and the storage would silently
      // degrade to the no-op below.
      const builtin = (
        process as unknown as {
          getBuiltinModule?: (id: string) => typeof import("async_hooks");
        }
      ).getBuiltinModule?.("async_hooks");
      const { AsyncLocalStorage } =
        builtin ??
        // eslint-disable-next-line no-eval
        ((eval("require") as NodeRequire)(
          "async_hooks"
        ) as typeof import("async_hooks"));
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
