/**
 * Auth guard for MCP tool handlers.
 *
 * Ensures the API client is authenticated before tool execution.
 * Returns context-aware error messages depending on whether the server
 * was launched by Claude Desktop (.mcpb) or Claude Code / other CLI clients.
 */

import type { PlasmicApiClient } from "./api-client.js";

export function requireAuth(apiClient: PlasmicApiClient | null): PlasmicApiClient {
  if (apiClient) {
    return apiClient;
  }
  const client = process.env.PLASMIC_MCP_CLIENT;
  throw new Error(getAuthErrorMessage(client));
}

export function getAuthErrorMessage(client?: string): string {
  if (client === "desktop") {
    return (
      "Visual Builder authentication required.\n\n" +
      "Open your extension settings and enter your credentials:\n" +
      "  1. Open Claude Desktop Settings > Extensions\n" +
      "  2. Find the Visual Builder extension\n" +
      "  3. Enter your host URL, email, and API token"
    );
  }

  return (
    "Visual Builder authentication required.\n\n" +
    "Run the auth command:\n" +
    "  npx @elasticpath/plasmic-mcp auth\n\n" +
    "Or set environment variables:\n" +
    "  PLASMIC_AUTH_HOST=https://useast.storefront.elasticpath.com\n" +
    "  PLASMIC_AUTH_USER=<your-email>\n" +
    "  PLASMIC_AUTH_TOKEN=<your-api-token>"
  );
}
