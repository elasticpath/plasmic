import {
  withEpSession,
  getCurrentEpSession,
} from "../session-context";

// The module is reachable from the CLIENT bundle (plasmic-register.ts →
// registerEpCustomFunctions → epGetProduct → session-context). Browsers have
// no `async_hooks`, so the module must IMPORT cleanly when it is unresolvable.
// Without this guard, Next.js dev mode crashes with "Module not found: Can't
// resolve 'async_hooks'" before any user code runs.
//
// It asserts loading only. Which storage you end up with is the next
// describe's job — asserting that here passed for the wrong reason once the
// module gained a second route to async_hooks.
describe("browser-bundle safety", () => {
  it("imports without throwing when async_hooks is unresolvable", () => {
    jest.isolateModules(() => {
      jest.doMock("async_hooks", () => {
        throw new Error(
          "Module not found: Can't resolve 'async_hooks' (simulated)"
        );
      });

      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const mod = require("../session-context");

      expect(typeof mod.withEpSession).toBe("function");
      expect(typeof mod.getCurrentEpSession).toBe("function");
      // Callbacks still run whichever storage was chosen, so consumer code
      // keeps working either way.
      expect(
        mod.withEpSession({ accessToken: "t", host: "h", clientId: "c" }, () => "ran")
      ).toBe("ran");
    });
    jest.dontMock("async_hooks");
    jest.resetModules();
  });
});

// `async_hooks` is reached two ways, and each must be exercised on its own:
// mocking the module does NOT affect `process.getBuiltinModule`, so a test
// that only mocks it proves nothing about which route was taken.
describe("reaching async_hooks", () => {
  const original = (process as any).getBuiltinModule;
  afterEach(() => {
    if (original) (process as any).getBuiltinModule = original;
    else delete (process as any).getBuiltinModule;
    // `doMock` outlives the test that called it, so without this the mock
    // that breaks one route silently breaks the next test's other route.
    jest.dontMock("async_hooks");
    jest.resetModules();
  });

  function storageIsReal(): boolean {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod = require("../session-context");
    return (
      mod.withEpSession({ accessToken: "t", host: "h", clientId: "c" }, () =>
        mod.getCurrentEpSession()
      )?.accessToken === "t"
    );
  }

  it("uses getBuiltinModule — the only route native ESM has", () => {
    jest.isolateModules(() => {
      // No `require` route at all, so a pass can only come from the builtin.
      jest.doMock("async_hooks", () => {
        throw new Error("Dynamic require of 'async_hooks' is not supported");
      });
      expect(storageIsReal()).toBe(true);
    });
  });

  it("falls back to require when getBuiltinModule is absent (older Node, CJS)", () => {
    jest.isolateModules(() => {
      delete (process as any).getBuiltinModule;
      expect(storageIsReal()).toBe(true);
    });
  });

  it("falls back to require when getBuiltinModule throws", () => {
    jest.isolateModules(() => {
      (process as any).getBuiltinModule = () => {
        throw new Error("blocked by policy");
      };
      expect(storageIsReal()).toBe(true);
    });
  });

  it("says so, loudly, when neither route works", () => {
    jest.isolateModules(() => {
      delete (process as any).getBuiltinModule;
      jest.doMock("async_hooks", () => {
        throw new Error("Cannot find module 'async_hooks'");
      });
      const warn = jest.spyOn(console, "warn").mockImplementation(() => {});

      expect(storageIsReal()).toBe(false);
      expect(warn.mock.calls.join(" ")).toContain("EP session scope");
      warn.mockRestore();
    });
  });
});

describe("withEpSession / getCurrentEpSession", () => {
  it("exposes the session to code running inside the callback", async () => {
    const session = {
      accessToken: "tok-1",
      host: "https://api.ep.com",
      clientId: "cid-1",
    };

    const observed = await withEpSession(session, async () => {
      return getCurrentEpSession();
    });

    expect(observed).toEqual(session);
  });

  it("returns undefined outside any withEpSession scope", () => {
    expect(getCurrentEpSession()).toBeUndefined();
  });

  it("isolates concurrent withEpSession callbacks — no cross-request leakage", async () => {
    // The critical property of AsyncLocalStorage. If we accidentally fall back
    // to a module-level variable, two parallel "requests" would observe each
    // other's session.
    const sessionA: any = {
      accessToken: "tok-A",
      host: "https://api.ep.com",
      clientId: "cid-A",
    };
    const sessionB: any = {
      accessToken: "tok-B",
      host: "https://api.ep.com",
      clientId: "cid-B",
    };

    // Force interleaving: each callback yields to the event loop multiple
    // times before reading the session, so the two callbacks ping-pong.
    const observe = async (label: string) => {
      const samples: { label: string; observed: string | undefined }[] = [];
      for (let i = 0; i < 5; i++) {
        await new Promise((r) => setImmediate(r));
        samples.push({
          label,
          observed: getCurrentEpSession()?.accessToken,
        });
      }
      return samples;
    };

    const [samplesA, samplesB] = await Promise.all([
      withEpSession(sessionA, () => observe("A")),
      withEpSession(sessionB, () => observe("B")),
    ]);

    // Every sample inside the A callback must see token A; same for B.
    expect(samplesA.every((s) => s.observed === "tok-A")).toBe(true);
    expect(samplesB.every((s) => s.observed === "tok-B")).toBe(true);
  });
});
