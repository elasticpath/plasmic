/** Mirrors better-auth's trustedOrigins glob semantics; its matcher is internal. */

const REGEXP_SPECIALS = /[\\^$.*+?()[\]{}|]/g;

export function globToRegExp(pattern: string): RegExp {
  let body = "";
  for (const ch of pattern) {
    if (ch === "*") body += "[^/\\\\]*?";
    else if (ch === "?") body += "[^/\\\\]";
    else body += ch.replace(REGEXP_SPECIALS, "\\$&");
  }
  return new RegExp(`^${body}$`);
}

export function hasWildcard(pattern: string): boolean {
  return pattern.includes("*") || pattern.includes("?");
}

export function matchesGlob(value: string, pattern: string): boolean {
  return globToRegExp(pattern).test(value);
}
