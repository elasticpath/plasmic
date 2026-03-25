/**
 * HTTP client for the Plasmic REST API.
 *
 * Uses native fetch (Node 18+). Auth headers follow the same pattern as
 * packages/cli/src/api.ts — x-plasmic-api-user + x-plasmic-api-token.
 *
 * Maintains a cookie jar and CSRF token for session-aware requests
 * (required by the Plasmic server's lusca CSRF middleware for write operations).
 */

import type {
  AuthConfig,
  ListProjectsResponse,
  ProjectBundleResponse,
  SaveRevisionReq,
  UpdateProjectReq,
  UpdateProjectResponse,
  GetPkgByProjectIdResponse,
  GetPkgVersionResponse,
  GetPkgVersionMetaResponse,
  AppAuthPubConfig,
  AppConfigResponse,
  GetModelUpdatesResponse,
} from "./types.js";

/**
 * Structured API error with HTTP status code for precise error handling.
 * Extends Error so existing catch blocks and toThrow() assertions still work.
 */
export class PlasmicApiError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
    public readonly errorType?: string
  ) {
    super(message);
    this.name = "PlasmicApiError";
  }
}

/** Default request timeout in milliseconds (30 seconds). */
const DEFAULT_TIMEOUT_MS = 30_000;

export class PlasmicApiClient {
  private auth: AuthConfig;

  /** Accumulated cookies from server responses (simple key=value store). */
  private cookies: Map<string, string> = new Map();

  /** Cached CSRF token obtained from GET /api/v1/auth/csrf. */
  private csrfToken: string | undefined;

  /** Request timeout in milliseconds. */
  private timeoutMs: number;

  constructor(auth: AuthConfig, timeoutMs: number = DEFAULT_TIMEOUT_MS) {
    this.auth = auth;
    this.timeoutMs = timeoutMs;
  }

  /** Get the auth config. Used by socket client for connection auth headers. */
  getAuth(): AuthConfig {
    return this.auth;
  }

