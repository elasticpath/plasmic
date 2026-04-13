/**
 * Structural validation tests for the .mcpb manifest.
 *
 * Ensures the Claude Desktop extension manifest has the correct format,
 * required user_config fields, sensitive marking on api_token, and proper
 * environment variable mapping.
 */

import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";

const MANIFEST_PATH = path.resolve(__dirname, "../../manifest.json");

describe("mcpb manifest", () => {
  let manifest: any;

  // Read manifest once for all tests
  try {
    manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf-8"));
  } catch {
    manifest = null;
  }

  it("exists and is valid JSON", () => {
    expect(manifest).not.toBeNull();
  });

  it("has manifest_version", () => {
    expect(manifest.manifest_version).toBeDefined();
  });

  it("has required user_config fields: host, email, api_token", () => {
    const fields = manifest.user_config;
    expect(fields).toBeDefined();
    expect(fields.host).toBeDefined();
    expect(fields.email).toBeDefined();
    expect(fields.api_token).toBeDefined();
  });

  it("marks api_token as sensitive", () => {
    expect(manifest.user_config.api_token.sensitive).toBe(true);
  });

  it("host has a default value pointing to US East", () => {
    expect(manifest.user_config.host.default).toBe(
      "https://useast.storefront.elasticpath.com"
    );
  });

  it("maps env vars correctly in server.mcp_config", () => {
    const env = manifest.server.mcp_config.env;
    expect(env.PLASMIC_AUTH_HOST).toBe("{{host}}");
    expect(env.PLASMIC_AUTH_USER).toBe("{{email}}");
    expect(env.PLASMIC_AUTH_TOKEN).toBe("{{api_token}}");
    expect(env.PLASMIC_MCP_CLIENT).toBe("desktop");
  });

  it("uses node server type", () => {
    expect(manifest.server.type).toBe("node");
  });
});
