/**
 * Unit tests for auth.ts
 *
 * The auth module resolves Plasmic credentials from env vars or .plasmic.auth file.
 * Tests verify the priority order, validation, and error messages that guide
 * developers to correct their configuration.
 *
 * Uses vi.resetModules() + dynamic import() for proper module isolation.
 */

import { vi, describe, it, expect, beforeEach, afterEach, afterAll } from "vitest";

// Shared mutable mock holders — vi.doMock factories reference these
// via the module-level object so closures are not needed.
const _authMocks = {
  fsReadFileSync: null as any,
  osHomedir: null as any,
};

describe("getAuth", () => {
  const savedEnv = { ...process.env };

  function clearAuthEnv() {
    delete process.env.PLASMIC_AUTH_HOST;
    delete process.env.PLASMIC_AUTH_USER;
    delete process.env.PLASMIC_AUTH_TOKEN;
    delete process.env.PLASMIC_BASIC_AUTH_USER;
    delete process.env.PLASMIC_BASIC_AUTH_PASSWORD;
  }

  /**
   * Load getAuth with mocked fs and os modules.
   * Uses vi.resetModules() to ensure the auth module picks up fresh mocks.
   */
  async function loadGetAuthWithMocks(fsReadFileSync: ReturnType<typeof vi.fn>, osHomedir: ReturnType<typeof vi.fn>) {
    _authMocks.fsReadFileSync = fsReadFileSync;
    _authMocks.osHomedir = osHomedir;
    vi.resetModules();
    vi.doMock("fs", () => ({
      readFileSync: (...args: any[]) => _authMocks.fsReadFileSync(...args),
    }));
    vi.doMock("path", async () => await vi.importActual("path"));
    vi.doMock("os", () => ({
      homedir: () => _authMocks.osHomedir(),
    }));
    return (await import("../auth")).getAuth as typeof import("../auth")["getAuth"];
  }

  beforeEach(() => {
    process.env = { ...savedEnv };
    clearAuthEnv();
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
  });

  afterAll(() => {
    process.env = savedEnv;
  });

  // --- Env var tests (don't need fs mocking) ---

  it("returns auth from environment variables when all present", async () => {
    process.env.PLASMIC_AUTH_HOST = "https://studio.example.com";
    process.env.PLASMIC_AUTH_USER = "user123";
    process.env.PLASMIC_AUTH_TOKEN = "token456";

    const getAuth = await loadGetAuthWithMocks(
      vi.fn(() => { throw new Error("ENOENT"); }),
      vi.fn(() => "/mock/home")
    );
    const auth = getAuth();

    expect(auth.host).toBe("https://studio.example.com");
    expect(auth.user).toBe("user123");
    expect(auth.token).toBe("token456");
  });

  it("strips trailing slashes from host", async () => {
    process.env.PLASMIC_AUTH_HOST = "https://studio.example.com///";
    process.env.PLASMIC_AUTH_USER = "user123";
    process.env.PLASMIC_AUTH_TOKEN = "token456";

    const getAuth = await loadGetAuthWithMocks(
      vi.fn(() => { throw new Error("ENOENT"); }),
      vi.fn(() => "/mock/home")
    );
    const auth = getAuth();
    expect(auth.host).toBe("https://studio.example.com");
  });

  it("includes basic auth credentials when present", async () => {
    process.env.PLASMIC_AUTH_HOST = "https://studio.example.com";
    process.env.PLASMIC_AUTH_USER = "user123";
    process.env.PLASMIC_AUTH_TOKEN = "token456";
    process.env.PLASMIC_BASIC_AUTH_USER = "basicUser";
    process.env.PLASMIC_BASIC_AUTH_PASSWORD = "basicPass";

    const getAuth = await loadGetAuthWithMocks(
      vi.fn(() => { throw new Error("ENOENT"); }),
      vi.fn(() => "/mock/home")
    );
    const auth = getAuth();
    expect(auth.basicAuthUser).toBe("basicUser");
    expect(auth.basicAuthPassword).toBe("basicPass");
  });

  it("throws when user and token are set but host is missing", async () => {
    process.env.PLASMIC_AUTH_USER = "user123";
    process.env.PLASMIC_AUTH_TOKEN = "token456";

    const getAuth = await loadGetAuthWithMocks(
      vi.fn(() => { throw new Error("ENOENT"); }),
      vi.fn(() => "/mock/home")
    );
    expect(() => getAuth()).toThrow("PLASMIC_AUTH_HOST is required");
  });

  // --- File fallback tests (need fs mocking) ---

  it("warns on partial environment variables and falls through to file", async () => {
    process.env.PLASMIC_AUTH_USER = "user123";
    // No token — partial env vars

    const getAuth = await loadGetAuthWithMocks(
      vi.fn(() => { throw new Error("ENOENT"); }),
      vi.fn(() => "/mock/home")
    );
    expect(() => getAuth()).toThrow("Plasmic authentication required");
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining("Partial Plasmic auth env vars")
    );
  });

  it("falls back to .plasmic.auth file when env vars missing", async () => {
    const mockReadFileSync = vi.fn((filePath: any) => {
      if (String(filePath).endsWith(".plasmic.auth")) {
        return JSON.stringify({
          host: "https://file-host.example.com",
          user: "fileUser",
          token: "fileToken",
        });
      }
      throw new Error("ENOENT");
    });

    const getAuth = await loadGetAuthWithMocks(
      mockReadFileSync,
      vi.fn(() => "/mock/home")
    );
    const auth = getAuth();
    expect(auth.host).toBe("https://file-host.example.com");
    expect(auth.user).toBe("fileUser");
    expect(auth.token).toBe("fileToken");
  });

  it("strips trailing slashes from file-based host", async () => {
    const mockReadFileSync = vi.fn((filePath: any) => {
      if (String(filePath).endsWith(".plasmic.auth")) {
        return JSON.stringify({
          host: "https://file-host.example.com///",
          user: "fileUser",
          token: "fileToken",
        });
      }
      throw new Error("ENOENT");
    });

    const getAuth = await loadGetAuthWithMocks(
      mockReadFileSync,
      vi.fn(() => "/mock/home")
    );
    const auth = getAuth();
    expect(auth.host).toBe("https://file-host.example.com");
  });

  it("skips auth file with incomplete fields", async () => {
    const mockReadFileSync = vi.fn((filePath: any) => {
      if (String(filePath).endsWith(".plasmic.auth")) {
        // Missing token field
        return JSON.stringify({ host: "https://example.com", user: "u" });
      }
      throw new Error("ENOENT");
    });

    const getAuth = await loadGetAuthWithMocks(
      mockReadFileSync,
      vi.fn(() => "/mock/home")
    );
    expect(() => getAuth()).toThrow("Plasmic authentication required");
  });

  it("warns when auth file has invalid JSON instead of silently ignoring", async () => {
    const mockReadFileSync = vi.fn((filePath: any) => {
      if (String(filePath).endsWith(".plasmic.auth")) {
        return "{ not valid json !!!";
      }
      throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
    });

    const getAuth = await loadGetAuthWithMocks(
      mockReadFileSync,
      vi.fn(() => "/mock/home")
    );
    // Should still throw because no valid auth is found
    expect(() => getAuth()).toThrow("Plasmic authentication required");
    // But should warn about the malformed file
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining("could not read it")
    );
  });

  it("does not warn when auth file simply does not exist", async () => {
    const enoentErr = Object.assign(new Error("ENOENT: no such file"), { code: "ENOENT" });
    const mockReadFileSync = vi.fn(() => { throw enoentErr; });

    const getAuth = await loadGetAuthWithMocks(
      mockReadFileSync,
      vi.fn(() => "/mock/home")
    );
    expect(() => getAuth()).toThrow("Plasmic authentication required");
    // Should NOT warn about missing files (expected case)
    const errorCalls = (console.error as ReturnType<typeof vi.fn>).mock.calls;
    const warningCalls = errorCalls.filter(
      (c: any) => typeof c[0] === "string" && c[0].includes("could not read it")
    );
    expect(warningCalls).toHaveLength(0);
  });

  it("throws descriptive error when no auth source available", async () => {
    const getAuth = await loadGetAuthWithMocks(
      vi.fn(() => { throw new Error("ENOENT"); }),
      vi.fn(() => "/mock/home")
    );
    expect(() => getAuth()).toThrow("Plasmic authentication required");
    expect(() => getAuth()).toThrow("PLASMIC_AUTH_HOST");
    expect(() => getAuth()).toThrow("PLASMIC_AUTH_USER");
    expect(() => getAuth()).toThrow("PLASMIC_AUTH_TOKEN");
  });
});
