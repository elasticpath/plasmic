/**
 * Server-side `Cookie:` header parsing, shared by the auth middleware and
 * the cart / proxy route handlers. Browser-side cookie access lives in
 * `./cookies.ts` (js-cookie) and is not interchangeable with this.
 */

/**
 * better-auth writes its cookies under a `__Secure-` prefix whenever the
 * deployment is served over HTTPS, and splits oversized `session_data`
 * payloads into `<name>.0`, `<name>.1`, … chunks. Presence checks that
 * compare names literally miss both forms.
 */
const SECURE_PREFIX = "__Secure-";

export function parseCookieHeader(
  cookieHeader: string
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of cookieHeader.split(";")) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    const name = part.slice(0, eq).trim();
    if (!name) continue;
    const raw = part.slice(eq + 1).trim();
    try {
      out[name] = decodeURIComponent(raw);
    } catch {
      // Malformed percent-encoding — keep the raw value rather than
      // throwing a 500 out of a route handler.
      out[name] = raw;
    }
  }
  return out;
}

export function readCookie(
  cookies: Record<string, string>,
  name: string
): string | undefined {
  return cookies[name] ?? cookies[`${SECURE_PREFIX}${name}`];
}

/** True when `name` is present directly, `__Secure-` prefixed, or chunked. */
export function hasCookie(
  cookies: Record<string, string>,
  name: string
): boolean {
  if (readCookie(cookies, name) !== undefined) return true;
  return Object.keys(cookies).some(
    (key) =>
      key.startsWith(`${name}.`) ||
      key.startsWith(`${SECURE_PREFIX}${name}.`)
  );
}
