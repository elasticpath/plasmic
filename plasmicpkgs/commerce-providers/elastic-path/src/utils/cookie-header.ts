/** Server-side Cookie header parsing. Browser access is in ./cookies.ts. */

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

/** Matches `name`, `__Secure-name`, and better-auth's `name.0` chunks. */
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
