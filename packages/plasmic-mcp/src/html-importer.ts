/**
 * HTML Import Bridge — converts raw HTML+CSS into a sequence of MCP edit-tool
 * calls that reconstruct the same structure inside Plasmic.
 *
 * WHY this file exists:
 * LLMs have deep HTML/CSS training but almost no Plasmic WAB training.
 * Asking an LLM to emit HTML is far more reliable than asking it to
 * orchestrate dozens of addChild / updateStyles calls with correct UUIDs.
 * This bridge lets the LLM express intent in HTML and the MCP translates
 * it faithfully into the Plasmic node graph.
 *
 * Architecture:
 *   1. parseHtmlToTree()  — pure DOM/CSS parsing, no side-effects, testable in isolation
 *   2. wiTreeToEditCalls() — maps the parsed tree to edit-tool calls (async, mutates model)
 *   3. importHtml()        — thin orchestrator: parse → map → invalidate cache → return result
 *
 * Dependencies:
 *   - jsdom  (DOM parsing + CSS selector matching in Node.js)
 *   - css-tree (structured CSS rule parsing, already a project dependency)
 *
 * Reference: .ralph/specs/design-html-bridge.md
 */

import { JSDOM } from "jsdom";
// css-tree v3 has no built-in TypeScript types.
// Typed via packages/plasmic-mcp/src/css-tree.d.ts
import * as csstree from "css-tree";
import type { PlasmicApiClient } from "./api-client.js";
import {
  addChild,
  updateStyles,
  updateText,
  updateAttrs,
  createStyleVariant,
} from "./edit-tools.js";
import { invalidateNodeCache } from "./node-resolver.js";
import type { PlasmicElement } from "./types.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Tags that must never produce nodes in Plasmic.
 * These are either non-visual, security-sensitive, or not representable.
 */
const IGNORED_TAGS = new Set([
  "script",
  "style",
  "link",
  "meta",
  "head",
  "noscript",
  "iframe",
  "object",
  "embed",
  "applet",
  "base",
  "title",
]);

/**
 * Pseudo-class and pseudo-element selectors that Plasmic supports as
 * style variants. Must match VALID_STYLE_SELECTORS in edit-tools.ts exactly.
 */
const HANDLED_PSEUDO_SELECTORS = new Set([
  ":hover",
  ":active",
  ":focus",
  ":focus-visible",
  ":focus-within",
  ":disabled",
  ":visited",
  ":link",
  "::placeholder",
]);

// ---------------------------------------------------------------------------
// Intermediate parsed-tree types
// ---------------------------------------------------------------------------

/** A CSS rule matched to an element, with the selector stripped of any pseudo-class. */
interface MatchedRule {
  /** The base selector (pseudo-class removed), used only for matching — not stored. */
  baseSelector: string;
  /** The pseudo-class/element suffix, e.g. ":hover". Undefined = base variant. */
  pseudo?: string;
  /** Media query max-width in pixels, e.g. 768 from `@media (max-width: 768px)`. */
  mediaMaxWidth?: number;
  /** CSS property → value pairs (camelCase keys). */
  styles: Record<string, string>;
}

/** Represents a parsed DOM node ready to be mapped to edit-tool calls. */
export type ParsedNode =
  | ParsedContainer
  | ParsedText
  | ParsedImage
  | ParsedButton
  | ParsedInput
  | ParsedSvg
  | ParsedComponent;

interface ParsedBase {
  /** camelCase CSS properties for the base variant. */
  styles: Record<string, string>;
  /** Pseudo-class variants with their style overrides. Key = selector e.g. ":hover". */
  pseudoStyles: Map<string, Record<string, string>>;
  /** @media max-width variants. Key = pixel value (number). */
  mediaStyles: Map<number, Record<string, string>>;
  /** HTML attributes (excluding class, style). */
  attrs: Record<string, string>;
}

interface ParsedContainer extends ParsedBase {
  kind: "container";
  tag: string;
  children: ParsedNode[];
}

interface ParsedText extends ParsedBase {
  kind: "text";
  tag: string;
  /** Concatenated text content of the element. */
  value: string;
}

interface ParsedImage extends ParsedBase {
  kind: "image";
  src: string;
}

interface ParsedButton extends ParsedBase {
  kind: "button";
  value?: string;
}

interface ParsedInput extends ParsedBase {
  kind: "input";
  inputType: "input" | "password" | "textarea";
}

interface ParsedSvg extends ParsedBase {
  kind: "svg";
  /** Raw SVG markup stored for dangerouslySetInnerHTML. */
  svgHtml: string;
}

interface ParsedComponent extends ParsedBase {
  kind: "component";
  /** Name of the Plasmic component to instantiate. */
  componentName: string;
  /** Children to pass into the component's default slot. */
  children: ParsedNode[];
}

