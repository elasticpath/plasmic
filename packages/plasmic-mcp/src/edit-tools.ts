/**
 * Core edit tool implementations for M2 P1 + variant-aware editing (P1.2).
 *
 * Each function performs a model mutation inside a ChangeRecorder session,
 * then saves the changes via SaveManager. The pattern is:
 *   1. Resolve the target node via node-resolver
 *   2. Wrap mutation in changeTracker.withRecording()
 *   3. Save the recorded changes via saveManager.saveChanges()
 *
 * P1.2: updateText and updateStyles accept an optional `variant` parameter.
 * When omitted, they target the base variant (backward compatible).
 * When provided, the variant is resolved by UUID, name (case-insensitive),
 * or CSS selector (e.g., ":hover"), and the edit targets that variant's
 * VariantSetting.
 *
 * Reference: specs/plasmic-incremental-writes.md § Edit Tools
 * Reference: specs/plasmic-variant-editing.md § Variant-Aware Editing
 */

import {
  isKnownTplTag,
  isKnownTplComponent,
  isKnownRawText,
  RawText,
  CustomCode,
} from "@/wab/shared/model/classes";
import { RSH } from "@/wab/shared/RuleSetHelpers";
import { TplMgr } from "@/wab/shared/TplMgr";
import { ensureVariantSetting } from "@/wab/shared/Variants";
import { mkTplTagX, mkTplInlinedText, mkTplComponentX } from "@/wab/shared/core/tpls";
import { flattenTpls } from "@/wab/shared/core/tpls";
import { requireSession } from "./session.js";
import { getChangeTracker } from "./change-tracker.js";
import type { RecordedChanges } from "./change-tracker.js";
import { SaveManager, type SaveResult } from "./save-manager.js";
import { PlasmicApiClient } from "./api-client.js";
import { resolveNode, requireSingleNode } from "./node-resolver.js";
import type { PlasmicElement, ComponentElement, DefaultComponentElement } from "./types.js";
import { isBatchActive, accumulateChanges } from "./batch-manager.js";
import { pushUndoOperation } from "./undo-manager.js";

// --- Helpers ---

/**
 * Expand a CSS box-model shorthand value (1-4 parts) into [top, right, bottom, left].
 * Follows the standard CSS shorthand algorithm.
 */
function expandBoxShorthand(value: string): [string, string, string, string] {
  const parts = value.trim().split(/\s+/);
  switch (parts.length) {
    case 1: return [parts[0], parts[0], parts[0], parts[0]];
    case 2: return [parts[0], parts[1], parts[0], parts[1]];
    case 3: return [parts[0], parts[1], parts[2], parts[1]];
    default: return [parts[0], parts[1], parts[2], parts[3]];
  }
}

/**
 * Sanitize CSS styles to prevent site invariant violations.
 *
 * Plasmic's site-invariants.ts rejects CSS shorthand properties that don't have
 * CSS initial values defined (via css-initials). This function expands common
 * shorthands to their longhand equivalents before they're stored in RuleSets.
 *
 * Expanded shorthands:
 *   - padding → paddingTop/Right/Bottom/Left
 *   - margin → marginTop/Right/Bottom/Left
 *   - gap → rowGap + columnGap
 *   - borderRadius → borderTopLeftRadius/TopRight/BottomRight/BottomLeft
 *   - borderWidth → borderTopWidth/Right/Bottom/Left
 *   - borderStyle → borderTopStyle/Right/Bottom/Left
 *   - borderColor → borderTopColor/Right/Bottom/Left
 *   - background-* → consolidated to `background` shorthand
 *
 * Accepts both camelCase and kebab-case input.
 */
