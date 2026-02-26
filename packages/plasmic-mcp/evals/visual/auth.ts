/**
 * Plasmic Studio authentication for visual capture.
 *
 * Authenticates via the CSRF -> login -> cookie flow used by the Plasmic
 * web app. Credentials come from environment variables. The same flow is
 * used by the existing Playwright test infrastructure in
 * platform/wab/playwright/utils/api-client.ts.
 *
 * Why a separate auth module: the visual capture system manages its own
 * browser session lifecycle (auth once per eval run, reuse across all
 * scenarios). The existing ApiClient in the Playwright test infra is
 * tied to Playwright's test fixture system and can't be reused directly.
 */

import type { Browser, BrowserContext } from "playwright";

export interface StudioAuthConfig {
  /** Plasmic API host, e.g., https://studio.plasmic.app */
  host: string;
  /** Login email */
  email: string;
  /** Login password */
  password: string;
}

/**
 * Read Studio auth config from environment variables.
 * Returns null if any required variable is missing — callers should
 * skip visual capture rather than fail the eval run.
 */
export function getAuthConfig(): StudioAuthConfig | null {
  const host = process.env.PLASMIC_AUTH_HOST;
  const email = process.env.PLASMIC_STUDIO_EMAIL;
  const password = process.env.PLASMIC_STUDIO_PASSWORD;

  if (!host || !email || !password) {
    return null;
  }

  return { host, email, password };
}

/**
 * Authenticate with Plasmic Studio and return a browser context
 * with session cookies.
 *
 * Flow (mirrors platform/wab/playwright/utils/api-client.ts):
 *   1. GET /api/v1/auth/csrf -> initial CSRF token
 *   2. POST /api/v1/auth/login with email/password + X-CSRF-Token header
 *   3. GET /api/v1/auth/csrf -> refresh (post-login token differs from pre-login)
 *
 * The returned context has the connect.sid session cookie set and can
 * navigate to Studio pages as an authenticated user.
 */
export async function authenticateStudio(
  browser: Browser,
  config: StudioAuthConfig
): Promise<BrowserContext> {
  const context = await browser.newContext();
  const request = context.request;

  // Step 1: Get initial CSRF token
  const csrfRes1 = await request.get(`${config.host}/api/v1/auth/csrf`);
  if (!csrfRes1.ok()) {
    const text = await csrfRes1.text();
    await context.close();
    throw new Error(
      `Failed to get CSRF token: ${csrfRes1.status()} ${text}`
    );
  }
  const csrf1 = (await csrfRes1.json()).csrf;

  // Step 2: Login with CSRF token
  const loginRes = await request.post(`${config.host}/api/v1/auth/login`, {
    data: { email: config.email, password: config.password },
    headers: { "X-CSRF-Token": csrf1 },
  });
  if (!loginRes.ok()) {
    const text = await loginRes.text();
    await context.close();
    throw new Error(`Studio login failed: ${loginRes.status()} ${text}`);
  }

  // Step 3: Refresh CSRF token — post-login token differs from pre-login.
  // This ensures any subsequent requests in this context use a valid token.
  const csrfRes2 = await request.get(`${config.host}/api/v1/auth/csrf`);
  if (!csrfRes2.ok()) {
    const text = await csrfRes2.text();
    await context.close();
    throw new Error(
      `Failed to refresh CSRF token after login: ${csrfRes2.status()} ${text}`
    );
  }

  return context;
}
