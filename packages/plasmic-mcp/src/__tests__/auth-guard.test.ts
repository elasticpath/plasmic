/**
 * Unit tests for auth-guard.ts — auth enforcement with context-aware messages.
 *
 * The auth guard is called by tool handlers to ensure the API client is
 * authenticated before making API calls. Returns the client if authenticated,
 * throws a descriptive error with client-specific instructions if not.
 */

import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import { requireAuth, getAuthErrorMessage } from "../auth-guard.js";

describe("requireAuth", () => {
  const savedEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...savedEnv };
    delete process.env.PLASMIC_MCP_CLIENT;
  });

  afterEach(() => {
    process.env = savedEnv;
  });

  it("returns the client when non-null", () => {
    const fakeClient = { getAuth: () => ({ host: "h", user: "u", token: "t" }) };
    const result = requireAuth(fakeClient as any);
    expect(result).toBe(fakeClient);
  });

  it("throws with CLI-specific message when null and no PLASMIC_MCP_CLIENT", () => {
    expect(() => requireAuth(null)).toThrow("plasmic-mcp auth");
  });

  it("throws with Desktop-specific message when PLASMIC_MCP_CLIENT=desktop", () => {
    process.env.PLASMIC_MCP_CLIENT = "desktop";
    expect(() => requireAuth(null)).toThrow("extension settings");
  });
});

describe("getAuthErrorMessage", () => {
  it("returns CLI instructions by default", () => {
    const msg = getAuthErrorMessage();
    expect(msg).toContain("plasmic-mcp auth");
    expect(msg).toContain("PLASMIC_AUTH");
  });

  it("returns Desktop instructions for desktop client", () => {
    const msg = getAuthErrorMessage("desktop");
    expect(msg).toContain("extension settings");
    expect(msg).not.toContain("plasmic-mcp auth");
  });

  it("includes actionable steps", () => {
    const msg = getAuthErrorMessage();
    expect(msg).toContain("Visual Builder");
  });
});