export function sanitizeStyles(
  styles: Record<string, string>
): Record<string, string> {
  const result: Record<string, string> = {};
  let bgColor: string | undefined;
  let bgImage: string | undefined;
  const skippedLonghands: string[] = [];

  for (const [key, value] of Object.entries(styles)) {
    switch (key) {
      // --- Background shorthand handling ---
      case "backgroundColor":
      case "background-color":
        bgColor = value;
        break;
      case "backgroundImage":
      case "background-image":
        bgImage = value;
        break;
      case "backgroundSize":
      case "background-size":
      case "backgroundPosition":
      case "background-position":
      case "backgroundRepeat":
      case "background-repeat":
      case "backgroundAttachment":
      case "background-attachment":
      case "backgroundOrigin":
      case "background-origin":
      case "backgroundClip":
      case "background-clip":
        skippedLonghands.push(key);
        break;
      case "background":
        result["background"] = value;
        break;

      // --- Padding shorthand → longhands ---
      case "padding":
      case "padding-shorthand": {
        const [t, r, b, l] = expandBoxShorthand(value);
        result["paddingTop"] = t;
        result["paddingRight"] = r;
        result["paddingBottom"] = b;
        result["paddingLeft"] = l;
        break;
      }

      // --- Margin shorthand → longhands ---
      case "margin":
      case "margin-shorthand": {
        const [t, r, b, l] = expandBoxShorthand(value);
        result["marginTop"] = t;
        result["marginRight"] = r;
        result["marginBottom"] = b;
        result["marginLeft"] = l;
        break;
      }

      // --- Gap shorthand → rowGap + columnGap ---
      case "gap": {
        const parts = value.trim().split(/\s+/);
        result["row-gap"] = parts[0];
        result["column-gap"] = parts.length > 1 ? parts[1] : parts[0];
        break;
      }

      // --- Border-radius shorthand → corner longhands ---
      case "borderRadius":
      case "border-radius": {
        const [tl, tr, br, bl] = expandBoxShorthand(value);
        result["border-top-left-radius"] = tl;
        result["border-top-right-radius"] = tr;
        result["border-bottom-right-radius"] = br;
        result["border-bottom-left-radius"] = bl;
        break;
      }

      // --- Border-width shorthand → side longhands ---
      case "borderWidth":
      case "border-width": {
        const [t, r, b, l] = expandBoxShorthand(value);
        result["border-top-width"] = t;
        result["border-right-width"] = r;
        result["border-bottom-width"] = b;
        result["border-left-width"] = l;
        break;
      }

      // --- Border-style shorthand → side longhands ---
      case "borderStyle":
      case "border-style": {
        const [t, r, b, l] = expandBoxShorthand(value);
        result["border-top-style"] = t;
        result["border-right-style"] = r;
        result["border-bottom-style"] = b;
        result["border-left-style"] = l;
        break;
      }

      // --- Border-color shorthand → side longhands ---
      case "borderColor":
      case "border-color": {
        const [t, r, b, l] = expandBoxShorthand(value);
        result["border-top-color"] = t;
        result["border-right-color"] = r;
        result["border-bottom-color"] = b;
        result["border-left-color"] = l;
        break;
      }

      // --- Inset shorthand → longhands ---
      case "inset": {
        const [t, r, b, l] = expandBoxShorthand(value);
        result["top"] = t;
        result["right"] = r;
        result["bottom"] = b;
        result["left"] = l;
        break;
      }

      default:
        result[key] = value;
        break;
    }
  }

  // Don't override an explicit background shorthand
  if (!result["background"]) {
    if (bgImage) {
      result["background"] = bgImage;
    } else if (bgColor) {
      result["background"] = `linear-gradient(${bgColor}, ${bgColor})`;
    }
  }

  if (skippedLonghands.length > 0) {
    console.error(
      `[plasmic-mcp] Warning: Dropped unsupported background longhands: ${skippedLonghands.join(", ")}. ` +
        `Use the "background" shorthand instead.`
    );
  }

  return result;
}

/**
 * Find a component by UUID from the active session.
 * Throws if the component is not found.
 */
function findComponent(componentUuid: string): any {
  const session = requireSession();
  const component = session.site.components?.find(
    (c: any) => c.uuid === componentUuid
  );
  if (!component) {
    throw new Error(
      `Component UUID "${componentUuid}" not found. Use list-components to see available components.`
    );
  }
  return component;
}

/**
 * Get the IID for a component (for modifiedComponentIids).
 * Uses the bundler's addrOf to get the address.
 */
function getComponentIid(component: any): string | undefined {
  const session = requireSession();
  const addr = session.bundler.addrOf(component);
  return addr?.iid;
}

/**
 * Find a component by name or UUID in the active site and its dependencies.
 * Used by plasmicElementToTpl to resolve component references in
 * `{ type: "component", name: "..." }` elements.
 *
 * Searches local components first, then dependency project components.
 * Throws a descriptive error listing available names if not found.
 */
function findComponentByNameOrUuid(nameOrUuid: string): any {
  const session = requireSession();
  const site = session.site;

  // Search local components first
  const localComps: any[] = site.components ?? [];
  let comp = localComps.find(
    (c: any) => c.name === nameOrUuid || c.uuid === nameOrUuid
  );
  if (comp) return comp;

  // Search dependency project components
  const deps: any[] = site.projectDependencies ?? [];
  for (const dep of deps) {
    const depComps: any[] = dep.site?.components ?? [];
    comp = depComps.find(
      (c: any) => c.name === nameOrUuid || c.uuid === nameOrUuid
    );
    if (comp) return comp;
  }

  // Not found — build descriptive error with available names
  const availableNames = localComps
    .map((c: any) => c.name)
    .filter(Boolean);
  const depNames: string[] = [];
  for (const dep of deps) {
    for (const c of dep.site?.components ?? []) {
      if (c.name) depNames.push(c.name);
    }
  }

  let msg = `Component "${nameOrUuid}" not found.`;
  if (availableNames.length > 0) {
    msg += ` Available: ${availableNames.join(", ")}`;
  }
  if (depNames.length > 0) {
    msg += `. From dependencies: ${depNames.join(", ")}`;
  }
  throw new Error(msg);
}

/**
 * Find the parent of a node in the Tpl tree.
 * Returns null if the node is the root (has no parent).
 */
function findParent(
  tplTree: any,
  targetNode: any
): { parent: any; childIndex: number } | null {
  const allNodes = flattenTpls(tplTree);
  for (const node of allNodes) {
    const children = node.children ?? [];
    const idx = children.indexOf(targetNode);
    if (idx >= 0) {
      return { parent: node, childIndex: idx };
    }
  }
  return null;
}

/**
 * Check if `ancestor` is an ancestor of (or equal to) `descendant`.
 * Used for cycle detection in move-child.
 */
function isAncestorOf(ancestor: any, descendant: any): boolean {
  if (ancestor === descendant) {return true;}
  const children = ancestor.children ?? [];
  for (const child of children) {
    if (isAncestorOf(child, descendant)) {return true;}
  }
  return false;
}

