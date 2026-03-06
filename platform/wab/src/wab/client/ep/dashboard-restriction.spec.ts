import { DevFlagsType } from "@/wab/shared/devflags";
import {
  isDashboardRestricted,
  redirectToDashboard,
  shouldHideForRestrictedUser,
  shouldRedirectAuthRoute,
} from "./dashboard-restriction";

function makeAppConfig(
  overrides: Partial<DevFlagsType> = {}
): DevFlagsType {
  return {
    hideDashboardViews: false,
    dashboardRedirectUrl: "",
    adminDashboardOverrideParam: "adminDashboard",
    ...overrides,
  } as DevFlagsType;
}

describe("isDashboardRestricted", () => {
  it("returns false when hideDashboardViews is false", () => {
    const config = makeAppConfig({ hideDashboardViews: false });
    expect(isDashboardRestricted(config, "")).toBe(false);
  });

  it("returns true when hideDashboardViews is true", () => {
    const config = makeAppConfig({ hideDashboardViews: true });
    expect(isDashboardRestricted(config, "")).toBe(true);
  });

  it("returns false when escape hatch param is present", () => {
    const config = makeAppConfig({ hideDashboardViews: true });
    expect(isDashboardRestricted(config, "?adminDashboard=true")).toBe(false);
  });

  it("returns true when escape hatch param has wrong value", () => {
    const config = makeAppConfig({ hideDashboardViews: true });
    expect(isDashboardRestricted(config, "?adminDashboard=false")).toBe(true);
  });

  it("supports custom override param name", () => {
    const config = makeAppConfig({
      hideDashboardViews: true,
      adminDashboardOverrideParam: "epAdmin",
    });
    expect(isDashboardRestricted(config, "?epAdmin=true")).toBe(false);
    expect(isDashboardRestricted(config, "?adminDashboard=true")).toBe(true);
  });

  it("returns true when escape hatch param is absent", () => {
    const config = makeAppConfig({ hideDashboardViews: true });
    expect(isDashboardRestricted(config, "?other=value")).toBe(true);
  });

  it("handles empty search string", () => {
    const config = makeAppConfig({ hideDashboardViews: true });
    expect(isDashboardRestricted(config, "")).toBe(true);
  });

  it("falls back to adminDashboard when override param is empty", () => {
    const config = makeAppConfig({
      hideDashboardViews: true,
      adminDashboardOverrideParam: "",
    });
    expect(isDashboardRestricted(config, "?adminDashboard=true")).toBe(false);
  });
});

describe("redirectToDashboard", () => {
  const originalReplace = window.location.replace;

  beforeEach(() => {
    Object.defineProperty(window, "location", {
      value: { replace: jest.fn() },
      writable: true,
    });
  });

  afterEach(() => {
    Object.defineProperty(window, "location", {
      value: { replace: originalReplace },
      writable: true,
    });
  });

  it("redirects to dashboardRedirectUrl", () => {
    const config = makeAppConfig({
      dashboardRedirectUrl: "https://cm.example.com",
    });
    redirectToDashboard(config);
    expect(window.location.replace).toHaveBeenCalledWith(
      "https://cm.example.com"
    );
  });

  it("falls back to / when dashboardRedirectUrl is empty", () => {
    const config = makeAppConfig({ dashboardRedirectUrl: "" });
    redirectToDashboard(config);
    expect(window.location.replace).toHaveBeenCalledWith("/");
  });

  it("falls back to / when dashboardRedirectUrl is undefined", () => {
    const config = makeAppConfig({
      dashboardRedirectUrl: undefined as any,
    });
    redirectToDashboard(config);
    expect(window.location.replace).toHaveBeenCalledWith("/");
  });
});

describe("shouldHideForRestrictedUser", () => {
  it("returns true when user is white-labeled", () => {
    const config = makeAppConfig({ hideDashboardViews: false });
    expect(shouldHideForRestrictedUser(true, config, "")).toBe(true);
  });

  it("returns true when dashboard is restricted", () => {
    const config = makeAppConfig({ hideDashboardViews: true });
    expect(shouldHideForRestrictedUser(false, config, "")).toBe(true);
  });

  it("returns false when neither white-label nor restricted", () => {
    const config = makeAppConfig({ hideDashboardViews: false });
    expect(shouldHideForRestrictedUser(false, config, "")).toBe(false);
  });

  it("returns true when both white-label and restricted", () => {
    const config = makeAppConfig({ hideDashboardViews: true });
    expect(shouldHideForRestrictedUser(true, config, "")).toBe(true);
  });

  it("returns false when restricted but escape hatch present", () => {
    const config = makeAppConfig({ hideDashboardViews: true });
    expect(
      shouldHideForRestrictedUser(false, config, "?adminDashboard=true")
    ).toBe(false);
  });

  it("returns true when white-label even with escape hatch", () => {
    const config = makeAppConfig({ hideDashboardViews: true });
    expect(
      shouldHideForRestrictedUser(true, config, "?adminDashboard=true")
    ).toBe(true);
  });

  it("treats null isWhiteLabel as non-white-label", () => {
    const config = makeAppConfig({ hideDashboardViews: false });
    expect(shouldHideForRestrictedUser(null, config, "")).toBe(false);
  });

  it("treats undefined isWhiteLabel as non-white-label", () => {
    const config = makeAppConfig({ hideDashboardViews: false });
    expect(shouldHideForRestrictedUser(undefined, config, "")).toBe(false);
  });
});

describe("shouldRedirectAuthRoute", () => {
  const restrictedConfig = makeAppConfig({ hideDashboardViews: true });
  const normalConfig = makeAppConfig({ hideDashboardViews: false });

  it("redirects auth routes when restricted", () => {
    expect(shouldRedirectAuthRoute(restrictedConfig, "/login", "")).toBe(true);
    expect(shouldRedirectAuthRoute(restrictedConfig, "/signup", "")).toBe(true);
    expect(shouldRedirectAuthRoute(restrictedConfig, "/sso", "")).toBe(true);
    expect(
      shouldRedirectAuthRoute(restrictedConfig, "/forgot-password", "")
    ).toBe(true);
    expect(
      shouldRedirectAuthRoute(restrictedConfig, "/reset-password", "")
    ).toBe(true);
  });

  it("does not redirect non-auth routes", () => {
    expect(
      shouldRedirectAuthRoute(restrictedConfig, "/projects/abc", "")
    ).toBe(false);
    expect(shouldRedirectAuthRoute(restrictedConfig, "/cms/db1", "")).toBe(
      false
    );
    expect(shouldRedirectAuthRoute(restrictedConfig, "/settings", "")).toBe(
      false
    );
  });

  it("does not redirect when not restricted", () => {
    expect(shouldRedirectAuthRoute(normalConfig, "/login", "")).toBe(false);
    expect(shouldRedirectAuthRoute(normalConfig, "/signup", "")).toBe(false);
  });

  it("does not redirect when escape hatch present", () => {
    expect(
      shouldRedirectAuthRoute(
        restrictedConfig,
        "/login",
        "?adminDashboard=true"
      )
    ).toBe(false);
  });

  it("supports custom auth patterns", () => {
    expect(
      shouldRedirectAuthRoute(restrictedConfig, "/custom-auth", "", [
        "/custom-auth",
      ])
    ).toBe(true);
    expect(
      shouldRedirectAuthRoute(restrictedConfig, "/login", "", ["/custom-auth"])
    ).toBe(false);
  });

  it("matches path prefixes", () => {
    expect(
      shouldRedirectAuthRoute(restrictedConfig, "/login/callback", "")
    ).toBe(true);
  });
});
