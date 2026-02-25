/**
 * Token reader: extracts design tokens from the in-memory Site model.
 *
 * Design tokens (colors, spacing, fonts, etc.) define a project's design system.
 * Claude uses these to create pages that match the project's visual language.
 *
 * Token values can reference other tokens via var(--token-<uuid>). This module
 * resolves such chains to their final CSS values, with cycle detection.
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
