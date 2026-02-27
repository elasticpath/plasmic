/**
 * Authentication for the Plasmic API.
 *
 * Reads credentials from environment variables (same as @plasmicapp/cli) or
 * from a .plasmic.auth JSON file. The MCP server requires auth to be present
 * at startup — interactive flows are not supported.
 *
 * Reference: packages/cli/src/utils/auth-utils.ts
 */

import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import type { AuthConfig } from "./types.js";

const ENV_AUTH_HOST = "PLASMIC_AUTH_HOST";
const ENV_AUTH_USER = "PLASMIC_AUTH_USER";
const ENV_AUTH_TOKEN = "PLASMIC_AUTH_TOKEN";
const AUTH_FILE_NAME = ".plasmic.auth";

export function getAuth(): AuthConfig {
  // Priority 1: environment variables
  const host = process.env[ENV_AUTH_HOST];
  const user = process.env[ENV_AUTH_USER];
  const token = process.env[ENV_AUTH_TOKEN];

  if (user && token) {
    if (!host) {
      throw new Error(
        "PLASMIC_AUTH_HOST is required when PLASMIC_AUTH_USER and PLASMIC_AUTH_TOKEN are set. " +
          "Set it to your self-hosted Plasmic instance URL (e.g., https://studio.plasmic.app)."
      );
    }
    return {
      host: host.replace(/\/+$/, ""),
      user,
      token,
      basicAuthUser: process.env["PLASMIC_BASIC_AUTH_USER"],
      basicAuthPassword: process.env["PLASMIC_BASIC_AUTH_PASSWORD"],
    };
  }

  // Warn on partial env vars
  if (user || token) {
    console.error(
      "[plasmic-mcp] Warning: Partial Plasmic auth env vars. " +
        "Both PLASMIC_AUTH_USER and PLASMIC_AUTH_TOKEN are required."
    );
  }

  // Priority 2: .plasmic.auth file
  const authFromFile = readAuthFile();
  if (authFromFile) {
    return authFromFile;
  }

  throw new Error(
    "Plasmic authentication required. Set environment variables:\n" +
      "  PLASMIC_AUTH_HOST=https://your-plasmic-instance.example.com\n" +
      "  PLASMIC_AUTH_USER=<your-api-user-id>\n" +
      "  PLASMIC_AUTH_TOKEN=<your-api-token>\n\n" +
      "Or create a .plasmic.auth file with:\n" +
      '  { "host": "...", "user": "...", "token": "..." }'
  );
}

function readAuthFile(): AuthConfig | null {
  const candidates = [
    path.join(process.cwd(), AUTH_FILE_NAME),
    path.join(os.homedir(), AUTH_FILE_NAME),
  ];

  for (const filePath of candidates) {
    try {
      const content = fs.readFileSync(filePath, "utf-8");
      const parsed = JSON.parse(content);
      if (parsed.user && parsed.token && parsed.host) {
        console.error(`[plasmic-mcp] Using auth from ${filePath}`);
        return {
          host: String(parsed.host).replace(/\/+$/, ""),
          user: String(parsed.user),
          token: String(parsed.token),
          basicAuthUser: parsed.basicAuthUser,
          basicAuthPassword: parsed.basicAuthPassword,
        };
      }
    } catch (err: unknown) {
      // File not found is expected — try next candidate
      const code = (err as NodeJS.ErrnoException)?.code;
      if (code !== "ENOENT") {
        // JSON parse error or permission issue on an existing file — warn the user
        console.error(
          `[plasmic-mcp] Warning: Found ${filePath} but could not read it: ${err instanceof Error ? err.message : String(err)}`
        );
      }
    }
  }

  return null;
}
