/**
 * PlasmicAdminClient — standalone HTTP client for the Plasmic admin API.
 *
 * Uses session/cookie authentication (email + password) with CSRF tokens.
 * All methods use native fetch() so the client works in any browser or
 * Node 18+ environment without additional dependencies.
 */

import type {
  AdminCloneResponse,
  AdminProjectsResponse,
  ApiProject,
  ApiTeam,
  ApiUser,
  CloneProjectRequest,
  CloneProjectResponse,
  CreateProjectRequest,
  CreateProjectResponse,
  CreateWorkspaceRequest,
  CreateWorkspaceResponse,
  DeleteResponse,
  GetProjectResponse,
  GetWorkspaceResponse,
  ListProjectsResponse,
  ListWorkspacesResponse,
  PlasmicAdminClientConfig,
  UpdateProjectMetaRequest,
  UpdateProjectRequest,
  UpdateProjectResponse,
  UpdateWorkspaceRequest,
} from "./types";

// ---------------------------------------------------------------------------
// Error class
// ---------------------------------------------------------------------------

export class PlasmicApiError extends Error {
  constructor(
    public readonly type: string,
    message: string,
    public readonly statusCode: number
  ) {
    super(message);
    this.name = "PlasmicApiError";
  }
}

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

/**
 * CSRF-exempt admin routes that do not require X-CSRF-Token.
 * These are POST routes that the server explicitly exempts from CSRF checks.
 */
const CSRF_EXEMPT_PATHS = new Set([
  "/admin/delete-project",
  "/admin/restore-project",
  "/admin/clone",
  "/admin/revert-project-revision",
]);

export class PlasmicAdminClient {
  private readonly baseUrl: string;
  private readonly _fetch: typeof globalThis.fetch;

  /** Session cookie value (`connect.sid`). */
  private sessionCookie: string | null = null;

  /** CSRF token for mutating requests. */
  private csrfToken: string | null = null;

  constructor(config: PlasmicAdminClientConfig) {
    // Strip trailing slash
    this.baseUrl = config.baseUrl.replace(/\/+$/, "");
    this._fetch = config.fetch ?? globalThis.fetch.bind(globalThis);
  }

  // -----------------------------------------------------------------------
  // Internal request helper
  // -----------------------------------------------------------------------

  private async request<T>(
    method: string,
    path: string,
    body?: unknown
  ): Promise<T> {
    const url = `${this.baseUrl}/api/v1${path}`;

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };

    // Attach session cookie
    if (this.sessionCookie) {
      headers["Cookie"] = `connect.sid=${this.sessionCookie}`;
    }

    // Attach CSRF token for non-exempt routes
    if (this.csrfToken && !CSRF_EXEMPT_PATHS.has(path)) {
      headers["X-CSRF-Token"] = this.csrfToken;
    }

