/**
 * Core edit tool implementations for M2 P1.
 *
 * Each function performs a model mutation inside a ChangeRecorder session,
 * then saves the changes via SaveManager. The pattern is:
 *   1. Resolve the target node via node-resolver
 *   2. Wrap mutation in changeTracker.withRecording()
 *   3. Save the recorded changes via saveManager.saveChanges()
 *
 * All tools operate on the base variant only (M2 limitation).
 *
 * Reference: specs/plasmic-incremental-writes.md § Edit Tools
 */

import {
  isKnownTplTag,
  isKnownRawText,
  RawText,
  CustomCode,
} from "@/wab/shared/model/classes";
import { RSH } from "@/wab/shared/RuleSetHelpers";
import { TplMgr } from "@/wab/shared/TplMgr";
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
 * Finds the node via node-resolver, updates the base variant's RawText,
 * records the change, and saves.
 *
 * Error if the node is a container (not a text element).
 */
export async function updateText(
  apiClient: PlasmicApiClient,
  componentUuid: string,
  nodeRef: string,
  text: string
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
  const vs = tplMgr.ensureBaseVariantSetting(tpl);

  // Check if this is a text-capable node
  const hasText = vs.text && isKnownRawText(vs.text);
  const isContainer =
    !hasText && tpl.children && tpl.children.length > 0;

  if (isContainer) {
    const layoutType =
      vs.rs?.values?.flexDirection === "column" ? "vbox" : "container";
    throw new Error(
      `Node "${resolved.name ?? nodeRef}" is a container (${layoutType}), not a text element. ` +
        `Use update-styles to change container properties, or target a text child node.`
    );
  }

  const tracker = getChangeTracker();
  let previousText: string | undefined;

  const changes = tracker.withRecording(() => {
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
  const save = await saveOrAccumulate(
    apiClient,
    changes,
    `update-text: "${text}" on ${resolved.name ?? nodeRef}`,
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
 * Update CSS styles on a TplTag node's base variant.
 *
 * Uses RuleSetHelpers to set each property in the styles object.
 * Properties use camelCase (React CSSProperties format).
 */
export async function updateStyles(
  apiClient: PlasmicApiClient,
  componentUuid: string,
  nodeRef: string,
  styles: Record<string, string>
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
  const vs = tplMgr.ensureBaseVariantSetting(tpl);

  const tracker = getChangeTracker();
  const sanitized = sanitizeStyles(styles);
  const updatedProperties = Object.keys(sanitized);

  const changes = tracker.withRecording(() => {
    const rsh = RSH(vs.rs, tpl);
    rsh.merge(sanitized);
  });

  const componentIid = getComponentIid(component);
  const save = await saveOrAccumulate(
    apiClient,
    changes,
    `update-styles: [${updatedProperties.join(", ")}] on ${resolved.name ?? nodeRef}`,
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

    const tpl = mkTplComponentX({
      component: targetComponent,
      baseVariant,
      ...(childTpls.length > 0 ? { children: childTpls } : {}),
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