/**
 * Insert a node into a parent's children array at a given position.
 * Also sets the child's parent pointer so Studio's $$$(tpl).root()
 * can traverse up to the component root.
 */
function insertChild(
  parent: any,
  child: any,
  position?: string | number
): void {
  if (!parent.children) {
    parent.children = [];
  }
  child.parent = parent;
  if (position === "first" || position === 0) {
    parent.children.unshift(child);
  } else if (
    position === "last" ||
    position === undefined ||
    position === null
  ) {
    parent.children.push(child);
  } else if (typeof position === "number") {
    parent.children.splice(position, 0, child);
  } else {
    // Default: append
    parent.children.push(child);
  }
}

/**
 * Save or accumulate changes depending on batch mode.
 * In batch mode: accumulates changes for a single save at end-batch.
 * In normal mode: saves immediately and pushes to undo stack.
 */
async function saveOrAccumulate(
  apiClient: PlasmicApiClient,
  changes: RecordedChanges,
  description: string,
  modifiedComponentIids?: string[]
): Promise<SaveResult> {
  if (isBatchActive()) {
    accumulateChanges(changes, modifiedComponentIids);
    const session = requireSession();
    return { revisionNum: session.revisionNum, incremental: true };
  }

  const saveManager = new SaveManager(apiClient);
  const save = await saveManager.saveChanges(changes, modifiedComponentIids);
  pushUndoOperation(description, changes);
  return save;
}

// --- Variant resolution ---

/**
 * Collect all available variant names for error messages.
 */
function collectAvailableVariantNames(site: any, component: any): string[] {
  const names: string[] = [];
  for (const group of site.globalVariantGroups ?? []) {
    for (const v of group.variants ?? []) {
      if (v.name) names.push(v.name);
    }
  }
  for (const group of component.variantGroups ?? []) {
    for (const v of group.variants ?? []) {
      if (v.name) names.push(v.name);
    }
  }
  for (const v of component.variants ?? []) {
    if (v.selectors?.length > 0) {
      names.push(v.selectors[0]);
    }
  }
  return names;
}

/**
 * Resolve a variant string to a Variant model object.
 *
 * Resolution order:
 *   1. UUID — exact match across all variant groups
 *   2. Selector — if string starts with ":", search style variants
 *   3. Name — case-insensitive search in global then component variant groups
 *
 * Throws descriptive errors for not-found or ambiguous matches.
 */
export function resolveVariant(site: any, component: any, variantStr: string): any {
  // 1. Search by UUID across all variant sources
  for (const group of site.globalVariantGroups ?? []) {
    for (const v of group.variants ?? []) {
      if (v.uuid === variantStr) return v;
    }
  }
  for (const group of component.variantGroups ?? []) {
    for (const v of group.variants ?? []) {
      if (v.uuid === variantStr) return v;
    }
  }
  for (const v of component.variants ?? []) {
    if (v.uuid === variantStr) return v;
  }

  // 2. Search by selector (e.g., ":hover", ":focus", ":pressed")
  if (variantStr.startsWith(":")) {
    const matches: Array<{ variant: any; source: string }> = [];

    for (const v of component.variants ?? []) {
      if (v.selectors?.includes(variantStr)) {
        matches.push({ variant: v, source: `style variant "${v.name ?? variantStr}"` });
      }
    }
    for (const group of component.variantGroups ?? []) {
      for (const v of group.variants ?? []) {
        if (v.selectors?.includes(variantStr)) {
          const alreadyFound = matches.some((m) => m.variant.uuid === v.uuid);
          if (!alreadyFound) {
            matches.push({ variant: v, source: `component group "${group.param?.variable?.name ?? "unnamed"}"` });
          }
        }
      }
    }

    if (matches.length === 1) return matches[0].variant;
    if (matches.length > 1) {
      const details = matches.map((m) => `  - ${m.source} (uuid: ${m.variant.uuid})`).join("\n");
      throw new Error(
        `Ambiguous variant "${variantStr}" matches ${matches.length} variants:\n${details}\n` +
          `Use a UUID to target the specific variant.`
      );
    }
    throw new Error(
      `No ${variantStr} variant found. Use list-variants to see available variants.`
    );
  }

  // 3. Search by name (case-insensitive)
  const lowerName = variantStr.toLowerCase();
  const matches: Array<{ variant: any; source: string }> = [];

  for (const group of site.globalVariantGroups ?? []) {
    for (const v of group.variants ?? []) {
      if (v.name?.toLowerCase() === lowerName) {
        matches.push({ variant: v, source: `global "${group.param?.variable?.name ?? group.type ?? "unnamed"}"` });
      }
    }
  }
  for (const group of component.variantGroups ?? []) {
    for (const v of group.variants ?? []) {
      if (v.name?.toLowerCase() === lowerName) {
        matches.push({ variant: v, source: `component "${group.param?.variable?.name ?? "unnamed"}"` });
      }
    }
  }

  if (matches.length === 1) return matches[0].variant;
  if (matches.length > 1) {
    const details = matches.map((m) => `  - ${m.source} (uuid: ${m.variant.uuid})`).join("\n");
    throw new Error(
      `Ambiguous variant "${variantStr}" matches ${matches.length} variants:\n${details}\n` +
        `Use a UUID to target the specific variant.`
    );
  }

  const available = collectAvailableVariantNames(site, component);
  throw new Error(
    `Variant "${variantStr}" not found.` +
      (available.length > 0 ? ` Available: ${available.join(", ")}` : "") +
      ` Use list-variants to see all variants.`
  );
}

