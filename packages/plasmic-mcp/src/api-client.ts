/**
 * HTTP client for the Plasmic REST API.
 *
 * Transport pattern mirrors Studio's shared API class (wab/shared/):
 * - get(url, data) / post(url, data) helpers delegate to req()
 * - GET query params serialized identically to Studio's ajax():
 *   URLSearchParams(mapValues(omitUndefined(data), v => JSON.stringify(v)))
 * - POST body: JSON.stringify(data)
 *
 * MCP-specific concerns (auth headers, cookie jar, CSRF caching, timeout,
 * PlasmicApiError) are handled in req() — the browser client doesn't need these
 * because it uses session cookies, jQuery, and browser-managed cookies.
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

  /**
   * Core HTTP transport. Mirrors Studio's abstract req() but uses native
   * fetch with MCP-specific auth headers, cookie jar, and error handling.
   *
   * GET/DELETE query param serialization matches Studio's ajax() exactly:
   *   URLSearchParams(L.mapValues(L.omitBy(data, L.isUndefined), v => JSON.stringify(v)))
   *
   * Translated to vanilla JS (no lodash dependency):
   *   Object.entries(data).filter(not undefined).map([k, v] => [k, JSON.stringify(v)])
   */
  private async req(
    method: string,
    url: string,
    data?: Record<string, unknown>,
    opts?: { headers?: Record<string, string> }
  ): Promise<any> {
    // Auto-fetch CSRF token before write operations, matching Studio's
    // behavior where _headers() always includes the token (fetched at page load).
    if (method !== "get" && !url.includes("/auth/csrf")) {
      await this.ensureCsrfToken();
    }

    // Prepend host + /api/v1/ prefix (matches Studio's fullApiPath)
    const fullUrl = `${this.auth.host}/api/v1/${url.replace(/^\//, "")}`;

    // Build headers: auth + cookies + CSRF + any extras from opts
    const headers = { ...this.makeHeaders(), ...(opts?.headers ?? {}) };

    // GET/DELETE: serialize data as query params matching Studio's ajax() pattern
    let search = "";
    if ((method === "get" || method === "delete") && data) {
      const entries: string[][] = Object.entries(data)
        .filter(([, v]) => v !== undefined)
        .map(([k, v]) => [k, JSON.stringify(v)]);
      if (entries.length > 0) {
        search = "?" + new URLSearchParams(entries).toString();
      }
    }

    // POST/PUT: serialize data as JSON body
    const body =
      method === "get" || method === "delete"
        ? undefined
        : data
          ? JSON.stringify(data)
          : undefined;

    console.error(`[plasmic-mcp] ${method.toUpperCase()} ${fullUrl}${search}`);

    let response: Response;
    try {
      response = await fetch(fullUrl + search, {
        method: method.toUpperCase(),
        headers,
        body,
        redirect: "manual",
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (err: unknown) {
      if (err instanceof Error && err.name === "TimeoutError") {
        throw new Error(
          `Request to Plasmic API timed out after ${this.timeoutMs / 1000}s (${method.toUpperCase()} ${url}). ` +
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

    return response.json();
  }

  // ---------------------------------------------------------------------------
  // Transport helpers — mirror Studio.get() / Studio.post()
  // ---------------------------------------------------------------------------

  /**
   * Mirrors Studio.get(). URL is relative (e.g., "/projects").
   * Data object becomes GET query params via Studio's serialization pattern.
   */
  async get(url: string, data?: Record<string, unknown>): Promise<any> {
    return this.req("get", url, data);
  }

  /**
   * Mirrors Studio.post(). URL is relative, data becomes JSON body.
   */
  async post(url: string, data?: Record<string, unknown>): Promise<any> {
    return this.req("post", url, data);
  }

  /**
   * Mirrors Studio.put(). URL is relative, data becomes JSON body.
   */
  async put(url: string, data?: Record<string, unknown>): Promise<any> {
    return this.req("put", url, data);
  }

  /**
   * Mirrors Studio.delete(). URL is relative, data becomes query params.
   */
  async del(url: string, data?: Record<string, unknown>): Promise<any> {
    return this.req("delete", url, data);
  }

  // ---------------------------------------------------------------------------
  // Session management (MCP-only)
  // ---------------------------------------------------------------------------

  /**
   * Fetch a CSRF token from the server. Must be called before write operations
   * that go through the lusca CSRF middleware (e.g., saveRevision).
   *
   * Mirrors Studio.refreshCsrfToken() but caches to avoid re-fetching.
   */
  async ensureCsrfToken(): Promise<void> {
    if (this.csrfToken) {return;}

    console.error("[plasmic-mcp] Fetching CSRF token...");
    const result = await this.get("/auth/csrf") as { csrf: string };
    this.csrfToken = result.csrf;
    console.error("[plasmic-mcp] CSRF token obtained");
  }

  /**
   * Get accumulated cookies as a header string for socket connections.
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

  // ---------------------------------------------------------------------------
  // API methods — each mirrors Studio's implementation using get()/post()
  // ---------------------------------------------------------------------------

  /** Studio: getProjects({ query: "all" }) */
  async listProjects(): Promise<ListProjectsResponse> {
    try {
      return await this.get("/projects", { query: "all" }) as ListProjectsResponse;
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

  /** MCP-only — fetches full project bundle by ID */
  async getProjectBundle(projectId: string): Promise<ProjectBundleResponse> {
    return this.get(
      `/projects/${encodeURIComponent(projectId)}`
    ) as Promise<ProjectBundleResponse>;
  }

  /** MCP-only — updates project (create pages, etc.) */
  async updateProject(
    projectId: string,
    body: UpdateProjectReq
  ): Promise<UpdateProjectResponse> {
    return this.post(
      `/projects/${encodeURIComponent(projectId)}`,
      body as unknown as Record<string, unknown>
    ) as Promise<UpdateProjectResponse>;
  }

  /**
   * Fetch the latest bundle version from the server.
   * Studio: getLastBundleVersion() → { latestBundleVersion: string }
   * We unwrap to plain string for caller convenience.
   */
  async getLastBundleVersion(): Promise<string> {
    const result = await this.get("/latest-bundle-version") as {
      latestBundleVersion: string;
    };
    return result.latestBundleVersion;
  }

  /**
   * Save an incremental or full revision to the Plasmic server.
   * Studio: saveProjectRevChanges(projectId, rev)
   * CSRF handled automatically by req() for all write methods.
   */
  async saveRevision(
    projectId: string,
    revisionNum: number,
    body: SaveRevisionReq
  ): Promise<unknown> {
    return this.post(
      `/projects/${encodeURIComponent(projectId)}/revisions/${revisionNum}`,
      body as unknown as Record<string, unknown>
    );
  }

  /** Studio: getPkgByProjectId(projectId) */
  async getPkgByProjectId(projectId: string): Promise<GetPkgByProjectIdResponse> {
    return this.get(
      `/projects/${encodeURIComponent(projectId)}/pkg`
    ) as Promise<GetPkgByProjectIdResponse>;
  }

  /**
   * Studio: getPkgVersion(pkgId, version ?? "latest", meta: false)
   * Defaults version to "latest" when not provided, matching Studio.
   */
  async getPkgVersion(pkgId: string, version?: string): Promise<GetPkgVersionResponse> {
    return this.get(`/pkgs/${encodeURIComponent(pkgId)}`, {
      version: version ?? "latest",
      meta: false,
    }) as Promise<GetPkgVersionResponse>;
  }

  /**
   * Studio: getPkgVersionMeta(pkgId, version ?? "latest", meta: true)
   * Defaults version to "latest" when not provided, matching Studio.
   */
  async getPkgVersionMeta(pkgId: string, version?: string): Promise<GetPkgVersionMetaResponse> {
    return this.get(`/pkgs/${encodeURIComponent(pkgId)}`, {
      version: version ?? "latest",
      meta: true,
    }) as Promise<GetPkgVersionMetaResponse>;
  }

  /** Studio: getAppAuthPubConfig(appId) */
  async getAppAuthPubConfig(projectId: string): Promise<AppAuthPubConfig> {
    return this.get(
      `/end-user/app/${encodeURIComponent(projectId)}/pub-config`
    ) as Promise<AppAuthPubConfig>;
  }

  /** Studio: getAppConfig() */
  async getAppConfig(): Promise<AppConfigResponse> {
    return this.get("/app-config") as Promise<AppConfigResponse>;
  }

  /**
   * Fetch incremental model updates since a given revision.
   * Studio: getModelUpdates(projectId, revisionNum, installedDeps, branchId)
   */
  async getModelUpdates(
    projectId: string,
    revisionNum: number,
    installedDeps: string[],
    branchId?: string
  ): Promise<GetModelUpdatesResponse> {
    return this.get(`/projects/${encodeURIComponent(projectId)}/updates`, {
      revisionNum,
      installedDeps,
      ...(branchId ? { branchId } : {}),
    }) as Promise<GetModelUpdatesResponse>;
  }

  // ---------------------------------------------------------------------------
  // Branch management — mirrors Studio's branch methods
  // ---------------------------------------------------------------------------

  async listBranches(projectId: string): Promise<any> {
    return this.get(`/projects/${encodeURIComponent(projectId)}/branches`);
  }

  async createBranch(
    projectId: string,
    data: { name: string; sourceBranchId?: string; base?: "new" | "latest" }
  ): Promise<any> {
    return this.post(`/projects/${encodeURIComponent(projectId)}/branches`, data);
  }

  async updateBranch(
    projectId: string,
    branchId: string,
    data: { name?: string; status?: string }
  ): Promise<any> {
    return this.put(
      `/projects/${encodeURIComponent(projectId)}/branches/${encodeURIComponent(branchId)}`,
      data
    );
  }

  async deleteBranch(projectId: string, branchId: string): Promise<any> {
    return this.del(
      `/projects/${encodeURIComponent(projectId)}/branches/${encodeURIComponent(branchId)}`
    );
  }

  async tryMergeBranch(projectId: string, data: Record<string, unknown>): Promise<any> {
    return this.post(`/projects/${encodeURIComponent(projectId)}/merge`, data);
  }

  async setMainBranchProtection(projectId: string, isProtected: boolean): Promise<any> {
    return this.post(
      `/projects/${encodeURIComponent(projectId)}/main-branch-protection`,
      { protected: isProtected }
    );
  }

  async getRevisionInfo(
    projectId: string,
    revisionId?: string,
    branchId?: string
  ): Promise<any> {
    return this.get(`/projects/${encodeURIComponent(projectId)}/revision-without-data`, {
      ...(revisionId ? { revisionId } : {}),
      ...(branchId ? { branchId } : {}),
    });
  }

  // ---------------------------------------------------------------------------
  // Comments — mirrors Studio's comment methods
  // ---------------------------------------------------------------------------

  private projectBranchId(projectId: string, branchId?: string): string {
    return branchId ? `${projectId}:${branchId}` : projectId;
  }

  async getComments(projectId: string, branchId?: string): Promise<any> {
    return this.get(`/comments/${this.projectBranchId(projectId, branchId)}`);
  }

  async postRootComment(
    projectId: string,
    branchId: string | undefined,
    data: Record<string, unknown>
  ): Promise<any> {
    return this.post(`/comments/${this.projectBranchId(projectId, branchId)}`, data);
  }

  async postThreadComment(
    projectId: string,
    branchId: string | undefined,
    threadId: string,
    data: Record<string, unknown>
  ): Promise<any> {
    return this.post(
      `/comments/${this.projectBranchId(projectId, branchId)}/thread/${encodeURIComponent(threadId)}`,
      data
    );
  }

  async editComment(
    projectId: string,
    branchId: string | undefined,
    commentId: string,
    data: { body: string }
  ): Promise<any> {
    return this.put(
      `/comments/${this.projectBranchId(projectId, branchId)}/comment/${encodeURIComponent(commentId)}`,
      data
    );
  }

  async deleteComment(
    projectId: string,
    branchId: string | undefined,
    commentId: string
  ): Promise<any> {
    return this.del(
      `/comments/${this.projectBranchId(projectId, branchId)}/comment/${encodeURIComponent(commentId)}`
    );
  }

  async resolveThread(
    projectId: string,
    branchId: string | undefined,
    threadId: string,
    data: { id: string; resolved: boolean }
  ): Promise<any> {
    return this.put(
      `/comments/${this.projectBranchId(projectId, branchId)}/thread/${encodeURIComponent(threadId)}`,
      data
    );
  }

  async addReaction(
    projectId: string,
    branchId: string | undefined,
    commentId: string,
    data: { id: string; data: { emojiName: string } }
  ): Promise<any> {
    return this.post(
      `/comments/${this.projectBranchId(projectId, branchId)}/comment/${encodeURIComponent(commentId)}/reactions`,
      data
    );
  }

  async removeReaction(
    projectId: string,
    branchId: string | undefined,
    reactionId: string
  ): Promise<any> {
    return this.del(
      `/comments/${this.projectBranchId(projectId, branchId)}/reactions/${encodeURIComponent(reactionId)}`
    );
  }
}
