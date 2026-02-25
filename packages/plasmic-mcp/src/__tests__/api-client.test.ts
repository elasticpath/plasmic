/**
 * Unit tests for api-client.ts
 *
 * The API client is the only code that talks to the Plasmic server over HTTP.
 * Tests verify correct URL construction, auth headers, request body serialization,
 * and error handling — all critical for a stable MCP server that surfaces
 * meaningful error messages to Claude and the developer.
 */

import { PlasmicApiClient } from "../api-client";
import type { AuthConfig } from "../types";

/** Returns a minimal Headers-like object that satisfies storeCookies(). */
function mockHeaders(setCookies: string[] = []) {
  return {
    getSetCookie: () => setCookies,
  };
}

describe("PlasmicApiClient", () => {
  const auth: AuthConfig = {
    host: "https://studio.example.com",
    user: "test-user",
    token: "test-token",
  };
  let client: PlasmicApiClient;
  let mockFetch: jest.Mock;

  beforeEach(() => {
    mockFetch = jest.fn();
    global.fetch = mockFetch;
    client = new PlasmicApiClient(auth);
    jest.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("listProjects", () => {
    it("makes GET request to /api/v1/projects?query=all", async () => {
      const mockResponse = {
        projects: [{ id: "proj1", name: "Test Project" }],
        perms: [],
      };
      mockFetch.mockResolvedValue({
        ok: true,
        headers: mockHeaders(),
        json: () => Promise.resolve(mockResponse),
      });

      const result = await client.listProjects();

      expect(mockFetch).toHaveBeenCalledWith(
        "https://studio.example.com/api/v1/projects?query=all",
        expect.objectContaining({
          method: "GET",
          headers: expect.objectContaining({
            "x-plasmic-api-user": "test-user",
            "x-plasmic-api-token": "test-token",
            "Content-Type": "application/json",
          }),
        })
      );
      expect(result).toEqual(mockResponse);
    });
  });

  describe("getProjectBundle", () => {
    it("makes GET request with encoded project ID", async () => {
      const mockResponse = {
        rev: { data: "{}", revision: 1 },
        project: { id: "proj1", name: "Test" },
      };
      mockFetch.mockResolvedValue({
        ok: true,
        headers: mockHeaders(),
        json: () => Promise.resolve(mockResponse),
      });

      await client.getProjectBundle("proj/with spaces");

      expect(mockFetch).toHaveBeenCalledWith(
        "https://studio.example.com/api/v1/projects/proj%2Fwith%20spaces",
        expect.objectContaining({ method: "GET" })
      );
    });

    it("returns the full bundle response", async () => {
      const bundleData = JSON.stringify({ map: {}, root: "0" });
      const mockResponse = {
        rev: { data: bundleData, revision: 5 },
        project: { id: "proj1", name: "My Project" },
      };
      mockFetch.mockResolvedValue({
        ok: true,
        headers: mockHeaders(),
        json: () => Promise.resolve(mockResponse),
      });

      const result = await client.getProjectBundle("proj1");

      expect(result.rev.data).toBe(bundleData);
      expect(result.project.name).toBe("My Project");
    });
  });

  describe("updateProject", () => {
    it("makes POST request with serialized body", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        headers: mockHeaders(),
        json: () => Promise.resolve({ success: true }),
      });

      const body = {
        newComponents: [
          { name: "TestPage", path: "/test", body: { type: "vbox" as const } },
        ],
      };
      await client.updateProject("proj1", body);

      expect(mockFetch).toHaveBeenCalledWith(
        "https://studio.example.com/api/v1/projects/proj1",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify(body),
        })
      );
    });

    it("does not include body for undefined body param", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        headers: mockHeaders(),
        json: () => Promise.resolve({}),
      });

      await client.updateProject("proj1", {} as any);

      // body should be JSON.stringify({}) = "{}"
      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ body: "{}" })
      );
    });
  });

  describe("auth headers", () => {
    it("includes basic auth header when credentials provided", async () => {
      const authWithBasic: AuthConfig = {
        ...auth,
        basicAuthUser: "basicUser",
        basicAuthPassword: "basicPass",
      };
      const clientWithBasic = new PlasmicApiClient(authWithBasic);

      mockFetch.mockResolvedValue({
        ok: true,
        headers: mockHeaders(),
        json: () => Promise.resolve({ projects: [], perms: [] }),
      });

      await clientWithBasic.listProjects();

      const expectedBasic = Buffer.from("basicUser:basicPass").toString(
        "base64"
      );
      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: `Basic ${expectedBasic}`,
          }),
        })
      );
    });

    it("does not include Authorization header without basic auth", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        headers: mockHeaders(),
        json: () => Promise.resolve({ projects: [], perms: [] }),
      });

      await client.listProjects();

      const callHeaders = mockFetch.mock.calls[0][1].headers;
      expect(callHeaders).not.toHaveProperty("Authorization");
    });
  });

  describe("error handling", () => {
    it("throws auth error on 403 response", async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 403,
        statusText: "Forbidden",
        headers: mockHeaders(),
      });

      await expect(client.listProjects()).rejects.toThrow(
        "Authentication failed"
      );
    });

    it("throws server error message when available in response body", async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 400,
        statusText: "Bad Request",
        headers: mockHeaders(),
        json: () =>
          Promise.resolve({ error: { message: "Invalid project ID" } }),
      });

      await expect(client.listProjects()).rejects.toThrow(
        "Invalid project ID"
      );
    });

    it("falls back to HTTP status when error body has no message", async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 500,
        statusText: "Internal Server Error",
        headers: mockHeaders(),
        json: () => Promise.resolve({}),
      });

      await expect(client.listProjects()).rejects.toThrow(
        "HTTP 500: Internal Server Error"
      );
    });

    it("falls back to HTTP status when response body is not JSON", async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 502,
        statusText: "Bad Gateway",
        headers: mockHeaders(),
        json: () => Promise.reject(new Error("not JSON")),
      });

      await expect(client.listProjects()).rejects.toThrow(
        "HTTP 502: Bad Gateway"
      );
    });

    it("throws network error with helpful message", async () => {
      mockFetch.mockRejectedValue(new Error("ECONNREFUSED"));

      await expect(client.listProjects()).rejects.toThrow(
        "Could not reach Plasmic API"
      );
      await expect(client.listProjects()).rejects.toThrow(
        "PLASMIC_AUTH_HOST"
      );
    });
  });
});