  private makeHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      "x-plasmic-api-user": this.auth.user,
      "x-plasmic-api-token": this.auth.token,
      "Content-Type": "application/json",
    };

    if (this.auth.basicAuthUser && this.auth.basicAuthPassword) {
      const basic = Buffer.from(
        `${this.auth.basicAuthUser}:${this.auth.basicAuthPassword}`
      ).toString("base64");
      headers["Authorization"] = `Basic ${basic}`;
    }

    // Include accumulated cookies for session continuity
    if (this.cookies.size > 0) {
      headers["Cookie"] = [...this.cookies.entries()]
        .map(([k, v]) => `${k}=${v}`)
        .join("; ");
    }

    // Include CSRF token if available
    if (this.csrfToken) {
      headers["x-csrf-token"] = this.csrfToken;
    }

    return headers;
  }

  /**
   * Extract and store cookies from Set-Cookie response headers.
   */
  private storeCookies(response: Response): void {
    const setCookieHeaders = response.headers.getSetCookie?.() ?? [];
    for (const header of setCookieHeaders) {
      // Parse "name=value; Path=/; ..." — we only need name=value
      const match = header.match(/^([^=]+)=([^;]*)/);
      if (match) {
        this.cookies.set(match[1], match[2]);
      }
    }
  }

  private async request<T>(
    method: string,
    urlPath: string,
    body?: unknown
  ): Promise<T> {
    const url = `${this.auth.host}${urlPath}`;
    const headers = this.makeHeaders();

    console.error(`[plasmic-mcp] ${method} ${url}`);

    let response: Response;
    try {
      response = await fetch(url, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
        redirect: "manual",
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (err: unknown) {
      if (err instanceof Error && err.name === "TimeoutError") {
        throw new Error(
          `Request to Plasmic API timed out after ${this.timeoutMs / 1000}s (${method} ${urlPath}). ` +
            `The server may be under heavy load. Try again in a moment.`
        );
      }
      throw new Error(
        `Could not reach Plasmic API at ${this.auth.host}. ` +
          `Check your network and PLASMIC_AUTH_HOST setting. (${err instanceof Error ? err.message : String(err)})`
      );
    }

    // Store cookies from every response for session continuity
    this.storeCookies(response);

    if (!response.ok) {
      if (response.status === 403) {
        throw new PlasmicApiError(
          "Authentication failed. Check your Plasmic API credentials " +
            "(PLASMIC_AUTH_USER and PLASMIC_AUTH_TOKEN).",
          403
        );
      }

      let errorMessage: string;
      let errorType: string | undefined;
      try {
        const errorBody = (await response.json()) as {
          error?: { message?: string; type?: string };
        };
        errorMessage =
          errorBody?.error?.message ??
          `HTTP ${response.status}: ${response.statusText}`;
        errorType = errorBody?.error?.type;
      } catch {
        errorMessage = `HTTP ${response.status}: ${response.statusText}`;
      }

      // Add actionable guidance for server errors
      if (response.status >= 500) {
        errorMessage =
          `Server error (HTTP ${response.status}): ${errorMessage}. ` +
          `This is a Plasmic server issue. Try again in a moment.`;
      }

      throw new PlasmicApiError(errorMessage, response.status, errorType);
    }

    return response.json() as Promise<T>;
  }

  /**
   * Fetch a CSRF token from the server. Must be called before write operations
   * that go through the lusca CSRF middleware (e.g., saveRevision).
   *
   * This establishes a session (via Set-Cookie) and returns a CSRF token
   * that must be sent as x-csrf-token in subsequent requests.
   */
  async ensureCsrfToken(): Promise<void> {
    if (this.csrfToken) {return;}

    console.error("[plasmic-mcp] Fetching CSRF token...");
    const result = await this.request<{ csrf: string }>(
      "GET",
      "/api/v1/auth/csrf"
    );
    this.csrfToken = result.csrf;
    console.error("[plasmic-mcp] CSRF token obtained");
  }

  /**
   * Get accumulated cookies as a header string for socket connections.
   * Reuses the same format as makeHeaders() (lines 80-84).
   */
  getCookieString(): string {
    if (this.cookies.size === 0) return "";
    return [...this.cookies.entries()]
      .map(([k, v]) => `${k}=${v}`)
      .join("; ");
  }

  /**
   * Clear accumulated cookies and cached CSRF token.
   * Called on project.set to prevent session state from one project
   * leaking into API calls for the next project.
   */
  clearSessionState(): void {
    this.cookies.clear();
    this.csrfToken = undefined;
  }

  async listProjects(): Promise<ListProjectsResponse> {
    try {
      return await this.request<ListProjectsResponse>(
        "GET",
        `/api/v1/projects?query=${encodeURIComponent(JSON.stringify("all"))}`
      );
    } catch (err: unknown) {
      // Add specific guidance for list-projects failures
      const hint =
        `Failed to list projects. ` +
        `Check that: (1) PLASMIC_AUTH_USER and PLASMIC_AUTH_TOKEN are correct, ` +
        `(2) the Plasmic server at ${this.auth.host} is reachable, ` +
        `(3) your API token has project access permissions.`;
      throw new Error(`${hint} Original error: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  async getProjectBundle(projectId: string): Promise<ProjectBundleResponse> {
    return this.request<ProjectBundleResponse>(
      "GET",
      `/api/v1/projects/${encodeURIComponent(projectId)}`
    );
  }

  async updateProject(
    projectId: string,
    body: UpdateProjectReq
  ): Promise<UpdateProjectResponse> {
    return this.request<UpdateProjectResponse>(
      "POST",
      `/api/v1/projects/${encodeURIComponent(projectId)}`,
      body
    );
  }

  /**
   * Fetch the latest bundle version from the server.
   * Matches Studio's SharedApi.getLastBundleVersion().
   * This is the authoritative version that must be used when calling
   * bundler.bundle() for full saves.
   */
  async getLastBundleVersion(): Promise<string> {
    const result = await this.request<{ latestBundleVersion: string }>(
      "GET",
      "/api/v1/latest-bundle-version"
    );
    return result.latestBundleVersion;
  }

  /**
   * Save an incremental or full revision to the Plasmic server.
   * URL: POST /api/v1/projects/{projectId}/revisions/{revisionNum}
   *
   * Automatically fetches a CSRF token if one hasn't been obtained yet,
   * since this endpoint requires CSRF validation.
   */
  async saveRevision(
    projectId: string,
    revisionNum: number,
    body: SaveRevisionReq
  ): Promise<unknown> {
    await this.ensureCsrfToken();
    return this.request<unknown>(
      "POST",
      `/api/v1/projects/${encodeURIComponent(projectId)}/revisions/${revisionNum}`,
      body
    );
  }

  /**
   * Get published package info for a project.
   * URL: GET /api/v1/projects/{projectId}/pkg
   * Returns { pkg: PkgInfo | undefined } — pkg is undefined if not published.
   */
  async getPkgByProjectId(projectId: string): Promise<GetPkgByProjectIdResponse> {
    return this.request<GetPkgByProjectIdResponse>(
      "GET",
      `/api/v1/projects/${encodeURIComponent(projectId)}/pkg`
    );
  }

  /**
   * Download a full PkgVersion bundle (model data + transitive dep bundles).
   * URL: GET /api/v1/pkgs/{pkgId}?version={version}&meta=false
   * Used by add-package to get the full bundle for unbundling.
   */
  async getPkgVersion(pkgId: string, version?: string): Promise<GetPkgVersionResponse> {
    const versionParam = version != null
      ? `version=${encodeURIComponent(JSON.stringify(version))}&`
      : "";
    return this.request<GetPkgVersionResponse>(
      "GET",
      `/api/v1/pkgs/${encodeURIComponent(pkgId)}?${versionParam}meta=false`
    );
  }

  /**
   * Get package version metadata (without full model data).
   * URL: GET /api/v1/pkgs/{pkgId}?version={version}&meta=true
   * Used by list-packages to check for available updates.
   */
  async getPkgVersionMeta(pkgId: string, version?: string): Promise<GetPkgVersionMetaResponse> {
    const versionParam = version != null
      ? `version=${encodeURIComponent(JSON.stringify(version))}&`
      : "";
    return this.request<GetPkgVersionMetaResponse>(
      "GET",
      `/api/v1/pkgs/${encodeURIComponent(pkgId)}?${versionParam}meta=true`
    );
  }

  /**
   * Get public auth config for a project (checks if app auth is enabled).
   * URL: GET /api/v1/end-user/app/{projectId}/pub-config
   * Used by add-package to block importing auth-enabled dependencies.
   */
  async getAppAuthPubConfig(projectId: string): Promise<AppAuthPubConfig> {
    return this.request<AppAuthPubConfig>(
      "GET",
      `/api/v1/end-user/app/${encodeURIComponent(projectId)}/pub-config`
    );
  }

  /**
   * Get the global app configuration, including the hostless package catalog.
   * URL: GET /api/v1/app-config
   * Used by list-available-packages to discover installable packages.
   */
  async getAppConfig(): Promise<AppConfigResponse> {
    return this.request<AppConfigResponse>(
      "GET",
      `/api/v1/app-config`
    );
  }

  /**
   * Fetch incremental model updates since a given revision.
   * URL: GET /api/v1/projects/{projectId}/updates?revisionNum=N&installedDeps=[...]
   *
   * Matches Studio's SharedApi.getModelUpdates(). Returns a discriminated union:
   * - { data: string, revision, depPkgs, deletedIids, modifiedComponentIids } — incremental update
   * - { needsReload: true } — full reload needed (schema/model diverged)
   * - { data: null } — no changes since revisionNum
   *
   * Used by the rebase engine (P0.4) to apply server changes to the local model.
   */
  async getModelUpdates(
    projectId: string,
    revisionNum: number,
    installedDeps: string[],
    branchId?: string
  ): Promise<GetModelUpdatesResponse> {
    const params = new URLSearchParams();
    params.set("revisionNum", String(revisionNum));
    params.set(
      "installedDeps",
      JSON.stringify(installedDeps)
    );
    if (branchId) {
      params.set("branchId", branchId);
    }
    return this.request<GetModelUpdatesResponse>(
      "GET",
      `/api/v1/projects/${encodeURIComponent(projectId)}/updates?${params.toString()}`
    );
  }
}
