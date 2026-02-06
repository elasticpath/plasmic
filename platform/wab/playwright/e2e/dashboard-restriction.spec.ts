import { expect, Page } from "@playwright/test";
import { test } from "../fixtures/test";
import {
  goToProject,
  getStudioFrame,
  waitForFrameToLoad,
} from "../utils/studio-utils";

/**
 * Helper to mock app-config with dashboard restriction enabled.
 * Must be called before navigating to pages.
 */
async function enableDashboardRestriction(
  page: Page,
  overrides: { adminTeamDomain?: string; dashboardRedirectUrl?: string } = {}
) {
  await page.route("**/api/v1/app-config", async (route) => {
    const response = await route.fetch();
    const json = await response.json();
    await route.fulfill({
      json: {
        ...json,
        hideDashboardViews: true,
        dashboardRedirectUrl:
          overrides.dashboardRedirectUrl ||
          "http://localhost:3003/test-redirect",
        adminTeamDomain: overrides.adminTeamDomain || "",
      },
    });
  });
}

test.describe("dashboard-restriction", () => {
  let projectId: string;

  test.describe("when hideDashboardViews is enabled", () => {
    test.beforeEach(async ({ apiClient, page }) => {
      projectId = await apiClient.setupNewProject({
        name: "dashboard-restriction-test",
      });
      await enableDashboardRestriction(page);
    });

    test.afterEach(async ({ apiClient }) => {
      await apiClient.removeProjectAfterTest(
        projectId,
        "user2@example.com",
        "!53kr3tz!"
      );
    });

    test("redirects dashboard routes to configured URL", async ({ page }) => {
      // Dashboard route should redirect
      await page.goto("/");
      await expect(page).toHaveURL(/test-redirect/);
    });

    test("allows studio route access with project ID", async ({ page }) => {
      // Direct project URL should work
      await goToProject(page, `/projects/${projectId}`);
      await expect(page).toHaveURL(new RegExp(`/projects/${projectId}`));

      // Verify studio loads
      const studioFrame = getStudioFrame(page);
      await expect(
        studioFrame.locator(".canvas-editor__canvas-container")
      ).toBeVisible({
        timeout: 60000,
      });
    });

    test("hides community links in studio left panel", async ({ page }) => {
      await goToProject(page, `/projects/${projectId}`);
      await waitForFrameToLoad(page);

      const studioFrame = getStudioFrame(page);
      // Community links should not be visible for restricted users
      await expect(
        studioFrame.locator('text="Slack community"')
      ).not.toBeVisible();
      await expect(studioFrame.locator('text="Forum"')).not.toBeVisible();
    });
  });

  test.describe("admin override", () => {
    test.beforeEach(async ({ apiClient, page }) => {
      projectId = await apiClient.setupNewProject({
        name: "admin-override-test",
      });
      // Test user is user2@example.com, so adminTeamDomain should match
      await enableDashboardRestriction(page, {
        adminTeamDomain: "example.com",
      });
    });

    test.afterEach(async ({ apiClient }) => {
      await apiClient.removeProjectAfterTest(
        projectId,
        "user2@example.com",
        "!53kr3tz!"
      );
    });

    test("allows admin to access dashboard with override param", async ({
      page,
    }) => {
      // Admin with override param should access dashboard
      await page.goto("/?adminDashboard=true");
      // Should NOT redirect - dashboard should load
      await expect(page).not.toHaveURL(/test-redirect/);
      // Wait for dashboard content to appear
      await expect(page.locator('text="All projects"')).toBeVisible({
        timeout: 30000,
      });
    });

    test("admin without override param still gets redirected", async ({
      page,
    }) => {
      // Admin without override param should redirect
      await page.goto("/");
      await expect(page).toHaveURL(/test-redirect/);
    });
  });
});