// --- list-variants ---

export interface ListVariantsResult {
  globalVariants: Array<{
    group: string;
    uuid: string;
    type: string;
    variants: Array<{
      uuid: string;
      name: string;
      mediaQuery?: string;
    }>;
  }>;
  componentVariants: Array<{
    group: string;
    uuid: string;
    variants: Array<{
      uuid: string;
      name: string;
    }>;
  }>;
  styleVariants: Array<{
    uuid: string;
    name: string;
    selectors: string[];
    forTpl?: string;
  }>;
}

/**
 * Enumerate all variants for a component and the project's global variants.
 *
 * Returns three groups:
 *   - globalVariants: screen breakpoints and user-defined globals
 *   - componentVariants: custom variant groups on the component
 *   - styleVariants: interaction states (hover, focus, pressed) with selectors
 */
export function listVariants(site: any, component: any): ListVariantsResult {
  const globalVariants: ListVariantsResult["globalVariants"] = [];

  for (const group of site.globalVariantGroups ?? []) {
    globalVariants.push({
      group: group.param?.variable?.name ?? "unnamed",
      uuid: group.uuid,
      type: group.type ?? "unknown",
      variants: (group.variants ?? []).map((v: any) => ({
        uuid: v.uuid,
        name: v.name,
        ...(v.mediaQuery ? { mediaQuery: v.mediaQuery } : {}),
      })),
    });
  }

  const componentVariants: ListVariantsResult["componentVariants"] = [];
  const styleVariants: ListVariantsResult["styleVariants"] = [];
  const seenStyleUuids = new Set<string>();

  for (const group of component.variantGroups ?? []) {
    const regularVariants: Array<{ uuid: string; name: string }> = [];

    for (const v of group.variants ?? []) {
      if (v.selectors?.length > 0) {
        // Style variant — track separately
        if (!seenStyleUuids.has(v.uuid)) {
          seenStyleUuids.add(v.uuid);
          styleVariants.push({
            uuid: v.uuid,
            name: v.name ?? v.selectors[0],
            selectors: v.selectors,
            ...(v.forTpl?.uuid ? { forTpl: v.forTpl.uuid } : {}),
          });
        }
      } else {
        regularVariants.push({ uuid: v.uuid, name: v.name });
      }
    }

    if (regularVariants.length > 0) {
      componentVariants.push({
        group: group.param?.variable?.name ?? "unnamed",
        uuid: group.uuid,
        variants: regularVariants,
      });
    }
  }

  // Also check component.variants for style variants not in variantGroups
  for (const v of component.variants ?? []) {
    if (v.selectors?.length > 0 && !seenStyleUuids.has(v.uuid)) {
      seenStyleUuids.add(v.uuid);
      styleVariants.push({
        uuid: v.uuid,
        name: v.name ?? v.selectors[0],
        selectors: v.selectors,
        ...(v.forTpl?.uuid ? { forTpl: v.forTpl.uuid } : {}),
      });
    }
  }

  return { globalVariants, componentVariants, styleVariants };
}

// --- update-text ---

export interface UpdateTextResult {
  save: SaveResult;
  nodeName?: string;
  nodeUuid: string;
  previousText?: string;
  newText: string;
}

/**
 * Update the text content of a TplTag node.
 *
 * Finds the node via node-resolver, updates the target variant's RawText,
 * records the change, and saves.
 *
 * When `variant` is omitted, targets the base variant (backward compatible).
 * When provided, resolves the variant by UUID, name, or selector.
 *
 * Error if the node is a container (not a text element).
 */
export async function updateText(
  apiClient: PlasmicApiClient,
  componentUuid: string,
  nodeRef: string,
  text: string,
  variant?: string
): Promise<UpdateTextResult> {
  const component = findComponent(componentUuid);
  const result = resolveNode(component, nodeRef);
  const resolved = requireSingleNode(result, nodeRef);

  if (!isKnownTplTag(resolved.node)) {
    throw new Error(
      `Node "${nodeRef}" is not a TplTag and cannot have text updated.`
    );
  }

  const tpl = resolved.node;
  const session = requireSession();
  const tplMgr = new TplMgr({ site: session.site });

  // Container check uses base variant (structural, variant-independent)
  const baseVs = tplMgr.ensureBaseVariantSetting(tpl);
  const hasText = baseVs.text && isKnownRawText(baseVs.text);
  const isContainer =
    !hasText && tpl.children && tpl.children.length > 0;

  if (isContainer) {
    const layoutType =
      baseVs.rs?.values?.flexDirection === "column" ? "vbox" : "container";
    throw new Error(
      `Node "${resolved.name ?? nodeRef}" is a container (${layoutType}), not a text element. ` +
        `Use update-styles to change container properties, or target a text child node.`
    );
  }

  // Resolve target variant (null = base)
  const resolvedVariant = variant
    ? resolveVariant(session.site, component, variant)
    : null;

  const tracker = getChangeTracker();
  let previousText: string | undefined;

  const changes = tracker.withRecording(() => {
    // Get or create the VariantSetting for the target variant.
    // ensureVariantSetting must be inside withRecording because it may
    // create a new VariantSetting (pushing to tpl.vsettings).
    const vs = resolvedVariant
      ? ensureVariantSetting(tpl, [resolvedVariant])
      : baseVs;

    if (vs.text && isKnownRawText(vs.text)) {
      previousText = vs.text.text;
      vs.text.text = text;
    } else {
      // Create a new RawText instance
      previousText = undefined;
      vs.text = new RawText({ text, markers: [] });
    }
  });

  const componentIid = getComponentIid(component);
  const variantLabel = resolvedVariant ? ` [variant: ${resolvedVariant.name ?? variant}]` : "";
  const save = await saveOrAccumulate(
    apiClient,
    changes,
    `update-text: "${text}" on ${resolved.name ?? nodeRef}${variantLabel}`,
    componentIid ? [componentIid] : []
  );

  return {
    save,
    nodeName: resolved.name,
    nodeUuid: resolved.uuid,
    previousText,
    newText: text,
  };
}

