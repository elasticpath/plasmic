/**
 * Integration smoke test for server.ts
 *
 * Verifies that createServer() wires up auth, API client, and tool registration
 * without throwing. The real McpServer is used (not mocked) so this validates
 * the full initialization path that runs on every server startup.
 *
 * Uses jest.resetModules() + dynamic require() because the esbuild jest
 * transform doesn't hoist jest.mock calls.
 */

describe("createServer", () => {
  const savedEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...savedEnv };
    process.env.PLASMIC_AUTH_HOST = "https://studio.example.com";
    process.env.PLASMIC_AUTH_USER = "test-user";
    process.env.PLASMIC_AUTH_TOKEN = "test-token";
    jest.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
    jest.resetModules();
  });

  afterAll(() => {
    process.env = savedEnv;
  });

  it("creates a server with all tools registered without throwing", () => {
    jest.resetModules();
    jest.mock("mobx", () => ({ configure: jest.fn() }));
    // Mock fs/os to prevent .plasmic.auth file fallback
    jest.mock("fs", () => ({
      readFileSync: () => { throw new Error("ENOENT"); },
    }));
    jest.mock("os", () => ({
      homedir: () => "/mock/home",
    }));

    const { createServer } = require("../server");
    const server = createServer();
    expect(server).toBeDefined();
  });

  it("throws when auth is not configured", () => {
    delete process.env.PLASMIC_AUTH_HOST;
    delete process.env.PLASMIC_AUTH_USER;
    delete process.env.PLASMIC_AUTH_TOKEN;

    jest.resetModules();
    jest.mock("mobx", () => ({ configure: jest.fn() }));
    jest.mock("fs", () => ({
      readFileSync: () => { throw new Error("ENOENT"); },
    }));
    jest.mock("os", () => ({
      homedir: () => "/mock/home",
    }));

    const { createServer } = require("../server");
    expect(() => createServer()).toThrow("Plasmic authentication required");
  });
});