// ---------------------------------------------------------------------------
// Public result type
// ---------------------------------------------------------------------------

export interface ImportHtmlResult {
  /** UUID of the root node created in Plasmic. Undefined on failure. */
  rootNodeUuid?: string;
  /** Total number of Plasmic nodes created. */
  nodesCreated: number;
  /** Non-fatal warnings (e.g. media variants skipped, SVG stored as raw HTML). */
  warnings: string[];
  /** Set when the import could not proceed at all. */
  error?: string;
}

// ---------------------------------------------------------------------------
// CSS utility helpers
// ---------------------------------------------------------------------------

/**
 * Convert a CSS kebab-case property name to camelCase as expected by edit-tools.
 * e.g. "font-size" → "fontSize", "-webkit-transform" → "WebkitTransform"
 */
function kebabToCamel(property: string): string {
  return property.replace(/-([a-z])/g, (_, ch: string) => ch.toUpperCase());
}

/**
 * Extract all CSS declarations from a css-tree Block node as camelCase key→value pairs.
 */
function extractDeclarations(block: csstree.Block): Record<string, string> {
  const result: Record<string, string> = {};
  csstree.walk(block, (node: csstree.CssNode) => {
    if (node.type === "Declaration") {
      const decl = node as csstree.Declaration;
      const key = kebabToCamel(decl.property);
      const value = csstree.generate(decl.value);
      result[key] = value;
    }
  });
  return result;
}

/**
 * Split a compound CSS selector into its base part and any trailing pseudo
 * suffix that Plasmic treats as a style variant.
 *
 * e.g. ".btn:hover"       → { base: ".btn",    pseudo: ":hover" }
 *      ".card::placeholder" → { base: ".card",  pseudo: "::placeholder" }
 *      ".hero"             → { base: ".hero",   pseudo: undefined }
 *
 * When the selector contains multiple pseudo-classes we only peel the last
 * handled one so the base selector still matches jsdom's element.matches().
 */
function splitPseudo(
  selector: string
): { base: string; pseudo: string | undefined } {
  // Walk handled pseudo selectors from longest to shortest to avoid partial matches.
  const sorted = [...HANDLED_PSEUDO_SELECTORS].sort(
    (a, b) => b.length - a.length
  );
  for (const pseudo of sorted) {
    const idx = selector.lastIndexOf(pseudo);
    if (idx !== -1) {
      const base = selector.slice(0, idx).trim() || "*";
      return { base, pseudo };
    }
  }
  return { base: selector, pseudo: undefined };
}

/**
 * Parse all CSS rules from a raw CSS string using css-tree.
 * Returns a flat list of MatchedRule descriptors ready for element matching.
 *
 * Handles:
 *   - Plain rules: `.foo { color: red }`
 *   - Pseudo-class rules: `.foo:hover { color: blue }`
 *   - Media queries: `@media (max-width: 768px) { .foo { font-size: 14px } }`
 *
 * Silently skips malformed rules — we prefer partial output over a hard failure.
 */
function parseCssRules(css: string): MatchedRule[] {
  const rules: MatchedRule[] = [];

  let ast: csstree.CssNode;
  try {
    ast = csstree.parse(css, { parseValue: false, onParseError: () => {} });
  } catch {
    // Malformed CSS — return empty, importer will fall back to inline styles only.
    return rules;
  }

  csstree.walk(ast, function (this: csstree.WalkContext, node: csstree.CssNode) {
    if (node.type === "Rule") {
      const rule = node as csstree.Rule;
      // Determine if we're inside a @media at-rule.
      let mediaMaxWidth: number | undefined;
      // The `atrule` ancestor is two levels up in css-tree's walk context
      // (Atrule → Block → Rule). We can inspect `this.atrule` if available.
      if (this.atrule && this.atrule.type === "Atrule" && this.atrule.name === "media") {
        const prelude = this.atrule.prelude;
        if (prelude) {
          const mediaText = csstree.generate(prelude);
          // Match `(max-width: NNNpx)` — simple heuristic, covers the common case.
          const match = mediaText.match(/max-width\s*:\s*(\d+(?:\.\d+)?)px/i);
          if (match) {
            mediaMaxWidth = parseFloat(match[1]);
          }
        }
      }

      const selectorList = rule.prelude;
      if (!selectorList || selectorList.type !== "SelectorList") return;
      if (!rule.block) return;

      const declarations = extractDeclarations(rule.block);
      if (Object.keys(declarations).length === 0) return;

      // css-tree's SelectorList contains Selector nodes; generate each as a string.
      csstree.walk(selectorList, (selectorNode: csstree.CssNode) => {
        if (selectorNode.type === "Selector") {
          const rawSelector = csstree.generate(selectorNode).trim();
          const { base, pseudo } = splitPseudo(rawSelector);
          rules.push({
            baseSelector: base,
            pseudo,
            mediaMaxWidth,
            styles: { ...declarations },
          });
        }
      });
    }
  });

  return rules;
}