// --- update-styles ---

export interface UpdateStylesResult {
  save: SaveResult;
  nodeName?: string;
  nodeUuid: string;
  updatedProperties: string[];
}

/**
 * Update CSS styles on a TplTag node.
 *
 * Uses RuleSetHelpers to set each property in the styles object.
 * Properties use camelCase (React CSSProperties format).
 *
 * When `variant` is omitted, targets the base variant (backward compatible).
 * When provided, resolves the variant by UUID, name, or selector, and
 * applies styles to that variant's VariantSetting.
 */
export async function updateStyles(
  apiClient: PlasmicApiClient,
  componentUuid: string,
  nodeRef: string,
  styles: Record<string, string>,
  variant?: string
): Promise<UpdateStylesResult> {
  const component = findComponent(componentUuid);
  const result = resolveNode(component, nodeRef);
  const resolved = requireSingleNode(result, nodeRef);

  if (!isKnownTplTag(resolved.node)) {
    throw new Error(
      `Node "${nodeRef}" is not a TplTag and cannot have styles updated.`
    );
  }

  const tpl = resolved.node;
  const session = requireSession();
  const tplMgr = new TplMgr({ site: session.site });

  // Resolve target variant (null = base)
  const resolvedVariant = variant
    ? resolveVariant(session.site, component, variant)
    : null;

  const tracker = getChangeTracker();
  const sanitized = sanitizeStyles(styles);
  const updatedProperties = Object.keys(sanitized);

  const changes = tracker.withRecording(() => {
    // Get or create the VariantSetting for the target variant.
    // ensureVariantSetting must be inside withRecording because it may
    // create a new VariantSetting (pushing to tpl.vsettings).
    const vs = resolvedVariant
      ? ensureVariantSetting(tpl, [resolvedVariant])
      : tplMgr.ensureBaseVariantSetting(tpl);

    const rsh = RSH(vs.rs, tpl);
    rsh.merge(sanitized);
  });

  const componentIid = getComponentIid(component);
  const variantLabel = resolvedVariant ? ` [variant: ${resolvedVariant.name ?? variant}]` : "";
  const save = await saveOrAccumulate(
    apiClient,
    changes,
    `update-styles: [${updatedProperties.join(", ")}] on ${resolved.name ?? nodeRef}${variantLabel}`,
    componentIid ? [componentIid] : []
  );

  return {
    save,
    nodeName: resolved.name,
    nodeUuid: resolved.uuid,
    updatedProperties,
  };
}

// --- add-child ---

export interface AddChildResult {
  save: SaveResult;
  parentName?: string;
  parentUuid: string;
  newNodeUuid?: string;
  position: string | number;
}

/**
 * Convert a PlasmicElement JSON tree to a live Tpl node.
 *
 * Creates TplTag nodes for HTML primitives (div, text, img, button, input)
 * and TplComponent nodes for component references ({ type: "component" }).
 *
 * Uses mkTplTagX/mkTplComponentX for node creation with the base variant
 * passed directly (since newly created nodes aren't attached to a component
 * yet, TplMgr can't determine their owning component for variant lookup).
 *
 * This approach avoids elementSchemaToTpl which pulls in 30+ dependencies.
 */
