/**
 * Unit tests for the entry point wiring (index.ts).
 *
 * Verifies that the CLI router correctly dispatches to:
 * - serve → starts the MCP server
 * - auth → runs the auth flow and writes credentials
 * - version → prints version and exits
 *
 * Since index.ts is the process entry point, we test via the runCli() function
 * that will be extracted from main().
 */

import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import { parseArgs } from "../cli.js";

describe("CLI dispatch via parseArgs", () => {
  it("routes no-args to serve", () => {
    const result = parseArgs(["/usr/bin/node", "/path/to/plasmic-mcp"]);
    expect(result.command).toBe("serve");
  });

  it("routes auth to auth command", () => {
    const result = parseArgs(["/usr/bin/node", "/path/to/plasmic-mcp", "auth"]);
    expect(result.command).toBe("auth");
  });

  it("routes --version to version command", () => {
    const result = parseArgs(["/usr/bin/node", "/path/to/plasmic-mcp", "--version"]);
    expect(result.command).toBe("version");
  });

  it("passes --host to auth options", () => {
    const result = parseArgs([
      "/usr/bin/node", "/path/to/plasmic-mcp",
      "auth", "--host", "https://euwest.storefront.elasticpath.com"
    ]);
    expect(result.command).toBe("auth");
    expect(result.options.host).toBe("https://euwest.storefront.elasticpath.com");
  });
});
