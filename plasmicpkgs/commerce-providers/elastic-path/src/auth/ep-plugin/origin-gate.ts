// CSRF gate following Go's CrossOriginProtection. Rejects requests; CORS
// only governs response readability.
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
  if (!url || url.protocol === "http:" || url.protocol === "https:") {
    return url !== null && url.origin !== "null" && pattern === url.origin;
  }
  return origin.startsWith(pattern);
}

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

export function passesOriginGate(
  request: Request,
  trustedOrigins: readonly string[] | undefined
): boolean {
  if (SAFE_METHODS.has(request.method.toUpperCase())) return true;

  const site = request.headers.get("sec-fetch-site");
  if (site === "same-origin" || site === "none") return true;

  const origin = request.headers.get("origin");
  if (!site && !origin) return true;
  if (!origin) return false;

  if (originMatchesRequestHost(request, origin)) return true;

  return isTrustedOrigin(origin, trustedOrigins);
}

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
