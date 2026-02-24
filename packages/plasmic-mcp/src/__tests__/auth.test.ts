/**
 * Unit tests for auth.ts
 *
 * The auth module resolves Plasmic credentials from env vars or .plasmic.auth file.
 * Tests verify the priority order, validation, and error messages that guide
 * developers to correct their configuration.
 *
 * Because the esbuild jest transform doesn't hoist jest.mock calls, tests that
 * need to mock fs/os use jest.resetModules() + dynamic require() for proper
 * module isolation.
 */

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
   * Uses jest.resetModules() to ensure the auth module picks up fresh mocks.
   */
  function loadGetAuthWithMocks(fsReadFileSync: jest.Mock, osHomedir: jest.Mock) {
    jest.resetModules();
    jest.mock("fs", () => ({
      readFileSync: (...args: any[]) => fsReadFileSync(...args),
    }));
    jest.mock("path", () => jest.requireActual("path"));
    jest.mock("os", () => ({
      homedir: () => osHomedir(),
    }));
    return require("../auth").getAuth as typeof import("../auth")["getAuth"];
  }

  beforeEach(() => {
    process.env = { ...savedEnv };
    clearAuthEnv();
    jest.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
    jest.resetModules();
  });

  afterAll(() => {
    process.env = savedEnv;
  });

  // --- Env var tests (don't need fs mocking) ---

  it("returns auth from environment variables when all present", () => {
    process.env.PLASMIC_AUTH_HOST = "https://studio.example.com";
    process.env.PLASMIC_AUTH_USER = "user123";
    process.env.PLASMIC_AUTH_TOKEN = "token456";

    const getAuth = loadGetAuthWithMocks(
      jest.fn(() => { throw new Error("ENOENT"); }),
      jest.fn(() => "/mock/home")
    );
    const auth = getAuth();

    expect(auth.host).toBe("https://studio.example.com");
    expect(auth.user).toBe("user123");
    expect(auth.token).toBe("token456");
  });

  it("strips trailing slashes from host", () => {
    process.env.PLASMIC_AUTH_HOST = "https://studio.example.com///";
    process.env.PLASMIC_AUTH_USER = "user123";
    process.env.PLASMIC_AUTH_TOKEN = "token456";

    const getAuth = loadGetAuthWithMocks(
      jest.fn(() => { throw new Error("ENOENT"); }),
      jest.fn(() => "/mock/home")
    );
    const auth = getAuth();
    expect(auth.host).toBe("https://studio.example.com");
  });

  it("includes basic auth credentials when present", () => {
    process.env.PLASMIC_AUTH_HOST = "https://studio.example.com";
    process.env.PLASMIC_AUTH_USER = "user123";
    process.env.PLASMIC_AUTH_TOKEN = "token456";
    process.env.PLASMIC_BASIC_AUTH_USER = "basicUser";
    process.env.PLASMIC_BASIC_AUTH_PASSWORD = "basicPass";

    const getAuth = loadGetAuthWithMocks(
      jest.fn(() => { throw new Error("ENOENT"); }),
      jest.fn(() => "/mock/home")
    );
    const auth = getAuth();
    expect(auth.basicAuthUser).toBe("basicUser");
    expect(auth.basicAuthPassword).toBe("basicPass");
  });

  it("throws when user and token are set but host is missing", () => {
    process.env.PLASMIC_AUTH_USER = "user123";
    process.env.PLASMIC_AUTH_TOKEN = "token456";

    const getAuth = loadGetAuthWithMocks(
      jest.fn(() => { throw new Error("ENOENT"); }),
      jest.fn(() => "/mock/home")
    );
    expect(() => getAuth()).toThrow("PLASMIC_AUTH_HOST is required");
  });

  // --- File fallback tests (need fs mocking) ---

  it("warns on partial environment variables and falls through to file", () => {
    process.env.PLASMIC_AUTH_USER = "user123";
    // No token — partial env vars

    const getAuth = loadGetAuthWithMocks(
      jest.fn(() => { throw new Error("ENOENT"); }),
      jest.fn(() => "/mock/home")
    );
    expect(() => getAuth()).toThrow("Plasmic authentication required");
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining("Partial Plasmic auth env vars")
    );
  });

  it("falls back to .plasmic.auth file when env vars missing", () => {
    const mockReadFileSync = jest.fn((filePath: any) => {
      if (String(filePath).endsWith(".plasmic.auth")) {
        return JSON.stringify({
          host: "https://file-host.example.com",
          user: "fileUser",
          token: "fileToken",
        });
      }
      throw new Error("ENOENT");
    });

    const getAuth = loadGetAuthWithMocks(
      mockReadFileSync,
      jest.fn(() => "/mock/home")
    );
    const auth = getAuth();
    expect(auth.host).toBe("https://file-host.example.com");
    expect(auth.user).toBe("fileUser");
    expect(auth.token).toBe("fileToken");
  });

  it("strips trailing slashes from file-based host", () => {
    const mockReadFileSync = jest.fn((filePath: any) => {
      if (String(filePath).endsWith(".plasmic.auth")) {
        return JSON.stringify({
          host: "https://file-host.example.com///",
          user: "fileUser",
          token: "fileToken",
        });
      }
      throw new Error("ENOENT");
    });

    const getAuth = loadGetAuthWithMocks(
      mockReadFileSync,
      jest.fn(() => "/mock/home")
    );
    const auth = getAuth();
    expect(auth.host).toBe("https://file-host.example.com");
  });

  it("skips auth file with incomplete fields", () => {
    const mockReadFileSync = jest.fn((filePath: any) => {
      if (String(filePath).endsWith(".plasmic.auth")) {
        // Missing token field
        return JSON.stringify({ host: "https://example.com", user: "u" });
      }
      throw new Error("ENOENT");
    });

    const getAuth = loadGetAuthWithMocks(
      mockReadFileSync,
      jest.fn(() => "/mock/home")
    );
    expect(() => getAuth()).toThrow("Plasmic authentication required");
  });

  it("throws descriptive error when no auth source available", () => {
    const getAuth = loadGetAuthWithMocks(
      jest.fn(() => { throw new Error("ENOENT"); }),
      jest.fn(() => "/mock/home")
    );
    expect(() => getAuth()).toThrow("Plasmic authentication required");
    expect(() => getAuth()).toThrow("PLASMIC_AUTH_HOST");
    expect(() => getAuth()).toThrow("PLASMIC_AUTH_USER");
    expect(() => getAuth()).toThrow("PLASMIC_AUTH_TOKEN");
  });
});
