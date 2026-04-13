/**
 * Authentication flow for the MCP server.
 *
 * Default: interactive credential entry via terminal prompts.
 *
 * Browser-based init-token flow (deferred): replicates the Plasmic CLI's
 * auth pattern — generate UUID init token, open browser to
 * {host}/auth/plasmic-init/{initToken}, listen via socket.io for callback.
 * Currently disabled because EP-hosted environments redirect unauthenticated
 * users to Commerce Manager, which doesn't yet support the init-token route.
 * Enable with `{ browser: true }` once a CM route is available.
 *
 * Reference: packages/cli/src/utils/auth-utils.ts
 */

import { randomUUID } from "crypto";
import type { AuthConfig } from "./types.js";

const DEFAULT_TIMEOUT_MS = 60_000;

export interface AcquireAuthOptions {
  timeoutMs?: number;
  /** Use browser-based init-token flow instead of terminal prompts. */
  browser?: boolean;
}

export async function acquireAuth(
  host: string,
  options?: AcquireAuthOptions
): Promise<AuthConfig> {
  const cleanHost = host.replace(/\/+$/, "");

  if (options?.browser) {
    return browserFlow(cleanHost, options?.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  }

  console.error("[plasmic-mcp] Visual Builder authentication");
  console.error(`[plasmic-mcp] Host: ${cleanHost}`);
  console.error("[plasmic-mcp] Enter your credentials (from your account settings):\n");

  return manualEntry(cleanHost);
}

// ---------------------------------------------------------------------------
// Browser init-token flow (deferred — enable when CM supports the route)
// ---------------------------------------------------------------------------

async function browserFlow(
  host: string,
  timeoutMs: number
): Promise<AuthConfig> {
  const initToken = randomUUID();
  const authUrl = `${host}/auth/plasmic-init/${initToken}`;

  const open = (await import("open")).default;
  await open(authUrl);
  console.error(`[plasmic-mcp] Opened browser for authentication: ${authUrl}`);

  try {
    const authData = await pollForToken(host, initToken, timeoutMs);
    return { host, user: authData.user, token: authData.token };
  } catch {
    console.error("[plasmic-mcp] Browser auth timed out, falling back to manual entry");
    return manualEntry(host);
  }
}

interface AuthData {
  user: string;
  token: string;
}

function pollForToken(
  host: string,
  initToken: string,
  timeoutMs: number
): Promise<AuthData> {
  return new Promise(async (resolve, reject) => {
    const { io } = await import("socket.io-client");

    const socket = io(host, {
      path: "/api/v1/init-token",
      transportOptions: {
        polling: {
          extraHeaders: {
            "x-plasmic-init-token": initToken,
          },
        },
      },
    });

    const timer = setTimeout(() => {
      socket.close();
      reject(new Error("Auth polling timed out"));
    }, timeoutMs);

    socket.on("token", (data: AuthData) => {
      clearTimeout(timer);
      socket.close();
      resolve(data);
    });

    socket.on("error", (err: Error) => {
      clearTimeout(timer);
      socket.close();
      reject(err);
    });
  });
}

// ---------------------------------------------------------------------------
// Manual credential entry (current default)
// ---------------------------------------------------------------------------

async function manualEntry(host: string): Promise<AuthConfig> {
  const prompts = (await import("prompts")).default;

  const response = await prompts([
    {
      type: "text",
      name: "user",
      message: "Email address:",
    },
    {
      type: "password",
      name: "token",
      message: "API token:",
    },
  ]);

  if (!response.user || !response.token) {
    throw new Error("Authentication cancelled — no credentials provided");
  }

  return { host, user: response.user, token: response.token };
}