/**
 * Match a set of pre-parsed CSS rules against a jsdom Element.
 * Returns merged styles grouped by variant type.
 *
 * Matching is intentionally conservative: we call element.matches() with a
 * try/catch because jsdom may not support every selector syntax.
 */
function matchRulesToElement(
  element: Element,
  rules: MatchedRule[]
): {
  base: Record<string, string>;
  pseudo: Map<string, Record<string, string>>;
  media: Map<number, Record<string, string>>;
} {
  const base: Record<string, string> = {};
  const pseudo = new Map<string, Record<string, string>>();
  const media = new Map<number, Record<string, string>>();

  for (const rule of rules) {
    let matches = false;
    try {
      matches = element.matches(rule.baseSelector);
    } catch {
      // Selector syntax not supported by jsdom — skip.
      continue;
    }
    if (!matches) continue;

    if (rule.mediaMaxWidth !== undefined) {
      // Collect into media variant bucket.
      const existing = media.get(rule.mediaMaxWidth) ?? {};
      media.set(rule.mediaMaxWidth, { ...existing, ...rule.styles });
    } else if (rule.pseudo) {
      // Collect into pseudo-class variant bucket.
      const existing = pseudo.get(rule.pseudo) ?? {};
      pseudo.set(rule.pseudo, { ...existing, ...rule.styles });
    } else {
      // Base styles — merge in source order (later rules win, matching browser cascade).
      Object.assign(base, rule.styles);
    }
  }

  return { base, pseudo, media };
}

/**
 * Parse an element's inline `style` attribute into camelCase key→value pairs.
 */
function parseInlineStyles(element: Element): Record<string, string> {
  const result: Record<string, string> = {};
  const style = element.getAttribute("style");
  if (!style) return result;

  // Use css-tree to parse the inline style value reliably.
  try {
    const ast = csstree.parse(style, {
      context: "declarationList",
      parseValue: false,
      onParseError: () => {},
    });
    csstree.walk(ast, (node: csstree.CssNode) => {
      if (node.type === "Declaration") {
        const decl = node as csstree.Declaration;
        result[kebabToCamel(decl.property)] = csstree.generate(decl.value);
      }
    });
  } catch {
    // Malformed inline style — skip.
  }

  return result;
}

/**
 * Collect all HTML attributes from an element, excluding `class` and `style`
 * (handled separately) and any data-* attribute whose value is empty.
 */
function collectAttrs(element: Element): Record<string, string> {
  const result: Record<string, string> = {};
  for (const attr of Array.from(element.attributes)) {
    if (attr.name === "class" || attr.name === "style") continue;
    result[attr.name] = attr.value;
  }
  return result;
}

// ---------------------------------------------------------------------------
// DOM → ParsedNode tree walker
// ---------------------------------------------------------------------------

/**
 * Determine whether an element's primary content is a single text run
 * (i.e., all non-whitespace content is text nodes, no significant child elements).
 *
 * Used to decide "text" vs "container" when the HTML tag is ambiguous (e.g. <div>Hello</div>).
 */
function isTextLeaf(element: Element): boolean {
  for (const child of Array.from(element.childNodes)) {
    if (child.nodeType === child.ELEMENT_NODE) {
      // Any child element means this is a container, not a text leaf.
      return false;
    }
  }
  // All children are text/comment nodes.
  return true;
}

/**
 * Tags that always represent text even when they have block-level children.
 * (In practice these shouldn't have element children, but authors sometimes nest them.)
 */
const TEXT_TAGS = new Set([
  "p", "span", "h1", "h2", "h3", "h4", "h5", "h6",
  "label", "a", "blockquote", "pre", "code", "li",
  "dt", "dd", "figcaption", "caption", "th", "td",
  "strong", "em", "b", "i", "u", "s",
]);

/**
 * Walk a jsdom Element and the pre-parsed CSS rules, producing a ParsedNode
 * tree that can be mapped to edit-tool calls without any DOM access.
 *
 * Exported separately from importHtml() so unit tests can verify parsing
 * behaviour without mocking the edit-tool layer.
 */
