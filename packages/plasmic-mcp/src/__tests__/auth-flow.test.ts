/**
 * Unit tests for auth-flow.ts — interactive and browser-based authentication.
 *
 * Default flow uses terminal prompts. Browser init-token flow is available
 * via { browser: true } option (deferred until CM supports the route).
 */

import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";

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

describe("acquireAuth — prompt flow (default)", () => {
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

  it("returns AuthConfig from prompted credentials", async () => {
    _mocks.promptsFn = vi.fn().mockResolvedValue({
      user: "user@example.com",
      token: "tok_abc123",
    });

    const { acquireAuth } = await loadAuthFlow();
    const result = await acquireAuth("https://useast.storefront.elasticpath.com");

    expect(result.host).toBe("https://useast.storefront.elasticpath.com");
    expect(result.user).toBe("user@example.com");
    expect(result.token).toBe("tok_abc123");
  });

  it("strips trailing slash from host", async () => {
    _mocks.promptsFn = vi.fn().mockResolvedValue({
      user: "user@example.com",
      token: "tok_abc123",
    });

    const { acquireAuth } = await loadAuthFlow();
    const result = await acquireAuth("https://useast.storefront.elasticpath.com/");

    expect(result.host).toBe("https://useast.storefront.elasticpath.com");
  });

  it("throws when user cancels prompts", async () => {
    _mocks.promptsFn = vi.fn().mockResolvedValue({});

    const { acquireAuth } = await loadAuthFlow();
    await expect(acquireAuth("https://useast.storefront.elasticpath.com")).rejects.toThrow(
      "Authentication cancelled"
    );
  });

  it("does not open browser", async () => {
    _mocks.promptsFn = vi.fn().mockResolvedValue({
      user: "user@example.com",
      token: "tok_abc123",
    });

    const { acquireAuth } = await loadAuthFlow();
    await acquireAuth("https://useast.storefront.elasticpath.com");

    expect(_mocks.openFn).not.toHaveBeenCalled();
  });
});

describe("acquireAuth — browser flow ({ browser: true })", () => {
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
    _mocks.socketOn = vi.fn((event: string, cb: Function) => {
      if (event === "token") {
        setTimeout(() => cb({ user: "u@test.com", token: "tok123" }), 10);
      }
    });

    const { acquireAuth } = await loadAuthFlow();
    await acquireAuth("https://useast.storefront.elasticpath.com", { browser: true });

    expect(_mocks.openFn).toHaveBeenCalledOnce();
    const url = _mocks.openFn.mock.calls[0][0] as string;
    expect(url).toMatch(/^https:\/\/useast\.storefront\.elasticpath\.com\/auth\/plasmic-init\//);
    expect(url).toMatch(/\/[0-9a-f-]{36}$/);
  });

  it("returns AuthConfig on successful token callback", async () => {
    _mocks.socketOn = vi.fn((event: string, cb: Function) => {
      if (event === "token") {
        setTimeout(() => cb({ user: "u@test.com", token: "tok123" }), 10);
      }
    });

    const { acquireAuth } = await loadAuthFlow();
    const result = await acquireAuth("https://useast.storefront.elasticpath.com", { browser: true });

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
    await acquireAuth("https://useast.storefront.elasticpath.com", { browser: true });

    expect(_mocks.socketClose).toHaveBeenCalled();
  });

  it("falls back to manual entry on timeout", async () => {
    _mocks.socketOn = vi.fn();
    _mocks.promptsFn = vi.fn().mockResolvedValue({
      user: "manual@test.com",
      token: "manual_tok",
    });

    const { acquireAuth } = await loadAuthFlow();
    const result = await acquireAuth("https://useast.storefront.elasticpath.com", {
      browser: true,
      timeoutMs: 50,
    });

    expect(result.host).toBe("https://useast.storefront.elasticpath.com");
    expect(result.user).toBe("manual@test.com");
    expect(result.token).toBe("manual_tok");
  });
});
