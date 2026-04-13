/**
 * Unit tests for auth-flow.ts — browser init-token authentication.
 *
 * Mocks browser opening and socket.io to test the orchestration logic
 * without requiring a real Plasmic server.
 */

import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";

// Shared mock holders for dynamic imports
const _mocks = {
  openFn: null as any,
  socketConnect: null as any,
  socketOn: null as any,
  socketClose: null as any,
  promptsFn: null as any,
};

async function loadAuthFlow() {
  vi.resetModules();

  vi.doMock("open", () => ({
    default: (...args: any[]) => _mocks.openFn(...args),
  }));

  // Mock socket.io-client
  vi.doMock("socket.io-client", () => ({
    io: (...args: any[]) => {
      _mocks.socketConnect(...args);
      return {
        on: (...onArgs: any[]) => _mocks.socketOn(...onArgs),
        close: () => _mocks.socketClose(),
      };
    },
  }));

  vi.doMock("prompts", () => ({
    default: (...args: any[]) => _mocks.promptsFn(...args),
  }));

  return await import("../auth-flow.js");
}

describe("acquireAuth", () => {
  beforeEach(() => {
    _mocks.openFn = vi.fn();
    _mocks.socketConnect = vi.fn();
    _mocks.socketOn = vi.fn();
    _mocks.socketClose = vi.fn();
    _mocks.promptsFn = vi.fn();
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it("opens browser with correct init-token URL", async () => {
    // Socket.io mock that immediately emits "token" event
    _mocks.socketOn = vi.fn((event: string, cb: Function) => {
      if (event === "token") {
        setTimeout(() => cb({ user: "u@test.com", token: "tok123" }), 10);
      }
    });

    const { acquireAuth } = await loadAuthFlow();
    const result = await acquireAuth("https://useast.storefront.elasticpath.com");

    expect(_mocks.openFn).toHaveBeenCalledOnce();
    const url = _mocks.openFn.mock.calls[0][0] as string;
    expect(url).toMatch(/^https:\/\/useast\.storefront\.elasticpath\.com\/auth\/plasmic-init\//);
    // URL should contain a UUID-like init token
    expect(url).toMatch(/\/[0-9a-f-]{36}$/);
  });

  it("returns AuthConfig on successful token callback", async () => {
    _mocks.socketOn = vi.fn((event: string, cb: Function) => {
      if (event === "token") {
        setTimeout(() => cb({ user: "u@test.com", token: "tok123" }), 10);
      }
    });

    const { acquireAuth } = await loadAuthFlow();
    const result = await acquireAuth("https://useast.storefront.elasticpath.com");

    expect(result.host).toBe("https://useast.storefront.elasticpath.com");
    expect(result.user).toBe("u@test.com");
    expect(result.token).toBe("tok123");
  });

  it("closes socket after receiving token", async () => {
    _mocks.socketOn = vi.fn((event: string, cb: Function) => {
      if (event === "token") {
        setTimeout(() => cb({ user: "u@test.com", token: "tok123" }), 10);
      }
    });

    const { acquireAuth } = await loadAuthFlow();
    await acquireAuth("https://useast.storefront.elasticpath.com");

    expect(_mocks.socketClose).toHaveBeenCalled();
  });

  it("falls back to manual entry on timeout", async () => {
    // Socket never emits "token" — will timeout
    _mocks.socketOn = vi.fn();

    // Manual prompt returns credentials
    _mocks.promptsFn = vi.fn().mockResolvedValue({
      user: "manual@test.com",
      token: "manual_tok",
    });

    const { acquireAuth } = await loadAuthFlow();
    // Use short timeout for testing
    const result = await acquireAuth("https://useast.storefront.elasticpath.com", { timeoutMs: 50 });

    expect(result.host).toBe("https://useast.storefront.elasticpath.com");
    expect(result.user).toBe("manual@test.com");
    expect(result.token).toBe("manual_tok");
  });

  it("strips trailing slash from host", async () => {
    _mocks.socketOn = vi.fn((event: string, cb: Function) => {
      if (event === "token") {
        setTimeout(() => cb({ user: "u@test.com", token: "tok123" }), 10);
      }
    });

    const { acquireAuth } = await loadAuthFlow();
    const result = await acquireAuth("https://useast.storefront.elasticpath.com/");

    expect(result.host).toBe("https://useast.storefront.elasticpath.com");
  });
});
