import {
  withEpSession,
  getCurrentEpSession,
} from "../session-context";

// The module is reachable from the CLIENT bundle through
// plasmic-register.ts → registerEpCustomFunctions → epGetProduct →
// session-context. Browsers have no `async_hooks`, so the module must
// load cleanly when the import throws. Without this guard, Next.js dev
// mode crashes with "Module not found: Can't resolve 'async_hooks'"
// before any user code runs.
describe("browser-bundle safety — module loads without async_hooks", () => {
  it("does not crash when async_hooks is unresolvable; getCurrentEpSession returns undefined", () => {
    jest.isolateModules(() => {
      jest.doMock("async_hooks", () => {
        throw new Error(
          "Module not found: Can't resolve 'async_hooks' (simulated)"
        );
      });

      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const mod = require("../session-context");

      // Module must load without throwing.
      expect(typeof mod.withEpSession).toBe("function");
      expect(typeof mod.getCurrentEpSession).toBe("function");

      // With no ALS available, getCurrentEpSession returns undefined and
      // withEpSession still invokes the callback (so consumer code keeps
      // running; ep.* functions just fail-soft because they read undefined).
      expect(mod.getCurrentEpSession()).toBeUndefined();
      const result = mod.withEpSession(
        { accessToken: "tok", host: "h", clientId: "c" },
        () => "ran"
      );
      expect(result).toBe("ran");
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