export function parseHtmlToTree(
  html: string,
  componentNames?: string[]
): { nodes: ParsedNode[]; warnings: string[] } {
  const warnings: string[] = [];

  // Parse with jsdom. We use a full document parse so <style> blocks and
  // document structure are handled correctly.
  const dom = new JSDOM(`<!DOCTYPE html><html><body>${html}</body></html>`, {
    // Disable external resource loading — we only need DOM structure.
    resources: "usable",
  });

  const document = dom.window.document;

  // Extract all <style> blocks from the parsed HTML.
  const cssText = Array.from(document.querySelectorAll("style"))
    .map((s) => s.textContent ?? "")
    .join("\n");

  const cssRules = parseCssRules(cssText);

  // Build a case-insensitive lookup for Plasmic component names so the LLM
  // can reference them via data-component="ComponentName" attributes.
  const componentNameSet = new Map<string, string>();
  if (componentNames) {
    for (const name of componentNames) {
      componentNameSet.set(name.toLowerCase(), name);
    }
  }

  function walkElement(element: Element): ParsedNode | null {
    const tag = element.tagName.toLowerCase();

    if (IGNORED_TAGS.has(tag)) return null;

    // Merge CSS-rule styles (base variant) with inline styles.
    // Inline styles take precedence (matching browser behaviour).
    const { base: ruleBaseStyles, pseudo, media } = matchRulesToElement(
      element,
      cssRules
    );
    const inlineStyles = parseInlineStyles(element);
    const mergedBase: Record<string, string> = {
      ...ruleBaseStyles,
      ...inlineStyles,
    };

    const attrs = collectAttrs(element);

    // --- Special element types ---

    if (tag === "svg") {
      return {
        kind: "svg",
        svgHtml: element.outerHTML,
        styles: mergedBase,
        pseudoStyles: pseudo,
        mediaStyles: media,
        attrs,
      } satisfies ParsedSvg;
    }

    if (tag === "img") {
      return {
        kind: "image",
        src: element.getAttribute("src") ?? "",
        styles: mergedBase,
        pseudoStyles: pseudo,
        mediaStyles: media,
        attrs,
      } satisfies ParsedImage;
    }

    if (tag === "button") {
      const value = element.textContent?.trim() || undefined;
      return {
        kind: "button",
        value,
        styles: mergedBase,
        pseudoStyles: pseudo,
        mediaStyles: media,
        attrs,
      } satisfies ParsedButton;
    }

    if (tag === "input" || tag === "textarea") {
      const inputType: "input" | "password" | "textarea" =
        tag === "textarea"
          ? "textarea"
          : element.getAttribute("type") === "password"
          ? "password"
          : "input";
      return {
        kind: "input",
        inputType,
        styles: mergedBase,
        pseudoStyles: pseudo,
        mediaStyles: media,
        attrs,
      } satisfies ParsedInput;
    }

    // --- Component reference via data-component attribute ---
    const dataComponentAttr = element.getAttribute("data-component");
    if (dataComponentAttr) {
      const matched = componentNameSet.get(dataComponentAttr.toLowerCase());
      if (matched) {
        // Remove data-component from attrs — it's a directive, not an HTML attribute.
        const { "data-component": _, ...cleanAttrs } = attrs;
        const children: ParsedNode[] = [];
        for (const child of Array.from(element.children)) {
          const parsed = walkElement(child);
          if (parsed !== null) children.push(parsed);
        }
        return {
          kind: "component",
          componentName: matched,
          children,
          styles: mergedBase,
          pseudoStyles: pseudo,
          mediaStyles: media,
          attrs: cleanAttrs,
        } satisfies ParsedComponent;
      } else {
        // Component name not found in site model — warn and fall through to container.
        warnings.push(
          `data-component="${dataComponentAttr}" does not match any component in the project. ` +
            "Element will be imported as a container instead."
        );
      }
    }

    // --- Text leaf or container ---

    // Classify as text only when:
    //   (a) the tag is an inherently text-level tag (h1, p, span…), OR
    //   (b) the element is a leaf (no child elements) AND has meaningful text content.
    // An empty <div> with styles should remain a container, not a text node.
    const textValue = element.textContent?.trim() ?? "";
    const isText = TEXT_TAGS.has(tag) || (isTextLeaf(element) && textValue !== "");

    if (isText) {
      // Skip whitespace-only text nodes that carry no styles or variants.
      if (
        textValue === "" &&
        Object.keys(mergedBase).length === 0 &&
        Object.keys(attrs).length === 0 &&
        pseudo.size === 0 &&
        media.size === 0
      ) {
        return null;
      }
      return {
        kind: "text",
        tag,
        value: textValue,
        styles: mergedBase,
        pseudoStyles: pseudo,
        mediaStyles: media,
        attrs,
      } satisfies ParsedText;
    }

    // Container — recurse into children.
    const children: ParsedNode[] = [];
    for (const child of Array.from(element.children)) {
      const parsed = walkElement(child);
      if (parsed !== null) children.push(parsed);
    }

    // A container with no children, no styles, and no variants is not worth creating.
    if (
      children.length === 0 &&
      Object.keys(mergedBase).length === 0 &&
      Object.keys(attrs).length === 0 &&
      pseudo.size === 0 &&
      media.size === 0
    ) {
      return null;
    }

    return {
      kind: "container",
      tag,
      children,
      styles: mergedBase,
      pseudoStyles: pseudo,
      mediaStyles: media,
      attrs,
    } satisfies ParsedContainer;
  }

  // The user-supplied HTML lands in <body>. Walk its direct children so we
  // don't wrap everything in an extra container.
  const rootChildren: ParsedNode[] = [];
  for (const child of Array.from(document.body.children)) {
    const parsed = walkElement(child);
    if (parsed !== null) rootChildren.push(parsed);
  }

  // Media variant warnings are surfaced per-node in wiTreeToEditCalls,
  // not at parse time, because we need the Plasmic node UUID to include
  // in the warning message.

  return { nodes: rootChildren, warnings };
}