function plasmicElementToTpl(
  element: PlasmicElement,
  tplMgr: TplMgr,
  baseVariant: any
): any {
  // String elements become text nodes
  if (typeof element === "string") {
    return mkTplInlinedText(element, [baseVariant], "div", { baseVariant });
  }

  // Component types create TplComponent nodes, not TplTag nodes.
  // Resolved by name or UUID from the site model (local + dependency components).
  if (element.type === "component" || element.type === "default-component") {
    const componentRef = element.type === "component"
      ? (element as ComponentElement).name
      : (element as DefaultComponentElement).kind;

    const targetComponent = findComponentByNameOrUuid(componentRef);

    // Convert children to TplNodes for the component's default slot
    const childElements = "children" in element && element.children
      ? Array.isArray(element.children)
        ? element.children
        : [element.children]
      : [];

    const childTpls = childElements.map((child) =>
      plasmicElementToTpl(child, tplMgr, baseVariant)
    );

    // Convert props to args dict for mkTplComponentX.
    // Each prop value is wrapped in a CustomCode expression (same as codeLit).
    // Slot params are rejected — use the "children" field for slot content.
    const propsField = "props" in element ? element.props : undefined;
    let args: Record<string, any> | undefined;
    if (propsField && Object.keys(propsField).length > 0) {
      args = {};
      const componentParams: any[] = targetComponent.params ?? [];
      const paramByName = new Map<string, any>();
      for (const p of componentParams) {
        if (p.variable?.name) {
          paramByName.set(p.variable.name, p);
        }
      }

      for (const [key, value] of Object.entries(propsField)) {
        const param = paramByName.get(key);
        if (!param) {
          const available = [...paramByName.keys()].sort().join(", ");
          throw new Error(
            `Unknown prop "${key}" on component "${targetComponent.name}". ` +
            `Available params: ${available || "(none)"}`
          );
        }
        // Slot params must use the "children" field, not "props"
        if (param.tplSlot) {
          throw new Error(
            `Prop "${key}" is a slot on component "${targetComponent.name}". ` +
            `Use the "children" field to pass slot content instead.`
          );
        }
        // Convert value to CustomCode expression (same as WAB's codeLit)
        const code = value === undefined ? "undefined" : JSON.stringify(value);
        if (code === undefined) {
          throw new Error(
            `Prop "${key}" on component "${targetComponent.name}" has a ` +
            `non-serializable value (${typeof value}).`
          );
        }
        args[key] = new CustomCode({ code, fallback: null });
      }
    }

    const tpl = mkTplComponentX({
      component: targetComponent,
      baseVariant,
      ...(childTpls.length > 0 ? { children: childTpls } : {}),
      ...(args ? { args } : {}),
    });

    return tpl;
  }

  // Map element type to HTML tag
  let tag: string;
  switch (element.type) {
    case "box":
    case "vbox":
    case "hbox":
    case "page-section":
      tag = "div";
      break;
    case "text":
      tag = (element as any).tag ?? "div";
      break;
    case "img":
      tag = "img";
      break;
    case "button":
      tag = "button";
      break;
    case "input":
    case "password":
    case "textarea":
      tag = element.type === "textarea" ? "textarea" : "input";
      break;
    default:
      tag = "div";
      break;
  }

  // Text-bearing elements: use mkTplInlinedText (same as Studio)
  const textValue = (element.type === "text" || element.type === "button")
    ? (element as any).value
    : undefined;

  if (textValue !== undefined) {
    const tpl = mkTplInlinedText(textValue, [baseVariant], tag, { baseVariant });
    const vs = tpl.vsettings[0];

    // Apply explicit styles
    if ("styles" in element && element.styles) {
      const rsh = RSH(vs.rs, tpl);
      rsh.merge(sanitizeStyles(element.styles));
    }

    return tpl;
  }

  // Container elements: build children recursively
  const childElements = "children" in element && element.children
    ? Array.isArray(element.children)
      ? element.children
      : [element.children]
    : [];

  const childTpls = childElements.map((child) =>
    plasmicElementToTpl(child, tplMgr, baseVariant)
  );

  const tpl = mkTplTagX(tag, { baseVariant, styles: {} }, ...childTpls);

  // Set parent pointers for children (mkTplTagX leaves them as null).
  // Required so Studio's $$$(tpl).root() can traverse up to the component root.
  for (const child of childTpls) {
    child.parent = tpl;
  }

  // Access the base variant setting created by mkTplTagX
  const vs = tpl.vsettings[0];

  // Apply layout styles for container types
  if (element.type === "vbox") {
    const rsh = RSH(vs.rs, tpl);
    rsh.merge({ display: "flex", flexDirection: "column" });
  } else if (element.type === "hbox") {
    const rsh = RSH(vs.rs, tpl);
    rsh.merge({ display: "flex", flexDirection: "row" });
  }

  // Apply explicit styles
  if ("styles" in element && element.styles) {
    const rsh = RSH(vs.rs, tpl);
    rsh.merge(sanitizeStyles(element.styles));
  }

  // Set image src
  if (element.type === "img" && "src" in element) {
    if (!vs.attrs) {vs.attrs = {};}
    vs.attrs.src = new CustomCode({
      code: JSON.stringify((element as any).src),
      fallback: null,
    });
  }

  return tpl;
}

/**
 * Add a child node to a parent TplTag.
 *
 * Converts a PlasmicElement JSON tree to Tpl nodes — TplTag for HTML
 * primitives, TplComponent for `{ type: "component" }` references.
 * Inserts into the parent at the specified position, and saves.
 *
 * Error if the parent is a text node (cannot have children).
 */
