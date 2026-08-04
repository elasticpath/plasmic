/**
 * Glob matching for origin and host allowlists, reproducing the semantics
 * better-auth applies to `trustedOrigins` entries: `*` and `?` stand in for
 * any run of / any single character that is not a path separator.
 * better-auth's own matcher is internal to the library, so the behaviour is
 * mirrored here rather than imported.
 */

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
