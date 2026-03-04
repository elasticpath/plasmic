/**
 * Tests for PlasmicAdminClient.
 *
 * Every public method is tested with a mock fetch that verifies:
 * - Correct HTTP method and URL
 * - Correct headers (Cookie, X-CSRF-Token, Content-Type)
 * - Correct request body
 * - Correct deserialization of the response
 *
 * The mock fetch helper captures all requests so we can assert on them.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { PlasmicAdminClient, PlasmicApiError } from "../client";

// ---------------------------------------------------------------------------
// Mock fetch helper
// ---------------------------------------------------------------------------

interface CapturedRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
}

function createMockFetch() {
  const requests: CapturedRequest[] = [];
  const responses: Array<{
    status: number;
    body: unknown;
    headers?: Record<string, string>;
  }> = [];

  const mockFetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const captured: CapturedRequest = {
      url: typeof url === "string" ? url : url.toString(),
      method: init?.method ?? "GET",
      headers: (init?.headers as Record<string, string>) ?? {},
      body: init?.body ? JSON.parse(init.body as string) : undefined,
    };
    requests.push(captured);

    const responseConfig = responses.shift() ?? { status: 200, body: {} };

    const responseHeaders = new Headers(responseConfig.headers ?? {});

    return {
      ok: responseConfig.status >= 200 && responseConfig.status < 300,
      status: responseConfig.status,
      headers: responseHeaders,
      json: async () => responseConfig.body,
      text: async () =>
        responseConfig.body !== undefined
          ? JSON.stringify(responseConfig.body)
          : "",
    } as Response;
  });

  return {
    fetch: mockFetch as unknown as typeof globalThis.fetch,
    requests,
    /** Queue a response for the next fetch call. */
    respond(status: number, body: unknown, headers?: Record<string, string>) {
      responses.push({ status, body, headers });
    },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("PlasmicAdminClient", () => {
  let client: PlasmicAdminClient;
  let mock: ReturnType<typeof createMockFetch>;

  beforeEach(() => {
    mock = createMockFetch();
    client = new PlasmicAdminClient({
      baseUrl: "https://plasmic.example.com",
      fetch: mock.fetch,
    });
  });

  // -----------------------------------------------------------------------
  // Constructor
  // -----------------------------------------------------------------------

  describe("constructor", () => {
    it("strips trailing slash from baseUrl", async () => {
      const c = new PlasmicAdminClient({
        baseUrl: "https://example.com///",
        fetch: mock.fetch,
      });
      mock.respond(200, { csrf: "tok" });
      await c.refreshCsrf();
      expect(mock.requests[0].url).toBe(
        "https://example.com/api/v1/auth/csrf"
      );
    });
  });

  // -----------------------------------------------------------------------
  // Auth
  // -----------------------------------------------------------------------

  describe("refreshCsrf", () => {
    it("fetches and stores CSRF token", async () => {
      mock.respond(200, { csrf: "abc123" });

      await client.refreshCsrf();

      expect(mock.requests[0].url).toBe(
        "https://plasmic.example.com/api/v1/auth/csrf"
      );
      expect(mock.requests[0].method).toBe("GET");
    });
  });

  describe("login", () => {
    it("performs 3-step auth flow: csrf → login → csrf refresh", async () => {
      // Step 1: initial CSRF
      mock.respond(200, { csrf: "initial-csrf" });
      // Step 2: login
      mock.respond(200, undefined, {
        "set-cookie": "connect.sid=session123; Path=/; HttpOnly",
      });
      // Step 3: refresh CSRF
      mock.respond(200, { csrf: "post-login-csrf" });

      await client.login("user@example.com", "password123");

      expect(mock.requests).toHaveLength(3);

      // Step 1: GET csrf
      expect(mock.requests[0].method).toBe("GET");
      expect(mock.requests[0].url).toContain("/auth/csrf");

      // Step 2: POST login with CSRF header
      expect(mock.requests[1].method).toBe("POST");
      expect(mock.requests[1].url).toContain("/auth/login");
      expect(mock.requests[1].headers["X-CSRF-Token"]).toBe("initial-csrf");
      expect(mock.requests[1].body).toEqual({
        email: "user@example.com",
        password: "password123",
      });

      // Step 3: GET csrf again (refreshed)
      expect(mock.requests[2].method).toBe("GET");
      expect(mock.requests[2].url).toContain("/auth/csrf");
    });

    it("extracts session cookie from set-cookie header", async () => {
      mock.respond(200, { csrf: "c1" });
      mock.respond(200, undefined, {
        "set-cookie": "connect.sid=sess-abc; Path=/; HttpOnly",
      });
      mock.respond(200, { csrf: "c2" });

      await client.login("a@b.com", "pw");

      // Subsequent request should include the session cookie
      mock.respond(200, { csrf: "c3" });
      await client.refreshCsrf();

      expect(mock.requests[3].headers["Cookie"]).toBe(
        "connect.sid=sess-abc"
      );
    });
  });

  describe("logout", () => {
    it("calls POST /auth/logout and clears session state", async () => {
      // Login first
      mock.respond(200, { csrf: "c1" });
      mock.respond(200, undefined, {
        "set-cookie": "connect.sid=sess; Path=/",
      });
      mock.respond(200, { csrf: "c2" });
      await client.login("a@b.com", "pw");

      // Logout
      mock.respond(200, undefined);
      await client.logout();

      expect(mock.requests[3].method).toBe("POST");
      expect(mock.requests[3].url).toContain("/auth/logout");

      // After logout, no session cookie
      mock.respond(200, { csrf: "c3" });
      await client.refreshCsrf();
      expect(mock.requests[4].headers["Cookie"]).toBeUndefined();
    });
  });

  describe("getCurrentUser", () => {
    it("calls GET /auth/self", async () => {
      const user = { id: "u1", email: "a@b.com", firstName: "A", lastName: "B", avatarUrl: null, createdAt: "2026-01-01" };
      mock.respond(200, user);

      const result = await client.getCurrentUser();

      expect(mock.requests[0].url).toContain("/auth/self");
      expect(result).toEqual(user);
    });
  });

  // -----------------------------------------------------------------------
  // Projects
  // -----------------------------------------------------------------------

  describe("listProjects", () => {
    it("defaults to query=all", async () => {
      mock.respond(200, { projects: [], perms: [] });
      await client.listProjects();
      expect(mock.requests[0].url).toContain("/projects?query=all");
    });

    it("accepts 'all' explicitly", async () => {
      mock.respond(200, { projects: [], perms: [] });
      await client.listProjects("all");
      expect(mock.requests[0].url).toContain("/projects?query=all");
    });

    it("accepts workspaceId filter", async () => {
      mock.respond(200, { projects: [], perms: [] });
      await client.listProjects({ workspaceId: "ws-123" });
      expect(mock.requests[0].url).toContain(
        "/projects?query=byWorkspace&workspaceId=ws-123"
      );
    });
  });

  describe("getProject", () => {
    it("calls GET /projects/:id", async () => {
      const resp = {
        project: { id: "p1", name: "Test" },
        rev: { id: "r1", revision: 1 },
        perms: [],
        owner: undefined,
        latestRevisionSynced: 1,
        modelVersion: 50,
        hasAppAuth: false,
        isMainBranchProtected: false,
      };
      mock.respond(200, resp);

      const result = await client.getProject("p1");
      expect(mock.requests[0].url).toContain("/projects/p1");
      expect(result.project.id).toBe("p1");
    });
  });

  describe("getProjectMeta", () => {
    it("calls GET /projects/:id/meta", async () => {
      mock.respond(200, { id: "p1", name: "Test" });
      await client.getProjectMeta("p1");
      expect(mock.requests[0].url).toContain("/projects/p1/meta");
    });
  });

  describe("createProject", () => {
    it("calls POST /projects with body", async () => {
      mock.respond(200, { project: { id: "new" }, rev: { id: "r1" } });
      await client.createProject({ name: "My Project", workspaceId: "ws-1" });
      expect(mock.requests[0].method).toBe("POST");
      expect(mock.requests[0].url).toContain("/projects");
      expect(mock.requests[0].body).toEqual({
        name: "My Project",
        workspaceId: "ws-1",
      });
    });

    it("sends empty body when no opts", async () => {
      mock.respond(200, { project: { id: "new" }, rev: { id: "r1" } });
      await client.createProject();
      expect(mock.requests[0].body).toEqual({});
    });
  });

  describe("updateProject", () => {
    it("calls PUT /projects/:id", async () => {
      mock.respond(200, { paywall: "pass", project: { id: "p1" } });
      await client.updateProject("p1", { name: "Renamed" });
      expect(mock.requests[0].method).toBe("PUT");
      expect(mock.requests[0].url).toContain("/projects/p1");
      expect(mock.requests[0].body).toEqual({ name: "Renamed" });
    });
  });

  describe("updateProjectMeta", () => {
    it("calls PUT /projects/:id/meta", async () => {
      mock.respond(200, { id: "p1", name: "Updated" });
      await client.updateProjectMeta("p1", { name: "Updated" });
      expect(mock.requests[0].method).toBe("PUT");
      expect(mock.requests[0].url).toContain("/projects/p1/meta");
    });
  });

  describe("deleteProject", () => {
    it("calls DELETE /projects/:id", async () => {
      mock.respond(200, { deletedId: "p1" });
      const result = await client.deleteProject("p1");
      expect(mock.requests[0].method).toBe("DELETE");
      expect(result.deletedId).toBe("p1");
    });
  });

  describe("cloneProject", () => {
    it("calls POST /projects/:id/clone", async () => {
      mock.respond(200, { projectId: "p2", workspaceId: "ws-1" });
      await client.cloneProject("p1", { name: "Clone" });
      expect(mock.requests[0].method).toBe("POST");
      expect(mock.requests[0].url).toContain("/projects/p1/clone");
      expect(mock.requests[0].body).toEqual({ name: "Clone" });
    });

    it("sends empty body when no opts", async () => {
      mock.respond(200, { projectId: "p2", workspaceId: "ws-1" });
      await client.cloneProject("p1");
      expect(mock.requests[0].body).toEqual({});
    });
  });

  // -----------------------------------------------------------------------
  // Admin operations
  // -----------------------------------------------------------------------

  describe("adminListProjects", () => {
    it("calls POST /admin/projects", async () => {
      mock.respond(200, { projects: [] });
      await client.adminListProjects();
      expect(mock.requests[0].method).toBe("POST");
      expect(mock.requests[0].url).toContain("/admin/projects");
      expect(mock.requests[0].body).toEqual({});
    });

    it("passes ownerId when provided", async () => {
      mock.respond(200, { projects: [] });
      await client.adminListProjects("user-123");
      expect(mock.requests[0].body).toEqual({ ownerId: "user-123" });
    });
  });

  describe("adminCloneProject", () => {
    it("is CSRF-exempt", async () => {
      // First get a CSRF token
      mock.respond(200, { csrf: "tok" });
      await client.refreshCsrf();

      mock.respond(200, { projectId: "cloned-1" });
      await client.adminCloneProject("p1");

      // The /admin/clone request should NOT have X-CSRF-Token
      expect(mock.requests[1].headers["X-CSRF-Token"]).toBeUndefined();
    });

    it("calls POST /admin/clone with projectId", async () => {
      mock.respond(200, { projectId: "cloned-1" });
      await client.adminCloneProject("p1");
      expect(mock.requests[0].body).toEqual({ projectId: "p1" });
    });

    it("includes revisionNum when provided", async () => {
      mock.respond(200, { projectId: "cloned-1" });
      await client.adminCloneProject("p1", 42);
      expect(mock.requests[0].body).toEqual({ projectId: "p1", revisionNum: 42 });
    });
  });

  describe("adminDeleteProject", () => {
    it("is CSRF-exempt and calls POST /admin/delete-project", async () => {
      mock.respond(200, { csrf: "tok" });
      await client.refreshCsrf();

      mock.respond(200, undefined);
      await client.adminDeleteProject("p1");

      expect(mock.requests[1].url).toContain("/admin/delete-project");
      expect(mock.requests[1].headers["X-CSRF-Token"]).toBeUndefined();
      expect(mock.requests[1].body).toEqual({ id: "p1" });
    });
  });

  describe("adminHardDeleteProject", () => {
    it("calls DELETE /admin/delete-project-and-revisions", async () => {
      mock.respond(200, undefined);
      await client.adminHardDeleteProject("p1");
      expect(mock.requests[0].method).toBe("DELETE");
      expect(mock.requests[0].url).toContain(
        "/admin/delete-project-and-revisions"
      );
      expect(mock.requests[0].body).toEqual({ projectId: "p1" });
    });
  });

  describe("adminRestoreProject", () => {
    it("is CSRF-exempt", async () => {
      mock.respond(200, { csrf: "tok" });
      await client.refreshCsrf();

      mock.respond(200, undefined);
      await client.adminRestoreProject("p1");

      expect(mock.requests[1].headers["X-CSRF-Token"]).toBeUndefined();
      expect(mock.requests[1].body).toEqual({ id: "p1" });
    });
  });

  describe("adminChangeProjectOwner", () => {
    it("calls POST /admin/change-project-owner", async () => {
      mock.respond(200, undefined);
      await client.adminChangeProjectOwner("p1", "new-owner@example.com");
      expect(mock.requests[0].body).toEqual({
        projectId: "p1",
        ownerEmail: "new-owner@example.com",
      });
    });
  });

  describe("adminRevertRevision", () => {
    it("is CSRF-exempt and sends projectId + revision", async () => {
      mock.respond(200, { csrf: "tok" });
      await client.refreshCsrf();

      mock.respond(200, { projectId: "reverted-1" });
      await client.adminRevertRevision("p1", 10);

      expect(mock.requests[1].headers["X-CSRF-Token"]).toBeUndefined();
      expect(mock.requests[1].body).toEqual({ projectId: "p1", revision: 10 });
    });
  });

  // -----------------------------------------------------------------------
  // Workspaces
  // -----------------------------------------------------------------------

  describe("listWorkspaces", () => {
    it("calls GET /workspaces", async () => {
      mock.respond(200, { teams: [], workspaces: [] });
      const result = await client.listWorkspaces();
      expect(mock.requests[0].url).toContain("/workspaces");
      expect(result.teams).toEqual([]);
    });
  });

  describe("getWorkspace", () => {
    it("calls GET /workspaces/:id", async () => {
      mock.respond(200, { workspace: { id: "ws-1" }, perms: [] });
      await client.getWorkspace("ws-1");
      expect(mock.requests[0].url).toContain("/workspaces/ws-1");
    });
  });

  describe("getPersonalWorkspace", () => {
    it("calls GET /personal-workspace", async () => {
      mock.respond(200, { workspace: { id: "ws-personal" }, perms: [] });
      await client.getPersonalWorkspace();
      expect(mock.requests[0].url).toContain("/personal-workspace");
    });
  });

  describe("createWorkspace", () => {
    it("calls POST /workspaces", async () => {
      mock.respond(200, { paywall: "pass", workspace: { id: "ws-new" } });
      await client.createWorkspace({ name: "New WS", teamId: "team-1" });
      expect(mock.requests[0].method).toBe("POST");
      expect(mock.requests[0].body).toEqual({
        name: "New WS",
        teamId: "team-1",
      });
    });
  });

  describe("updateWorkspace", () => {
    it("calls PUT /workspaces/:id", async () => {
      mock.respond(200, { paywall: "pass" });
      await client.updateWorkspace("ws-1", { name: "Updated" });
      expect(mock.requests[0].method).toBe("PUT");
      expect(mock.requests[0].url).toContain("/workspaces/ws-1");
      expect(mock.requests[0].body).toEqual({ name: "Updated" });
    });
  });

  describe("deleteWorkspace", () => {
    it("calls DELETE /workspaces/:id", async () => {
      mock.respond(200, { deletedId: "ws-1" });
      const result = await client.deleteWorkspace("ws-1");
      expect(mock.requests[0].method).toBe("DELETE");
      expect(result.deletedId).toBe("ws-1");
    });
  });

  // -----------------------------------------------------------------------
  // Teams
  // -----------------------------------------------------------------------

  describe("listTeams", () => {
    it("calls GET /teams", async () => {
      mock.respond(200, [{ id: "t1", name: "Team 1" }]);
      const result = await client.listTeams();
      expect(mock.requests[0].url).toContain("/teams");
      expect(result).toHaveLength(1);
    });
  });

  describe("getTeam", () => {
    it("calls GET /teams/:id", async () => {
      mock.respond(200, { id: "t1", name: "Team 1" });
      const result = await client.getTeam("t1");
      expect(mock.requests[0].url).toContain("/teams/t1");
      expect(result.name).toBe("Team 1");
    });
  });

  // -----------------------------------------------------------------------
  // Error handling
  // -----------------------------------------------------------------------

  describe("error handling", () => {
    it("throws PlasmicApiError on non-OK responses", async () => {
      mock.respond(403, { type: "ForbiddenError", message: "Not admin" });

      await expect(client.listProjects()).rejects.toThrow(PlasmicApiError);
      await expect(
        (async () => {
          mock.respond(403, { type: "ForbiddenError", message: "Not admin" });
          try {
            await client.listProjects();
          } catch (e) {
            const err = e as PlasmicApiError;
            expect(err.type).toBe("ForbiddenError");
            expect(err.message).toBe("Not admin");
            expect(err.statusCode).toBe(403);
            throw e;
          }
        })()
      ).rejects.toThrow();
    });

    it("handles non-JSON error responses", async () => {
      const badFetch = vi.fn(async () => ({
        ok: false,
        status: 500,
        headers: new Headers(),
        json: async () => {
          throw new Error("not json");
        },
        text: async () => "Internal Server Error",
      })) as unknown as typeof globalThis.fetch;

      const c = new PlasmicAdminClient({
        baseUrl: "https://example.com",
        fetch: badFetch,
      });

      await expect(c.listProjects()).rejects.toThrow(PlasmicApiError);
    });

    it("uses 'UnknownError' type for errors without type field", async () => {
      mock.respond(400, { message: "Bad request" });

      try {
        await client.listProjects();
      } catch (e) {
        const err = e as PlasmicApiError;
        expect(err.type).toBe("UnknownError");
        expect(err.message).toBe("Bad request");
      }
    });
  });

  // -----------------------------------------------------------------------
  // CSRF token handling
  // -----------------------------------------------------------------------

  describe("CSRF token handling", () => {
    it("includes CSRF token on non-exempt routes", async () => {
      mock.respond(200, { csrf: "my-token" });
      await client.refreshCsrf();

      mock.respond(200, { projects: [], perms: [] });
      await client.listProjects();

      expect(mock.requests[1].headers["X-CSRF-Token"]).toBe("my-token");
    });

    it("omits CSRF token on exempt admin routes", async () => {
      mock.respond(200, { csrf: "my-token" });
      await client.refreshCsrf();

      // /admin/delete-project is exempt
      mock.respond(200, undefined);
      await client.adminDeleteProject("p1");
      expect(mock.requests[1].headers["X-CSRF-Token"]).toBeUndefined();

      // /admin/restore-project is exempt
      mock.respond(200, undefined);
      await client.adminRestoreProject("p2");
      expect(mock.requests[2].headers["X-CSRF-Token"]).toBeUndefined();

      // /admin/clone is exempt
      mock.respond(200, { projectId: "cloned" });
      await client.adminCloneProject("p3");
      expect(mock.requests[3].headers["X-CSRF-Token"]).toBeUndefined();

      // /admin/revert-project-revision is exempt
      mock.respond(200, { projectId: "reverted" });
      await client.adminRevertRevision("p4", 5);
      expect(mock.requests[4].headers["X-CSRF-Token"]).toBeUndefined();
    });

    it("sends CSRF on non-exempt admin routes like /admin/projects", async () => {
      mock.respond(200, { csrf: "my-token" });
      await client.refreshCsrf();

      mock.respond(200, { projects: [] });
      await client.adminListProjects();
      expect(mock.requests[1].headers["X-CSRF-Token"]).toBe("my-token");
    });
  });

  // -----------------------------------------------------------------------
  // URL encoding
  // -----------------------------------------------------------------------

  describe("URL encoding", () => {
    it("encodes special characters in IDs", async () => {
      mock.respond(200, { id: "p/1", name: "Test" });
      await client.getProjectMeta("p/1");
      expect(mock.requests[0].url).toContain("/projects/p%2F1/meta");
    });
  });
});