// ---------------------------------------------------------------------------
// ParsedNode → edit-tool calls
// ---------------------------------------------------------------------------

/**
 * Map a single ParsedNode (and its descendants) to a sequence of MCP edit-tool
 * calls.  Returns the UUID of the root node created, or undefined if no node
 * was created (e.g. a parse error on this specific element).
 *
 * The function is recursive: children are processed after the parent is created
 * so we have a valid parentRef UUID for each addChild call.
 */
async function mapNodeToEditCalls(
  apiClient: PlasmicApiClient,
  componentUuid: string,
  parentRef: string,
  node: ParsedNode,
  position: string | undefined,
  state: { nodesCreated: number; warnings: string[] }
): Promise<string | undefined> {
  let newNodeUuid: string | undefined;

  // --- Build the PlasmicElement and call addChild ---

  if (node.kind === "container") {
    // Map to a box element.  Use the original tag when it is a valid container tag
    // (edit-tools will validate and fall back to "div" otherwise).
    const childEl: PlasmicElement = {
      type: "box",
      tag: node.tag,
      styles: Object.keys(node.styles).length > 0 ? node.styles : undefined,
    };

    let addResult: Awaited<ReturnType<typeof addChild>>;
    try {
      addResult = await addChild(
        apiClient,
        componentUuid,
        parentRef,
        childEl,
        position
      );
    } catch (err) {
      state.warnings.push(
        `Failed to add container <${node.tag}>: ${String(err)}`
      );
      return undefined;
    }

    newNodeUuid = addResult.newNodeUuid!;
    state.nodesCreated++;

    // Apply additional styles that weren't part of the initial addChild spec.
    // addChild accepts styles inline, so this call is only needed when we also
    // have pseudo or media variants to add — but we always do it consistently
    // to keep the mapping simple and auditable.
    if (Object.keys(node.styles).length > 0) {
      try {
        await updateStyles(apiClient, componentUuid, newNodeUuid, node.styles);
      } catch (err) {
        state.warnings.push(
          `updateStyles failed on <${node.tag}> (${newNodeUuid}): ${String(err)}`
        );
      }
    }

    // Apply non-style attributes (e.g. aria-*, data-*).
    if (Object.keys(node.attrs).length > 0) {
      try {
        await updateAttrs(
          apiClient,
          componentUuid,
          newNodeUuid,
          node.attrs as Record<string, unknown>
        );
      } catch (err) {
        state.warnings.push(
          `updateAttrs failed on <${node.tag}> (${newNodeUuid}): ${String(err)}`
        );
      }
    }

    // Recurse into children.
    for (const child of node.children) {
      await mapNodeToEditCalls(
        apiClient,
        componentUuid,
        newNodeUuid,
        child,
        undefined, // children always appended in source order
        state
      );
    }
  } else if (node.kind === "text") {
    const childEl: PlasmicElement = {
      type: "text",
      value: node.value,
      tag: node.tag,
      styles: Object.keys(node.styles).length > 0 ? node.styles : undefined,
    };

    let addResult: Awaited<ReturnType<typeof addChild>>;
    try {
      addResult = await addChild(
        apiClient,
        componentUuid,
        parentRef,
        childEl,
        position
      );
    } catch (err) {
      state.warnings.push(
        `Failed to add text <${node.tag}>: ${String(err)}`
      );
      return undefined;
    }

    newNodeUuid = addResult.newNodeUuid!;
    state.nodesCreated++;

    if (Object.keys(node.styles).length > 0) {
      try {
        await updateStyles(apiClient, componentUuid, newNodeUuid, node.styles);
      } catch (err) {
        state.warnings.push(
          `updateStyles failed on text <${node.tag}> (${newNodeUuid}): ${String(err)}`
        );
      }
    }

    if (node.value) {
      try {
        await updateText(
          apiClient,
          componentUuid,
          newNodeUuid,
          node.value
        );
      } catch (err) {
        state.warnings.push(
          `updateText failed on <${node.tag}> (${newNodeUuid}): ${String(err)}`
        );
      }
    }

    if (Object.keys(node.attrs).length > 0) {
      try {
        await updateAttrs(
          apiClient,
          componentUuid,
          newNodeUuid,
          node.attrs as Record<string, unknown>
        );
      } catch (err) {
        state.warnings.push(
          `updateAttrs failed on text <${node.tag}> (${newNodeUuid}): ${String(err)}`
        );
      }
    }
  } else if (node.kind === "image") {
    const childEl: PlasmicElement = {
      type: "img",
      src: node.src,
      styles: Object.keys(node.styles).length > 0 ? node.styles : undefined,
    };

    let addResult: Awaited<ReturnType<typeof addChild>>;
    try {
      addResult = await addChild(
        apiClient,
        componentUuid,
        parentRef,
        childEl,
        position
      );
    } catch (err) {
      state.warnings.push(`Failed to add <img>: ${String(err)}`);
      return undefined;
    }

    newNodeUuid = addResult.newNodeUuid!;
    state.nodesCreated++;

    if (Object.keys(node.styles).length > 0) {
      try {
        await updateStyles(apiClient, componentUuid, newNodeUuid, node.styles);
      } catch (err) {
        state.warnings.push(
          `updateStyles failed on <img> (${newNodeUuid}): ${String(err)}`
        );
      }
    }

    if (Object.keys(node.attrs).length > 0) {
      try {
        await updateAttrs(
          apiClient,
          componentUuid,
          newNodeUuid,
          node.attrs as Record<string, unknown>
        );
      } catch (err) {
        state.warnings.push(
          `updateAttrs failed on <img> (${newNodeUuid}): ${String(err)}`
        );
      }
    }
  } else if (node.kind === "button") {
    const childEl: PlasmicElement = {
      type: "button",
      value: node.value,
      styles: Object.keys(node.styles).length > 0 ? node.styles : undefined,
    };

    let addResult: Awaited<ReturnType<typeof addChild>>;
    try {
      addResult = await addChild(
        apiClient,
        componentUuid,
        parentRef,
        childEl,
        position
      );
    } catch (err) {
      state.warnings.push(`Failed to add <button>: ${String(err)}`);
      return undefined;
    }

    newNodeUuid = addResult.newNodeUuid!;
    state.nodesCreated++;

    if (Object.keys(node.styles).length > 0) {
      try {
        await updateStyles(apiClient, componentUuid, newNodeUuid, node.styles);
      } catch (err) {
        state.warnings.push(
          `updateStyles failed on <button> (${newNodeUuid}): ${String(err)}`
        );
      }
    }

    if (Object.keys(node.attrs).length > 0) {
      try {
        await updateAttrs(
          apiClient,
          componentUuid,
          newNodeUuid,
          node.attrs as Record<string, unknown>
        );
      } catch (err) {
        state.warnings.push(
          `updateAttrs failed on <button> (${newNodeUuid}): ${String(err)}`
        );
      }
    }
  } else if (node.kind === "input") {
    const childEl: PlasmicElement = {
      type: node.inputType,
      styles: Object.keys(node.styles).length > 0 ? node.styles : undefined,
    };

    let addResult: Awaited<ReturnType<typeof addChild>>;
    try {
      addResult = await addChild(
        apiClient,
        componentUuid,
        parentRef,
        childEl,
        position
      );
    } catch (err) {
      state.warnings.push(
        `Failed to add <${node.inputType}>: ${String(err)}`
      );
      return undefined;
    }

    newNodeUuid = addResult.newNodeUuid!;
    state.nodesCreated++;

    if (Object.keys(node.styles).length > 0) {
      try {
        await updateStyles(apiClient, componentUuid, newNodeUuid, node.styles);
      } catch (err) {
        state.warnings.push(
          `updateStyles failed on <${node.inputType}> (${newNodeUuid}): ${String(err)}`
        );
      }
    }

    if (Object.keys(node.attrs).length > 0) {
      try {
        await updateAttrs(
          apiClient,
          componentUuid,
          newNodeUuid,
          node.attrs as Record<string, unknown>
        );
      } catch (err) {
        state.warnings.push(
          `updateAttrs failed on <${node.inputType}> (${newNodeUuid}): ${String(err)}`
        );
      }
    }
  } else if (node.kind === "svg") {
    // SVG is stored as a raw HTML attribute on a wrapper div.
    // Asset upload is out of scope for v1 — we use dangerouslySetInnerHTML.
    const childEl: PlasmicElement = {
      type: "box",
      tag: "div",
      styles: Object.keys(node.styles).length > 0 ? node.styles : undefined,
    };

    let addResult: Awaited<ReturnType<typeof addChild>>;
    try {
      addResult = await addChild(
        apiClient,
        componentUuid,
        parentRef,
        childEl,
        position
      );
    } catch (err) {
      state.warnings.push(`Failed to add SVG wrapper div: ${String(err)}`);
      return undefined;
    }

    newNodeUuid = addResult.newNodeUuid!;
    state.nodesCreated++;

    // Store the raw SVG as dangerouslySetInnerHTML so it renders in preview.
    try {
      await updateAttrs(apiClient, componentUuid, newNodeUuid, {
        dangerouslySetInnerHTML: { __html: node.svgHtml },
      });
    } catch (err) {
      state.warnings.push(
        `updateAttrs (dangerouslySetInnerHTML) failed on SVG wrapper (${newNodeUuid}): ${String(err)}`
      );
    }

    state.warnings.push(
      `SVG stored as raw HTML attribute on node ${newNodeUuid}. ` +
        "SVG asset upload is not supported in v1 — use an image asset for production."
    );
  } else if (node.kind === "component") {
    // Map to a Plasmic component instance via addChild with type: "component".
    const childEl: PlasmicElement = {
      type: "component",
      name: node.componentName,
      styles: Object.keys(node.styles).length > 0 ? node.styles : undefined,
    };

    let addResult: Awaited<ReturnType<typeof addChild>>;
    try {
      addResult = await addChild(
        apiClient,
        componentUuid,
        parentRef,
        childEl,
        position
      );
    } catch (err) {
      state.warnings.push(
        `Failed to add component "${node.componentName}": ${String(err)}`
      );
      return undefined;
    }

    newNodeUuid = addResult.newNodeUuid!;
    state.nodesCreated++;

    if (Object.keys(node.styles).length > 0) {
      try {
        await updateStyles(apiClient, componentUuid, newNodeUuid, node.styles);
      } catch (err) {
        state.warnings.push(
          `updateStyles failed on component "${node.componentName}" (${newNodeUuid}): ${String(err)}`
        );
      }
    }

    if (Object.keys(node.attrs).length > 0) {
      try {
        await updateAttrs(
          apiClient,
          componentUuid,
          newNodeUuid,
          node.attrs as Record<string, unknown>
        );
      } catch (err) {
        state.warnings.push(
          `updateAttrs failed on component "${node.componentName}" (${newNodeUuid}): ${String(err)}`
        );
      }
    }

    // Recurse into children — these become the component's default slot content.
    for (const child of node.children) {
      await mapNodeToEditCalls(
        apiClient,
        componentUuid,
        newNodeUuid,
        child,
        undefined,
        state
      );
    }
  }

  // --- Apply pseudo-class style variants ---
  if (newNodeUuid && node.pseudoStyles.size > 0) {
    for (const [pseudo, pseudoCss] of node.pseudoStyles) {
      if (!HANDLED_PSEUDO_SELECTORS.has(pseudo)) {
        state.warnings.push(
          `Pseudo-selector "${pseudo}" is not supported as a Plasmic style variant — skipped.`
        );
        continue;
      }

      // Ensure the style variant exists before applying styles to it.
      // createStyleVariant errors when the variant already exists — that is fine,
      // we simply proceed to updateStyles with the selector name either way.
      // edit-tools resolves variant by selector string so we don't need the UUID.
      try {
        await createStyleVariant(
          apiClient,
          componentUuid,
          pseudo,
          newNodeUuid
        );
      } catch (err) {
        const msg = String(err);
        // "already exists" is an acceptable error — continue to apply styles.
        if (!msg.includes("already exists")) {
          state.warnings.push(
            `createStyleVariant "${pseudo}" failed on ${newNodeUuid}: ${msg}`
          );
          continue;
        }
      }

      try {
        await updateStyles(
          apiClient,
          componentUuid,
          newNodeUuid,
          pseudoCss,
          pseudo
        );
      } catch (err) {
        state.warnings.push(
          `updateStyles for "${pseudo}" variant failed on ${newNodeUuid}: ${String(err)}`
        );
      }
    }
  }

  // --- Warn about @media variants (not yet matched to breakpoints) ---
  if (newNodeUuid && node.mediaStyles.size > 0) {
    for (const [maxWidth] of node.mediaStyles) {
      state.warnings.push(
        `@media (max-width: ${maxWidth}px) styles on node ${newNodeUuid} were not applied. ` +
          "Screen variants must be matched to existing Plasmic breakpoints manually. " +
          "Use the design tool to create responsive variants."
      );
    }
  }

  return newNodeUuid;
}

