/**
 * Token reader: extracts design tokens from the in-memory Site model.
 *
 * Design tokens (colors, spacing, fonts, etc.) define a project's design system.
 * Claude uses these to create pages that match the project's visual language.
 *
 * Token values can reference other tokens via var(--token-<uuid>). This module
 * resolves such chains to their final CSS values, with cycle detection.
 *
 * Token reference helpers (mkTokenRef, findToken, etc.) support the update-styles
 * tool's `token:TokenName` syntax for applying design tokens to style properties.
 */

import type { StyleTokenType, TokenInfo } from "./types.js";

const RE_TOKEN_REF = /var\(--token-([^)]+)\)/;

/**
 * Resolves a token value by following var(--token-<uuid>) references.
 * Detects cycles and returns the raw reference string if unresolvable.
 */
export function resolveTokenValue(
  value: string,
  tokenValueMap: Map<string, string>,
  visited?: Set<string>
): string {
  const match = RE_TOKEN_REF.exec(value);
  if (!match) {return value;}

  const refUuid = match[1];
  const seen = visited ?? new Set<string>();
  if (seen.has(refUuid)) {return value;}
  seen.add(refUuid);

  const refValue = tokenValueMap.get(refUuid);
  if (!refValue) {return value;}

  return resolveTokenValue(refValue, tokenValueMap, seen);
}

/**
 * Reads design tokens from a Site's styleTokens array.
 *
 * Returns tokens with resolved values (when the raw value is a token ref)
 * and groups them by type for readability. Optionally filters by token type.
 */
export function readTokens(
  styleTokens: any[],
  filterType?: StyleTokenType
): { tokenCount: number; tokens: Record<string, TokenInfo[]> } {
  const rawTokens = styleTokens ?? [];

  // Build uuid→value map for resolving token references
  const tokenValueMap = new Map<string, string>();
  for (const t of rawTokens) {
    tokenValueMap.set(t.uuid, t.value);
  }

  const filtered = filterType
    ? rawTokens.filter((t: any) => t.type === filterType)
    : rawTokens;

  const tokens: TokenInfo[] = filtered.map((t: any) => {
    const info: TokenInfo = {
      uuid: t.uuid,
      name: t.name,
      type: t.type as StyleTokenType,
      value: t.value,
    };
    const resolved = resolveTokenValue(t.value, tokenValueMap);
    if (resolved !== t.value) {
      info.resolvedValue = resolved;
    }
    return info;
  });

  // Group by type for readability
  const grouped: Record<string, TokenInfo[]> = {};
  for (const t of tokens) {
    if (!grouped[t.type]) {grouped[t.type] = [];}
    grouped[t.type].push(t);
  }

  return { tokenCount: tokens.length, tokens: grouped };
}

// ---------------------------------------------------------------------------
// Token reference helpers — used by edit-tools and tree-reader
// ---------------------------------------------------------------------------

/** Create a `var(--token-<uuid>)` CSS reference for a token UUID. */
export function mkTokenRef(uuid: string): string {
  return `var(--token-${uuid})`;
}

/** Check if a CSS value is a `var(--token-<uuid>)` token reference. */
export function isTokenRef(value: string): boolean {
  return RE_TOKEN_REF.test(value);
}

/** Extract the token UUID from a `var(--token-<uuid>)` reference, or undefined. */
export function parseTokenRefUuid(value: string): string | undefined {
  const match = RE_TOKEN_REF.exec(value);
  return match?.[1];
}

/**
 * Collect all accessible tokens from a site and its dependencies.
 * Local tokens appear first, then dependency tokens.
 */
export function getAllStyleTokens(site: any): any[] {
  const tokens: any[] = [...(site.styleTokens ?? [])];
  for (const dep of site.projectDependencies ?? []) {
    tokens.push(...(dep.site?.styleTokens ?? []));
  }
  return tokens;
}

/**
 * Find a token by name (case-insensitive) or UUID.
 * Returns null if not found.
 * Throws if multiple tokens match by name (ambiguous).
 */
export function findToken(allTokens: any[], nameOrUuid: string): any | null {
  // UUID exact match first
  const byUuid = allTokens.find((t: any) => t.uuid === nameOrUuid);
  if (byUuid) return byUuid;

  // Case-insensitive name match
  const lowerName = nameOrUuid.toLowerCase();
  const byName = allTokens.filter(
    (t: any) => t.name?.toLowerCase() === lowerName
  );

  if (byName.length === 0) return null;
  if (byName.length === 1) return byName[0];

  // Ambiguous — multiple tokens share the same name
  const details = byName
    .map((t: any) => `  - "${t.name}" (type: ${t.type}, uuid: ${t.uuid})`)
    .join("\n");
  throw new Error(
    `Ambiguous token name "${nameOrUuid}" matches ${byName.length} tokens:\n${details}\n` +
      `Use a UUID to target the specific token.`
  );
}

/**
 * Get acceptable token types for a CSS property.
 * Returns null for properties where any token type could apply.
 *
 * Prevents mismatches like using a Color token for padding (which expects
 * a length/Spacing value). Lenient for unknown properties.
 */
export function getAcceptableTokenTypes(
  prop: string
): StyleTokenType[] | null {
  const kebab = prop.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`);

  // Color properties
  if (
    kebab === "color" ||
    kebab.endsWith("-color") ||
    kebab === "background"
  ) {
    return ["Color"];
  }

  // Font properties
  if (kebab === "font-size") return ["FontSize", "Spacing"];
  if (kebab === "font-family") return ["FontFamily"];
  if (kebab === "line-height") return ["LineHeight"];
  if (kebab === "opacity") return ["Opacity"];

  // Spacing/length properties
  if (/^(padding|margin)/.test(kebab)) return ["Spacing"];
  if (/^(row-gap|column-gap|gap)$/.test(kebab)) return ["Spacing"];
  if (
    /^(width|height|min-width|min-height|max-width|max-height)$/.test(kebab)
  ) {
    return ["Spacing", "FontSize"];
  }
  if (/^(top|right|bottom|left)$/.test(kebab)) return ["Spacing"];
  if (kebab.startsWith("border") && kebab.endsWith("-width"))
    return ["Spacing"];
  if (kebab === "outline-width") return ["Spacing"];
  if (kebab.includes("-radius")) return ["Spacing"];

  // Unknown property → allow any token type
  return null;
}
