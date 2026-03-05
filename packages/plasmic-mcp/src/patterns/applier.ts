/**
 * Pattern Applier — instantiates a pattern's PlasmicElement tree into a component.
 *
 * Uses `addChild` directly with the full nested PlasmicElement tree, which is
 * handled recursively by `plasmicElementToTpl` in the WAB engine. A single
 * `addChild` call with the complete tree is sufficient for patterns.
 */

import type { PlasmicApiClient } from "../api-client.js";
import type { PlasmicElement } from "../types.js";
import { getPattern } from "./registry.js";
import { addChild } from "../edit-tools.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ApplyPatternResult {
  rootNodeUuid?: string;
  nodesCreated: number;
  warnings: string[];
  error?: string;
}

// ---------------------------------------------------------------------------
// Customisation
// ---------------------------------------------------------------------------

/**
 * Deep-clones a PlasmicElement tree and applies text substitutions.
 * Only substitutes in `value` fields (TextElement, ButtonElement) where the
 * current value exactly matches a customisation key's default text, OR where
 * the customisation key is explicitly declared by the pattern.
 */
export function applyCustomisations(
  tree: PlasmicElement,
  customisations: Record<string, string>,
  declaredKeys: string[]
): { result: PlasmicElement; warnings: string[] } {
  const warnings: string[] = [];

  // Warn about undeclared keys
  for (const key of Object.keys(customisations)) {
    if (!declaredKeys.includes(key)) {
      warnings.push(
        `Customisation key "${key}" is not declared by this pattern — ignored.`
      );
    }
  }

  // Build a substitution map from declared keys only
  const subs: Record<string, string> = {};
  for (const key of declaredKeys) {
    if (key in customisations) {
      subs[key] = customisations[key];
    }
  }

  if (Object.keys(subs).length === 0) {
    return { result: structuredClone(tree), warnings };
  }

  const cloned = structuredClone(tree);
  applySubstitutionsRecursive(cloned, subs);
  return { result: cloned, warnings };
}

/**
 * Known customisation key → field mapping.
 * Maps common customisation key names to the text values they should replace.
 */
const KEY_FIELD_MAP: Record<string, string> = {
  headingText: "headingText",
  subtitleText: "subtitleText",
  ctaLabel: "ctaLabel",
  bodyText: "bodyText",
  actionLabel: "actionLabel",
  titleText: "titleText",
  submitLabel: "submitLabel",
  brandName: "brandName",
  copyrightText: "copyrightText",
  sectionTitle: "sectionTitle",
  imageSrc: "imageSrc",
};

function applySubstitutionsRecursive(
  el: PlasmicElement,
  subs: Record<string, string>
): void {
  if (typeof el === "string") return;

  // Substitute text values
  if ("value" in el && typeof el.value === "string") {
    for (const [key, newValue] of Object.entries(subs)) {
      if (matchesCustomisationKey(key, el)) {
        el.value = newValue;
      }
    }
  }

  // Substitute image src
  if ("src" in el && typeof el.src === "string" && "imageSrc" in subs) {
    el.src = subs.imageSrc;
  }

  // Recurse into children
  if ("children" in el && el.children) {
    const children = Array.isArray(el.children)
      ? el.children
      : [el.children];
    for (const child of children) {
      applySubstitutionsRecursive(child, subs);
    }
  }
}

/**
 * Heuristic matching: a customisation key matches an element if the key name
 * maps logically to the element's role. We use the element's tag and value
 * position to infer the match.
 */
function matchesCustomisationKey(
  key: string,
  el: PlasmicElement
): boolean {
  if (typeof el === "string") return false;
  if (!("value" in el)) return false;

  const tag = "tag" in el ? el.tag : undefined;
  const elType = "type" in el ? el.type : undefined;

  switch (key) {
    case "headingText":
      return tag === "h1" || tag === "h2";
    case "subtitleText":
      return tag === "p" && !!("value" in el);
    case "ctaLabel":
    case "submitLabel":
      return elType === "button";
    case "bodyText":
      return tag === "p";
    case "actionLabel":
      return tag === "a";
    case "titleText":
      return tag === "h3";
    case "sectionTitle":
      return tag === "h2";
    case "brandName":
      return (
        tag === "span" &&
        typeof el.value === "string" &&
        el.value === "Brand"
      );
    case "copyrightText":
      return (
        tag === "p" &&
        typeof el.value === "string" &&
        el.value.startsWith("©")
      );
    default:
      return false;
  }
}

// ---------------------------------------------------------------------------
// Apply pattern
// ---------------------------------------------------------------------------

/**
 * Instantiate a named pattern into a component at the specified parent node.
 *
 * Flow:
 * 1. Look up pattern by name
 * 2. Deep-clone the tree and apply customisations
 * 3. Call addChild with the full PlasmicElement tree (WAB handles recursion)
 * 4. Return the root node UUID
 */
export async function applyPattern(
  apiClient: PlasmicApiClient,
  componentUuid: string,
  parentRef: string,
  patternName: string,
  customisations?: Record<string, string>,
  position?: string | number
): Promise<ApplyPatternResult> {
  const pattern = getPattern(patternName);
  if (!pattern) {
    return {
      nodesCreated: 0,
      warnings: [],
      error: `Pattern '${patternName}' not found. Call listPatterns to see available patterns.`,
    };
  }

  const allWarnings: string[] = [];

  // Apply customisations
  let tree: PlasmicElement;
  if (customisations && Object.keys(customisations).length > 0) {
    const { result, warnings } = applyCustomisations(
      pattern.tree,
      customisations,
      pattern.customisationKeys
    );
    tree = result;
    allWarnings.push(...warnings);
  } else {
    tree = structuredClone(pattern.tree);
  }

  // Insert the full tree with a single addChild call
  try {
    const result = await addChild(
      apiClient,
      componentUuid,
      parentRef,
      tree,
      position
    );
    return {
      rootNodeUuid: result.newNodeUuid,
      nodesCreated: countNodes(tree),
      warnings: allWarnings,
    };
  } catch (err) {
    return {
      nodesCreated: 0,
      warnings: allWarnings,
      error: `Failed to apply pattern '${patternName}': ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

/**
 * Count nodes in a PlasmicElement tree (for reporting).
 */
function countNodes(el: PlasmicElement): number {
  if (typeof el === "string") return 1;
  let count = 1;
  if ("children" in el && el.children) {
    const children = Array.isArray(el.children)
      ? el.children
      : [el.children];
    for (const child of children) {
      count += countNodes(child);
    }
  }
  return count;
}
