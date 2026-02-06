import {
  isDashboardRestricted,
  shouldHideForRestrictedUser,
} from "./dashboard-restriction";
import { DevFlagsType } from "@/wab/shared/devflags";

describe("dashboard-restriction", () => {
  // Helper to create test config (pattern from devflags.spec.ts)
  function createConfig(overrides: Partial<DevFlagsType> = {}): DevFlagsType {
    return {
      hideDashboardViews: false,
      dashboardRedirectUrl: "",
      adminDashboardOverrideParam: "adminDashboard",
      adminTeamDomain: "",
      ...overrides,
    } as DevFlagsType;
  }

  describe("isDashboardRestricted", () => {
    it("returns false when hideDashboardViews is false", () => {
      const config = createConfig({ hideDashboardViews: false });
      expect(isDashboardRestricted(config, "user@example.com", "")).toBe(false);
    });

    it("returns true when hideDashboardViews is true", () => {
      const config = createConfig({ hideDashboardViews: true });
      expect(isDashboardRestricted(config, "user@example.com", "")).toBe(true);
    });

    it("returns false for admin email with override param", () => {
      const config = createConfig({
        hideDashboardViews: true,
        adminTeamDomain: "admin.example.com",
      });
      expect(
        isDashboardRestricted(
          config,
          "user@admin.example.com",
          "?adminDashboard=true"
        )
      ).toBe(false);
    });

    it("returns true for non-admin email with override param", () => {
      const config = createConfig({
        hideDashboardViews: true,
        adminTeamDomain: "admin.example.com",
      });
      expect(
        isDashboardRestricted(config, "user@other.com", "?adminDashboard=true")
      ).toBe(true);
    });

    it("returns true for admin email without override param", () => {
      const config = createConfig({
        hideDashboardViews: true,
        adminTeamDomain: "admin.example.com",
      });
      expect(
        isDashboardRestricted(config, "user@admin.example.com", "")
      ).toBe(true);
    });

    it("uses custom override param name when configured", () => {
      const config = createConfig({
        hideDashboardViews: true,
        adminTeamDomain: "admin.example.com",
        adminDashboardOverrideParam: "customParam",
      });
      expect(
        isDashboardRestricted(
          config,
          "user@admin.example.com",
          "?customParam=true"
        )
      ).toBe(false);
      expect(
        isDashboardRestricted(
          config,
          "user@admin.example.com",
          "?adminDashboard=true"
        )
      ).toBe(true);
    });

    it("handles undefined email gracefully", () => {
      const config = createConfig({ hideDashboardViews: true });
      expect(isDashboardRestricted(config, undefined, "")).toBe(true);
    });

    it("handles empty location search gracefully", () => {
      const config = createConfig({
        hideDashboardViews: true,
        adminTeamDomain: "admin.example.com",
      });
      expect(
        isDashboardRestricted(config, "user@admin.example.com", "")
      ).toBe(true);
    });
  });

  describe("shouldHideForRestrictedUser", () => {
    it("returns true when user is white-labeled", () => {
      const config = createConfig({ hideDashboardViews: false });
      expect(
        shouldHideForRestrictedUser(true, config, "user@example.com", "")
      ).toBe(true);
    });

    it("returns true when dashboard is restricted", () => {
      const config = createConfig({ hideDashboardViews: true });
      expect(
        shouldHideForRestrictedUser(false, config, "user@example.com", "")
      ).toBe(true);
    });

    it("returns false when neither white-labeled nor restricted", () => {
      const config = createConfig({ hideDashboardViews: false });
      expect(
        shouldHideForRestrictedUser(false, config, "user@example.com", "")
      ).toBe(false);
    });

    it("returns true when both white-labeled and restricted", () => {
      const config = createConfig({ hideDashboardViews: true });
      expect(
        shouldHideForRestrictedUser(true, config, "user@example.com", "")
      ).toBe(true);
    });

    it("returns false for admin with override even when dashboard restricted", () => {
      const config = createConfig({
        hideDashboardViews: true,
        adminTeamDomain: "admin.example.com",
      });
      expect(
        shouldHideForRestrictedUser(
          false,
          config,
          "user@admin.example.com",
          "?adminDashboard=true"
        )
      ).toBe(false);
    });
  });
});