    const response = await this._fetch(url, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });

    // Extract set-cookie for session management (Node environments)
    this.extractSessionCookie(response);

    if (!response.ok) {
      let errorBody: { type?: string; message?: string } = {};
      try {
        errorBody = await response.json();
      } catch {
        // Non-JSON error response
      }
      throw new PlasmicApiError(
        errorBody.type ?? "UnknownError",
        errorBody.message ?? `HTTP ${response.status}`,
        response.status
      );
    }

    const text = await response.text();
    if (!text) return undefined as T;
    return JSON.parse(text) as T;
  }

  /**
   * Extract connect.sid from set-cookie headers. In Node (non-browser)
   * environments, cookies aren't managed automatically, so we parse them.
   */
  private extractSessionCookie(response: Response): void {
    const setCookie = response.headers.get("set-cookie");
    if (!setCookie) return;

    const match = setCookie.match(/connect\.sid=([^;]+)/);
    if (match) {
      this.sessionCookie = match[1];
    }
  }

  // -----------------------------------------------------------------------
  // Auth
  // -----------------------------------------------------------------------

  /** Fetch a fresh CSRF token from the server. */
  async refreshCsrf(): Promise<void> {
    const data = await this.request<{ csrf: string }>("GET", "/auth/csrf");
    this.csrfToken = data.csrf;
  }

  /**
   * Log in with email and password. Stores session cookie and refreshes
   * the CSRF token automatically.
   */
  async login(email: string, password: string): Promise<void> {
    // Step 1: Get initial CSRF token
    await this.refreshCsrf();

    // Step 2: POST login with CSRF
    await this.request<void>("POST", "/auth/login", { email, password });

    // Step 3: Refresh CSRF token (changes after login)
    await this.refreshCsrf();
  }

  /** Log out — clears session cookie and CSRF token. */
  async logout(): Promise<void> {
    await this.request<void>("POST", "/auth/logout");
    this.sessionCookie = null;
    this.csrfToken = null;
  }

  /** Get the currently authenticated user. */
  async getCurrentUser(): Promise<ApiUser> {
    return this.request<ApiUser>("GET", "/auth/self");
  }

  // -----------------------------------------------------------------------
  // Projects
  // -----------------------------------------------------------------------

  /** List all projects, or projects in a specific workspace. */
  async listProjects(
    query?: "all" | { workspaceId: string }
  ): Promise<ListProjectsResponse> {
    if (query && typeof query === "object") {
      return this.request<ListProjectsResponse>(
        "GET",
        `/projects?query=byWorkspace&workspaceId=${encodeURIComponent(query.workspaceId)}`
      );
    }
    return this.request<ListProjectsResponse>("GET", "/projects?query=all");
  }

  /** Get full project details including revision. */
  async getProject(projectId: string): Promise<GetProjectResponse> {
    return this.request<GetProjectResponse>(
      "GET",
      `/projects/${encodeURIComponent(projectId)}`
    );
  }

  /** Get project metadata only (no revision data). */
  async getProjectMeta(projectId: string): Promise<ApiProject> {
    return this.request<ApiProject>(
      "GET",
      `/projects/${encodeURIComponent(projectId)}/meta`
    );
  }

  /** Create a new project. */
  async createProject(
    opts?: CreateProjectRequest
  ): Promise<CreateProjectResponse> {
    return this.request<CreateProjectResponse>("POST", "/projects", opts ?? {});
  }

  /** Update project settings. */
  async updateProject(
    projectId: string,
    updates: UpdateProjectRequest
  ): Promise<UpdateProjectResponse> {
    return this.request<UpdateProjectResponse>(
      "PUT",
      `/projects/${encodeURIComponent(projectId)}`,
      updates
    );
  }

  /** Update project metadata (name, hostUrl, workspace, uiConfig). */
  async updateProjectMeta(
    projectId: string,
    updates: UpdateProjectMetaRequest
  ): Promise<ApiProject> {
    return this.request<ApiProject>(
      "PUT",
      `/projects/${encodeURIComponent(projectId)}/meta`,
      updates
    );
  }

  /** Delete a project (soft delete). */
  async deleteProject(projectId: string): Promise<DeleteResponse> {
    return this.request<DeleteResponse>(
      "DELETE",
      `/projects/${encodeURIComponent(projectId)}`
    );
  }

  /** Clone/duplicate a project. */
  async cloneProject(
    projectId: string,
    opts?: CloneProjectRequest
  ): Promise<CloneProjectResponse> {
    return this.request<CloneProjectResponse>(
      "POST",
      `/projects/${encodeURIComponent(projectId)}/clone`,
      opts ?? {}
    );
  }

  // -----------------------------------------------------------------------
  // Admin project operations
  // -----------------------------------------------------------------------

  /** List all projects (admin). Optionally filter by owner. */
  async adminListProjects(
    ownerId?: string
  ): Promise<AdminProjectsResponse> {
    return this.request<AdminProjectsResponse>(
      "POST",
      "/admin/projects",
      ownerId ? { ownerId } : {}
    );
  }

  /** Clone a project as admin, optionally at a specific revision. */
  async adminCloneProject(
    projectId: string,
    revisionNum?: number
  ): Promise<AdminCloneResponse> {
    return this.request<AdminCloneResponse>("POST", "/admin/clone", {
      projectId,
      ...(revisionNum !== undefined ? { revisionNum } : {}),
    });
  }

  /** Soft-delete a project as admin. */
  async adminDeleteProject(projectId: string): Promise<void> {
    await this.request<void>("POST", "/admin/delete-project", {
      id: projectId,
    });
  }

  /** Hard-delete a project and all its revisions as admin. */
  async adminHardDeleteProject(projectId: string): Promise<void> {
    await this.request<void>("DELETE", "/admin/delete-project-and-revisions", {
      projectId,
    });
  }

  /** Restore a soft-deleted project as admin. */
  async adminRestoreProject(projectId: string): Promise<void> {
    await this.request<void>("POST", "/admin/restore-project", {
      id: projectId,
    });
  }

  /** Change the owner of a project as admin. */
  async adminChangeProjectOwner(
    projectId: string,
    ownerEmail: string
  ): Promise<void> {
    await this.request<void>("POST", "/admin/change-project-owner", {
      projectId,
      ownerEmail,
    });
  }

  /** Revert a project to a specific revision as admin. */
  async adminRevertRevision(
    projectId: string,
    revision: number
  ): Promise<AdminCloneResponse> {
    return this.request<AdminCloneResponse>(
      "POST",
      "/admin/revert-project-revision",
      { projectId, revision }
    );
  }

  // -----------------------------------------------------------------------
  // Workspaces
  // -----------------------------------------------------------------------

  /** List all workspaces and teams. */
  async listWorkspaces(): Promise<ListWorkspacesResponse> {
    return this.request<ListWorkspacesResponse>("GET", "/workspaces");
  }

  /** Get a workspace by ID. */
  async getWorkspace(workspaceId: string): Promise<GetWorkspaceResponse> {
    return this.request<GetWorkspaceResponse>(
      "GET",
      `/workspaces/${encodeURIComponent(workspaceId)}`
    );
  }

  /** Get the current user's personal workspace. */
  async getPersonalWorkspace(): Promise<GetWorkspaceResponse> {
    return this.request<GetWorkspaceResponse>("GET", "/personal-workspace");
  }

  /** Create a workspace in a team. */
  async createWorkspace(
    opts: CreateWorkspaceRequest
  ): Promise<CreateWorkspaceResponse> {
    return this.request<CreateWorkspaceResponse>(
      "POST",
      "/workspaces",
      opts
    );
  }

  /** Update a workspace. */
  async updateWorkspace(
    workspaceId: string,
    updates: UpdateWorkspaceRequest
  ): Promise<CreateWorkspaceResponse> {
    return this.request<CreateWorkspaceResponse>(
      "PUT",
      `/workspaces/${encodeURIComponent(workspaceId)}`,
      updates
    );
  }

  /** Delete a workspace. */
  async deleteWorkspace(workspaceId: string): Promise<DeleteResponse> {
    return this.request<DeleteResponse>(
      "DELETE",
      `/workspaces/${encodeURIComponent(workspaceId)}`
    );
  }

  // -----------------------------------------------------------------------
  // Teams (supporting endpoints)
  // -----------------------------------------------------------------------

  /** List all teams the current user belongs to. */
  async listTeams(): Promise<ApiTeam[]> {
    return this.request<ApiTeam[]>("GET", "/teams");
  }

  /** Get a team by ID. */
  async getTeam(teamId: string): Promise<ApiTeam> {
    return this.request<ApiTeam>(
      "GET",
      `/teams/${encodeURIComponent(teamId)}`
    );
  }
}
