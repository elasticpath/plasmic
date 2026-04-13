/**
 * Unit tests for cli.ts — CLI argument parser.
 *
 * The CLI router parses process.argv to determine which command to run:
 * - No args → serve (start MCP server)
 * - "auth" → authenticate
 * - "--version" → print version
 */

import { describe, it, expect } from "vitest";
import { parseArgs } from "../cli.js";

describe("parseArgs", () => {
  // argv[0] = node, argv[1] = script path, argv[2+] = user args
  const base = ["/usr/bin/node", "/path/to/plasmic-mcp"];

  it("defaults to serve when no args", () => {
    const result = parseArgs([...base]);
    expect(result.command).toBe("serve");
  });

  it("parses auth command", () => {
    const result = parseArgs([...base, "auth"]);
    expect(result.command).toBe("auth");
  });

  it("parses auth --host flag", () => {
    const result = parseArgs([...base, "auth", "--host", "https://useast.storefront.elasticpath.com"]);
    expect(result.command).toBe("auth");
    expect(result.options.host).toBe("https://useast.storefront.elasticpath.com");
  });

  it("parses --version flag", () => {
    const result = parseArgs([...base, "--version"]);
    expect(result.command).toBe("version");
  });

  it("defaults to serve on unknown command", () => {
    const result = parseArgs([...base, "unknown-thing"]);
    expect(result.command).toBe("serve");
  });
});
