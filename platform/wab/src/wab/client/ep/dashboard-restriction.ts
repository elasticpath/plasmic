import { DevFlagsType } from "@/wab/shared/devflags";

/**
 * EP Studio lockdown — redirects dashboard and auth routes to Commerce Manager
 * when `hideDashboardViews` devflag is enabled. Any user can bypass via the
 * escape-hatch query param (default `?adminDashboard=true`).
 */

function hasEscapeHatch(appConfig: DevFlagsType, locationSearch: string): boolean {
  const paramName = appConfig.adminDashboardOverrideParam || "adminDashboard";
  const params = new URLSearchParams(locationSearch);
  if (params.get(paramName) === "true") {
    return true;
  }
  // Check inside continueTo param — the escape hatch gets encoded there
  // when redirecting unauthenticated users to the login page.
  const continueTo = params.get("continueTo");
  if (continueTo) {
    const qIdx = continueTo.indexOf("?");
    if (qIdx !== -1) {
      const innerParams = new URLSearchParams(continueTo.substring(qIdx));
      return innerParams.get(paramName) === "true";
    }
  }
  return false;
}

/** True when dashboard routes should be locked down. */
export function isDashboardRestricted(
  appConfig: DevFlagsType,
  locationSearch: string
): boolean {
  return appConfig.hideDashboardViews && !hasEscapeHatch(appConfig, locationSearch);
}

/** Redirect to Commerce Manager (or "/" if no URL configured). */
export function redirectToDashboard(appConfig: DevFlagsType): void {
  const url = appConfig.dashboardRedirectUrl || "/";
  window.location.replace(url);
}

/**
 * Combines white-label + EP restriction for UI element hiding.
 * Returns true when elements should be hidden.
 */
export function shouldHideForRestrictedUser(
  isWhiteLabel: boolean | null | undefined,
  appConfig: DevFlagsType,
  locationSearch: string
): boolean {
  return !!isWhiteLabel || isDashboardRestricted(appConfig, locationSearch);
}

const AUTH_PATTERNS = [
  "/login",
  "/signup",
  "/sso",
  "/forgot-password",
  "/reset-password",
];

/** True when an auth route should redirect to CM. */
export function shouldRedirectAuthRoute(
  appConfig: DevFlagsType,
  pathname: string,
  locationSearch: string,
  authPatterns: string[] = AUTH_PATTERNS
): boolean {
  if (!isDashboardRestricted(appConfig, locationSearch)) {
    return false;
  }
  return authPatterns.some((p) => pathname === p || pathname.startsWith(p + "/"));
}
