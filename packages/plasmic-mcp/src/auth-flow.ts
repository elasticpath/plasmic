/**
 * Browser-based init-token authentication flow.
 *
 * Replicates the Plasmic CLI's auth pattern:
 * 1. Generate a UUID init token
 * 2. Open browser to {host}/auth/plasmic-init/{initToken}
 * 3. Listen via socket.io on /api/v1/init-token for the token callback
 * 4. Write credentials to ~/.plasmic.auth
 *
 * Falls back to manual credential entry if the browser flow times out.
 *
 * Reference: packages/cli/src/utils/auth-utils.ts
 */

import { randomUUID } from "crypto";
import type { AuthConfig } from "./types.js";

const DEFAULT_TIMEOUT_MS = 60_000;

export interface AcquireAuthOptions {
  timeoutMs?: number;
}

export async function acquireAuth(
  host: string,
  options?: AcquireAuthOptions
): Promise<AuthConfig> {
  const cleanHost = host.replace(/\/+$/, "");
  const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  const initToken = randomUUID();
  const authUrl = `${cleanHost}/auth/plasmic-init/${initToken}`;

  // Open browser
  const open = (await import("open")).default;
  await open(authUrl);
  console.error(`[plasmic-mcp] Opened browser for authentication: ${authUrl}`);

  // Try socket.io polling for the token
  try {
    const authData = await pollForToken(cleanHost, initToken, timeoutMs);
    return { host: cleanHost, user: authData.user, token: authData.token };
  } catch {
    // Timeout — fall back to manual entry
    console.error("[plasmic-mcp] Browser auth timed out, falling back to manual entry");
    return manualEntry(cleanHost);
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
