/**
 * EP Dashboard Restriction Module
 *
 * This module contains logic for restricting access to Plasmic dashboard views
 * and redirecting users to an external dashboard (e.g., Commerce Manager).
 *
 * Configuration is done via devflags:
 * - hideDashboardViews: boolean - Enable/disable dashboard restriction
 * - dashboardRedirectUrl: string - URL to redirect dashboard routes to
 * - adminDashboardOverrideParam: string - Query param name for admin override
 *
 * Admin users (matching adminTeamDomain) can bypass restrictions by adding
 * ?adminDashboard=true (or custom param name) to the URL.
 */

import { isAdminTeamEmail } from "@/wab/shared/devflag-utils";
import { DevFlagsType } from "@/wab/shared/devflags";

/**
 * Returns true if dashboard should be restricted (devflag-based).
 * This is separate from isWhiteLabelUser which is user-based.
 * Admin users can bypass this restriction with a query param.
 */
export function isDashboardRestricted(
  appConfig: DevFlagsType,
  userEmail: string | undefined,
  locationSearch: string
): boolean {
  if (!appConfig.hideDashboardViews) {
    return false;
  }

  // Check for admin override
  const adminParam = appConfig.adminDashboardOverrideParam || "adminDashboard";
  const hasAdminOverride =
    new URLSearchParams(locationSearch).get(adminParam) === "true" &&
    isAdminTeamEmail(userEmail, appConfig);

  return !hasAdminOverride;
}

/**
 * Redirects to the configured dashboard redirect URL.
 * Uses window.location.href for cross-origin navigation.
 */
export function redirectToDashboard(appConfig: DevFlagsType): void {
  const redirectUrl = appConfig.dashboardRedirectUrl || "/";
  window.location.href = redirectUrl;
}

/**
 * Helper to check if a user should see restricted UI elements.
 * Combines white-label check with dashboard restriction check.
 */
export function shouldHideForRestrictedUser(
  isWhiteLabelUser: boolean,
  appConfig: DevFlagsType,
  userEmail: string | undefined,
  locationSearch: string
): boolean {
  return (
    isWhiteLabelUser ||
    isDashboardRestricted(appConfig, userEmail, locationSearch)
  );
}