/**
 * Map a full list of ParsedNode roots to edit-tool calls.
 *
 * This is the second stage of the import pipeline, separated from parsing
 * so that each stage can be tested and reasoned about independently.
 * The function is deliberately sequential (not parallel) so that Plasmic's
 * in-memory model sees edits in a predictable source order.
 */
export async function wiTreeToEditCalls(
  apiClient: PlasmicApiClient,
  componentUuid: string,
  parentRef: string,
  nodes: ParsedNode[],
  position?: string
): Promise<{
  rootNodeUuids: string[];
  nodesCreated: number;
  warnings: string[];
}> {
  const state = { nodesCreated: 0, warnings: [] as string[] };
  const rootNodeUuids: string[] = [];

  for (const node of nodes) {
    const uuid = await mapNodeToEditCalls(
      apiClient,
      componentUuid,
      parentRef,
      node,
      position,
      state
    );
    if (uuid) rootNodeUuids.push(uuid);
  }

  return { rootNodeUuids, nodesCreated: state.nodesCreated, warnings: state.warnings };
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

/**
 * Import an HTML+CSS string into a Plasmic component as a subtree of nodes.
 *
 * The function is intentionally a thin orchestrator:
 *   1. Parse HTML → ParsedNode tree  (pure, no side-effects)
 *   2. Map tree → edit-tool calls    (async, mutates the Plasmic model)
 *   3. Invalidate node cache         (required after structural edits)
 *   4. Return result with root UUID, node count, and any warnings
 *
 * Edge cases handled:
 *   - Empty or whitespace-only HTML  → error result, no model mutation
 *   - Parse produces zero importable nodes → error result
 *   - Individual node failures        → collected as warnings, import continues
 *
 * @param apiClient     - Authenticated Plasmic API client
 * @param componentUuid - UUID of the component to add nodes into
 * @param parentRef     - UUID or name of the parent node (resolved by node-resolver)
 * @param html          - Raw HTML string (may include <style> blocks)
 * @param position      - "append" | "prepend" | number index (default: append)
 */
export async function importHtml(
  apiClient: PlasmicApiClient,
  componentUuid: string,
  parentRef: string,
  html: string,
  position?: string | number,
  componentNames?: string[]
): Promise<ImportHtmlResult> {
  // Guard: empty / whitespace-only input
  if (!html || html.trim() === "") {
    return {
      nodesCreated: 0,
      warnings: [],
      error: "No importable elements found: HTML input is empty.",
    };
  }

  // Stage 1: Parse HTML → intermediate tree (no model mutations)
  let parsedNodes: ParsedNode[];
  let parseWarnings: string[];
  try {
    const { nodes, warnings } = parseHtmlToTree(html, componentNames);
    parsedNodes = nodes;
    parseWarnings = warnings;
  } catch (err) {
    console.error("[plasmic-mcp] html-importer: parse failed:", err);
    return {
      nodesCreated: 0,
      warnings: [],
      error: `HTML parse failed: ${String(err)}`,
    };
  }

  if (parsedNodes.length === 0) {
    return {
      nodesCreated: 0,
      warnings: parseWarnings,
      error: "No importable elements found after parsing HTML.",
    };
  }

  // Stage 2: Map tree → edit-tool calls
  let rootNodeUuids: string[];
  let nodesCreated: number;
  let mapWarnings: string[];

  try {
    const result = await wiTreeToEditCalls(
      apiClient,
      componentUuid,
      parentRef,
      parsedNodes,
      position !== undefined ? String(position) : undefined
    );
    rootNodeUuids = result.rootNodeUuids;
    nodesCreated = result.nodesCreated;
    mapWarnings = result.warnings;
  } catch (err) {
    // Unexpected error from the mapping layer — still invalidate the cache
    // because some nodes may have been created before the failure.
    invalidateNodeCache(componentUuid);
    console.error("[plasmic-mcp] html-importer: edit-tool mapping failed:", err);
    return {
      nodesCreated: 0,
      warnings: parseWarnings,
      error: `Failed to map HTML to Plasmic nodes: ${String(err)}`,
    };
  }

  // Stage 3: Invalidate the node cache — structural edits were made.
  invalidateNodeCache(componentUuid);

  const allWarnings = [...parseWarnings, ...mapWarnings];

  if (nodesCreated === 0) {
    return {
      nodesCreated: 0,
      warnings: allWarnings,
      error: "Import produced no nodes. All elements may have been skipped.",
    };
  }

  return {
    rootNodeUuid: rootNodeUuids[0],
    nodesCreated,
    warnings: allWarnings,
  };
}
