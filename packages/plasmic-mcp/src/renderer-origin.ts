/**
 * Resolution of the "renderer origin" — the host that serves Plasmic's
 * lightweight renderer assets (`/static/host.html` and the `sub` /
 * `react-web-bundle` / `live-frame` bundles) for live preview.
 *
 * On plasmic.com SaaS this is `host.plasmicdev.com`. On a self-hosted Studio
 * the Studio auth host serves the full SPA at `/static/host.html` (no renderer
 * commit hash), so renderer assets must come from a separate origin — for
 * Elastic Path, its own CloudFront `host` distribution. Rather than hardcode
 * that (it carries an environment/region prefix), we derive it from the
 * Studio's own `appConfig.defaultHostUrl` — the same value Studio's
 * `getHostUrl()` uses — and fall back only when that can't be reached.
 */

/** Last-resort default, used only when no override and no app-config are available. */
export const RENDERER_ORIGIN_FALLBACK = "https://host.plasmicdev.com";

/**
 * Pure resolution, in priority order:
 *   1. `envOverride` — `PLASMIC_RENDERER_ORIGIN` (explicit operator override)
 *   2. origin of `appConfigHostUrl` — the Studio `appConfig.defaultHostUrl`
 *   3. `fallback`
 *
 * Trailing slashes are stripped. An unparseable `appConfigHostUrl` is ignored
 * in favour of the fallback.
 */
export function deriveRendererOrigin(
  envOverride: string | undefined,
  appConfigHostUrl: string | undefined,
  fallback: string = RENDERER_ORIGIN_FALLBACK
): string {
  if (envOverride) {
    return envOverride.replace(/\/$/, "");
  }
  if (appConfigHostUrl) {
    try {
      return new URL(appConfigHostUrl).origin;
    } catch {
      // Malformed defaultHostUrl — fall through to the fallback.
    }
  }
  return fallback.replace(/\/$/, "");
}
