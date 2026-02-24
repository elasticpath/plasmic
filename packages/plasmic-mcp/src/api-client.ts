/**
 * HTTP client for the Plasmic REST API.
 *
 * Uses native fetch (Node 18+). Auth headers follow the same pattern as
 * packages/cli/src/api.ts — x-plasmic-api-user + x-plasmic-api-token.
 */

import type {
  AuthConfig,
  ListProjectsResponse,
  ProjectBundleResponse,
  SaveRevisionReq,
  UpdateProjectReq,
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

export class PlasmicApiClient {
  private auth: AuthConfig;

  constructor(auth: AuthConfig) {
    this.auth = auth;
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

    return headers;
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
      });
    } catch (err) {
      throw new Error(
        `Could not reach Plasmic API at ${this.auth.host}. ` +
          `Check your network and PLASMIC_AUTH_HOST setting. (${err})`
      );
    }

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
      throw new PlasmicApiError(errorMessage, response.status, errorType);
    }

    return response.json() as Promise<T>;
  }

  async listProjects(): Promise<ListProjectsResponse> {
    return this.request<ListProjectsResponse>(
      "GET",
      "/api/v1/projects?query=all"
    );
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
  ): Promise<unknown> {
    return this.request<unknown>(
      "POST",
      `/api/v1/projects/${encodeURIComponent(projectId)}`,
      body
    );
  }

  /**
   * Save an incremental or full revision to the Plasmic server.
   * URL: POST /api/v1/projects/{projectId}/revisions/{revisionNum}
   */
  async saveRevision(
    projectId: string,
    revisionNum: number,
    body: SaveRevisionReq
  ): Promise<unknown> {
    return this.request<unknown>(
      "POST",
      `/api/v1/projects/${encodeURIComponent(projectId)}/revisions/${revisionNum}`,
      body
    );
  }
}