export async function addChild(
  apiClient: PlasmicApiClient,
  componentUuid: string,
  parentRef: string,
  child: PlasmicElement,
  position?: string | number
): Promise<AddChildResult> {
  const component = findComponent(componentUuid);
  const result = resolveNode(component, parentRef);
  const resolved = requireSingleNode(result, parentRef);

  if (!isKnownTplTag(resolved.node)) {
    throw new Error(
      `Node "${parentRef}" is not a TplTag and cannot have children added.`
    );
  }

  const parent = resolved.node;
  const session = requireSession();
  const tplMgr = new TplMgr({ site: session.site });

  // Check if parent is a text node (not a container)
  const parentVs = tplMgr.ensureBaseVariantSetting(parent);
  if (parentVs.text && isKnownRawText(parentVs.text) && (!parent.children || parent.children.length === 0)) {
    throw new Error(
      `Node "${resolved.name ?? parentRef}" is a text element and cannot have children. ` +
        `Target a container node instead.`
    );
  }

  // Get the base variant from the component (not from the node) so we can
  // pass it to plasmicElementToTpl for newly created detached nodes.
  const baseVariant = tplMgr.ensureBaseVariant(component);

  const tracker = getChangeTracker();
  let newTpl: any;

  const changes = tracker.withRecording(() => {
    newTpl = plasmicElementToTpl(child, tplMgr, baseVariant);
    insertChild(parent, newTpl, position);
  });

  const componentIid = getComponentIid(component);
  const save = await saveOrAccumulate(
    apiClient,
    changes,
    `add-child: ${typeof child === "string" ? "text" : child.type} to ${resolved.name ?? parentRef}`,
    componentIid ? [componentIid] : []
  );

  return {
    save,
    parentName: resolved.name,
    parentUuid: resolved.uuid,
    newNodeUuid: newTpl?.uuid,
    position: position ?? "last",
  };
}

// --- remove-child ---

export interface RemoveChildResult {
  save: SaveResult;
  removedName?: string;
  removedUuid: string;
}

/**
 * Remove a child node from the Tpl tree.
 *
 * Prevents removal of the component's root node.
 * The removed node's IID is included in toDeleteIids for the server.
 */
export async function removeChild(
  apiClient: PlasmicApiClient,
  componentUuid: string,
  nodeRef: string
): Promise<RemoveChildResult> {
  const component = findComponent(componentUuid);
  const result = resolveNode(component, nodeRef);
  const resolved = requireSingleNode(result, nodeRef);

  // Prevent removal of root node
  if (resolved.node === component.tplTree) {
    throw new Error(
      `Cannot remove the root node of component "${component.name}". ` +
        `Remove individual child nodes instead.`
    );
  }

  const parentInfo = findParent(component.tplTree, resolved.node);
  if (!parentInfo) {
    throw new Error(
      `Could not find parent of node "${nodeRef}". The node may already be detached.`
    );
  }

  const tracker = getChangeTracker();

  const changes = tracker.withRecording(() => {
    parentInfo.parent.children.splice(parentInfo.childIndex, 1);
  });

  const componentIid = getComponentIid(component);
  const save = await saveOrAccumulate(
    apiClient,
    changes,
    `remove-child: ${resolved.name ?? nodeRef}`,
    componentIid ? [componentIid] : []
  );

  return {
    save,
    removedName: resolved.name,
    removedUuid: resolved.uuid,
  };
}

// --- move-child ---

export interface MoveChildResult {
  save: SaveResult;
  movedName?: string;
  movedUuid: string;
  newParentName?: string;
  newParentUuid: string;
  position: string | number;
}

/**
 * Move a child node to a new parent within the same component.
 *
 * Removes from current parent, inserts into new parent at position.
 * Detects and prevents cycles (moving a node into its own descendant).
 */
export async function moveChild(
  apiClient: PlasmicApiClient,
  componentUuid: string,
  nodeRef: string,
  newParentRef: string,
  position?: string | number
): Promise<MoveChildResult> {
  const component = findComponent(componentUuid);

  // Resolve both nodes
  const nodeResult = resolveNode(component, nodeRef);
  const resolved = requireSingleNode(nodeResult, nodeRef);

  const parentResult = resolveNode(component, newParentRef);
  const newParent = requireSingleNode(parentResult, newParentRef);

  if (!isKnownTplTag(newParent.node)) {
    throw new Error(
      `New parent "${newParentRef}" is not a TplTag and cannot have children.`
    );
  }

  // Prevent moving root node
  if (resolved.node === component.tplTree) {
    throw new Error(
      `Cannot move the root node of component "${component.name}".`
    );
  }

  // Detect cycles: cannot move a node into its own descendant
  if (isAncestorOf(resolved.node, newParent.node)) {
    throw new Error(
      `Cannot move "${resolved.name ?? nodeRef}" into its own descendant "${newParent.name ?? newParentRef}".`
    );
  }

  // Find current parent
  const currentParentInfo = findParent(component.tplTree, resolved.node);
  if (!currentParentInfo) {
    throw new Error(
      `Could not find current parent of node "${nodeRef}".`
    );
  }

  const tracker = getChangeTracker();

  const changes = tracker.withRecording(() => {
    // Remove from current parent
    currentParentInfo.parent.children.splice(
      currentParentInfo.childIndex,
      1
    );
    // Insert into new parent
    insertChild(newParent.node, resolved.node, position);
  });

  const componentIid = getComponentIid(component);
  const save = await saveOrAccumulate(
    apiClient,
    changes,
    `move-child: ${resolved.name ?? nodeRef} to ${newParent.name ?? newParentRef}`,
    componentIid ? [componentIid] : []
  );

  return {
    save,
    movedName: resolved.name,
    movedUuid: resolved.uuid,
    newParentName: newParent.name,
    newParentUuid: newParent.uuid,
    position: position ?? "last",
  };
}

// --- rename-component ---

export interface RenameComponentResult {
  save: SaveResult;
  oldName: string;
  newName: string;
  componentUuid: string;
  newPath?: string;
}

/**
 * Rename a page or component.
 *
 * Uses TplMgr.renameComponent() which handles name deduplication
 * automatically (e.g., "Card" → "Card 2" if "Card" already exists).
 * Optionally updates the page URL path if the component is a page.
 */
