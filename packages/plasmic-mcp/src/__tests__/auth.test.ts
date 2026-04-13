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
  fsWriteFileSync: null as any,
  fsChmodSync: null as any,
  osMkdirSync: null as any,
  osHomedir: null as any,
};

/**
 * Load auth module with mocked fs and os modules.
 * Uses vi.resetModules() to ensure the auth module picks up fresh mocks.
 */
async function loadAuthWithMocks(opts: {
  fsReadFileSync: ReturnType<typeof vi.fn>;
  osHomedir: ReturnType<typeof vi.fn>;
  fsWriteFileSync?: ReturnType<typeof vi.fn>;
  fsChmodSync?: ReturnType<typeof vi.fn>;
}) {
  _authMocks.fsReadFileSync = opts.fsReadFileSync;
  _authMocks.fsWriteFileSync = opts.fsWriteFileSync ?? vi.fn();
  _authMocks.fsChmodSync = opts.fsChmodSync ?? vi.fn();
  _authMocks.osHomedir = opts.osHomedir;
  vi.resetModules();
  vi.doMock("fs", () => ({
    readFileSync: (...args: any[]) => _authMocks.fsReadFileSync(...args),
    writeFileSync: (...args: any[]) => _authMocks.fsWriteFileSync(...args),
    chmodSync: (...args: any[]) => _authMocks.fsChmodSync(...args),
    mkdirSync: (...args: any[]) => (_authMocks.osMkdirSync ?? vi.fn())(...args),
  }));
  vi.doMock("path", async () => await vi.importActual("path"));
  vi.doMock("os", () => ({
    homedir: () => _authMocks.osHomedir(),
  }));
  return await import("../auth");
}

/** Shorthand for tests that only need getAuth. */
async function loadGetAuthWithMocks(fsReadFileSync: ReturnType<typeof vi.fn>, osHomedir: ReturnType<typeof vi.fn>) {
  const mod = await loadAuthWithMocks({ fsReadFileSync, osHomedir });
  return mod.getAuth;
}

function clearAuthEnv() {
  delete process.env.PLASMIC_AUTH_HOST;
  delete process.env.PLASMIC_AUTH_USER;
  delete process.env.PLASMIC_AUTH_TOKEN;
  delete process.env.PLASMIC_BASIC_AUTH_USER;
  delete process.env.PLASMIC_BASIC_AUTH_PASSWORD;
}

describe("getAuth", () => {
  const savedEnv = { ...process.env };

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
    const auth = getAuth();
    expect(auth).toBeNull();
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

  it("skips auth file with incomplete fields and returns null", async () => {
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
    expect(getAuth()).toBeNull();
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
    // Should return null because no valid auth is found
    expect(getAuth()).toBeNull();
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
    expect(getAuth()).toBeNull();
    // Should NOT warn about missing files (expected case)
    const errorCalls = (console.error as ReturnType<typeof vi.fn>).mock.calls;
    const warningCalls = errorCalls.filter(
      (c: any) => typeof c[0] === "string" && c[0].includes("could not read it")
    );
    expect(warningCalls).toHaveLength(0);
  });

  it("returns null when no auth source available", async () => {
    const getAuth = await loadGetAuthWithMocks(
      vi.fn(() => { throw new Error("ENOENT"); }),
      vi.fn(() => "/mock/home")
    );
    expect(getAuth()).toBeNull();
  });
});

describe("writeAuth", () => {
  const savedEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...savedEnv };
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
  });

  afterAll(() => {
    process.env = savedEnv;
  });

  it("writes JSON credentials to ~/.plasmic.auth", async () => {
    const mockWriteFileSync = vi.fn();
    const mockChmodSync = vi.fn();

    const { writeAuth } = await loadAuthWithMocks({
      fsReadFileSync: vi.fn(() => { throw new Error("ENOENT"); }),
      osHomedir: vi.fn(() => "/mock/home"),
      fsWriteFileSync: mockWriteFileSync,
      fsChmodSync: mockChmodSync,
    });

    writeAuth({
      host: "https://useast.storefront.elasticpath.com",
      user: "user@example.com",
      token: "tok_abc123",
    });

    expect(mockWriteFileSync).toHaveBeenCalledOnce();
    const [filePath, content] = mockWriteFileSync.mock.calls[0];
    expect(filePath).toContain(".plasmic.auth");
    const parsed = JSON.parse(content);
    expect(parsed.host).toBe("https://useast.storefront.elasticpath.com");
    expect(parsed.user).toBe("user@example.com");
    expect(parsed.token).toBe("tok_abc123");
  });

  it("sets file permissions to 0600", async () => {
    const mockWriteFileSync = vi.fn();
    const mockChmodSync = vi.fn();

    const { writeAuth } = await loadAuthWithMocks({
      fsReadFileSync: vi.fn(() => { throw new Error("ENOENT"); }),
      osHomedir: vi.fn(() => "/mock/home"),
      fsWriteFileSync: mockWriteFileSync,
      fsChmodSync: mockChmodSync,
    });

    writeAuth({
      host: "https://useast.storefront.elasticpath.com",
      user: "user@example.com",
      token: "tok_abc123",
    });

    expect(mockChmodSync).toHaveBeenCalledOnce();
    const [filePath, mode] = mockChmodSync.mock.calls[0];
    expect(filePath).toContain(".plasmic.auth");
    expect(mode).toBe(0o600);
  });

  it("writes to custom path when provided", async () => {
    const mockWriteFileSync = vi.fn();
    const mockChmodSync = vi.fn();

    const { writeAuth } = await loadAuthWithMocks({
      fsReadFileSync: vi.fn(() => { throw new Error("ENOENT"); }),
      osHomedir: vi.fn(() => "/mock/home"),
      fsWriteFileSync: mockWriteFileSync,
      fsChmodSync: mockChmodSync,
    });

    writeAuth(
      {
        host: "https://euwest.storefront.elasticpath.com",
        user: "user@example.com",
        token: "tok_xyz789",
      },
      "/custom/path/.plasmic.auth"
    );

    const [filePath] = mockWriteFileSync.mock.calls[0];
    expect(filePath).toBe("/custom/path/.plasmic.auth");
  });

  it("round-trips: writeAuth then getAuth returns same credentials", async () => {
    // In-memory file store
    const fileStore: Record<string, string> = {};

    const mockWriteFileSync = vi.fn((filePath: string, content: string) => {
      fileStore[filePath] = content;
    });
    const mockReadFileSync = vi.fn((filePath: string) => {
      if (fileStore[filePath]) return fileStore[filePath];
      throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
    });

    const { writeAuth, getAuth } = await loadAuthWithMocks({
      fsReadFileSync: mockReadFileSync,
      osHomedir: vi.fn(() => "/mock/home"),
      fsWriteFileSync: mockWriteFileSync,
      fsChmodSync: vi.fn(),
    });

    const config = {
      host: "https://useast.storefront.elasticpath.com",
      user: "roundtrip@example.com",
      token: "tok_roundtrip",
    };

    writeAuth(config, "/mock/home/.plasmic.auth");
    const readBack = getAuth();
    expect(readBack).not.toBeNull();
    expect(readBack!.host).toBe(config.host);
    expect(readBack!.user).toBe(config.user);
    expect(readBack!.token).toBe(config.token);
  });
});
