/**
 * Unit tests for the health-check tool.
 *
 * The health check returns server version and auth status without requiring
 * authentication, making it the one tool that works in unauthenticated mode.
 */

import { vi, describe, it, expect, beforeEach, afterEach, afterAll } from "vitest";

describe("health-check tool", () => {
  const savedEnv = { ...process.env };
  let client: any;

  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
    process.env = { ...savedEnv };
  });

  afterAll(() => {
    process.env = savedEnv;
  });

  async function setupServer(withAuth: boolean) {
    if (withAuth) {
      process.env.PLASMIC_AUTH_HOST = "https://useast.storefront.elasticpath.com";
      process.env.PLASMIC_AUTH_USER = "test@example.com";
      process.env.PLASMIC_AUTH_TOKEN = "test-token";
    } else {
      delete process.env.PLASMIC_AUTH_HOST;
      delete process.env.PLASMIC_AUTH_USER;
      delete process.env.PLASMIC_AUTH_TOKEN;
    }

    vi.resetModules();
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.doMock("mobx", () => {
      const mock = { configure: vi.fn() };
      return { ...mock, default: mock };
    });
    vi.doMock("fs", () => {
      const mock = {
        readFileSync: () => { throw new Error("ENOENT"); },
        writeFileSync: vi.fn(),
      };
      return { ...mock, default: mock };
    });
    vi.doMock("os", () => {
      const mock = { homedir: () => "/mock/home", tmpdir: () => "/tmp" };
      return { ...mock, default: mock };
    });

    const { createServer } = await import("../server");
    const mcpServer = createServer();

    const { InMemoryTransport } = await import("@modelcontextprotocol/sdk/inMemory.js");
    const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await mcpServer.connect(serverTransport);
    client = new Client({ name: "test-client", version: "1.0" });
    await client.connect(clientTransport);
  }

  it("returns version and authenticated status when auth is present", async () => {
    await setupServer(true);

    const result = await client.callTool({
      name: "project",
      arguments: { action: "health-check" },
    });

    const text = (result.content as any[])[0]?.text;
    const parsed = JSON.parse(text);
    expect(parsed.status).toBe("ok");
    expect(parsed.authenticated).toBe(true);
    expect(parsed.host).toBe("https://useast.storefront.elasticpath.com");
    expect(parsed.version).toBeDefined();

    await client.close();
  });

  it("returns version and unauthenticated status when no auth", async () => {
    await setupServer(false);

    const result = await client.callTool({
      name: "project",
      arguments: { action: "health-check" },
    });

    const text = (result.content as any[])[0]?.text;
    const parsed = JSON.parse(text);
    expect(parsed.status).toBe("ok");
    expect(parsed.authenticated).toBe(false);
    expect(parsed.host).toBeUndefined();
    expect(parsed.version).toBeDefined();

    await client.close();
  });
});
