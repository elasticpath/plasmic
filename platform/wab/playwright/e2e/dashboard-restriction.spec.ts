import { expect, Page } from "@playwright/test";
import { test, makeApiClient } from "../fixtures/test";

/**
 * E2E tests for the EP Studio lockdown feature (hideDashboardViews devflag).
 *
 * When enabled, dashboard and auth routes redirect to Commerce Manager (CM).
 * Project routes (/projects/:id) and CMS routes (/cms/:dbId) remain accessible.
 * The ?adminDashboard=true escape hatch bypasses all restrictions.
 *
 * Why E2E: Unit tests validate the pure logic in dashboard-restriction.ts, but
 * only E2E tests can confirm that the React routing integration, devflag
 * fetching, and browser-level redirects work together correctly.
 */

const REDIRECT_URL = "https://cm-test.example.com/";

test.describe("EP Studio Lockdown", () => {
  let savedFlags: Record<string, any>;
  let projectId: string;

  test.beforeAll(async ({ request, baseURL }) => {
    const client = makeApiClient(request, baseURL);
    savedFlags = await client.getDevFlags();

    await client.upsertDevFlags({
      ...savedFlags,
      hideDashboardViews: true,
      dashboardRedirectUrl: REDIRECT_URL,
      adminDashboardOverrideParam: "adminDashboard",
    });

    await client.login("user2@example.com", "!53kr3tz!");
    projectId = await client.setupNewProject({ name: "lockdown-e2e" });
  });

  test.afterAll(async ({ request, baseURL }) => {
    const client = makeApiClient(request, baseURL);

    if (savedFlags) {
      await client.upsertDevFlags(savedFlags);
    }
    if (projectId) {
      await client.login("user2@example.com", "!53kr3tz!");
      await client.removeProject(projectId).catch(() => {});
    }
  });

  /**
   * Intercepts navigation to the redirect URL so the browser gets a valid
   * response instead of failing on an unreachable external domain.
   */
  async function interceptRedirect(page: Page): Promise<void> {
    await page.route(`${REDIRECT_URL}**`, (route) =>
      route.fulfill({
        status: 200,
        contentType: "text/html",
        body: "<html><body>Commerce Manager</body></html>",
      })
    );
  }

  // ── Dashboard routes redirect to CM when logged in ──────────────────────

  for (const path of ["/", "/projects", "/settings"]) {
    test(`logged-in: ${path} redirects to CM`, async ({ page, apiClient }) => {
      await interceptRedirect(page);
      await page.goto(path).catch(() => {});
      await page.waitForURL(`${REDIRECT_URL}**`, { timeout: 30_000 });
    });
  }

  // ── Auth routes redirect to CM ──────────────────────────────────────────

  for (const path of [
    "/login",
    "/signup",
    "/sso",
    "/forgot-password",
    "/reset-password",
  ]) {
    test(`auth: ${path} redirects to CM`, async ({ page }) => {
      await interceptRedirect(page);
      await page.goto(path).catch(() => {});
      await page.waitForURL(`${REDIRECT_URL}**`, { timeout: 30_000 });
    });
  }

  // ── Allowed routes remain accessible ────────────────────────────────────

  test("project route /projects/:id is accessible", async ({
    page,
    apiClient,
  }) => {
    await interceptRedirect(page);
    await page.goto(`/projects/${projectId}`, { timeout: 120_000 });
    expect(page.url()).toContain(`/projects/${projectId}`);
  });

  // ── Escape hatch bypasses restrictions ──────────────────────────────────

  test("?adminDashboard=true bypasses dashboard redirect", async ({
    page,
    apiClient,
  }) => {
    await interceptRedirect(page);
    await page.goto("/projects?adminDashboard=true", {
      waitUntil: "networkidle",
      timeout: 60_000,
    });
    expect(page.url()).toContain("/projects");
    expect(page.url()).not.toContain(REDIRECT_URL);
  });

  test("?adminDashboard=true bypasses auth redirect", async ({ page }) => {
    await interceptRedirect(page);
    await page.goto("/login?adminDashboard=true", {
      waitUntil: "networkidle",
      timeout: 60_000,
    });
    expect(page.url()).toContain("/login");
    expect(page.url()).not.toContain(REDIRECT_URL);
  });

  // ── Non-logged-in user ──────────────────────────────────────────────────

  test("non-logged-in user redirects to CM instead of login", async ({
    page,
  }) => {
    await page.context().clearCookies();
    await interceptRedirect(page);
    await page.goto("/").catch(() => {});
    await page.waitForURL(`${REDIRECT_URL}**`, { timeout: 30_000 });
  });
});