export async function renameComponent(
  apiClient: PlasmicApiClient,
  componentUuid: string,
  newName: string,
  newPath?: string
): Promise<RenameComponentResult> {
  const component = findComponent(componentUuid);
  const oldName = component.name;
  const session = requireSession();
  const tplMgr = new TplMgr({ site: session.site });
  const tracker = getChangeTracker();

  const changes = tracker.withRecording(() => {
    tplMgr.renameComponent(component, newName);
    if (newPath !== undefined && component.pageMeta) {
      component.pageMeta.path = newPath;
    }
  });

  const componentIid = getComponentIid(component);
  const save = await saveOrAccumulate(
    apiClient,
    changes,
    `rename-component: "${oldName}" → "${component.name}"`,
    componentIid ? [componentIid] : []
  );

  return {
    save,
    oldName,
    newName: component.name, // May differ from input due to deduplication
    componentUuid,
    // Only report newPath if it was actually applied (component must be a page)
    newPath: (newPath !== undefined && component.pageMeta) ? newPath : component.pageMeta?.path,
  };
}

// --- update-page-meta ---

export interface UpdatePageMetaResult {
  save: SaveResult;
  componentUuid: string;
  componentName: string;
  updatedFields: string[];
}

/**
 * Update page-level SEO metadata.
 *
 * Sets fields on component.pageMeta: title, description, openGraphImage,
 * canonical, path. Only fields explicitly provided are updated; omitted
 * fields are left unchanged.
 *
 * Throws if the target component is not a page (has no pageMeta).
 */
export async function updatePageMeta(
  apiClient: PlasmicApiClient,
  componentUuid: string,
  meta: {
    title?: string;
    description?: string;
    openGraphImage?: string;
    canonical?: string;
    path?: string;
  }
): Promise<UpdatePageMetaResult> {
  const component = findComponent(componentUuid);

  if (!component.pageMeta) {
    throw new Error(
      `Component "${component.name}" is not a page — no page metadata to update. ` +
        `Only pages (components with a URL path) have metadata.`
    );
  }

  const tracker = getChangeTracker();
  const updatedFields: string[] = [];

  const changes = tracker.withRecording(() => {
    if (meta.title !== undefined) {
      component.pageMeta.title = meta.title;
      updatedFields.push("title");
    }
    if (meta.description !== undefined) {
      component.pageMeta.description = meta.description;
      updatedFields.push("description");
    }
    if (meta.openGraphImage !== undefined) {
      component.pageMeta.openGraphImage = meta.openGraphImage;
      updatedFields.push("openGraphImage");
    }
    if (meta.canonical !== undefined) {
      component.pageMeta.canonical = meta.canonical;
      updatedFields.push("canonical");
    }
    if (meta.path !== undefined) {
      component.pageMeta.path = meta.path;
      updatedFields.push("path");
    }
  });

  const componentIid = getComponentIid(component);
  const save = await saveOrAccumulate(
    apiClient,
    changes,
    `update-page-meta: [${updatedFields.join(", ")}] on ${component.name}`,
    componentIid ? [componentIid] : []
  );

  return {
    save,
    componentUuid,
    componentName: component.name,
    updatedFields,
  };
}

// --- delete-component ---

export interface DeleteComponentResult {
  save: SaveResult;
  deletedName: string;
  deletedUuid: string;
}

/**
 * Find components that reference `targetComponent` via TplComponent instances.
 * Used by deleteComponent to prevent deletion of referenced components.
 */
function findReferencingComponents(site: any, targetComponent: any): any[] {
  const referencingComps: any[] = [];
  for (const comp of site.components ?? []) {
    if (comp === targetComponent) continue;
    const allNodes = flattenTpls(comp.tplTree);
    for (const node of allNodes) {
      if (isKnownTplComponent(node) && node.component === targetComponent) {
        referencingComps.push(comp);
        break;
      }
    }
  }
  return referencingComps;
}

/**
 * Delete a component or page from the project.
 *
 * Checks for references from other components (TplComponent instances).
 * If references exist and `force` is not true, throws with a list of
 * referencing component names. Uses TplMgr.removeComponent() for the
 * actual deletion, which handles arena cleanup and page link removal.
 */
export async function deleteComponent(
  apiClient: PlasmicApiClient,
  componentUuid: string,
  force?: boolean
): Promise<DeleteComponentResult> {
  const component = findComponent(componentUuid);
  const session = requireSession();
  const site = session.site;

  // Check for references before deletion
  const referencingComps = findReferencingComponents(site, component);
  if (referencingComps.length > 0 && !force) {
    const names = referencingComps.map((c: any) => c.name).join(", ");
    throw new Error(
      `Cannot delete "${component.name}": referenced by ${names}. ` +
        `Use force: true to override.`
    );
  }

  const tplMgr = new TplMgr({ site });
  const tracker = getChangeTracker();
  const deletedName = component.name;

  const changes = tracker.withRecording(() => {
    tplMgr.removeComponent(component);
  });

  const componentIid = getComponentIid(component);
  const save = await saveOrAccumulate(
    apiClient,
    changes,
    `delete-component: "${deletedName}"`,
    componentIid ? [componentIid] : []
  );

  return {
    save,
    deletedName,
    deletedUuid: componentUuid,
  };
}
