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
  UpdateProjectReq,
} from "./types.js";

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
        throw new Error(
          "Authentication failed. Check your Plasmic API credentials " +
            "(PLASMIC_AUTH_USER and PLASMIC_AUTH_TOKEN)."
        );
      }

      let errorMessage: string;
      try {
        const errorBody = (await response.json()) as {
          error?: { message?: string };
        };
        errorMessage =
          errorBody?.error?.message ??
          `HTTP ${response.status}: ${response.statusText}`;
      } catch {
        errorMessage = `HTTP ${response.status}: ${response.statusText}`;
      }
      throw new Error(errorMessage);
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
}
