/**
 * Same-site return-to shared by post-auth forms.
 *
 * A valid `?redirect=` on the current page wins. Otherwise a valid configured
 * path is used. Otherwise the caller stays put. Callers navigate only after
 * their own success path; this module does not know about login or registration.
 *
 * A path is one leading `/`, optionally with a query string or fragment.
 * A second slash, a backslash, a leading scheme, or a C0/DEL control
 * character is rejected. The query value is decoded once by URLSearchParams.
 */

const CONTROL = /[\u0000-\u001F\u007F]/;
const SCHEME = /^[a-zA-Z][a-zA-Z0-9+.-]*:/;

export function isSameSiteRedirect(value: string): boolean {
  if (typeof value !== "string" || value.length === 0) return false;
  if (CONTROL.test(value)) return false;
  if (value.includes("\\")) return false;
  if (SCHEME.test(value)) return false;
  if (!value.startsWith("/")) return false;
  if (value.startsWith("//")) return false;
  return true;
}

export function readRedirectQuery(search: string): string | null {
  const raw = search.startsWith("?") ? search.slice(1) : search;
  const params = new URLSearchParams(raw);
  if (!params.has("redirect")) return null;
  const value = params.get("redirect");
  if (value == null || value.length === 0) return null;
  return value;
}

export function resolveReturnTo(input: {
  search: string | null;
  configured?: string | null;
}): string | null {
  if (input.search != null) {
    const fromQuery = readRedirectQuery(input.search);
    if (fromQuery != null && isSameSiteRedirect(fromQuery)) return fromQuery;
  }
  if (input.configured != null && isSameSiteRedirect(input.configured)) {
    return input.configured;
  }
  return null;
}

export function readLocationSearch(): string | null {
  if (typeof window === "undefined") return null;
  return window.location?.search ?? "";
}

export function assignReturnTo(path: string): void {
  if (typeof window === "undefined") return;
  window.location.assign(path);
}
