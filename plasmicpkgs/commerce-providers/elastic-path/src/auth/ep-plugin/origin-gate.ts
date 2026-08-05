/**
 * Origin gate — the CSRF layer on state-changing routes, following Go's
 * `CrossOriginProtection`. Request rejection, distinct from CORS (response
 * readability). Trust list is better-auth's `trustedOrigins` (ADR-0001).
 */
import { hasWildcard, matchesGlob } from "../../utils/glob-pattern";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

function parseUrl(value: string): URL | null {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

export function matchesOriginPattern(origin: string, pattern: string): boolean {
  const url = parseUrl(origin);
  if (hasWildcard(pattern)) {
    if (pattern.includes("://")) {
      return matchesGlob(
        url && url.origin !== "null" ? url.origin : origin,
        pattern
      );
    }
    return url ? matchesGlob(url.host, pattern) : false;
  }
  // Non-wildcard: http(s) and scheme-less values compare as origins;
  // custom schemes (Electron shells and the like) compare by prefix.
  if (!url || url.protocol === "http:" || url.protocol === "https:") {
    return url !== null && url.origin !== "null" && pattern === url.origin;
  }
  return origin.startsWith(pattern);
}

/**
 * Go compares Origin to the request's own Host before the allowlist, so a
 * same-origin request passes even if the deployment's origin is unlisted.
 */
function originMatchesRequestHost(request: Request, origin: string): boolean {
  const originHost = parseUrl(origin)?.host?.toLowerCase();
  if (!originHost) return false;
  const hostHeader = request.headers.get("host")?.toLowerCase();
  if (hostHeader && hostHeader === originHost) return true;
  const urlHost = parseUrl(request.url)?.host?.toLowerCase();
  return Boolean(urlHost) && urlHost === originHost;
}

export function isTrustedOrigin(
  origin: string,
  trustedOrigins: readonly string[] | undefined
): boolean {
  if (!origin || !trustedOrigins?.length) return false;
  return trustedOrigins.some((pattern) =>
    matchesOriginPattern(origin, pattern)
  );
}

/** `true` when the request may proceed. */
export function passesOriginGate(
  request: Request,
  trustedOrigins: readonly string[] | undefined
): boolean {
  if (SAFE_METHODS.has(request.method.toUpperCase())) return true;

  const site = request.headers.get("sec-fetch-site");
  if (site === "same-origin" || site === "none") return true;

  const origin = request.headers.get("origin");
  // Neither signal: not a browser, so no ambient credentials to abuse.
  if (!site && !origin) return true;
  if (!origin) return false;

  if (originMatchesRequestHost(request, origin)) return true;

  return isTrustedOrigin(origin, trustedOrigins);
}

/** Returns a 403 response when the gate rejects, or `null` to continue. */
export function enforceOriginGate(
  request: Request,
  trustedOrigins: readonly string[] | undefined
): Response | null {
  if (passesOriginGate(request, trustedOrigins)) return null;
  return new Response(JSON.stringify({ error: "untrusted_origin" }), {
    status: 403,
    headers: { "Content-Type": "application/json" },
  });
}
