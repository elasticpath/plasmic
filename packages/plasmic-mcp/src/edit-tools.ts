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
 * P7: createStyleVariant and createVariantGroup enable creating new variants
 * programmatically — completing the variant editing story so users can add
 * hover/focus states and custom variant groups, not just edit existing ones.
 *
 * Reference: specs/plasmic-incremental-writes.md § Edit Tools
 * Reference: specs/plasmic-variant-editing.md § Variant-Aware Editing
 */

import { randomUUID } from "crypto";
import {
  isKnownTplTag,
  isKnownTplComponent,
  isKnownRawText,
  isKnownExprText,
  isKnownRenderExpr,
  isKnownCustomCode,
  isKnownObjectPath,
  isKnownStyleMarker,
  isKnownNodeMarker,
  isKnownNamedState,
  isKnownEventHandler,
  RawText,
  CustomCode,
  ExprText,
  ObjectPath,
  RenderExpr,
  Arg,
  Rep,
  Var,
  PropParam,
  StateParam,
  StateChangeHandlerParam,
  NamedState,
  EventHandler,
  Interaction,
  NameArg,
  FunctionExpr,
  Text as TextType,
  Num,
  BoolType,
  AnyType,
  HrefType,
  FunctionType,
  ArgType,
  RuleSet,
  StyleMarker,
  NodeMarker,
  ComponentDataQuery,
  ComponentServerQuery,
  isKnownComponentDataQuery,
  isKnownComponentServerQuery,
  Mixin,
  isKnownMixin,
  KeyFrame,
  AnimationSequence,
  Animation,
  isKnownAnimationSequence,
  isKnownAnimation,
  Theme,
  ThemeStyle,
  DataToken,
  isKnownDataToken,
  GlobalVariantGroup,
  isKnownGlobalVariantGroup,
  Split,
  RandomSplitSlice,
  SegmentSplitSlice,
  ImageAsset,
  ImageAssetRef,
  isKnownImageAssetRef,
} from "@/wab/shared/model/classes";
import { RSH } from "@/wab/shared/RuleSetHelpers";
import { TplMgr } from "@/wab/shared/TplMgr";
import { ensureVariantSetting } from "@/wab/shared/Variants";
import { mkTplTagX, mkTplInlinedText, mkTplComponentX, clone as cloneTpl } from "@/wab/shared/core/tpls";
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
import { undoChanges } from "@/wab/shared/core/undo-util";
import { extractComponent as wabExtractComponent } from "@/wab/shared/core/components";
import cssInitials from "css-initials";
import {
  findToken,
  getAllStyleTokens,
  mkTokenRef,
  getAcceptableTokenTypes,
  resolveTokenValue,
} from "./token-reader.js";
import type { StyleTokenType } from "./types.js";
import type { RegistryComponent } from "./devhost-sync.js";

// --- Tag Validation ---

/** Valid HTML tags for container elements (box, vbox, hbox, page-section). */
const CONTAINER_TAGS = new Set([
  "div", "section", "article", "nav", "header", "footer",
  "aside", "main", "ul", "ol", "li", "form", "fieldset",
]);

/** Valid HTML tags for text elements. */
const TEXT_TAGS = new Set([
  "div", "p", "span", "h1", "h2", "h3", "h4", "h5", "h6",
  "label", "a", "blockquote", "pre", "code",
]);

/** Tags that are always rejected for security reasons. */
const UNSAFE_TAGS = new Set(["script", "style", "iframe"]);

/**
 * Validate and return the HTML tag for a container element.
 * If no tag is specified, returns "div".
 * Throws if the tag is unsafe or not in the allowed list.
 */
function validateContainerTag(tag: string | undefined): string {
  if (!tag) return "div";
  if (UNSAFE_TAGS.has(tag)) {
    throw new Error(
      `Tag "${tag}" is not allowed (unsafe). ` +
      `Allowed container tags: ${[...CONTAINER_TAGS].join(", ")}`
    );
  }
  if (!CONTAINER_TAGS.has(tag)) {
    throw new Error(
      `Invalid tag "${tag}" for container element. ` +
      `Allowed tags: ${[...CONTAINER_TAGS].join(", ")}`
    );
  }
  return tag;
}

/**
 * Validate and return the HTML tag for a text element.
 * If no tag is specified, returns "div".
 * Throws if the tag is unsafe or not in the allowed list.
 */
function validateTextTag(tag: string | undefined): string {
  if (!tag) return "div";
  if (UNSAFE_TAGS.has(tag)) {
    throw new Error(
      `Tag "${tag}" is not allowed (unsafe). ` +
      `Allowed text tags: ${[...TEXT_TAGS].join(", ")}`
    );
  }
  if (!TEXT_TAGS.has(tag)) {
    throw new Error(
      `Invalid tag "${tag}" for text element. ` +
      `Allowed tags: ${[...TEXT_TAGS].join(", ")}`
    );
  }
  return tag;
}

// --- Attribute Validation ---

/** Standard HTML attributes that can be set via update-attrs. */
const STANDARD_HTML_ATTRS = new Set([
  "id", "class", "href", "target", "rel", "title", "tabIndex",
  "type", "name", "placeholder", "value", "disabled", "checked",
  "src", "alt", "width", "height", "action", "method",
  "for", "autocomplete", "autofocus", "required", "readonly",
  "min", "max", "step", "pattern", "maxlength", "minlength",
]);

/** ARIA attributes that can be set via update-attrs. */
const ARIA_ATTRS = new Set([
  "role", "aria-label", "aria-labelledby", "aria-describedby",
  "aria-hidden", "aria-expanded", "aria-selected", "aria-disabled",
  "aria-live", "aria-atomic", "aria-busy", "aria-controls",
  "aria-current", "aria-haspopup", "aria-invalid", "aria-pressed",
  "aria-readonly", "aria-required", "aria-sort", "aria-valuemax",
  "aria-valuemin", "aria-valuenow", "aria-valuetext",
]);

/**
 * Validate an attribute name. Returns true if the attribute is allowed.
 * Rejects event handler attributes (onclick, onload, etc.) and
 * attributes with invalid syntax.
 */
function isValidAttrName(name: string): { valid: boolean; reason?: string } {
  // Reject event handlers
  if (/^on[a-z]/i.test(name)) {
    return { valid: false, reason: `Event handler attribute "${name}" is not allowed. Use event handlers in code components instead.` };
  }
  // Reject empty or whitespace-only names
  if (!name || /\s/.test(name)) {
    return { valid: false, reason: `Invalid attribute name "${name}": must be non-empty with no whitespace.` };
  }
  // Allow standard HTML attrs
  if (STANDARD_HTML_ATTRS.has(name)) return { valid: true };
  // Allow ARIA attrs
  if (ARIA_ATTRS.has(name)) return { valid: true };
  // Allow data-* attributes
  if (name.startsWith("data-")) return { valid: true };
  // Allow custom element attributes (anything with a hyphen that's not data- or aria-)
  // This supports web component custom elements per the spec
  if (/^[a-zA-Z][a-zA-Z0-9-]*$/.test(name)) return { valid: true };
  // Reject anything else
  return { valid: false, reason: `Invalid attribute name "${name}": must match valid HTML attribute syntax (letters, digits, hyphens).` };
}

/**
 * Create an attribute expression value from a user-provided value.
 * - null → signals deletion (caller handles)
 * - string starting with "$" → dynamic CustomCode (strips "$" prefix)
 * - string wrapped in "{{...}}" → dynamic CustomCode (strips delimiters)
 * - everything else → static literal via CustomCode(JSON.stringify(...))
 */
function createAttrExpr(value: unknown): any {
  if (typeof value === "string") {
    // Dynamic value: $expression
    if (value.startsWith("$")) {
      return new CustomCode({ code: value.slice(1), fallback: null });
    }
    // Dynamic value: {{expression}}
    if (value.startsWith("{{") && value.endsWith("}}")) {
      return new CustomCode({ code: value.slice(2, -2).trim(), fallback: null });
    }
    // Static string literal
    return new CustomCode({ code: JSON.stringify(value), fallback: null });
  }
  // Booleans, numbers, null-like → serialize as literal
  return new CustomCode({
    code: value === undefined ? "undefined" : JSON.stringify(value),
    fallback: null,
  });
}

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
 * Split a CSS shorthand value into tokens, respecting parenthesized groups.
 * e.g., "1px solid rgb(255, 0, 0)" → ["1px", "solid", "rgb(255, 0, 0)"]
 */
function splitCssTokens(value: string): string[] {
  const tokens: string[] = [];
  let current = "";
  let depth = 0;
  for (const char of value) {
    if (char === "(") depth++;
    if (char === ")") depth--;
    if (/\s/.test(char) && depth === 0) {
      if (current) tokens.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  if (current) tokens.push(current);
  return tokens;
}

/** CSS border-style keywords. */
const BORDER_STYLE_KEYWORDS = new Set([
  "none", "hidden", "dotted", "dashed", "solid",
  "double", "groove", "ridge", "inset", "outset",
]);

/** CSS border-width keywords. */
const BORDER_WIDTH_KEYWORDS = new Set(["thin", "medium", "thick"]);

/** CSS global/inherit values that apply to all longhands. */
const CSS_GLOBAL_VALUES = new Set(["inherit", "initial", "unset", "revert"]);

/**
 * Parse a CSS border/outline shorthand value into its component parts.
 * Format: <width> || <style> || <color> (any order, any optional).
 *
 * For global values (inherit, initial, etc.), all three parts are set.
 */
function parseBorderShorthand(
  value: string
): { width?: string; style?: string; color?: string } {
  const trimmed = value.trim();

  // Global values apply to all longhands
  if (CSS_GLOBAL_VALUES.has(trimmed.toLowerCase())) {
    return { width: trimmed, style: trimmed, color: trimmed };
  }

  const tokens = splitCssTokens(trimmed);
  let width: string | undefined;
  let style: string | undefined;
  let color: string | undefined;

  for (const token of tokens) {
    const lower = token.toLowerCase();
    if (!style && BORDER_STYLE_KEYWORDS.has(lower)) {
      style = token;
    } else if (
      !width &&
      (BORDER_WIDTH_KEYWORDS.has(lower) || /^[0-9.]/.test(token))
    ) {
      width = token;
    } else if (!color) {
      color = token;
    }
  }

  return { width, style, color };
}

// --- Token reference resolution ---

const TOKEN_PREFIX = "token:";

/**
 * Resolve token references in style values.
 *
 * Replaces `token:TokenName` or `token:<uuid>` values with `var(--token-<uuid>)`
 * — the WAB-standard token reference format stored in RuleSet.values.
 *
 * Validates that:
 *   - The token exists (by name case-insensitive or UUID)
 *   - The token type is compatible with the CSS property
 *   - Token names aren't ambiguous (multiple tokens sharing a name)
 *
 * Called before sanitizeStyles() so expanded shorthands get the var() value.
 */
export function resolveTokenReferences(
  styles: Record<string, string>,
  site: any
): Record<string, string> {
  const result: Record<string, string> = {};
  let allTokens: any[] | null = null; // lazy-load on first token: value

  for (const [prop, value] of Object.entries(styles)) {
    if (typeof value === "string" && value.startsWith(TOKEN_PREFIX)) {
      const tokenRef = value.slice(TOKEN_PREFIX.length);
      if (!tokenRef) {
        throw new Error(
          `Token name required after "token:" in style property "${prop}".`
        );
      }

      // Lazy-load all tokens (local + dependencies)
      if (!allTokens) {
        allTokens = getAllStyleTokens(site);
      }

      const token = findToken(allTokens, tokenRef);
      if (!token) {
        // Build helpful error listing available tokens of the expected type
        const acceptableTypes = getAcceptableTokenTypes(prop);
        const available = allTokens
          .filter(
            (t: any) =>
              !acceptableTypes ||
              acceptableTypes.includes(t.type as StyleTokenType)
          )
          .map((t: any) => `"${t.name}" (${t.type})`)
          .join(", ");

        throw new Error(
          `Token "${tokenRef}" not found.` +
            (available
              ? ` Available tokens: ${available}`
              : " No tokens defined in this project.")
        );
      }

      // Validate token type against CSS property
      const acceptableTypes = getAcceptableTokenTypes(prop);
      if (
        acceptableTypes &&
        !acceptableTypes.includes(token.type as StyleTokenType)
      ) {
        throw new Error(
          `Token "${token.name}" is type "${token.type}" but property "${prop}" expects: ${acceptableTypes.join(", ")}. ` +
            `Use a ${acceptableTypes.join(" or ")} token instead.`
        );
      }

      result[prop] = mkTokenRef(token.uuid);
    } else {
      result[prop] = value;
    }
  }

  return result;
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
 *   - backgroundColor/backgroundImage + longhands → composite `background` shorthand
 *     (WAB site-invariants reject individual background-* longhands)
 *
 * Accepts both camelCase and kebab-case input.
 */
export function sanitizeStyles(
  styles: Record<string, string>
): Record<string, string> {
  const result: Record<string, string> = {};
  let bgColor: string | undefined;
  let bgImage: string | undefined;
  let bgSize: string | undefined;
  let bgPosition: string | undefined;
  let bgRepeat: string | undefined;
  let bgAttachment: string | undefined;
  let bgOrigin: string | undefined;
  let bgClip: string | undefined;

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
        bgSize = value;
        break;
      case "backgroundPosition":
      case "background-position":
        bgPosition = value;
        break;
      case "backgroundRepeat":
      case "background-repeat":
        bgRepeat = value;
        break;
      case "backgroundAttachment":
      case "background-attachment":
        bgAttachment = value;
        break;
      case "backgroundOrigin":
      case "background-origin":
        bgOrigin = value;
        break;
      case "backgroundClip":
      case "background-clip":
        bgClip = value;
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

      // --- Border combined shorthand → up to 12 longhands ---
      case "border": {
        const parsed = parseBorderShorthand(value);
        for (const side of ["top", "right", "bottom", "left"]) {
          if (parsed.width !== undefined) result[`border-${side}-width`] = parsed.width;
          if (parsed.style !== undefined) result[`border-${side}-style`] = parsed.style;
          if (parsed.color !== undefined) result[`border-${side}-color`] = parsed.color;
        }
        break;
      }

      // --- Border-top shorthand → 3 longhands ---
      case "borderTop":
      case "border-top": {
        const parsed = parseBorderShorthand(value);
        if (parsed.width !== undefined) result["border-top-width"] = parsed.width;
        if (parsed.style !== undefined) result["border-top-style"] = parsed.style;
        if (parsed.color !== undefined) result["border-top-color"] = parsed.color;
        break;
      }

      // --- Border-right shorthand → 3 longhands ---
      case "borderRight":
      case "border-right": {
        const parsed = parseBorderShorthand(value);
        if (parsed.width !== undefined) result["border-right-width"] = parsed.width;
        if (parsed.style !== undefined) result["border-right-style"] = parsed.style;
        if (parsed.color !== undefined) result["border-right-color"] = parsed.color;
        break;
      }

      // --- Border-bottom shorthand → 3 longhands ---
      case "borderBottom":
      case "border-bottom": {
        const parsed = parseBorderShorthand(value);
        if (parsed.width !== undefined) result["border-bottom-width"] = parsed.width;
        if (parsed.style !== undefined) result["border-bottom-style"] = parsed.style;
        if (parsed.color !== undefined) result["border-bottom-color"] = parsed.color;
        break;
      }

      // --- Border-left shorthand → 3 longhands ---
      case "borderLeft":
      case "border-left": {
        const parsed = parseBorderShorthand(value);
        if (parsed.width !== undefined) result["border-left-width"] = parsed.width;
        if (parsed.style !== undefined) result["border-left-style"] = parsed.style;
        if (parsed.color !== undefined) result["border-left-color"] = parsed.color;
        break;
      }

      // --- Outline shorthand → 3 longhands ---
      case "outline": {
        const parsed = parseBorderShorthand(value);
        if (parsed.width !== undefined) result["outline-width"] = parsed.width;
        if (parsed.style !== undefined) result["outline-style"] = parsed.style;
        if (parsed.color !== undefined) result["outline-color"] = parsed.color;
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
    const hasImageOrColor = bgImage || bgColor;
    const hasLonghands = bgSize || bgPosition || bgRepeat || bgAttachment || bgOrigin || bgClip;

    if (hasImageOrColor) {
      // Build composite background shorthand incorporating any longhands.
      // WAB site-invariants reject individual background-* longhands, so
      // everything must be consolidated into the `background` shorthand.
      const parts: string[] = [];

      // Image or gradient first
      if (bgImage) {
        parts.push(bgImage);
      } else {
        parts.push(`linear-gradient(${bgColor}, ${bgColor})`);
      }

      // Position and/or size (CSS requires position before "/ size")
      if (bgPosition || bgSize) {
        const pos = bgPosition || "0% 0%";
        parts.push(bgSize ? `${pos} / ${bgSize}` : pos);
      }

      if (bgRepeat) parts.push(bgRepeat);
      if (bgAttachment) parts.push(bgAttachment);

      // Origin and clip: two <box> values = origin then clip; one = both
      if (bgOrigin && bgClip && bgOrigin !== bgClip) {
        parts.push(bgOrigin);
        parts.push(bgClip);
      } else if (bgOrigin) {
        parts.push(bgOrigin);
      } else if (bgClip) {
        parts.push(bgClip);
      }

      result["background"] = parts.join(" ");
    } else if (hasLonghands) {
      // Longhands without image/color can't form a useful background shorthand.
      // Warn so the caller knows their properties weren't applied.
      const names = [
        bgSize && "backgroundSize", bgPosition && "backgroundPosition",
        bgRepeat && "backgroundRepeat", bgAttachment && "backgroundAttachment",
        bgOrigin && "backgroundOrigin", bgClip && "backgroundClip",
      ].filter(Boolean);
      console.error(
        `[plasmic-mcp] Warning: Background longhands (${names.join(", ")}) require ` +
          `backgroundImage, backgroundColor, or background shorthand in the same call. ` +
          `These properties were not applied.`
      );
    }
  }

  return result;
}

// --- CSS Property Validation ---

/**
 * Convert camelCase to kebab-case.
 * e.g., "paddingTop" → "padding-top", "WebkitTransform" → "-webkit-transform"
 */
function camelToKebab(str: string): string {
  return str.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`);
}

/**
 * Additional CSS properties accepted by Plasmic that may not be in
 * css-initials 0.3.x. Modern CSS properties widely supported by browsers.
 */
const ADDITIONAL_VALID_PROPERTIES = new Set([
  "row-gap", "column-gap",
  "justify-self", "justify-items",
  "place-items", "place-content", "place-self",
  "aspect-ratio",
  "object-fit", "object-position",
  "user-select",
  "backdrop-filter",
  "will-change",
  "contain",
  "appearance",
  "scroll-behavior", "scroll-snap-type", "scroll-snap-align",
  "overscroll-behavior", "overscroll-behavior-x", "overscroll-behavior-y",
  "text-decoration-line", "text-decoration-style", "text-decoration-color",
  "text-decoration-thickness", "text-underline-offset",
  "accent-color",
  "caret-color",
  "isolation",
  "mix-blend-mode",
  "background-blend-mode",
  "filter",
  "clip-path",
  "mask",
  "writing-mode",
  "text-overflow",
  "hyphens",
  "tab-size",
  "touch-action",
  "resize",
  "all",
  "background",
  // Grid layout
  "grid-template-columns", "grid-template-rows", "grid-template-areas",
  "grid-column", "grid-row", "grid-area",
  "grid-column-start", "grid-column-end", "grid-row-start", "grid-row-end",
  "grid-auto-columns", "grid-auto-rows", "grid-auto-flow",
  "grid-gap",
  // Flex shorthand
  "flex",
  // Inset
  "inset",
  // Outline longhands
  "outline-width", "outline-style", "outline-color", "outline-offset",
  // Shorthands handled by sanitizeStyles — included so they appear in
  // "did you mean?" suggestions (they get expanded before validation)
  "border", "border-top", "border-right", "border-bottom", "border-left",
  "border-radius", "border-width", "border-style", "border-color",
  "outline",
  "padding", "margin", "gap", "inset",
]);

/** Build the complete set of valid CSS property names (kebab-case). */
let _validPropertiesCache: Set<string> | null = null;
function getValidPropertiesSet(): Set<string> {
  if (_validPropertiesCache) return _validPropertiesCache;
  const props = new Set<string>();
  for (const key of Object.keys(cssInitials)) {
    props.add(key);
  }
  for (const prop of ADDITIONAL_VALID_PROPERTIES) {
    props.add(prop);
  }
  _validPropertiesCache = props;
  return props;
}

/**
 * Check if a CSS property name is valid.
 * Accepts both camelCase and kebab-case input.
 * CSS custom properties (--*) and vendor-prefixed properties are always valid.
 */
export function isValidStyleProp(prop: string): boolean {
  if (prop.startsWith("--")) return true;
  if (
    prop.startsWith("-webkit-") || prop.startsWith("-moz-") ||
    prop.startsWith("-ms-") || prop.startsWith("-o-")
  ) {
    return true;
  }
  const kebab = camelToKebab(prop);
  return getValidPropertiesSet().has(kebab);
}

/**
 * Compute Levenshtein distance between two strings.
 * Used for "did you mean?" suggestions on invalid property names.
 */
function levenshteinDistance(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () =>
    Array(n + 1).fill(0)
  );
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (a[i - 1] === b[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1];
      } else {
        dp[i][j] =
          1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
      }
    }
  }
  return dp[m][n];
}

/**
 * Suggest closest valid property names for an invalid input.
 * Returns up to 3 suggestions with Levenshtein distance ≤ 4.
 */
function suggestStyleProps(
  invalid: string,
  maxSuggestions = 3,
  maxDistance = 4
): string[] {
  const kebab = camelToKebab(invalid);
  const validProps = [...getValidPropertiesSet()];
  const scored = validProps
    .map((prop) => ({ prop, dist: levenshteinDistance(kebab, prop) }))
    .filter((s) => s.dist <= maxDistance)
    .sort((a, b) => a.dist - b.dist);
  return scored.slice(0, maxSuggestions).map((s) => s.prop);
}

/** Known CSS shorthands handled by sanitizeStyles(). */
const SHORTHAND_HINTS: Record<string, string> = {
  "padding": "padding → paddingTop/Right/Bottom/Left",
  "margin": "margin → marginTop/Right/Bottom/Left",
  "gap": "gap → row-gap + column-gap",
  "border": "border → border-{top,right,bottom,left}-{width,style,color}",
  "border-radius": "borderRadius → border-{corner}-radius longhands",
  "border-width": "borderWidth → border-{side}-width longhands",
  "border-style": "borderStyle → border-{side}-style longhands",
  "border-color": "borderColor → border-{side}-color longhands",
  "outline": "outline → outline-width, outline-style, outline-color",
};

/**
 * Validate CSS properties after sanitization.
 * Throws a descriptive error for the first invalid property, including
 * fuzzy-match suggestions and shorthand expansion hints.
 */
export function validateStyleProperties(
  styles: Record<string, string>
): void {
  for (const prop of Object.keys(styles)) {
    if (!isValidStyleProp(prop)) {
      const kebab = camelToKebab(prop);
      const suggestions = suggestStyleProps(prop);
      let msg = `Unknown CSS property "${prop}".`;
      if (suggestions.length > 0) {
        msg += ` Did you mean: ${suggestions.map((s) => `"${s}"`).join(", ")}?`;
      }
      const hint = SHORTHAND_HINTS[kebab];
      if (hint) {
        msg += ` (Hint: ${hint})`;
      }
      throw new Error(msg);
    }
  }
}

/**
 * Get the full sorted list of valid CSS property names.
 * Used by the list-style-properties tool.
 */
export function getValidStylePropertyNames(): string[] {
  return [...getValidPropertiesSet()].sort();
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
      `Component UUID "${componentUuid}" not found. Use component tool with action 'list' to see available components.`
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
 * Find the parent of a node in the Tpl tree, including inside slot override
 * content (RenderExpr.tpl arrays on TplComponent instances).
 *
 * Returns the parent node, the child's index, and a reference to the actual
 * children array (either parent.children or arg.expr.tpl for slot overrides).
 * Returns null if the node is the root (has no parent).
 */
function findParent(
  tplTree: any,
  targetNode: any
): { parent: any; childIndex: number; childrenArray: any[] } | null {
  return findParentRecursive(tplTree, targetNode);
}

function findParentRecursive(
  node: any,
  targetNode: any
): { parent: any; childIndex: number; childrenArray: any[] } | null {
  // Check direct children
  const children = node.children ?? [];
  const idx = children.indexOf(targetNode);
  if (idx >= 0) {
    return { parent: node, childIndex: idx, childrenArray: children };
  }

  // Recurse into direct children
  for (const child of children) {
    const found = findParentRecursive(child, targetNode);
    if (found) return found;
  }

  // Check slot override content for TplComponent nodes
  if (isKnownTplComponent(node)) {
    const vs = node.vsettings?.[0];
    if (vs?.args?.length) {
      for (const arg of vs.args) {
        if (isKnownRenderExpr(arg.expr)) {
          const tplArr = arg.expr.tpl ?? [];
          const tplIdx = tplArr.indexOf(targetNode);
          if (tplIdx >= 0) {
            return { parent: node, childIndex: tplIdx, childrenArray: tplArr };
          }
          // Recurse into slot override children
          for (const slotChild of tplArr) {
            const found = findParentRecursive(slotChild, targetNode);
            if (found) return found;
          }
        }
      }
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
  // Traverse regular children (TplTag)
  const children = ancestor.children ?? [];
  for (const child of children) {
    if (isAncestorOf(child, descendant)) {return true;}
  }
  // Traverse slot override children (TplComponent)
  if (ancestor.vsettings) {
    for (const vs of ancestor.vsettings) {
      for (const arg of vs.args ?? []) {
        if (isKnownRenderExpr(arg.expr)) {
          for (const tpl of arg.expr.tpl ?? []) {
            if (isAncestorOf(tpl, descendant)) {return true;}
          }
        }
      }
    }
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
  try {
    const save = await saveManager.saveChanges(changes, modifiedComponentIids);
    pushUndoOperation(description, changes);
    return save;
  } catch (err) {
    // Auto-rollback: revert in-memory model changes so the model stays clean
    // and subsequent mutations can succeed without refresh-project.
    try {
      const tracker = getChangeTracker();
      tracker.withRecording(() => {
        undoChanges(changes.changes);
      });
      console.error(
        `[plasmic-mcp] Auto-rolled back failed mutation: ${description}`
      );
    } catch (rollbackErr) {
      // Rollback itself failed — model is in an inconsistent state
      console.error(
        `[plasmic-mcp] CRITICAL: Rollback failed after save error. ` +
          `Use refresh-project to reload a clean model. (${rollbackErr})`
      );
      const saveErr = err instanceof Error ? err : new Error(String(err));
      throw new Error(
        `${saveErr.message} ` +
          `Additionally, auto-rollback failed. Use refresh-project to reload a clean model.`
      );
    }
    throw err;
  }
}

// --- Variant resolution ---

/**
 * Check if a variant is a code component variant (has codeComponentName and codeComponentVariantKeys).
 */
function isCodeComponentVariant(variant: any): boolean {
  return (
    !!variant.codeComponentName &&
    Array.isArray(variant.codeComponentVariantKeys) &&
    variant.codeComponentVariantKeys.length > 0
  );
}

/**
 * Get code component variant metadata from the component's root TplComponent.
 * Returns null if the component root is not a code component with registered variants.
 *
 * The variant meta is stored on the code component's codeComponentMeta.variants,
 * keyed by variant key (e.g., "selected" → { cssSelector: "[data-selected]", displayName: "Selected" }).
 */
function getCodeComponentVariantMetas(
  component: any
): Record<string, { cssSelector: string; displayName: string }> | null {
  const tplTree = component.tplTree;
  // Root must be a TplComponent (wrapping a code component)
  // Use typeTag (real WAB instances) with _type fallback (duck-typed mocks)
  const tag = tplTree?.typeTag ?? tplTree?._type;
  if (!tplTree || tag !== "TplComponent") return null;

  const codeComp = tplTree.component;
  if (!codeComp?.codeComponentMeta?.variants) return null;

  const metas = codeComp.codeComponentMeta.variants;
  if (typeof metas !== "object" || Object.keys(metas).length === 0) return null;

  return metas;
}

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
  // Include code component variant keys and display names
  const ccMetas = getCodeComponentVariantMetas(component);
  for (const v of component.variants ?? []) {
    if (isCodeComponentVariant(v)) {
      const keys: string[] = v.codeComponentVariantKeys;
      for (const key of keys) {
        names.push(key);
        if (ccMetas?.[key]?.displayName) {
          names.push(ccMetas[key].displayName);
        }
      }
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

  // 3. Search by code component variant key or display name (case-insensitive).
  //    Code component variants take precedence over regular name matches (matches Studio behavior).
  const lowerName = variantStr.toLowerCase();
  const ccMetas = getCodeComponentVariantMetas(component);
  if (ccMetas) {
    for (const v of component.variants ?? []) {
      if (isCodeComponentVariant(v)) {
        const keys: string[] = v.codeComponentVariantKeys;
        // Match by key (case-insensitive)
        if (keys.some((k: string) => k.toLowerCase() === lowerName)) {
          return v;
        }
        // Match by display name (case-insensitive)
        for (const key of keys) {
          if (ccMetas[key]?.displayName?.toLowerCase() === lowerName) {
            return v;
          }
        }
      }
    }
  }

  // 4. Search by name (case-insensitive) in global and component variant groups
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
  codeComponentVariants: Array<{
    uuid: string;
    key: string;
    displayName: string;
    cssSelector: string;
    codeComponentName: string;
    invalid?: boolean;
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

  // Enumerate code component variants (from component.variants where codeComponentName is set).
  // These come from registered ComponentMeta.variants on the code component root.
  const codeComponentVariants: ListVariantsResult["codeComponentVariants"] = [];
  const ccMetas = getCodeComponentVariantMetas(component);

  for (const v of component.variants ?? []) {
    if (isCodeComponentVariant(v)) {
      const keys: string[] = v.codeComponentVariantKeys;
      // A variant is invalid if any of its keys are missing from the code component meta
      const hasInvalidKey = !ccMetas || keys.some((k: string) => !ccMetas[k]);

      // Build display name from meta entries (join multiple display names for multi-key variants)
      const displayNames = keys
        .map((k: string) => ccMetas?.[k]?.displayName)
        .filter(Boolean);
      const displayName =
        displayNames.length > 0 ? displayNames.join(", ") : keys[0];

      // Use first valid key's cssSelector
      const firstValidMeta = keys
        .map((k: string) => ccMetas?.[k])
        .find(Boolean);

      codeComponentVariants.push({
        uuid: v.uuid,
        key: keys[0],
        displayName,
        cssSelector: firstValidMeta?.cssSelector ?? "",
        codeComponentName: v.codeComponentName,
        ...(hasInvalidKey ? { invalid: true } : {}),
      });
    }
  }

  return { globalVariants, componentVariants, styleVariants, codeComponentVariants };
}

// --- update-text ---

export interface UpdateTextResult {
  save: SaveResult;
  nodeName?: string;
  nodeUuid: string;
  previousText?: string;
  newText: string;
  dynamic?: boolean;
  fallback?: string;
}

/**
 * Update the text content of a TplTag node.
 *
 * Finds the node via node-resolver, updates the target variant's text.
 * By default creates static RawText. When `dynamic: true`, creates an
 * ExprText with a CustomCode expression — enabling data-bound text like
 * `$ctx.product.name`.
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
  variant?: string,
  dynamic?: boolean,
  fallback?: string,
  html?: boolean
): Promise<UpdateTextResult> {
  const component = findComponent(componentUuid);
  const result = resolveNode(component, nodeRef);
  const resolved = requireSingleNode(result, nodeRef);

  if (!isKnownTplTag(resolved.node)) {
    throw new Error(
      `Node "${nodeRef}" is not a TplTag and cannot have text updated.`
    );
  }

  // Validate: dynamic text cannot have an empty expression
  if (dynamic && text.trim() === "") {
    throw new Error(
      `Dynamic text expression cannot be empty. Provide a JavaScript expression (e.g., "$ctx.product.name").`
    );
  }

  const tpl = resolved.node;
  const session = requireSession();
  const tplMgr = new TplMgr({ site: session.site });

  // Container check uses base variant (structural, variant-independent)
  const baseVs = tplMgr.ensureBaseVariantSetting(tpl);
  const hasText = baseVs.text && (isKnownRawText(baseVs.text) || isKnownExprText(baseVs.text));
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

    // Extract previous text from either RawText or ExprText
    if (vs.text && isKnownRawText(vs.text)) {
      previousText = vs.text.text;
    } else if (vs.text && isKnownExprText(vs.text)) {
      const expr = vs.text.expr;
      previousText = expr?.code ?? "[dynamic]";
    }

    if (dynamic) {
      // Create ExprText with CustomCode expression
      const fallbackExpr = fallback != null
        ? new CustomCode({ code: JSON.stringify(fallback), fallback: null })
        : null;
      vs.text = new ExprText({
        expr: new CustomCode({ code: text, fallback: fallbackExpr }),
        html: html ?? false,
      });
    } else if (vs.text && isKnownRawText(vs.text)) {
      // Update existing RawText in place
      vs.text.text = text;
    } else {
      // Create new RawText (replaces ExprText or creates fresh)
      vs.text = new RawText({ text, markers: [] });
    }
  });

  const componentIid = getComponentIid(component);
  const variantLabel = resolvedVariant ? ` [variant: ${resolvedVariant.name ?? variant}]` : "";
  const dynamicLabel = dynamic ? " (dynamic)" : "";
  const save = await saveOrAccumulate(
    apiClient,
    changes,
    `update-text: "${text}" on ${resolved.name ?? nodeRef}${variantLabel}${dynamicLabel}`,
    componentIid ? [componentIid] : []
  );

  return {
    save,
    nodeName: resolved.name,
    nodeUuid: resolved.uuid,
    previousText,
    newText: text,
    ...(dynamic ? { dynamic: true } : {}),
    ...(fallback != null ? { fallback } : {}),
  };
}

// --- update-rich-text ---

/** Mark definition as provided by the caller. */
export interface RichTextMark {
  start: number;
  end: number;
  type: "bold" | "italic" | "underline" | "strikethrough" | "link" | "code";
  href?: string;
}

export interface UpdateRichTextResult {
  save: SaveResult;
  nodeName?: string;
  nodeUuid: string;
  previousText?: string;
  newText: string;
  markCount: number;
}

/** The [child] placeholder that WAB uses for NodeMarker positions in RawText. */
const NODE_MARKER_PLACEHOLDER = "[child]";

/** Mark types that map to StyleMarker (CSS properties on a text range). */
const STYLE_MARK_TYPES = new Set(["bold", "italic", "underline", "strikethrough"]);

/** Mark types that map to NodeMarker (inline TplTag elements). */
const NODE_MARK_TYPES = new Set(["link", "code"]);

/**
 * CSS properties for each style mark type.
 * Values are stored as kebab-case in RuleSet.values (WAB convention).
 */
const STYLE_MARK_CSS: Record<string, Record<string, string>> = {
  bold: { "font-weight": "700" },
  italic: { "font-style": "italic" },
  underline: { "text-decoration-line": "underline" },
  strikethrough: { "text-decoration-line": "line-through" },
};

/**
 * Update the text content of a TplTag node with inline formatting marks.
 *
 * Creates a RawText with StyleMarkers (bold, italic, underline, strikethrough)
 * and NodeMarkers (link, code) for inline formatting. This is the rich text
 * counterpart to updateText which creates plain text.
 *
 * StyleMarkers apply CSS properties to text ranges via RuleSet.
 * NodeMarkers wrap text ranges in inline TplTag elements (<a>, <code>).
 *
 * Mark positions are in the user's flat text coordinate system. Internally,
 * NodeMarker text is replaced with "[child]" placeholders and the actual text
 * lives inside the child TplTag's RawText.
 */
export async function updateRichText(
  apiClient: PlasmicApiClient,
  componentUuid: string,
  nodeRef: string,
  text: string,
  marks: RichTextMark[],
  variant?: string
): Promise<UpdateRichTextResult> {
  const component = findComponent(componentUuid);
  const result = resolveNode(component, nodeRef);
  const resolved = requireSingleNode(result, nodeRef);

  if (!isKnownTplTag(resolved.node)) {
    throw new Error(
      `Node "${nodeRef}" is not a TplTag and cannot have text updated.`
    );
  }

  // Validate marks
  validateRichTextMarks(text, marks);

  // If no marks, create plain RawText (same as update-text with no formatting)
  if (marks.length === 0) {
    const tpl = resolved.node;
    const session = requireSession();
    const tplMgr = new TplMgr({ site: session.site });
    const baseVs = tplMgr.ensureBaseVariantSetting(tpl);

    // Container check
    const hasText = baseVs.text && (isKnownRawText(baseVs.text) || isKnownExprText(baseVs.text));
    const isContainer = !hasText && tpl.children && tpl.children.length > 0;
    if (isContainer) {
      throw new Error(
        `Rich text can only be set on text elements. Node "${resolved.name ?? nodeRef}" is a container.`
      );
    }

    const resolvedVariant = variant
      ? resolveVariant(session.site, component, variant)
      : null;

    const tracker = getChangeTracker();
    let previousText: string | undefined;

    const changes = tracker.withRecording(() => {
      const vs = resolvedVariant
        ? ensureVariantSetting(tpl, [resolvedVariant])
        : baseVs;

      if (vs.text && isKnownRawText(vs.text)) {
        previousText = vs.text.text;
      }

      vs.text = new RawText({ text, markers: [] });
    });

    const componentIid = getComponentIid(component);
    const save = await saveOrAccumulate(
      apiClient,
      changes,
      `update-rich-text: plain "${text}" on ${resolved.name ?? nodeRef}`,
      componentIid ? [componentIid] : []
    );

    return {
      save,
      nodeName: resolved.name,
      nodeUuid: resolved.uuid,
      previousText,
      newText: text,
      markCount: 0,
    };
  }

  // Setup session, component, base variant BEFORE building markers
  // (needed so mkTplTagX can create real class instances in integration)
  const tpl = resolved.node;
  const session = requireSession();
  const tplMgr = new TplMgr({ site: session.site });
  const baseVs = tplMgr.ensureBaseVariantSetting(tpl);
  const baseVariant = tplMgr.ensureBaseVariant(component);

  // Container check
  const hasText = baseVs.text && (isKnownRawText(baseVs.text) || isKnownExprText(baseVs.text));
  const isContainer = !hasText && tpl.children && tpl.children.length > 0;
  if (isContainer) {
    throw new Error(
      `Rich text can only be set on text elements. Node "${resolved.name ?? nodeRef}" is a container.`
    );
  }

  // Check for ExprText (dynamic text)
  if (baseVs.text && isKnownExprText(baseVs.text)) {
    throw new Error(
      `Rich text marks not supported on dynamic text. Use update-text with dynamic:true instead.`
    );
  }

  // Separate into node marks (link, code) and style marks (bold, italic, etc.)
  const nodeMarks = marks
    .filter((m) => NODE_MARK_TYPES.has(m.type))
    .sort((a, b) => a.start - b.start);
  const styleMarks = marks.filter((m) => STYLE_MARK_TYPES.has(m.type));

  // Validate: node marks don't overlap each other
  for (let i = 1; i < nodeMarks.length; i++) {
    if (nodeMarks[i].start < nodeMarks[i - 1].end) {
      throw new Error(
        `Link/code marks cannot overlap each other (mark at ${nodeMarks[i - 1].start}-${nodeMarks[i - 1].end} overlaps with ${nodeMarks[i].start}-${nodeMarks[i].end}).`
      );
    }
  }

  // Build WAB text with [child] placeholders and create inline TplTags
  const { wabText, wabNodeMarkers, childTpls, offsetMap } =
    buildNodeMarkerText(text, nodeMarks, baseVariant);

  // Build StyleMarkers, splitting across node mark boundaries
  const { parentStyleMarkers, childStyleMarkers } =
    buildRichStyleMarkers(text, styleMarks, nodeMarks, offsetMap);

  // Apply child style markers to child TplTag RawText
  for (const { childIndex, marker } of childStyleMarkers) {
    const childTpl = childTpls[childIndex];
    const childRawText = childTpl.vsettings?.[0]?.text;
    if (childRawText && isKnownRawText(childRawText)) {
      childRawText.markers.push(marker);
    }
  }

  // All parent-level markers
  const allParentMarkers = [...wabNodeMarkers, ...parentStyleMarkers];

  const resolvedVariant = variant
    ? resolveVariant(session.site, component, variant)
    : null;

  const tracker = getChangeTracker();
  let previousText: string | undefined;

  const changes = tracker.withRecording(() => {
    const vs = resolvedVariant
      ? ensureVariantSetting(tpl, [resolvedVariant])
      : baseVs;

    if (vs.text && isKnownRawText(vs.text)) {
      previousText = vs.text.text;
    }

    // Replace text with rich text
    vs.text = new RawText({ text: wabText, markers: allParentMarkers });

    // Replace inline children — remove old inline TplTag children, add new ones.
    // Inline tags are children referenced by NodeMarkers (a, code, span, etc.).
    const inlineTags = new Set(["a", "code", "span", "strong", "i", "em", "sub", "sup"]);
    if (tpl.children) {
      tpl.children = tpl.children.filter(
        (child: any) => !isKnownTplTag(child) || !inlineTags.has(child.tag)
      );
    } else {
      tpl.children = [];
    }

    // Add new inline TplTag children and set parent pointers
    for (const childTpl of childTpls) {
      childTpl.parent = tpl;
      tpl.children.push(childTpl);
    }
  });

  const componentIid = getComponentIid(component);
  const variantLabel = resolvedVariant
    ? ` [variant: ${resolvedVariant.name ?? variant}]`
    : "";
  const save = await saveOrAccumulate(
    apiClient,
    changes,
    `update-rich-text: "${text}" with ${marks.length} marks on ${resolved.name ?? nodeRef}${variantLabel}`,
    componentIid ? [componentIid] : []
  );

  return {
    save,
    nodeName: resolved.name,
    nodeUuid: resolved.uuid,
    previousText,
    newText: text,
    markCount: marks.length,
  };
}

/**
 * Validate rich text marks for consistency.
 * Throws descriptive errors for invalid marks.
 */
function validateRichTextMarks(text: string, marks: RichTextMark[]): void {
  for (const mark of marks) {
    if (mark.start >= mark.end) {
      throw new Error(
        `Mark start must be less than end (got start=${mark.start}, end=${mark.end} for "${mark.type}" mark).`
      );
    }
    if (mark.end > text.length) {
      throw new Error(
        `Mark end (${mark.end}) exceeds text length (${text.length}).`
      );
    }
    if (mark.start < 0) {
      throw new Error(
        `Mark start must be non-negative (got ${mark.start}).`
      );
    }
    if (mark.type === "link" && !mark.href) {
      throw new Error(`Link marks require 'href' property.`);
    }
  }
}

/**
 * Build WAB text with [child] placeholders for node marks (link, code).
 *
 * Returns the WAB text string, NodeMarker objects, child TplTag objects,
 * and an offset map for converting user positions to WAB positions.
 */
function buildNodeMarkerText(
  userText: string,
  nodeMarks: RichTextMark[],
  baseVariant: any
): {
  wabText: string;
  wabNodeMarkers: any[];
  childTpls: any[];
  offsetMap: { userStart: number; userEnd: number; cumulativeOffset: number }[];
} {
  if (nodeMarks.length === 0) {
    return {
      wabText: userText,
      wabNodeMarkers: [],
      childTpls: [],
      offsetMap: [],
    };
  }

  const parts: string[] = [];
  const wabNodeMarkers: any[] = [];
  const childTpls: any[] = [];
  const offsetMap: { userStart: number; userEnd: number; cumulativeOffset: number }[] = [];
  let lastEnd = 0;
  let cumulativeOffset = 0;

  for (const mark of nodeMarks) {
    // Text before this node mark
    parts.push(userText.slice(lastEnd, mark.start));

    // The WAB position where [child] will be placed
    const wabPosition = parts.join("").length;
    const markedText = userText.slice(mark.start, mark.end);

    // Create inline TplTag for this node mark
    const tag = mark.type === "link" ? "a" : "code";
    const childTpl = createInlineTplTag(tag, markedText, baseVariant, mark.href);
    childTpls.push(childTpl);

    // Create NodeMarker
    wabNodeMarkers.push(
      new NodeMarker({
        position: wabPosition,
        length: NODE_MARKER_PLACEHOLDER.length,
        tpl: childTpl,
      })
    );

    // Add [child] placeholder to WAB text
    parts.push(NODE_MARKER_PLACEHOLDER);

    // Track offset: [child] (7 chars) replaces the original text (mark.end - mark.start chars)
    cumulativeOffset += NODE_MARKER_PLACEHOLDER.length - (mark.end - mark.start);
    offsetMap.push({ userStart: mark.start, userEnd: mark.end, cumulativeOffset });

    lastEnd = mark.end;
  }

  // Text after the last node mark
  parts.push(userText.slice(lastEnd));

  return {
    wabText: parts.join(""),
    wabNodeMarkers,
    childTpls,
    offsetMap,
  };
}

/**
 * Create an inline TplTag for use inside a NodeMarker.
 *
 * Uses mkTplTagX to create proper class instances (required for real WAB
 * model validation in integration). Then sets text content and attributes
 * on the created VariantSetting.
 *
 * For links (<a>): sets the href attribute and text content.
 * For code (<code>): sets text content only.
 */
function createInlineTplTag(tag: string, text: string, baseVariant: any, href?: string): any {
  const tpl = mkTplTagX(tag, { baseVariant, styles: {} });
  const vs = tpl.vsettings[0];

  // Set text content
  vs.text = new RawText({ text, markers: [] });

  // For links, set the href attribute
  if (tag === "a" && href) {
    if (!vs.attrs) { vs.attrs = {}; }
    vs.attrs.href = new CustomCode({
      code: JSON.stringify(href),
      fallback: null,
    });
  }

  return tpl;
}

/**
 * Build StyleMarkers for style marks, handling overlap with node marks.
 *
 * Style marks that are entirely outside node mark ranges produce parent-level
 * StyleMarkers (on the parent RawText). Style marks that overlap with node
 * marks are split: the inside portion produces a child-level StyleMarker
 * (on the child TplTag's RawText), the outside portion produces a parent marker.
 */
function buildRichStyleMarkers(
  userText: string,
  styleMarks: RichTextMark[],
  nodeMarks: RichTextMark[],
  offsetMap: { userStart: number; userEnd: number; cumulativeOffset: number }[]
): {
  parentStyleMarkers: any[];
  childStyleMarkers: { childIndex: number; marker: any }[];
} {
  const parentStyleMarkers: any[] = [];
  const childStyleMarkers: { childIndex: number; marker: any }[] = [];

  for (const mark of styleMarks) {
    const css = STYLE_MARK_CSS[mark.type];
    if (!css) continue;

    // Split the style mark range into segments: inside/outside node marks
    const segments = splitRangeByNodeMarks(mark.start, mark.end, nodeMarks);

    for (const seg of segments) {
      if (seg.type === "outside") {
        // Convert user position to WAB position
        const wabStart = userPosToWabPos(seg.start, nodeMarks, offsetMap);
        const wabEnd = userPosToWabPos(seg.end, nodeMarks, offsetMap);
        if (wabEnd > wabStart) {
          parentStyleMarkers.push(
            new StyleMarker({
              position: wabStart,
              length: wabEnd - wabStart,
              rs: new RuleSet({ values: { ...css }, mixins: [], animations: null }),
            })
          );
        }
      } else {
        // seg.type === "inside" — style marker on child TplTag's RawText
        const childIndex = seg.childIndex!;
        const localStart = seg.start - nodeMarks[childIndex].start;
        const localEnd = seg.end - nodeMarks[childIndex].start;
        if (localEnd > localStart) {
          childStyleMarkers.push({
            childIndex,
            marker: new StyleMarker({
              position: localStart,
              length: localEnd - localStart,
              rs: new RuleSet({ values: { ...css }, mixins: [], animations: null }),
            }),
          });
        }
      }
    }
  }

  return { parentStyleMarkers, childStyleMarkers };
}

/**
 * Split a range [start, end) into segments that are inside or outside node mark ranges.
 */
function splitRangeByNodeMarks(
  start: number,
  end: number,
  nodeMarks: RichTextMark[]
): { type: "inside" | "outside"; start: number; end: number; childIndex?: number }[] {
  if (nodeMarks.length === 0) {
    return [{ type: "outside", start, end }];
  }

  const segments: { type: "inside" | "outside"; start: number; end: number; childIndex?: number }[] = [];
  let cursor = start;

  for (let i = 0; i < nodeMarks.length; i++) {
    const nm = nodeMarks[i];
    if (cursor >= end) break;

    // Outside segment before this node mark
    if (cursor < nm.start && cursor < end) {
      const segEnd = Math.min(nm.start, end);
      if (segEnd > cursor) {
        segments.push({ type: "outside", start: cursor, end: segEnd });
      }
      cursor = segEnd;
    }

    // Inside segment (overlap with this node mark)
    if (cursor < nm.end && cursor < end && cursor >= nm.start) {
      const segStart = Math.max(cursor, nm.start);
      const segEnd = Math.min(nm.end, end);
      if (segEnd > segStart) {
        segments.push({ type: "inside", start: segStart, end: segEnd, childIndex: i });
      }
      cursor = segEnd;
    } else if (cursor < nm.end && cursor < end) {
      // Style mark starts before node mark start but cursor was advanced past it
      cursor = Math.min(nm.end, end);
    }
  }

  // Remaining outside segment after all node marks
  if (cursor < end) {
    segments.push({ type: "outside", start: cursor, end });
  }

  return segments;
}

/**
 * Convert a user text position to a WAB text position, accounting for
 * [child] placeholder offset introduced by node marks.
 */
function userPosToWabPos(
  userPos: number,
  nodeMarks: RichTextMark[],
  offsetMap: { userStart: number; userEnd: number; cumulativeOffset: number }[]
): number {
  // Find how many complete node marks are before this position
  let offset = 0;
  for (let i = 0; i < nodeMarks.length; i++) {
    if (nodeMarks[i].end <= userPos) {
      // This node mark is entirely before userPos
      offset = offsetMap[i].cumulativeOffset;
    } else if (nodeMarks[i].start < userPos) {
      // userPos is inside a node mark — shouldn't happen for "outside" segments
      // but handle gracefully: position at end of [child]
      offset = offsetMap[i].cumulativeOffset;
    } else {
      break;
    }
  }
  return userPos + offset;
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

  const tpl = resolved.node;
  if (!isKnownTplTag(tpl) && !isKnownTplComponent(tpl)) {
    throw new Error(
      `Node "${nodeRef}" is a ${tpl?._type ?? "unknown"} and cannot have styles updated. Only HTML elements and component instances support styling.`
    );
  }

  const session = requireSession();
  const tplMgr = new TplMgr({ site: session.site });

  // Resolve target variant (null = base)
  const resolvedVariant = variant
    ? resolveVariant(session.site, component, variant)
    : null;

  const tracker = getChangeTracker();
  // Resolve token references (token:Name → var(--token-<uuid>)) before
  // shorthand expansion so expanded longhands inherit the var() value.
  const withTokens = resolveTokenReferences(styles, session.site);
  const sanitized = sanitizeStyles(withTokens);
  validateStyleProperties(sanitized);
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

// --- update-attrs ---

export interface UpdateAttrsResult {
  save: SaveResult;
  nodeName?: string;
  nodeUuid: string;
  updatedAttributes: string[];
  removedAttributes: string[];
}

/**
 * Update HTML attributes on a TplTag node.
 *
 * Supports standard HTML attributes, ARIA attributes, and data-* attributes.
 * Rejects event handler attributes (onclick, etc.) for security.
 *
 * Values:
 *   - null → removes the attribute
 *   - string starting with "$" → dynamic CustomCode expression (strips "$")
 *   - string wrapped in "{{...}}" → dynamic CustomCode expression
 *   - everything else → static literal (JSON.stringify)
 *
 * When `variant` is omitted, targets the base variant (backward compatible).
 * When provided, resolves the variant and applies to that VariantSetting.
 */
export async function updateAttrs(
  apiClient: PlasmicApiClient,
  componentUuid: string,
  nodeRef: string,
  attrs: Record<string, unknown>,
  variant?: string
): Promise<UpdateAttrsResult> {
  const component = findComponent(componentUuid);
  const result = resolveNode(component, nodeRef);
  const resolved = requireSingleNode(result, nodeRef);

  if (!isKnownTplTag(resolved.node)) {
    throw new Error(
      `Node "${nodeRef}" is not a TplTag and cannot have attributes updated.`
    );
  }

  const tpl = resolved.node;
  const session = requireSession();
  const tplMgr = new TplMgr({ site: session.site });

  // Resolve target variant (null = base)
  const resolvedVariant = variant
    ? resolveVariant(session.site, component, variant)
    : null;

  // Validate all attribute names before making any changes
  const updatedAttributes: string[] = [];
  const removedAttributes: string[] = [];
  for (const [key, value] of Object.entries(attrs)) {
    const validation = isValidAttrName(key);
    if (!validation.valid) {
      throw new Error(validation.reason!);
    }
    if (value === null) {
      removedAttributes.push(key);
    } else {
      updatedAttributes.push(key);
    }
  }

  const tracker = getChangeTracker();

  const changes = tracker.withRecording(() => {
    const vs = resolvedVariant
      ? ensureVariantSetting(tpl, [resolvedVariant])
      : tplMgr.ensureBaseVariantSetting(tpl);

    if (!vs.attrs) {vs.attrs = {};}

    for (const [key, value] of Object.entries(attrs)) {
      if (value === null) {
        // Remove the attribute
        delete vs.attrs[key];
      } else {
        // Set or update the attribute
        vs.attrs[key] = createAttrExpr(value);
      }
    }
  });

  const componentIid = getComponentIid(component);
  const variantLabel = resolvedVariant ? ` [variant: ${resolvedVariant.name ?? variant}]` : "";
  const allKeys = [...updatedAttributes, ...removedAttributes.map(k => `-${k}`)];
  const save = await saveOrAccumulate(
    apiClient,
    changes,
    `update-attrs: [${allKeys.join(", ")}] on ${resolved.name ?? nodeRef}${variantLabel}`,
    componentIid ? [componentIid] : []
  );

  return {
    save,
    nodeName: resolved.name,
    nodeUuid: resolved.uuid,
    updatedAttributes,
    removedAttributes,
  };
}

// --- add-child ---

export interface AddChildResult {
  save: SaveResult;
  parentName?: string;
  parentUuid: string;
  newNodeUuid?: string;
  position: string | number;
  /** Set when child was added to a named slot on a TplComponent. */
  slotName?: string;
  /** Non-fatal warnings (e.g., parentComponentName mismatch). */
  warnings?: string[];
}

/**
 * Find a registry component entry by matching component name.
 * Handles $dev suffix: a registry entry "MyComponent$dev" matches
 * site model component "MyComponent" and vice versa.
 */
function findRegistryComponent(
  registryComponents: RegistryComponent[],
  componentName: string
): RegistryComponent | null {
  if (!registryComponents?.length) return null;
  return registryComponents.find((c) => {
    if (!c?.name) return false;
    const regName = c.name.endsWith("$dev")
      ? c.name.slice(0, -4)
      : c.name;
    const siteName = componentName.endsWith("$dev")
      ? componentName.slice(0, -4)
      : componentName;
    return regName === siteName;
  }) ?? null;
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
  baseVariant: any,
  registryComponents?: RegistryComponent[]
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
      plasmicElementToTpl(child, tplMgr, baseVariant, registryComponents)
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
        // Convert value to CustomCode expression (same as WAB's codeLit).
        // JSON.stringify returns undefined for functions/symbols; guard against that.
        const serialized = JSON.stringify(value);
        if (serialized === undefined) {
          throw new Error(
            `Prop "${key}" on component "${targetComponent.name}" has a ` +
            `non-serializable value (${typeof value}).`
          );
        }
        const code = value === undefined ? "undefined" : serialized;
        args[key] = new CustomCode({ code, fallback: null });
      }
    }

    const tpl = mkTplComponentX({
      component: targetComponent,
      baseVariant,
      ...(childTpls.length > 0 ? { children: childTpls } : {}),
      ...(args ? { args } : {}),
    });

    // Apply registry enrichments from dev host if available.
    // Code components register metadata (defaultStyles, slot defaultValues)
    // that should be applied to new instances so they render correctly.
    if (registryComponents) {
      const regComp = findRegistryComponent(registryComponents, targetComponent.name);

      // 1. Apply defaultStyles (e.g., width, padding, display).
      if (regComp?.defaultStyles && typeof regComp.defaultStyles === "object") {
        try {
          const vs = tplMgr.ensureBaseVariantSetting(tpl);
          const rsh = RSH(vs.rs, tpl);
          rsh.merge(sanitizeStyles(regComp.defaultStyles));
        } catch (e) {
          // Non-fatal: log and continue without default styles
          console.error(
            `[plasmic-mcp] Warning: Could not apply defaultStyles for "${targetComponent.name}":`,
            e
          );
        }
      }

      // 2. Populate default slot content from registry props[slotName].defaultValue.
      // When a code component registers slot props with defaultValue (PlasmicElement
      // trees), those defaults are populated for slots that don't already have
      // explicit content from the user. This ensures components like Accordion
      // render with meaningful placeholder content out of the box.
      if (regComp?.props && typeof regComp.props === "object") {
        const componentParams: any[] = targetComponent.params ?? [];

        for (const [propName, propMeta] of Object.entries(
          regComp.props as Record<string, any>
        )) {
          if (propMeta?.type !== "slot" || propMeta?.defaultValue == null) continue;

          // Find matching slot param on the WAB component model
          const slotParam = componentParams.find(
            (p: any) => p.tplSlot && p.variable?.name === propName
          );
          if (!slotParam) continue;

          try {
            const vs = tplMgr.ensureBaseVariantSetting(tpl);

            // Skip if slot already has content (from explicit children or args)
            const existingArg = (vs.args ?? []).find(
              (a: any) =>
                a.param === slotParam ||
                a.param?.variable?.name === propName
            );
            if (existingArg) continue;

            // Normalize defaultValue to array of PlasmicElements
            const rawDefaults = Array.isArray(propMeta.defaultValue)
              ? propMeta.defaultValue
              : [propMeta.defaultValue];

            // Filter to valid PlasmicElements (strings or objects with type field)
            const validElements = rawDefaults.filter(
              (elt: unknown) =>
                typeof elt === "string" ||
                (typeof elt === "object" && elt !== null && "type" in elt)
            );
            if (validElements.length === 0) continue;

            // Convert each PlasmicElement to a TplNode recursively
            const defaultTpls = validElements.map((elt: PlasmicElement) =>
              plasmicElementToTpl(elt, tplMgr, baseVariant, registryComponents)
            );

            // Wire into the TplComponent as a slot arg
            const renderExpr = new RenderExpr({ tpl: defaultTpls });
            const newArg = new Arg({ param: slotParam, expr: renderExpr });
            if (!vs.args) {
              vs.args = [];
            }
            vs.args.push(newArg);

            // Set parent pointers for tree traversal
            for (const child of defaultTpls) {
              child.parent = tpl;
            }
          } catch (e) {
            // Non-fatal: log and continue without this slot's defaults
            console.error(
              `[plasmic-mcp] Warning: Could not populate default slot content ` +
                `for "${targetComponent.name}.${propName}":`,
              e
            );
          }
        }
      }
    }

    return tpl;
  }

  // Map element type to HTML tag, with validation for custom tags
  let tag: string;
  switch (element.type) {
    case "box":
    case "vbox":
    case "hbox":
    case "page-section":
      tag = validateContainerTag(element.tag);
      break;
    case "text":
      tag = validateTextTag(element.tag);
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
    ? element.value
    : undefined;

  if (textValue !== undefined) {
    const tpl = mkTplInlinedText(textValue, [baseVariant], tag, { baseVariant });
    const vs = tpl.vsettings[0];

    // Apply explicit styles
    if ("styles" in element && element.styles) {
      const rsh = RSH(vs.rs, tpl);
      rsh.merge(sanitizeStyles(element.styles));
    }

    // Process HTML attributes from element.attrs
    if ("attrs" in element && element.attrs && typeof element.attrs === "object") {
      if (!vs.attrs) {vs.attrs = {};}
      for (const [key, value] of Object.entries(element.attrs as Record<string, unknown>)) {
        const validation = isValidAttrName(key);
        if (!validation.valid) {
          throw new Error(validation.reason!);
        }
        if (value !== null && value !== undefined) {
          vs.attrs[key] = createAttrExpr(value);
        }
      }
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
    plasmicElementToTpl(child, tplMgr, baseVariant, registryComponents)
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
      code: JSON.stringify(element.src),
      fallback: null,
    });
  }

  // Auto-set type="password" for password inputs
  if (element.type === "password") {
    if (!vs.attrs) {vs.attrs = {};}
    // Only set if not already explicitly provided via attrs
    if (!vs.attrs.type) {
      vs.attrs.type = new CustomCode({
        code: JSON.stringify("password"),
        fallback: null,
      });
    }
  }

  // Process HTML attributes from element.attrs
  if ("attrs" in element && element.attrs && typeof element.attrs === "object") {
    if (!vs.attrs) {vs.attrs = {};}
    for (const [key, value] of Object.entries(element.attrs as Record<string, unknown>)) {
      const validation = isValidAttrName(key);
      if (!validation.valid) {
        throw new Error(validation.reason!);
      }
      if (value !== null && value !== undefined) {
        vs.attrs[key] = createAttrExpr(value);
      }
    }
  }

  return tpl;
}

/**
 * Add a child node to a parent container or to a named slot on a TplComponent.
 *
 * Converts a PlasmicElement JSON tree to Tpl nodes — TplTag for HTML
 * primitives, TplComponent for `{ type: "component" }` references.
 *
 * When `parentRef` is a TplTag: inserts into parent.children at position.
 * When `parentRef` is a TplComponent: inserts into the named slot's
 * RenderExpr.tpl array (defaults to "children" slot if `slot` omitted).
 *
 * Error if the parent is a text node (cannot have children).
 */
export async function addChild(
  apiClient: PlasmicApiClient,
  componentUuid: string,
  parentRef: string,
  child: PlasmicElement,
  position?: string | number,
  slot?: string
): Promise<AddChildResult> {
  const component = findComponent(componentUuid);
  const result = resolveNode(component, parentRef);
  const resolved = requireSingleNode(result, parentRef);

  const session = requireSession();
  const tplMgr = new TplMgr({ site: session.site });
  const registryComponents = session.registryData?.components;
  const warnings: string[] = [];

  // Validate parentComponentName from registry: if the child element is a
  // component with a registered parentComponentName, warn when the insertion
  // target doesn't match. This catches misplaced components early (e.g.,
  // AccordionItem outside Accordion) without blocking the operation.
  if (typeof child === "object" && (child.type === "component" || child.type === "default-component") && registryComponents) {
    const childCompRef = child.type === "component"
      ? child.name
      : child.kind;
    if (childCompRef) {
      const regEntry = findRegistryComponent(registryComponents, childCompRef);
      if (regEntry?.parentComponentName) {
        const expectedParent = regEntry.parentComponentName;
        let actualParent: string | null = null;
        if (isKnownTplComponent(resolved.node)) {
          actualParent = resolved.node.component?.name;
        }
        if (actualParent) {
          // Compare with $dev suffix handling
          const stripDev = (n: string) => n.endsWith("$dev") ? n.slice(0, -4) : n;
          if (stripDev(expectedParent) !== stripDev(actualParent)) {
            const msg = `Component "${childCompRef}" is designed to be used inside "${expectedParent}" but is being added to "${actualParent}"`;
            warnings.push(msg);
            console.error(`[plasmic-mcp] Warning: ${msg}`);
          }
        } else {
          // Parent is a TplTag, not a component — may still be valid (inside a slot)
          const msg = `Component "${childCompRef}" is designed to be used inside "${expectedParent}" but is being added to a non-component container`;
          warnings.push(msg);
          console.error(`[plasmic-mcp] Warning: ${msg}`);
        }
      }
    }
  }

  // --- TplComponent parent: add to slot ---
  if (isKnownTplComponent(resolved.node)) {
    const tplComp = resolved.node;
    const targetComp = tplComp.component;

    // Validate the component has slot params
    const slotParams = (targetComp.params ?? []).filter(
      (p: any) => p.tplSlot
    );
    if (slotParams.length === 0) {
      throw new Error(
        `Component "${targetComp.name}" has no slots.`
      );
    }

    // Determine target slot name (default to "children")
    const slotName = slot ?? "children";

    // Find the matching slot param
    const slotParam = slotParams.find(
      (p: any) => p.variable?.name === slotName
    );
    if (!slotParam) {
      const available = slotParams
        .map((p: any) => p.variable?.name)
        .filter(Boolean)
        .sort();
      throw new Error(
        `Slot "${slotName}" not found on component "${targetComp.name}". ` +
          `Available slots: ${available.join(", ")}`
      );
    }

    // Get base variant setting for the TplComponent instance
    const vs = tplMgr.ensureBaseVariantSetting(tplComp);

    // Find existing arg for this slot
    let slotArg = (vs.args ?? []).find(
      (arg: any) =>
        arg.param === slotParam || arg.param?.variable?.name === slotName
    );

    // Validate that existing arg (if any) is a RenderExpr
    if (slotArg && !isKnownRenderExpr(slotArg.expr)) {
      throw new Error(
        `Slot "${slotName}" contains a code expression, not renderable content.`
      );
    }

    const baseVariant = tplMgr.ensureBaseVariant(component);
    const tracker = getChangeTracker();
    let newTpl: any;

    const changes = tracker.withRecording(() => {
      newTpl = plasmicElementToTpl(child, tplMgr, baseVariant, registryComponents);

      if (slotArg) {
        // Slot already has a RenderExpr — insert into its tpl array
        insertIntoArray(slotArg.expr.tpl, newTpl, position);
      } else {
        // No existing override — create new Arg + RenderExpr
        const renderExpr = new RenderExpr({ tpl: [newTpl] });
        const newArg = new Arg({ param: slotParam, expr: renderExpr });
        if (!vs.args) { vs.args = []; }
        vs.args.push(newArg);
      }

      // Set parent pointer for tree traversal
      newTpl.parent = tplComp;
    });

    const componentIid = getComponentIid(component);
    const save = await saveOrAccumulate(
      apiClient,
      changes,
      `add-child: ${typeof child === "string" ? "text" : child.type} to slot "${slotName}" on ${resolved.name ?? parentRef}`,
      componentIid ? [componentIid] : []
    );

    return {
      save,
      parentName: resolved.name,
      parentUuid: resolved.uuid,
      newNodeUuid: newTpl?.uuid,
      position: position ?? "last",
      slotName,
      ...(warnings.length > 0 ? { warnings } : {}),
    };
  }

  // --- TplTag parent: original behavior ---
  if (slot) {
    throw new Error(
      `Slot targeting only applies to component instances. ` +
        `Node "${parentRef}" is a TplTag, not a TplComponent.`
    );
  }

  if (!isKnownTplTag(resolved.node)) {
    throw new Error(
      `Node "${parentRef}" is not a container and cannot have children added.`
    );
  }

  const parent = resolved.node;

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
    newTpl = plasmicElementToTpl(child, tplMgr, baseVariant, registryComponents);
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
    ...(warnings.length > 0 ? { warnings } : {}),
  };
}

/**
 * Insert a node into an array at the specified position.
 * Used for inserting into RenderExpr.tpl arrays (slot content).
 */
function insertIntoArray(
  arr: any[],
  item: any,
  position?: string | number
): void {
  if (position === "first" || position === 0) {
    arr.unshift(item);
  } else if (
    position === "last" ||
    position === undefined ||
    position === null
  ) {
    arr.push(item);
  } else if (typeof position === "number") {
    arr.splice(position, 0, item);
  } else {
    arr.push(item);
  }
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
    parentInfo.childrenArray.splice(parentInfo.childIndex, 1);
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
  slotName?: string;
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
  position?: string | number,
  slot?: string
): Promise<MoveChildResult> {
  const component = findComponent(componentUuid);

  // Resolve both nodes
  const nodeResult = resolveNode(component, nodeRef);
  const resolved = requireSingleNode(nodeResult, nodeRef);

  const parentResult = resolveNode(component, newParentRef);
  const newParent = requireSingleNode(parentResult, newParentRef);

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

  // --- TplComponent parent: move into slot ---
  if (isKnownTplComponent(newParent.node)) {
    const tplComp = newParent.node;
    const targetComp = tplComp.component;

    const slotParams = (targetComp.params ?? []).filter(
      (p: any) => p.tplSlot
    );
    if (slotParams.length === 0) {
      throw new Error(
        `Component "${targetComp.name}" has no slots.`
      );
    }

    const slotName = slot ?? "children";
    const slotParam = slotParams.find(
      (p: any) => p.variable?.name === slotName
    );
    if (!slotParam) {
      const available = slotParams
        .map((p: any) => p.variable?.name)
        .filter(Boolean)
        .sort();
      throw new Error(
        `Slot "${slotName}" not found on component "${targetComp.name}". ` +
          `Available slots: ${available.join(", ")}`
      );
    }

    const session = requireSession();
    const tplMgr = new TplMgr({ site: session.site });
    const vs = tplMgr.ensureBaseVariantSetting(tplComp);

    let slotArg = (vs.args ?? []).find(
      (arg: any) =>
        arg.param === slotParam || arg.param?.variable?.name === slotName
    );

    if (slotArg && !isKnownRenderExpr(slotArg.expr)) {
      throw new Error(
        `Slot "${slotName}" contains a code expression, not renderable content.`
      );
    }

    const tracker = getChangeTracker();

    const changes = tracker.withRecording(() => {
      // Remove from current parent
      currentParentInfo.childrenArray.splice(
        currentParentInfo.childIndex,
        1
      );

      if (slotArg) {
        insertIntoArray(slotArg.expr.tpl, resolved.node, position);
      } else {
        const renderExpr = new RenderExpr({ tpl: [resolved.node] });
        const newArg = new Arg({ param: slotParam, expr: renderExpr });
        if (!vs.args) { vs.args = []; }
        vs.args.push(newArg);
      }

      resolved.node.parent = tplComp;
    });

    const componentIid = getComponentIid(component);
    const save = await saveOrAccumulate(
      apiClient,
      changes,
      `move-child: ${resolved.name ?? nodeRef} to slot "${slotName}" on ${newParent.name ?? newParentRef}`,
      componentIid ? [componentIid] : []
    );

    return {
      save,
      movedName: resolved.name,
      movedUuid: resolved.uuid,
      newParentName: newParent.name,
      newParentUuid: newParent.uuid,
      position: position ?? "last",
      slotName,
    };
  }

  // --- TplTag parent: original behavior ---
  if (slot) {
    throw new Error(
      `Slot targeting only applies to component instances. ` +
        `Node "${newParentRef}" is a TplTag, not a TplComponent.`
    );
  }

  if (!isKnownTplTag(newParent.node)) {
    throw new Error(
      `New parent "${newParentRef}" is not a TplTag and cannot have children.`
    );
  }

  const tracker = getChangeTracker();

  const changes = tracker.withRecording(() => {
    // Remove from current parent (supports both direct children and slot overrides)
    currentParentInfo.childrenArray.splice(
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

// --- clone-child ---

export interface CloneChildResult {
  save: SaveResult;
  clonedName?: string;
  clonedUuid: string;
  originalUuid: string;
  slotName?: string;
}

/**
 * Clone a node and insert the copy as a sibling (or at a specified location).
 *
 * Deep-clones the target node and all descendants with new UUIDs.
 * All variant settings (base + non-base) are copied. Text, styles, attrs,
 * and slot override content are preserved on the clone.
 *
 * By default the clone is inserted as the next sibling of the original.
 * When parentRef + position are provided, the clone is inserted there instead.
 *
 * Cannot clone the root node of a component (it has no parent to insert into).
 */
export async function cloneChild(
  apiClient: PlasmicApiClient,
  componentUuid: string,
  nodeRef: string,
  newName?: string,
  parentRef?: string,
  position?: string | number,
  slot?: string
): Promise<CloneChildResult> {
  const component = findComponent(componentUuid);
  const result = resolveNode(component, nodeRef);
  const resolved = requireSingleNode(result, nodeRef);

  // Cannot clone root node
  if (resolved.node === component.tplTree) {
    throw new Error(
      `Cannot clone the root node of component "${component.name}". ` +
        `Clone individual child nodes instead.`
    );
  }

  const tracker = getChangeTracker();
  let clonedNode: any;
  let resolvedSlotName: string | undefined;

  const changes = tracker.withRecording(() => {
    // Deep clone the node and all descendants using WAB's real clone()
    clonedNode = cloneTpl(resolved.node);

    // Set the name on the clone
    if (newName !== undefined) {
      clonedNode.name = newName;
    } else if (resolved.node.name) {
      clonedNode.name = `${resolved.node.name} (copy)`;
    }

    if (parentRef) {
      // Insert at specified parent + position
      const parentResult = resolveNode(component, parentRef);
      const parentResolved = requireSingleNode(parentResult, parentRef);

      // --- TplComponent parent: clone into slot ---
      if (isKnownTplComponent(parentResolved.node)) {
        const tplComp = parentResolved.node;
        const targetComp = tplComp.component;

        const slotParams = (targetComp.params ?? []).filter(
          (p: any) => p.tplSlot
        );
        if (slotParams.length === 0) {
          throw new Error(
            `Component "${targetComp.name}" has no slots.`
          );
        }

        const slotName = slot ?? "children";
        const slotParam = slotParams.find(
          (p: any) => p.variable?.name === slotName
        );
        if (!slotParam) {
          const available = slotParams
            .map((p: any) => p.variable?.name)
            .filter(Boolean)
            .sort();
          throw new Error(
            `Slot "${slotName}" not found on component "${targetComp.name}". ` +
              `Available slots: ${available.join(", ")}`
          );
        }

        const session = requireSession();
        const tplMgr = new TplMgr({ site: session.site });
        const vs = tplMgr.ensureBaseVariantSetting(tplComp);

        let slotArg = (vs.args ?? []).find(
          (arg: any) =>
            arg.param === slotParam || arg.param?.variable?.name === slotName
        );

        if (slotArg && !isKnownRenderExpr(slotArg.expr)) {
          throw new Error(
            `Slot "${slotName}" contains a code expression, not renderable content.`
          );
        }

        if (slotArg) {
          insertIntoArray(slotArg.expr.tpl, clonedNode, position);
        } else {
          const renderExpr = new RenderExpr({ tpl: [clonedNode] });
          const newArg = new Arg({ param: slotParam, expr: renderExpr });
          if (!vs.args) { vs.args = []; }
          vs.args.push(newArg);
        }

        clonedNode.parent = tplComp;
        resolvedSlotName = slotName;
      } else if (isKnownTplTag(parentResolved.node)) {
        // --- TplTag parent ---
        if (slot) {
          throw new Error(
            `Slot targeting only applies to component instances. ` +
              `Node "${parentRef}" is a TplTag, not a TplComponent.`
          );
        }
        insertChild(parentResolved.node, clonedNode, position);
      } else {
        throw new Error(
          `Parent node "${parentRef}" is not a container and cannot have children added.`
        );
      }
    } else {
      // Reject slot without parentRef
      if (slot) {
        throw new Error(
          `Slot targeting requires parentRef to specify the component instance.`
        );
      }
      // Insert as sibling after the original
      const parentInfo = findParent(component.tplTree, resolved.node);
      if (!parentInfo) {
        throw new Error(
          `Cannot find parent of node "${nodeRef}". The node may be detached.`
        );
      }
      // Insert right after the original node
      parentInfo.childrenArray.splice(parentInfo.childIndex + 1, 0, clonedNode);
      clonedNode.parent = parentInfo.parent;
    }
  });

  const componentIid = getComponentIid(component);
  const save = await saveOrAccumulate(
    apiClient,
    changes,
    `clone-child: ${resolved.name ?? nodeRef}`,
    componentIid ? [componentIid] : []
  );

  return {
    save,
    clonedName: clonedNode?.name,
    clonedUuid: clonedNode?.uuid,
    originalUuid: resolved.uuid,
    ...(resolvedSlotName ? { slotName: resolvedSlotName } : {}),
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

// --- extract-to-component ---

export interface ExtractComponentResult {
  save: SaveResult;
  newComponentUuid: string;
  newComponentName: string;
  instanceUuid: string;
  containingComponentUuid: string;
}

/**
 * Extract a subtree from a component into a new reusable component.
 *
 * The target node (identified by nodeRef) is replaced with a TplComponent
 * instance referencing the newly created component. Styles, children, and
 * variant settings are preserved in the new component.
 *
 * Uses WAB's extractComponent() which handles:
 *   - Cloning the subtree with new UUIDs
 *   - Mapping variants from the containing component to the new component
 *   - Promoting private style variants on the new root
 *   - Resetting positioning (moved to the TplComponent wrapper)
 *   - Piping variant args, slots, and variable references
 *   - Extracting expression dependencies as props
 *
 * getCanvasEnvForTpl returns undefined in the MCP context (no canvas),
 * so code expression fallbacks are not auto-generated. This matches
 * the WAB test pattern (components.spec.ts).
 */
export async function extractToComponent(
  apiClient: PlasmicApiClient,
  componentUuid: string,
  nodeRef: string,
  newName: string,
): Promise<ExtractComponentResult> {
  const component = findComponent(componentUuid);
  const session = requireSession();
  const site = session.site;

  // Resolve the target node
  const result = resolveNode(component, nodeRef);
  const resolved = requireSingleNode(result, nodeRef);
  const tpl = resolved.node;

  // Validate: must be TplTag or TplComponent, not root
  if (!isKnownTplTag(tpl) && !isKnownTplComponent(tpl)) {
    throw new Error(
      `Cannot extract node "${nodeRef}": only TplTag and TplComponent elements can be extracted.`
    );
  }
  if (tpl === component.tplTree) {
    throw new Error(
      `Cannot extract the root element of "${component.name}". Select a child element instead.`
    );
  }

  const tplMgr = new TplMgr({ site });

  // Additional validation via TplMgr (checks column, text ancestor)
  if (!tplMgr.canExtractComponent(tpl)) {
    throw new Error(
      `Cannot extract node "${nodeRef}": element is either a grid column or inside a text element.`
    );
  }

  const tracker = getChangeTracker();
  const uniqueName = tplMgr.getUniqueComponentName(newName);

  let newComponent: any;
  let instanceNode: any;

  const changes = tracker.withRecording(() => {
    instanceNode = wabExtractComponent({
      site,
      name: uniqueName,
      tpl,
      containingComponent: component,
      resurfaceParams: false,
      tplMgr,
      getCanvasEnvForTpl: () => undefined,
    });
    newComponent = instanceNode.component;
    tplMgr.attachComponent(newComponent);
  });

  // Save: both the containing component and the new component are modified
  const componentIid = getComponentIid(component);
  const newComponentIid = getComponentIid(newComponent);
  const iids = [componentIid, newComponentIid].filter(Boolean) as string[];

  const save = await saveOrAccumulate(
    apiClient,
    changes,
    `extract-component: "${newComponent.name}" from "${component.name}"`,
    iids
  );

  return {
    save,
    newComponentUuid: newComponent.uuid,
    newComponentName: newComponent.name,
    instanceUuid: instanceNode.uuid,
    containingComponentUuid: componentUuid,
  };
}

// --- create-style-variant ---

/** Valid CSS pseudo-class/element selectors for style variants. */
const VALID_STYLE_SELECTORS = [
  ":hover",
  ":active",
  ":focus",
  ":focus-visible",
  ":focus-within",
  ":focus-visible-within",
  ":disabled",
  ":visited",
  ":link",
  "::placeholder",
];

export interface CreateStyleVariantResult {
  save: SaveResult;
  variantUuid: string;
  selector: string;
  scope: "component" | "element";
  forTplUuid?: string;
  forTplName?: string;
}

/**
 * Create a new CSS interaction state variant (hover, focus, pressed, etc.)
 * on a component or scoped to a specific element.
 *
 * Component-level variants apply to any element in the component.
 * Element-scoped (private) variants are tied to a specific TplNode.
 *
 * Prevents creating duplicate variants with the same selector on the
 * same scope (component-level or same element).
 */
export async function createStyleVariant(
  apiClient: PlasmicApiClient,
  componentUuid: string,
  selector: string,
  nodeRef?: string
): Promise<CreateStyleVariantResult> {
  const component = findComponent(componentUuid);

  // Validate selector: standard pseudo-class or registered code component selector
  if (!VALID_STYLE_SELECTORS.includes(selector)) {
    const ccMetas = getCodeComponentVariantMetas(component);
    if (ccMetas) {
      const validCCSelectors = Object.values(ccMetas)
        .map((m: any) => m.cssSelector)
        .filter(Boolean);
      if (!validCCSelectors.includes(selector)) {
        throw new Error(
          `Invalid selector "${selector}". Valid selectors: ${[...VALID_STYLE_SELECTORS, ...validCCSelectors].join(", ")}`
        );
      }
    } else {
      throw new Error(
        `Invalid selector "${selector}". Valid selectors: ${VALID_STYLE_SELECTORS.join(", ")}`
      );
    }
  }
  const session = requireSession();
  const tplMgr = new TplMgr({ site: session.site });
  const tracker = getChangeTracker();

  if (nodeRef) {
    // Private (element-scoped) style variant
    const result = resolveNode(component, nodeRef);
    const resolved = requireSingleNode(result, nodeRef);

    if (!isKnownTplTag(resolved.node)) {
      throw new Error(
        `Node "${nodeRef}" is not a TplTag. Style variants can only be created on HTML elements.`
      );
    }

    // Check for existing private style variant with same selector on this element
    const existingVariants = (component.variants ?? []).filter(
      (v: any) => v.selectors?.includes(selector) && v.forTpl === resolved.node
    );
    if (existingVariants.length > 0) {
      throw new Error(
        `A ${selector} variant already exists for this element (uuid: ${existingVariants[0].uuid}). ` +
          `Use update-styles with variant: "${selector}" to edit it.`
      );
    }

    let variant: any;
    const changes = tracker.withRecording(() => {
      variant = tplMgr.createPrivateStyleVariant(component, resolved.node, [selector]);
    });

    const componentIid = getComponentIid(component);
    const save = await saveOrAccumulate(
      apiClient,
      changes,
      `create-style-variant: ${selector} on ${resolved.name ?? nodeRef}`,
      componentIid ? [componentIid] : []
    );

    return {
      save,
      variantUuid: variant!.uuid,
      selector,
      scope: "element",
      forTplUuid: resolved.uuid,
      forTplName: resolved.name,
    };
  } else {
    // Component-level style variant
    const existingVariants = (component.variants ?? []).filter(
      (v: any) => v.selectors?.includes(selector) && !v.forTpl
    );
    if (existingVariants.length > 0) {
      throw new Error(
        `A ${selector} variant already exists for this component (uuid: ${existingVariants[0].uuid}). ` +
          `Use update-styles with variant: "${selector}" to edit it.`
      );
    }

    let variant: any;
    const changes = tracker.withRecording(() => {
      variant = tplMgr.createStyleVariant(component, [selector]);
    });

    const componentIid = getComponentIid(component);
    const save = await saveOrAccumulate(
      apiClient,
      changes,
      `create-style-variant: ${selector} on component ${component.name}`,
      componentIid ? [componentIid] : []
    );

    return {
      save,
      variantUuid: variant!.uuid,
      selector,
      scope: "component",
    };
  }
}

// --- create-variant-group ---

export interface CreateVariantGroupResult {
  save: SaveResult;
  groupUuid: string;
  groupName: string;
  type: "single" | "multi" | "toggle";
  variants: Array<{ uuid: string; name: string }>;
}

/**
 * Create a new named variant group on a component.
 *
 * Variant groups define custom component states (e.g., Size: Small/Medium/Large,
 * or a boolean toggle like "isActive"). Each group can hold multiple variants.
 *
 * Types:
 *   - "single" (default): single-choice group (radio-style, one variant active at a time)
 *   - "multi": multi-choice group (checkbox-style, multiple variants can be active)
 *   - "toggle": standalone boolean variant (auto-creates one variant named after the group)
 *
 * Optionally creates initial variants in the group.
 */
export async function createVariantGroup(
  apiClient: PlasmicApiClient,
  componentUuid: string,
  name: string,
  type?: "single" | "multi" | "toggle",
  initialVariants?: string[]
): Promise<CreateVariantGroupResult> {
  const component = findComponent(componentUuid);
  const session = requireSession();
  const tplMgr = new TplMgr({ site: session.site });
  const tracker = getChangeTracker();

  // Map user-facing type to TplMgr's internal VariantOptionsType
  const resolvedType = type ?? "single";
  let optionsType: string;
  switch (resolvedType) {
    case "multi":
      optionsType = "multiChoice";
      break;
    case "toggle":
      optionsType = "standalone";
      break;
    default:
      optionsType = "singleChoice";
      break;
  }

  let group: any;
  const createdVariants: Array<{ uuid: string; name: string }> = [];

  const changes = tracker.withRecording(() => {
    group = tplMgr.createVariantGroup({ component, name, optionsType });

    // Standalone type auto-creates one variant — capture it
    if (optionsType === "standalone" && group.variants?.length > 0) {
      for (const v of group.variants) {
        createdVariants.push({ uuid: v.uuid, name: v.name });
      }
    }

    // Create additional initial variants if requested
    if (initialVariants && initialVariants.length > 0) {
      for (const variantName of initialVariants) {
        const v = tplMgr.createVariant(component, group, variantName);
        createdVariants.push({ uuid: v.uuid, name: v.name });
      }
    }
  });

  const componentIid = getComponentIid(component);
  const save = await saveOrAccumulate(
    apiClient,
    changes,
    `create-variant-group: "${name}" on ${component.name}`,
    componentIid ? [componentIid] : []
  );

  return {
    save,
    groupUuid: group!.uuid,
    groupName: group!.param?.variable?.name ?? name,
    type: resolvedType,
    variants: createdVariants,
  };
}

// --- set-visibility ---

export interface SetVisibilityResult {
  save: SaveResult;
  nodeName?: string;
  nodeUuid: string;
  previousVisibility: string;
  newVisibility: string;
}

/**
 * Set element visibility per variant.
 *
 * Visibility is stored via two fields on the VariantSetting:
 *   - `dataCond`: a CustomCode expression (false = not rendered, true = rendered)
 *   - `rs.values["plasmic-display-none"]`: internal marker for CSS display:none
 *
 * Three states:
 *   - visible (true): clear dataCond + display-none marker
 *   - notRendered (false): dataCond = code("false"), clear display-none marker
 *   - displayNone ("displayNone"): dataCond = code("true"), set display-none marker
 */
export async function setVisibility(
  apiClient: PlasmicApiClient,
  componentUuid: string,
  nodeRef: string,
  visible: boolean | "displayNone",
  variant?: string
): Promise<SetVisibilityResult> {
  const component = findComponent(componentUuid);
  const result = resolveNode(component, nodeRef);
  const resolved = requireSingleNode(result, nodeRef);

  const tpl = resolved.node;
  if (!isKnownTplTag(tpl) && !isKnownTplComponent(tpl)) {
    throw new Error(
      `Node "${nodeRef}" is not a TplTag or TplComponent and cannot have visibility set.`
    );
  }

  const session = requireSession();
  const tplMgr = new TplMgr({ site: session.site });
  const resolvedVariant = variant
    ? resolveVariant(session.site, component, variant)
    : null;

  const tracker = getChangeTracker();
  let previousVisibility = "visible";

  const changes = tracker.withRecording(() => {
    const vs = resolvedVariant
      ? ensureVariantSetting(tpl, [resolvedVariant])
      : tplMgr.ensureBaseVariantSetting(tpl);

    // Derive previous visibility state
    previousVisibility = deriveVisibility(vs);

    if (visible === true) {
      // Visible: clear dataCond and display-none marker
      vs.dataCond = null;
      if (vs.rs?.values) {
        delete vs.rs.values["plasmic-display-none"];
      }
    } else if (visible === false) {
      // Not rendered: dataCond = false, clear display-none marker
      vs.dataCond = new CustomCode({ code: "false", fallback: null });
      if (vs.rs?.values) {
        delete vs.rs.values["plasmic-display-none"];
      }
    } else if (visible === "displayNone") {
      // Display none: dataCond = true + display-none marker
      vs.dataCond = new CustomCode({ code: "true", fallback: null });
      if (!vs.rs) vs.rs = new RuleSet({ values: {}, mixins: [], animations: null });
      if (!vs.rs.values) vs.rs.values = {};
      vs.rs.values["plasmic-display-none"] = "true";
    }
  });

  const newVisibility =
    visible === true
      ? "visible"
      : visible === false
        ? "notRendered"
        : "displayNone";

  const componentIid = getComponentIid(component);
  const variantLabel = resolvedVariant
    ? ` [variant: ${resolvedVariant.name ?? variant}]`
    : "";
  const save = await saveOrAccumulate(
    apiClient,
    changes,
    `set-visibility: ${newVisibility} on ${resolved.name ?? nodeRef}${variantLabel}`,
    componentIid ? [componentIid] : []
  );

  return {
    save,
    nodeName: resolved.name,
    nodeUuid: resolved.uuid,
    previousVisibility,
    newVisibility,
  };
}

/**
 * Derive the current visibility state from a VariantSetting.
 */
function deriveVisibility(vs: any): string {
  if (!vs?.dataCond) return "visible";
  if (isKnownCustomCode(vs.dataCond)) {
    if (vs.dataCond.code === "false") return "notRendered";
    if (vs.dataCond.code === "true") {
      if (vs.rs?.values?.["plasmic-display-none"] === "true") {
        return "displayNone";
      }
      return "visible";
    }
    return "conditional";
  }
  return "conditional";
}

// --- set-data-cond ---

export interface SetDataCondResult {
  save: SaveResult;
  nodeName?: string;
  nodeUuid: string;
  previousCondition: string | null;
  newCondition: string | null;
}

/**
 * Set or clear a data condition expression for conditional rendering.
 *
 * The condition is a JavaScript expression evaluated at render time.
 * When set, the element is only rendered when the expression is truthy.
 * Pass null to remove the condition (element always renders).
 *
 * Setting a custom condition clears any existing visibility state
 * (PLASMIC_DISPLAY_NONE marker) since the condition now controls rendering.
 */
export async function setDataCond(
  apiClient: PlasmicApiClient,
  componentUuid: string,
  nodeRef: string,
  condition: string | null,
  variant?: string
): Promise<SetDataCondResult> {
  const component = findComponent(componentUuid);
  const result = resolveNode(component, nodeRef);
  const resolved = requireSingleNode(result, nodeRef);

  const tpl = resolved.node;
  if (!isKnownTplTag(tpl) && !isKnownTplComponent(tpl)) {
    throw new Error(
      `Node "${nodeRef}" is not a TplTag or TplComponent and cannot have a data condition set.`
    );
  }

  const session = requireSession();
  const tplMgr = new TplMgr({ site: session.site });
  const resolvedVariant = variant
    ? resolveVariant(session.site, component, variant)
    : null;

  const tracker = getChangeTracker();
  let previousCondition: string | null = null;

  const changes = tracker.withRecording(() => {
    const vs = resolvedVariant
      ? ensureVariantSetting(tpl, [resolvedVariant])
      : tplMgr.ensureBaseVariantSetting(tpl);

    // Extract previous condition
    if (vs.dataCond && isKnownCustomCode(vs.dataCond)) {
      previousCondition = vs.dataCond.code;
    } else if (vs.dataCond && isKnownObjectPath(vs.dataCond)) {
      previousCondition = vs.dataCond.path.join(".");
    }

    if (condition === null) {
      // Remove data condition
      vs.dataCond = null;
    } else {
      // Set custom code expression
      vs.dataCond = new CustomCode({ code: condition, fallback: null });
    }

    // Clear display-none marker — condition now controls rendering
    if (vs.rs?.values) {
      delete vs.rs.values["plasmic-display-none"];
    }
  });

  const componentIid = getComponentIid(component);
  const variantLabel = resolvedVariant
    ? ` [variant: ${resolvedVariant.name ?? variant}]`
    : "";
  const save = await saveOrAccumulate(
    apiClient,
    changes,
    `set-data-cond: ${condition ?? "(removed)"} on ${resolved.name ?? nodeRef}${variantLabel}`,
    componentIid ? [componentIid] : []
  );

  return {
    save,
    nodeName: resolved.name,
    nodeUuid: resolved.uuid,
    previousCondition,
    newCondition: condition,
  };
}

// --- set-data-rep ---

export interface DataRepInfo {
  collection: string;
  elementVariable: string;
  indexVariable?: string;
}

export interface SetDataRepResult {
  save: SaveResult;
  nodeName?: string;
  nodeUuid: string;
  previousDataRep: DataRepInfo | null;
  newDataRep: DataRepInfo | null;
}

/**
 * Set or clear data repetition on an element.
 *
 * When collection is a non-null string, creates a Rep object with Var for
 * element/index variables and a CustomCode expression for the collection.
 * When collection is null, removes the dataRep from the VariantSetting.
 *
 * Note: In WAB, dataRep is stored on VariantSetting but is not truly
 * variantable — it is conventionally set only on the base variant.
 * We accept a variant parameter for API consistency, but omitting it
 * (targeting the base variant) is the expected usage.
 */
export async function setDataRep(
  apiClient: PlasmicApiClient,
  componentUuid: string,
  nodeRef: string,
  collection: string | null,
  elementVariable?: string,
  indexVariable?: string | null,
  variant?: string
): Promise<SetDataRepResult> {
  const component = findComponent(componentUuid);
  const result = resolveNode(component, nodeRef);
  const resolved = requireSingleNode(result, nodeRef);

  const tpl = resolved.node;
  if (!isKnownTplTag(tpl) && !isKnownTplComponent(tpl)) {
    throw new Error(
      `Node "${nodeRef}" is not a TplTag or TplComponent and cannot have data repetition set.`
    );
  }

  const session = requireSession();
  const tplMgr = new TplMgr({ site: session.site });
  const resolvedVariant = variant
    ? resolveVariant(session.site, component, variant)
    : null;

  const tracker = getChangeTracker();
  let previousDataRep: DataRepInfo | null = null;

  const changes = tracker.withRecording(() => {
    const vs = resolvedVariant
      ? ensureVariantSetting(tpl, [resolvedVariant])
      : tplMgr.ensureBaseVariantSetting(tpl);

    // Extract previous dataRep state
    previousDataRep = extractDataRepInfo(vs);

    if (collection === null) {
      // Remove data repetition
      vs.dataRep = null;
    } else {
      // Create Rep with Var for element/index and CustomCode for collection
      const elemName = elementVariable ?? "currentItem";
      const idxName = indexVariable !== null ? (indexVariable ?? "currentIndex") : undefined;

      vs.dataRep = new Rep({
        element: new Var({ name: elemName, uuid: randomUUID() }),
        index: idxName ? new Var({ name: idxName, uuid: randomUUID() }) : null,
        collection: new CustomCode({ code: collection, fallback: null }),
      });
    }
  });

  const newDataRep =
    collection !== null
      ? {
          collection,
          elementVariable: elementVariable ?? "currentItem",
          ...(indexVariable !== null
            ? { indexVariable: indexVariable ?? "currentIndex" }
            : {}),
        }
      : null;

  const componentIid = getComponentIid(component);
  const variantLabel = resolvedVariant
    ? ` [variant: ${resolvedVariant.name ?? variant}]`
    : "";
  const save = await saveOrAccumulate(
    apiClient,
    changes,
    `set-data-rep: ${collection ?? "(removed)"} on ${resolved.name ?? nodeRef}${variantLabel}`,
    componentIid ? [componentIid] : []
  );

  return {
    save,
    nodeName: resolved.name,
    nodeUuid: resolved.uuid,
    previousDataRep,
    newDataRep,
  };
}

/**
 * Extract DataRepInfo from a VariantSetting's dataRep field.
 */
function extractDataRepInfo(vs: any): DataRepInfo | null {
  const rep = vs?.dataRep;
  if (!rep) return null;

  let collection: string;
  if (isKnownCustomCode(rep.collection)) {
    collection = rep.collection.code;
  } else if (isKnownObjectPath(rep.collection)) {
    collection = rep.collection.path.join(".");
  } else {
    return null;
  }

  const info: DataRepInfo = {
    collection,
    elementVariable: rep.element?.name ?? "currentItem",
  };

  if (rep.index?.name) {
    info.indexVariable = rep.index.name;
  }

  return info;
}

// --- Token CRUD ---

export interface CreateTokenResult {
  save: SaveResult;
  tokenUuid: string;
  name: string;
  type: string;
  value: string;
}

/**
 * Create a new style token on the site.
 */
export async function createToken(
  apiClient: PlasmicApiClient,
  name: string,
  tokenType: string,
  value: string
): Promise<CreateTokenResult> {
  const session = requireSession();
  const tplMgr = new TplMgr({ site: session.site });
  const tracker = getChangeTracker();

  let token: any;

  const changes = tracker.withRecording(() => {
    token = tplMgr.addStyleToken({
      name,
      tokenType,
      value,
    });
  });

  const save = await saveOrAccumulate(
    apiClient,
    changes,
    `create-token: ${token.name} (${tokenType})`,
    []
  );

  return {
    save,
    tokenUuid: token.uuid,
    name: token.name,
    type: token.type,
    value: token.value,
  };
}

export interface UpdateTokenResult {
  save: SaveResult;
  tokenUuid: string;
  name: string;
  previousName?: string;
  previousValue?: string;
  value: string;
}

/**
 * Update a token's value and/or name.
 */
export async function updateToken(
  apiClient: PlasmicApiClient,
  tokenRef: string,
  newValue?: string,
  newName?: string
): Promise<UpdateTokenResult> {
  const session = requireSession();
  const allTokens = getAllStyleTokens(session.site);
  const token = findToken(allTokens, tokenRef);
  if (!token) {
    throw new Error(`Token "${tokenRef}" not found.`);
  }

  // Ensure token is local (not from a dependency)
  const localTokens = session.site.styleTokens ?? [];
  if (!localTokens.includes(token)) {
    throw new Error(
      `Token "${tokenRef}" is from a dependency project and cannot be modified.`
    );
  }

  const tplMgr = new TplMgr({ site: session.site });
  const tracker = getChangeTracker();

  let previousValue: string | undefined;
  let previousName: string | undefined;

  const changes = tracker.withRecording(() => {
    if (newValue !== undefined) {
      previousValue = token.value;
      token.value = newValue;
    }
    if (newName !== undefined) {
      previousName = token.name;
      tplMgr.renameStyleToken(token, newName);
    }
  });

  const save = await saveOrAccumulate(
    apiClient,
    changes,
    `update-token: ${token.name}`,
    []
  );

  return {
    save,
    tokenUuid: token.uuid,
    name: token.name,
    previousName,
    previousValue,
    value: token.value,
  };
}

export interface RemoveTokenResult {
  save: SaveResult;
  tokenUuid: string;
  name: string;
  inlinedCount: number;
}

/**
 * Remove a token from the site. Inlines all references (in component styles
 * and other tokens) to the token's current resolved value before removal.
 */
export async function removeToken(
  apiClient: PlasmicApiClient,
  tokenRef: string
): Promise<RemoveTokenResult> {
  const session = requireSession();
  const allTokens = getAllStyleTokens(session.site);
  const token = findToken(allTokens, tokenRef);
  if (!token) {
    throw new Error(`Token "${tokenRef}" not found.`);
  }

  const localTokens: any[] = session.site.styleTokens ?? [];
  if (!localTokens.includes(token)) {
    throw new Error(
      `Token "${tokenRef}" is from a dependency project and cannot be removed.`
    );
  }

  // Build a token value map for resolving references
  const tokenValueMap = new Map<string, string>();
  for (const t of allTokens) {
    tokenValueMap.set(t.uuid, t.value);
  }

  // Resolve the token's value for inlining
  const resolvedValue = resolveTokenValue(token.value, tokenValueMap);
  const tokenRefStr = mkTokenRef(token.uuid);

  const tracker = getChangeTracker();
  let inlinedCount = 0;

  const changes = tracker.withRecording(() => {
    // 1. Inline references in other tokens' values
    for (const t of localTokens) {
      if (t === token) continue;
      if (typeof t.value === "string" && t.value.includes(`--token-${token.uuid}`)) {
        t.value = t.value.replaceAll(tokenRefStr, resolvedValue);
        inlinedCount++;
      }
    }

    // 2. Inline references in component RuleSet values
    for (const comp of session.site.components ?? []) {
      if (!comp.tplTree) continue;
      const tpls = flattenTpls(comp.tplTree);
      for (const tpl of tpls) {
        for (const vs of tpl.vsettings ?? []) {
          const values = vs.rs?.values;
          if (!values || typeof values !== "object") continue;
          for (const [prop, val] of Object.entries(values)) {
            if (typeof val === "string" && val.includes(`--token-${token.uuid}`)) {
              values[prop] = (val as string).replaceAll(tokenRefStr, resolvedValue);
              inlinedCount++;
            }
          }
        }
      }
    }

    // 3. Remove token from the array
    const idx = localTokens.indexOf(token);
    if (idx >= 0) {
      localTokens.splice(idx, 1);
    }
  });

  const save = await saveOrAccumulate(
    apiClient,
    changes,
    `remove-token: ${token.name}`,
    []
  );

  return {
    save,
    tokenUuid: token.uuid,
    name: token.name,
    inlinedCount,
  };
}

export interface DuplicateTokenResult {
  save: SaveResult;
  tokenUuid: string;
  name: string;
  sourceUuid: string;
  sourceName: string;
  value: string;
}

/**
 * Duplicate an existing token with an optional new name.
 */
export async function duplicateToken(
  apiClient: PlasmicApiClient,
  tokenRef: string,
  newName?: string
): Promise<DuplicateTokenResult> {
  const session = requireSession();
  const allTokens = getAllStyleTokens(session.site);
  const token = findToken(allTokens, tokenRef);
  if (!token) {
    throw new Error(`Token "${tokenRef}" not found.`);
  }

  const tplMgr = new TplMgr({ site: session.site });
  const tracker = getChangeTracker();

  let newToken: any;

  const changes = tracker.withRecording(() => {
    newToken = tplMgr.duplicateStyleToken(token);
    if (newName) {
      tplMgr.renameStyleToken(newToken, newName);
    }
  });

  const save = await saveOrAccumulate(
    apiClient,
    changes,
    `duplicate-token: ${token.name} → ${newToken.name}`,
    []
  );

  return {
    save,
    tokenUuid: newToken.uuid,
    name: newToken.name,
    sourceUuid: token.uuid,
    sourceName: token.name,
    value: newToken.value,
  };
}

// --- Component Props ---

/** Reserved prop names that conflict with React/Plasmic internals. */
const RESERVED_PROP_NAMES = new Set([
  "children", "key", "ref", "className", "style",
]);

/** Map from WAB type name to user-facing type string. */
const WAB_TYPE_TO_USER: Record<string, string> = {
  text: "text",
  bool: "boolean",
  num: "number",
  any: "object",
  img: "image",
  href: "href",
  func: "eventHandler",
  renderable: "slot",
  renderFunc: "slot",
  choice: "choice",
  color: "color",
  dateString: "dateString",
  dateRangeStrings: "dateRangeStrings",
  queryData: "queryData",
};

/** Supported user-facing prop types for addProp. */
const SUPPORTED_PROP_TYPES = new Set([
  "text", "number", "boolean", "object", "href", "eventHandler",
]);

export interface PropInfo {
  uuid: string;
  name: string;
  type: string;
  paramKind: string;
  exportType: string;
  description?: string;
  displayName?: string;
  required: boolean;
  isSlot: boolean;
  isState: boolean;
  defaultExpr?: string;
}

/**
 * List all props (params) on a component.
 *
 * Read-only — no mutation or save. Returns structured info for each param
 * including name, type, kind (prop/slot/state), and metadata.
 */
export function listProps(component: any): PropInfo[] {
  return (component.params ?? []).map((param: any) => {
    const typeName = param.type?.name;
    const userType = WAB_TYPE_TO_USER[typeName] ?? typeName ?? "unknown";

    // Determine param kind from typeTag (real WAB) or _type (mock)
    const tag = param.typeTag ?? param._type;
    const kindMap: Record<string, string> = {
      PropParam: "prop",
      SlotParam: "slot",
      StateParam: "state",
      StateChangeHandlerParam: "stateChangeHandler",
      GlobalVariantGroupParam: "globalVariantGroup",
    };
    const paramKind = kindMap[tag] ?? "unknown";

    // Extract default expression if present
    let defaultExpr: string | undefined;
    if (param.defaultExpr) {
      if (isKnownCustomCode(param.defaultExpr)) {
        defaultExpr = param.defaultExpr.code;
      } else if (isKnownObjectPath(param.defaultExpr)) {
        defaultExpr = param.defaultExpr.path.join(".");
      }
    }

    const info: PropInfo = {
      uuid: param.uuid,
      name: param.variable?.name,
      type: userType,
      paramKind,
      exportType: param.exportType ?? "External",
      required: param.required ?? false,
      isSlot: paramKind === "slot" || userType === "slot",
      isState: paramKind === "state" || paramKind === "stateChangeHandler",
    };

    if (param.description) info.description = param.description;
    if (param.displayName) info.displayName = param.displayName;
    if (defaultExpr) info.defaultExpr = defaultExpr;

    return info;
  });
}

// --- add-prop ---

export interface AddPropResult {
  save: SaveResult;
  paramUuid: string;
  name: string;
  type: string;
}

/**
 * Create the WAB type object for a given user-facing prop type string.
 */
function createPropType(propType: string): any {
  switch (propType) {
    case "text": return new TextType({ name: "text" });
    case "number": return new Num({ name: "num" });
    case "boolean": return new BoolType({ name: "bool" });
    case "object": return new AnyType({ name: "any" });
    case "href": return new HrefType({ name: "href" });
    case "eventHandler": return new FunctionType({ name: "func", params: [] });
    default:
      throw new Error(`Unsupported prop type: ${propType}`);
  }
}

/**
 * Convert a user-provided default value to a CustomCode expression,
 * wrapping as needed based on the prop type.
 */
function toDefaultExpr(propType: string, defaultValue: string): any {
  let code: string;
  switch (propType) {
    case "text":
      code = JSON.stringify(defaultValue);
      break;
    case "number": {
      const num = Number(defaultValue);
      if (isNaN(num)) {
        throw new Error(
          `Invalid default value for number prop: "${defaultValue}". Must be a valid number.`
        );
      }
      code = String(num);
      break;
    }
    case "boolean":
      if (defaultValue !== "true" && defaultValue !== "false") {
        throw new Error(
          `Invalid default value for boolean prop: "${defaultValue}". Must be "true" or "false".`
        );
      }
      code = defaultValue;
      break;
    default:
      code = defaultValue;
  }
  return new CustomCode({ code, fallback: null });
}

/**
 * Add a prop (parameter) to a component definition.
 *
 * Creates a PropParam with the specified type and pushes it to component.params.
 * Supported types: text, number, boolean, object, href, eventHandler.
 *
 * The defaultValue is automatically wrapped for the prop type:
 *   - text: wrapped in quotes ("Untitled" → code: '"Untitled"')
 *   - number: validated and used as-is ("42" → code: '42')
 *   - boolean: validated and used as-is ("true" → code: 'true')
 *   - object/href/eventHandler: passed through as-is
 */
export async function addProp(
  apiClient: PlasmicApiClient,
  componentUuid: string,
  name: string,
  propType: string,
  defaultValue?: string,
  description?: string
): Promise<AddPropResult> {
  if (RESERVED_PROP_NAMES.has(name)) {
    throw new Error(
      `Prop name "${name}" is reserved. Reserved names: ${[...RESERVED_PROP_NAMES].join(", ")}`
    );
  }

  if (!SUPPORTED_PROP_TYPES.has(propType)) {
    throw new Error(
      `Invalid prop type "${propType}". Supported types: ${[...SUPPORTED_PROP_TYPES].join(", ")}`
    );
  }

  const component = findComponent(componentUuid);
  const session = requireSession();
  const tplMgr = new TplMgr({ site: session.site });
  const tracker = getChangeTracker();

  // Deduplicate name
  const uniqueName = tplMgr.getUniqueParamName(component, name);

  // Create WAB type object
  const typeObj = createPropType(propType);

  // Create default expression if provided
  const defaultExpr = defaultValue !== undefined
    ? toDefaultExpr(propType, defaultValue)
    : null;

  let param: any;

  const changes = tracker.withRecording(() => {
    param = new PropParam({
      variable: new Var({ name: uniqueName, uuid: randomUUID() }),
      uuid: randomUUID(),
      type: typeObj,
      advanced: false,
      enumValues: [],
      origin: null,
      exportType: "External",
      defaultExpr,
      previewExpr: null,
      propEffect: null,
      description: description ?? null,
      displayName: null,
      about: null,
      isRepeated: null,
      isMainContentSlot: false,
      required: false,
      mergeWithParent: false,
      isLocalizable: false,
    });

    if (!component.params) component.params = [];
    component.params.push(param);
  });

  const componentIid = getComponentIid(component);
  const save = await saveOrAccumulate(
    apiClient,
    changes,
    `add-prop: ${uniqueName} (${propType}) on ${component.name}`,
    componentIid ? [componentIid] : []
  );

  return {
    save,
    paramUuid: param!.uuid,
    name: uniqueName,
    type: propType,
  };
}

// --- remove-prop ---

export interface RemovePropResult {
  save: SaveResult;
  removedName: string;
  removedUuid: string;
  cleanedArgCount: number;
}

/**
 * Find a param on a component by name or UUID.
 */
function findParam(component: any, propRef: string): any | null {
  return (component.params ?? []).find(
    (p: any) => p.uuid === propRef || p.variable?.name === propRef
  ) ?? null;
}

/**
 * Remove a prop from a component definition.
 *
 * Cleans up Arg objects on all TplComponent instances across the project
 * that reference this param. Splices the param from component.params.
 *
 * Cannot remove StateParam or StateChangeHandlerParam via this tool
 * (those should be managed through state management tools).
 */
export async function removeProp(
  apiClient: PlasmicApiClient,
  componentUuid: string,
  propRef: string
): Promise<RemovePropResult> {
  const component = findComponent(componentUuid);
  const session = requireSession();

  const param = findParam(component, propRef);
  if (!param) {
    throw new Error(
      `Prop "${propRef}" not found on component "${component.name}". ` +
        `Use list-props to see available props.`
    );
  }

  const tag = param.typeTag ?? param._type;
  if (tag === "StateParam" || tag === "StateChangeHandlerParam") {
    throw new Error(
      `Cannot remove state param "${param.variable.name}" via remove-prop. ` +
        `State params should be managed through state management tools.`
    );
  }

  const tracker = getChangeTracker();
  let cleanedArgCount = 0;

  const changes = tracker.withRecording(() => {
    // Clean up Args on all TplComponent instances referencing this component
    for (const comp of session.site.components ?? []) {
      if (!comp.tplTree) continue;
      const tpls = flattenTpls(comp.tplTree);
      for (const tpl of tpls) {
        if (isKnownTplComponent(tpl) && tpl.component === component) {
          for (const vs of tpl.vsettings ?? []) {
            const args = vs.args ?? [];
            for (let i = args.length - 1; i >= 0; i--) {
              if (args[i].param === param) {
                args.splice(i, 1);
                cleanedArgCount++;
              }
            }
          }
        }
      }
    }

    // Remove from component.params
    const idx = (component.params ?? []).indexOf(param);
    if (idx >= 0) {
      component.params.splice(idx, 1);
    }
  });

  const componentIid = getComponentIid(component);
  const save = await saveOrAccumulate(
    apiClient,
    changes,
    `remove-prop: ${param.variable.name} from ${component.name}`,
    componentIid ? [componentIid] : []
  );

  return {
    save,
    removedName: param.variable.name,
    removedUuid: param.uuid,
    cleanedArgCount,
  };
}

// --- update-prop ---

export interface UpdatePropResult {
  save: SaveResult;
  paramUuid: string;
  name: string;
  previousName?: string;
  updatedFields: string[];
}

/**
 * Update a prop's name, default value, and/or description.
 *
 * Type cannot be changed via update — use remove-prop + add-prop instead.
 * Uses TplMgr.renameParam() for name changes, which handles expression
 * patching ($props.oldName → $props.newName) across the component.
 */
export async function updateProp(
  apiClient: PlasmicApiClient,
  componentUuid: string,
  propRef: string,
  newName?: string,
  defaultValue?: string,
  description?: string
): Promise<UpdatePropResult> {
  const component = findComponent(componentUuid);
  const session = requireSession();

  const param = findParam(component, propRef);
  if (!param) {
    throw new Error(
      `Prop "${propRef}" not found on component "${component.name}". ` +
        `Use list-props to see available props.`
    );
  }

  if (newName !== undefined && RESERVED_PROP_NAMES.has(newName)) {
    throw new Error(
      `Prop name "${newName}" is reserved. Reserved names: ${[...RESERVED_PROP_NAMES].join(", ")}`
    );
  }

  const tplMgr = new TplMgr({ site: session.site });
  const tracker = getChangeTracker();
  const updatedFields: string[] = [];
  let previousName: string | undefined;

  const changes = tracker.withRecording(() => {
    if (newName !== undefined) {
      previousName = param.variable.name;
      tplMgr.renameParam(component, param, newName);
      updatedFields.push("name");
    }
    if (defaultValue !== undefined) {
      // Derive prop type from param.type.name to wrap correctly
      const wabTypeName = param.type?.name;
      const userType = WAB_TYPE_TO_USER[wabTypeName] ?? wabTypeName ?? "text";
      param.defaultExpr = toDefaultExpr(userType, defaultValue);
      updatedFields.push("defaultValue");
    }
    if (description !== undefined) {
      param.description = description || null;
      updatedFields.push("description");
    }
  });

  const componentIid = getComponentIid(component);
  const save = await saveOrAccumulate(
    apiClient,
    changes,
    `update-prop: ${param.variable.name} on ${component.name} [${updatedFields.join(", ")}]`,
    componentIid ? [componentIid] : []
  );

  return {
    save,
    paramUuid: param.uuid,
    name: param.variable.name,
    previousName,
    updatedFields,
  };
}

// --- State Management ---

/** Supported state variable types. */
const SUPPORTED_STATE_TYPES = new Set([
  "text", "number", "boolean", "array", "object",
]);

export interface StateInfo {
  uuid: string;
  name: string;
  variableType: string;
  accessType: string;
  paramUuid: string;
  initialValue?: string;
}

/**
 * List all named states on a component.
 *
 * Read-only — no mutation or save. Filters to NamedState instances only
 * (excludes VariantGroupState and implicit states).
 */
export function listStates(component: any): StateInfo[] {
  return (component.states ?? [])
    .filter((s: any) => isKnownNamedState(s))
    .map((state: any) => {
      const info: StateInfo = {
        uuid: state.param?.uuid ?? "unknown",
        name: state.name,
        variableType: state.variableType ?? "text",
        accessType: state.accessType ?? "private",
        paramUuid: state.param?.uuid ?? "unknown",
      };

      // Extract initial value from param.defaultExpr
      if (state.param?.defaultExpr) {
        if (isKnownCustomCode(state.param.defaultExpr)) {
          info.initialValue = state.param.defaultExpr.code;
        } else if (isKnownObjectPath(state.param.defaultExpr)) {
          info.initialValue = state.param.defaultExpr.path.join(".");
        }
      }

      return info;
    });
}

// --- add-state ---

export interface AddStateResult {
  save: SaveResult;
  stateUuid: string;
  paramUuid: string;
  name: string;
  variableType: string;
  accessType: string;
}

/**
 * Create the WAB type object for a given state variable type.
 * Maps: text→Text, number→Num, boolean→BoolType, array/object→AnyType.
 */
function createStateType(variableType: string): any {
  switch (variableType) {
    case "text": return new TextType({ name: "text" });
    case "number": return new Num({ name: "num" });
    case "boolean": return new BoolType({ name: "bool" });
    case "array":
    case "object": return new AnyType({ name: "any" });
    default:
      throw new Error(`Unsupported state variable type: ${variableType}`);
  }
}

/**
 * Convert a user-provided initial value string to a CustomCode expression,
 * wrapping as needed based on the state variable type.
 */
function toStateInitialExpr(variableType: string, initialValue: string): any {
  let code: string;
  switch (variableType) {
    case "text":
      code = JSON.stringify(initialValue);
      break;
    case "number": {
      const num = Number(initialValue);
      if (isNaN(num)) {
        throw new Error(
          `Invalid initial value for number state: "${initialValue}". Must be a valid number.`
        );
      }
      code = String(num);
      break;
    }
    case "boolean":
      if (initialValue !== "true" && initialValue !== "false") {
        throw new Error(
          `Invalid initial value for boolean state: "${initialValue}". Must be "true" or "false".`
        );
      }
      code = initialValue;
      break;
    default:
      code = initialValue;
  }
  return new CustomCode({ code, fallback: null });
}

/**
 * Add a named state variable to a component.
 *
 * Creates a NamedState with associated StateParam and StateChangeHandlerParam.
 * The state is pushed to component.states, and both params are pushed to
 * component.params.
 *
 * Supported variable types: text, number, boolean, array, object.
 * Access types: private (default), readonly, writable.
 *
 * When accessType is "writable", the StateParam exportType is "External",
 * otherwise "ToolsOnly".
 */
export async function addState(
  apiClient: PlasmicApiClient,
  componentUuid: string,
  name: string,
  variableType: string,
  accessType: string = "private",
  initialValue?: string
): Promise<AddStateResult> {
  if (!SUPPORTED_STATE_TYPES.has(variableType)) {
    throw new Error(
      `Invalid variable type "${variableType}". Supported types: ${[...SUPPORTED_STATE_TYPES].join(", ")}`
    );
  }

  const validAccessTypes = ["private", "readonly", "writable"];
  if (!validAccessTypes.includes(accessType)) {
    throw new Error(
      `Invalid access type "${accessType}". Supported types: ${validAccessTypes.join(", ")}`
    );
  }

  const component = findComponent(componentUuid);
  const session = requireSession();
  const tplMgr = new TplMgr({ site: session.site });
  const tracker = getChangeTracker();

  // Check for duplicate state name
  const existingStates: any[] = component.states ?? [];
  const duplicate = existingStates.find(
    (s: any) => isKnownNamedState(s) && s.name === name
  );
  if (duplicate) {
    throw new Error(
      `State "${name}" already exists on component "${component.name}".`
    );
  }

  // Deduplicate param names
  const uniqueName = tplMgr.getUniqueParamName(component, name);
  const onChangeName = tplMgr.getUniqueParamName(component, `On ${uniqueName} change`);

  // Create WAB type
  const typeObj = createStateType(variableType);

  // Create initial value expression if provided
  const defaultExpr = initialValue !== undefined
    ? toStateInitialExpr(variableType, initialValue)
    : null;

  // Determine export type based on access
  const paramExportType = accessType === "writable" ? "External" : "ToolsOnly";
  const onChangeExportType = accessType === "private" ? "ToolsOnly" : "External";

  let state: any;
  let valueParam: any;

  const changes = tracker.withRecording(() => {
    // Create StateParam (value param)
    valueParam = new StateParam({
      variable: new Var({ name: uniqueName, uuid: randomUUID() }),
      uuid: randomUUID(),
      type: typeObj,
      state: null, // back-reference set below
      enumValues: [],
      origin: null,
      exportType: paramExportType,
      defaultExpr,
      previewExpr: null,
      propEffect: null,
      description: variableType,
      displayName: null,
      about: null,
      isRepeated: null,
      isMainContentSlot: false,
      required: false,
      mergeWithParent: false,
      isLocalizable: false,
    });

    // Create StateChangeHandlerParam (onChange param)
    const onChangeParam = new StateChangeHandlerParam({
      variable: new Var({ name: onChangeName, uuid: randomUUID() }),
      uuid: randomUUID(),
      type: new FunctionType({ name: "func", params: [new ArgType({ name: "arg", argName: "val", type: createStateType(variableType), displayName: null })] }),
      state: null, // back-reference set below
      enumValues: [],
      origin: null,
      exportType: onChangeExportType,
      defaultExpr: null,
      previewExpr: null,
      propEffect: null,
      description: "EventHandler",
      displayName: null,
      about: null,
      isRepeated: null,
      isMainContentSlot: false,
      required: false,
      mergeWithParent: false,
      isLocalizable: false,
    });

    // Create NamedState
    state = new NamedState({
      name: uniqueName,
      param: valueParam,
      accessType,
      variableType,
      onChangeParam,
      tplNode: null,
      implicitState: null,
    });

    // Set back-references
    valueParam.state = state;
    onChangeParam.state = state;

    // Push to component
    if (!component.states) component.states = [];
    component.states.push(state);

    if (!component.params) component.params = [];
    component.params.push(valueParam);
    component.params.push(onChangeParam);
  });

  const componentIid = getComponentIid(component);
  const save = await saveOrAccumulate(
    apiClient,
    changes,
    `add-state: ${uniqueName} (${variableType}) on ${component.name}`,
    componentIid ? [componentIid] : []
  );

  return {
    save,
    stateUuid: valueParam!.uuid,
    paramUuid: valueParam!.uuid,
    name: uniqueName,
    variableType,
    accessType,
  };
}

// --- remove-state ---

export interface RemoveStateResult {
  save: SaveResult;
  removedName: string;
  removedUuid: string;
  cleanedArgCount: number;
}

/**
 * Find a named state on a component by name or param UUID.
 */
function findState(component: any, stateRef: string): any | null {
  return (component.states ?? []).find(
    (s: any) =>
      isKnownNamedState(s) &&
      (s.name === stateRef || s.param?.uuid === stateRef)
  ) ?? null;
}

/**
 * Remove a named state from a component.
 *
 * Removes the NamedState, its StateParam, and its StateChangeHandlerParam.
 * Cleans up Arg objects on all TplComponent instances that reference
 * either param. Splices both params from component.params and the state
 * from component.states.
 */
export async function removeState(
  apiClient: PlasmicApiClient,
  componentUuid: string,
  stateRef: string
): Promise<RemoveStateResult> {
  const component = findComponent(componentUuid);
  const session = requireSession();

  const state = findState(component, stateRef);
  if (!state) {
    throw new Error(
      `State "${stateRef}" not found on component "${component.name}". ` +
        `Use list-states to see available states.`
    );
  }

  const tracker = getChangeTracker();
  let cleanedArgCount = 0;

  const changes = tracker.withRecording(() => {
    const valueParam = state.param;
    const onChangeParam = state.onChangeParam;

    // Clean up Args on all TplComponent instances referencing this component
    for (const comp of session.site.components ?? []) {
      if (!comp.tplTree) continue;
      const tpls = flattenTpls(comp.tplTree);
      for (const tpl of tpls) {
        if (isKnownTplComponent(tpl) && tpl.component === component) {
          for (const vs of tpl.vsettings ?? []) {
            const args = vs.args ?? [];
            for (let i = args.length - 1; i >= 0; i--) {
              if (args[i].param === valueParam || args[i].param === onChangeParam) {
                args.splice(i, 1);
                cleanedArgCount++;
              }
            }
          }
        }
      }
    }

    // Remove params from component.params
    const params = component.params ?? [];
    for (const param of [valueParam, onChangeParam]) {
      if (!param) continue;
      const idx = params.indexOf(param);
      if (idx >= 0) params.splice(idx, 1);
    }

    // Remove state from component.states
    const states = component.states ?? [];
    const stateIdx = states.indexOf(state);
    if (stateIdx >= 0) states.splice(stateIdx, 1);
  });

  const componentIid = getComponentIid(component);
  const save = await saveOrAccumulate(
    apiClient,
    changes,
    `remove-state: ${state.name} from ${component.name}`,
    componentIid ? [componentIid] : []
  );

  return {
    save,
    removedName: state.name,
    removedUuid: state.param?.uuid ?? "unknown",
    cleanedArgCount,
  };
}

// --- update-state ---

export interface UpdateStateResult {
  save: SaveResult;
  stateUuid: string;
  name: string;
  previousName?: string;
  updatedFields: string[];
}

/**
 * Update a state's name, access type, and/or initial value.
 *
 * Variable type cannot be changed via update — use remove-state + add-state instead.
 * When accessType changes, the associated param export types are updated too.
 */
export async function updateState(
  apiClient: PlasmicApiClient,
  componentUuid: string,
  stateRef: string,
  newName?: string,
  accessType?: string,
  initialValue?: string
): Promise<UpdateStateResult> {
  const component = findComponent(componentUuid);
  const session = requireSession();

  const state = findState(component, stateRef);
  if (!state) {
    throw new Error(
      `State "${stateRef}" not found on component "${component.name}". ` +
        `Use list-states to see available states.`
    );
  }

  if (accessType !== undefined) {
    const validAccessTypes = ["private", "readonly", "writable"];
    if (!validAccessTypes.includes(accessType)) {
      throw new Error(
        `Invalid access type "${accessType}". Supported types: ${validAccessTypes.join(", ")}`
      );
    }
  }

  const tplMgr = new TplMgr({ site: session.site });
  const tracker = getChangeTracker();
  const updatedFields: string[] = [];
  let previousName: string | undefined;

  const changes = tracker.withRecording(() => {
    if (newName !== undefined) {
      previousName = state.name;

      // Check for duplicate
      const existingStates: any[] = component.states ?? [];
      const duplicate = existingStates.find(
        (s: any) => isKnownNamedState(s) && s.name === newName && s !== state
      );
      if (duplicate) {
        throw new Error(
          `State "${newName}" already exists on component "${component.name}".`
        );
      }

      state.name = newName;
      // Rename the underlying param variable too
      if (state.param?.variable) {
        tplMgr.renameParam(component, state.param, newName);
      }
      // Rename the onChange param to match
      if (state.onChangeParam?.variable) {
        const onChangeName = `On ${newName} change`;
        tplMgr.renameParam(component, state.onChangeParam, onChangeName);
      }
      updatedFields.push("name");
    }

    if (accessType !== undefined) {
      state.accessType = accessType;
      // Update export types on params
      if (state.param) {
        state.param.exportType = accessType === "writable" ? "External" : "ToolsOnly";
      }
      if (state.onChangeParam) {
        state.onChangeParam.exportType = accessType === "private" ? "ToolsOnly" : "External";
      }
      updatedFields.push("accessType");
    }

    if (initialValue !== undefined) {
      const variableType = state.variableType ?? "text";
      state.param.defaultExpr = toStateInitialExpr(variableType, initialValue);
      updatedFields.push("initialValue");
    }
  });

  const componentIid = getComponentIid(component);
  const save = await saveOrAccumulate(
    apiClient,
    changes,
    `update-state: ${state.name} on ${component.name} [${updatedFields.join(", ")}]`,
    componentIid ? [componentIid] : []
  );

  return {
    save,
    stateUuid: state.param?.uuid ?? "unknown",
    name: state.name,
    previousName,
    updatedFields,
  };
}

// --- Interactions & Event Handlers ---

/** Valid HTML event names for TplTag elements. */
const VALID_EVENTS = new Set([
  "onClick", "onDoubleClick", "onMouseEnter", "onMouseLeave",
  "onFocus", "onBlur", "onChange", "onSubmit",
  "onKeyDown", "onKeyUp", "onScroll", "onLoad",
]);

/**
 * Supported action names and their user-friendly aliases.
 * Maps user-facing names to WAB internal action names.
 */
const ACTION_ALIASES: Record<string, string> = {
  // WAB internal names (pass-through)
  navigation: "navigation",
  updateVariable: "updateVariable",
  customFunction: "customFunction",
  // User-friendly aliases
  navigateTo: "navigation",
  goToPage: "navigation",
  setState: "updateVariable",
  runCode: "customFunction",
};

/** Supported WAB action names. */
const SUPPORTED_ACTIONS = new Set(["navigation", "updateVariable", "customFunction"]);

/**
 * Resolve a user-provided action name to a WAB internal action name.
 * Accepts both WAB names and user-friendly aliases.
 */
function resolveActionName(actionName: string): string {
  const resolved = ACTION_ALIASES[actionName];
  if (resolved) return resolved;
  if (SUPPORTED_ACTIONS.has(actionName)) return actionName;
  throw new Error(
    `Unknown action "${actionName}". Supported actions: ${[...SUPPORTED_ACTIONS].join(", ")}. ` +
      `Aliases: navigateTo, goToPage, setState, runCode.`
  );
}

export interface InteractionInfo {
  index: number;
  uuid: string;
  event: string;
  actionName: string;
  interactionName: string;
  conditionalMode: string;
  condition?: string;
  args: Record<string, string>;
}

/**
 * List all interactions on a TplTag element.
 *
 * Read-only — scans the base VariantSetting attrs for EventHandler entries.
 * Returns structured info for each interaction including event, action, args.
 */
export function listInteractions(
  component: any,
  nodeRef: string
): InteractionInfo[] {
  const session = requireSession();
  const nodeResult = resolveNode(component, nodeRef);
  const resolved = requireSingleNode(nodeResult, nodeRef);
  const tpl = resolved.node;

  if (!isKnownTplTag(tpl)) {
    throw new Error(
      `Cannot list interactions on a ${tpl._type ?? "non-TplTag"} node. Only TplTag elements support interactions.`
    );
  }

  const tplMgr = new TplMgr({ site: session.site });
  const baseVs = tplMgr.ensureBaseVariantSetting(tpl);
  const attrs = baseVs.attrs ?? {};
  const result: InteractionInfo[] = [];

  for (const [event, expr] of Object.entries(attrs)) {
    if (!event.startsWith("on") || !isKnownEventHandler(expr)) continue;
    const handler = expr as EventHandler;
    for (let i = 0; i < (handler.interactions?.length ?? 0); i++) {
      const interaction = handler.interactions[i];
      const info: InteractionInfo = {
        index: i,
        uuid: interaction.uuid ?? "unknown",
        event,
        actionName: interaction.actionName,
        interactionName: interaction.interactionName,
        conditionalMode: interaction.conditionalMode ?? "always",
        args: {},
      };

      // Extract condition expression
      if (interaction.condExpr) {
        if (isKnownCustomCode(interaction.condExpr)) {
          info.condition = interaction.condExpr.code;
        } else if (isKnownObjectPath(interaction.condExpr)) {
          info.condition = interaction.condExpr.path.join(".");
        }
      }

      // Extract args
      for (const arg of interaction.args ?? []) {
        const argExpr = arg.expr;
        if (isKnownCustomCode(argExpr)) {
          info.args[arg.name] = argExpr.code;
        } else if (isKnownObjectPath(argExpr)) {
          info.args[arg.name] = argExpr.path.join(".");
        } else if (argExpr?._type === "FunctionExpr" && argExpr.bodyExpr) {
          if (isKnownCustomCode(argExpr.bodyExpr)) {
            info.args[arg.name] = argExpr.bodyExpr.code;
          }
        }
      }

      result.push(info);
    }
  }

  return result;
}

// --- add-interaction ---

export interface AddInteractionResult {
  save: SaveResult;
  interactionUuid: string;
  event: string;
  actionName: string;
  interactionName: string;
}

/**
 * Build NameArg[] for the given action and user-provided args.
 */
function buildActionArgs(actionName: string, args: Record<string, string>): any[] {
  const nameArgs: any[] = [];

  switch (actionName) {
    case "navigation": {
      const destination = args.destination;
      if (!destination) {
        throw new Error('Action "navigation" requires a "destination" arg (URL or expression).');
      }
      nameArgs.push(new NameArg({
        name: "destination",
        expr: new CustomCode({ code: destination.startsWith('"') || destination.startsWith("'")
          ? destination
          : JSON.stringify(destination), fallback: null }),
      }));
      break;
    }

    case "updateVariable": {
      const stateName = args.variable ?? args.state;
      if (!stateName) {
        throw new Error('Action "updateVariable" requires a "variable" (or "state") arg with the state name.');
      }
      const value = args.value;
      if (value === undefined) {
        throw new Error('Action "updateVariable" requires a "value" arg with the new value expression.');
      }
      const operation = args.operation ?? "newValue";

      nameArgs.push(new NameArg({
        name: "variable",
        expr: new ObjectPath({ path: ["$state", stateName], fallback: null }),
      }));
      nameArgs.push(new NameArg({
        name: "operation",
        expr: new CustomCode({ code: JSON.stringify(operation), fallback: null }),
      }));
      nameArgs.push(new NameArg({
        name: "value",
        expr: new CustomCode({ code: value, fallback: null }),
      }));
      break;
    }

    case "customFunction": {
      const code = args.customFunction ?? args.code;
      if (!code) {
        throw new Error('Action "customFunction" requires a "code" (or "customFunction") arg.');
      }
      nameArgs.push(new NameArg({
        name: "customFunction",
        expr: new FunctionExpr({
          argNames: ["$steps"],
          bodyExpr: new CustomCode({ code, fallback: null }),
        }),
      }));
      break;
    }

    default:
      throw new Error(`Unsupported action for arg building: ${actionName}`);
  }

  return nameArgs;
}

/**
 * Add an interaction to a TplTag element's event handler.
 *
 * Creates or reuses an EventHandler on the base VariantSetting attrs,
 * then creates an Interaction with the specified action and args.
 *
 * Supported actions: navigation (navigateTo), updateVariable (setState), customFunction (runCode).
 * Events: onClick, onDoubleClick, onMouseEnter, onMouseLeave, onFocus, onBlur,
 *         onChange, onSubmit, onKeyDown, onKeyUp, onScroll, onLoad.
 */
export async function addInteraction(
  apiClient: PlasmicApiClient,
  componentUuid: string,
  nodeRef: string,
  event: string,
  actionName: string,
  args?: Record<string, string>,
  interactionName?: string,
  condition?: string
): Promise<AddInteractionResult> {
  if (!VALID_EVENTS.has(event)) {
    throw new Error(
      `Unknown event "${event}". Available events: ${[...VALID_EVENTS].join(", ")}`
    );
  }

  const resolvedAction = resolveActionName(actionName);

  const component = findComponent(componentUuid);
  const session = requireSession();
  const nodeResult = resolveNode(component, nodeRef);
  const resolved = requireSingleNode(nodeResult, nodeRef);
  const tpl = resolved.node;

  if (!isKnownTplTag(tpl)) {
    throw new Error(
      `Cannot add interactions to a ${tpl._type ?? "non-TplTag"} node. Only TplTag elements support interactions.`
    );
  }

  const tplMgr = new TplMgr({ site: session.site });
  const tracker = getChangeTracker();

  // Build NameArgs for the action
  const nameArgs = buildActionArgs(resolvedAction, args ?? {});

  // Generate a default interaction name if not provided
  const defaultName = interactionName ?? `${event} → ${resolvedAction}`;

  let interactionUuid: string = "";

  const changes = tracker.withRecording(() => {
    const baseVs = tplMgr.ensureBaseVariantSetting(tpl);
    if (!baseVs.attrs) baseVs.attrs = {};

    // Get or create EventHandler
    let handler = baseVs.attrs[event];
    if (!handler || !isKnownEventHandler(handler)) {
      handler = new EventHandler({ interactions: [] });
      baseVs.attrs[event] = handler;
    }

    // Build condition expr if provided
    const condExpr = condition
      ? new CustomCode({ code: condition, fallback: null })
      : null;

    const conditionalMode = condition ? "expression" : "always";

    interactionUuid = randomUUID();

    // Create Interaction
    const interaction = new Interaction({
      interactionName: defaultName,
      actionName: resolvedAction,
      args: nameArgs,
      condExpr,
      conditionalMode,
      uuid: interactionUuid,
      parent: handler,
    });

    handler.interactions.push(interaction);
  });

  const componentIid = getComponentIid(component);
  const save = await saveOrAccumulate(
    apiClient,
    changes,
    `add-interaction: ${event} → ${resolvedAction} on ${component.name}`,
    componentIid ? [componentIid] : []
  );

  return {
    save,
    interactionUuid,
    event,
    actionName: resolvedAction,
    interactionName: defaultName,
  };
}

// --- remove-interaction ---

export interface RemoveInteractionResult {
  save: SaveResult;
  removedCount: number;
  event: string;
}

/**
 * Remove an interaction from a TplTag element's event handler.
 *
 * Can remove by interaction index within a specific event,
 * or remove all interactions for an event (by omitting index).
 * If the EventHandler becomes empty after removal, it is deleted from attrs.
 */
export async function removeInteraction(
  apiClient: PlasmicApiClient,
  componentUuid: string,
  nodeRef: string,
  event: string,
  interactionIndex?: number
): Promise<RemoveInteractionResult> {
  const component = findComponent(componentUuid);
  const session = requireSession();
  const nodeResult = resolveNode(component, nodeRef);
  const resolved = requireSingleNode(nodeResult, nodeRef);
  const tpl = resolved.node;

  if (!isKnownTplTag(tpl)) {
    throw new Error(
      `Cannot remove interactions from a ${tpl._type ?? "non-TplTag"} node.`
    );
  }

  const tplMgr = new TplMgr({ site: session.site });
  const tracker = getChangeTracker();
  let removedCount = 0;

  const changes = tracker.withRecording(() => {
    const baseVs = tplMgr.ensureBaseVariantSetting(tpl);
    const handler = baseVs.attrs?.[event];
    if (!handler || !isKnownEventHandler(handler)) {
      throw new Error(
        `No event handler for "${event}" on this element. Use list-interactions to see available interactions.`
      );
    }

    const interactions = handler.interactions ?? [];

    if (interactionIndex !== undefined) {
      // Remove specific interaction by index
      if (interactionIndex < 0 || interactionIndex >= interactions.length) {
        throw new Error(
          `Interaction index ${interactionIndex} out of range (0-${interactions.length - 1}).`
        );
      }
      interactions.splice(interactionIndex, 1);
      removedCount = 1;
    } else {
      // Remove all interactions for this event
      removedCount = interactions.length;
      interactions.length = 0;
    }

    // Clean up empty handler
    if (interactions.length === 0 && baseVs.attrs) {
      delete baseVs.attrs[event];
    }
  });

  const componentIid = getComponentIid(component);
  const save = await saveOrAccumulate(
    apiClient,
    changes,
    `remove-interaction: ${event} on ${component.name} (removed ${removedCount})`,
    componentIid ? [componentIid] : []
  );

  return { save, removedCount, event };
}

// --- update-interaction ---

export interface UpdateInteractionResult {
  save: SaveResult;
  event: string;
  interactionIndex: number;
  actionName: string;
  interactionName: string;
}

/**
 * Update an existing interaction on a TplTag element's event handler.
 *
 * Modifies the interaction at the given index within the given event's handler.
 * Only provided fields are updated; omitted fields remain unchanged.
 */
export async function updateInteraction(
  apiClient: PlasmicApiClient,
  componentUuid: string,
  nodeRef: string,
  event: string,
  interactionIndex: number,
  updates: {
    actionName?: string;
    args?: Record<string, string>;
    condition?: string | null;
    interactionName?: string;
  }
): Promise<UpdateInteractionResult> {
  const component = findComponent(componentUuid);
  const session = requireSession();
  const nodeResult = resolveNode(component, nodeRef);
  const resolved = requireSingleNode(nodeResult, nodeRef);
  const tpl = resolved.node;

  if (!isKnownTplTag(tpl)) {
    throw new Error(
      `Cannot update interactions on a ${tpl._type ?? "non-TplTag"} node. Only TplTag elements support interactions.`
    );
  }

  const tplMgr = new TplMgr({ site: session.site });
  const tracker = getChangeTracker();

  let finalActionName = "";
  let finalInteractionName = "";

  const changes = tracker.withRecording(() => {
    const baseVs = tplMgr.ensureBaseVariantSetting(tpl);
    const handler = baseVs.attrs?.[event];
    if (!handler || !isKnownEventHandler(handler)) {
      throw new Error(
        `No event handler for "${event}" on this element. Use interaction.list to see available interactions.`
      );
    }

    const interactions = handler.interactions ?? [];
    if (interactionIndex < 0 || interactionIndex >= interactions.length) {
      throw new Error(
        `Interaction index ${interactionIndex} out of range (0-${interactions.length - 1}).`
      );
    }

    const interaction = interactions[interactionIndex];

    // Update action name and rebuild args if actionName changed
    if (updates.actionName !== undefined) {
      const resolvedAction = resolveActionName(updates.actionName);
      interaction.actionName = resolvedAction;
      // When changing action, args must be provided for the new action
      const newArgs = buildActionArgs(resolvedAction, updates.args ?? {});
      interaction.args = newArgs;
    } else if (updates.args !== undefined) {
      // Rebuild args for the current action with new values
      const newArgs = buildActionArgs(interaction.actionName, updates.args);
      interaction.args = newArgs;
    }

    // Update condition
    if (updates.condition !== undefined) {
      if (updates.condition === null || updates.condition === "") {
        interaction.condExpr = null;
        interaction.conditionalMode = "always";
      } else {
        interaction.condExpr = new CustomCode({ code: updates.condition, fallback: null });
        interaction.conditionalMode = "expression";
      }
    }

    // Update interaction name
    if (updates.interactionName !== undefined) {
      interaction.interactionName = updates.interactionName;
    }

    finalActionName = interaction.actionName;
    finalInteractionName = interaction.interactionName;
  });

  const componentIid = getComponentIid(component);
  const save = await saveOrAccumulate(
    apiClient,
    changes,
    `update-interaction: ${event}[${interactionIndex}] on ${component.name}`,
    componentIid ? [componentIid] : []
  );

  return {
    save,
    event,
    interactionIndex,
    actionName: finalActionName,
    interactionName: finalInteractionName,
  };
}

// =============================================================================
// Data Queries — CRUD for ComponentDataQuery and ComponentServerQuery
// =============================================================================

export interface QueryInfo {
  uuid: string;
  name: string;
  queryType: "dataQuery" | "serverQuery";
}

/**
 * List all data queries on a component.
 * Returns both client-side (dataQuery) and server-side (serverQuery) queries.
 */
export function listQueries(component: any): QueryInfo[] {
  requireSession();

  const result: QueryInfo[] = [];

  for (const q of component.dataQueries ?? []) {
    result.push({
      uuid: q.uuid,
      name: q.name,
      queryType: "dataQuery",
    });
  }

  for (const q of component.serverQueries ?? []) {
    result.push({
      uuid: q.uuid,
      name: q.name,
      queryType: "serverQuery",
    });
  }

  return result;
}

export interface AddQueryResult {
  save: SaveResult;
  queryUuid: string;
  name: string;
  queryType: "dataQuery" | "serverQuery";
}

/**
 * Validate a query name: must be a valid JS identifier (used as $queries.name).
 */
function validateQueryName(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) {
    throw new Error("Query name cannot be empty.");
  }
  // Normalize to camelCase-safe identifier (replace spaces/hyphens with camelCase)
  const normalized = trimmed
    .replace(/[-_\s]+(.)/g, (_m, c) => c.toUpperCase())
    .replace(/^[^a-zA-Z$_]/, "_$&"); // prefix with _ if starts with digit
  if (!/^[a-zA-Z$_][a-zA-Z0-9$_]*$/.test(normalized)) {
    throw new Error(
      `Query name "${trimmed}" is not a valid JavaScript identifier. ` +
        `Query names are referenced as $queries.${normalized} in expressions.`
    );
  }
  return normalized;
}

/**
 * Find a query by name or UUID. Searches both dataQueries and serverQueries.
 */
function findQuery(
  component: any,
  queryRef: string
): { query: any; queryType: "dataQuery" | "serverQuery" } {
  // Search data queries
  for (const q of component.dataQueries ?? []) {
    if (q.uuid === queryRef || q.name === queryRef) {
      return { query: q, queryType: "dataQuery" };
    }
  }
  // Search server queries
  for (const q of component.serverQueries ?? []) {
    if (q.uuid === queryRef || q.name === queryRef) {
      return { query: q, queryType: "serverQuery" };
    }
  }
  throw new Error(
    `Query "${queryRef}" not found. Use list-queries to see available queries.`
  );
}

/**
 * Add a new data query to a component.
 * Creates a ComponentDataQuery (client-side) or ComponentServerQuery (server-side).
 */
export async function addQuery(
  apiClient: PlasmicApiClient,
  componentUuid: string,
  name: string,
  queryType: "dataQuery" | "serverQuery" = "dataQuery"
): Promise<AddQueryResult> {
  const validName = validateQueryName(name);
  const component = findComponent(componentUuid);
  const session = requireSession();
  const tracker = getChangeTracker();

  // Check for duplicate names
  const allQueries = [
    ...(component.dataQueries ?? []),
    ...(component.serverQueries ?? []),
  ];
  if (allQueries.some((q: any) => q.name === validName)) {
    throw new Error(
      `Query "${validName}" already exists on component "${component.name}". ` +
        `Use a different name or remove the existing query first.`
    );
  }

  const queryUuid = randomUUID();

  const changes = tracker.withRecording(() => {
    if (queryType === "dataQuery") {
      const query = new ComponentDataQuery({
        uuid: queryUuid,
        name: validName,
        op: null,
      });
      if (!component.dataQueries) component.dataQueries = [];
      component.dataQueries.push(query);
    } else {
      const query = new ComponentServerQuery({
        uuid: queryUuid,
        name: validName,
        op: null,
      });
      if (!component.serverQueries) component.serverQueries = [];
      component.serverQueries.push(query);
    }
  });

  const componentIid = getComponentIid(component);
  const save = await saveOrAccumulate(
    apiClient,
    changes,
    `add-query: ${validName} (${queryType}) on ${component.name}`,
    componentIid ? [componentIid] : []
  );

  return {
    save,
    queryUuid,
    name: validName,
    queryType,
  };
}

export interface RemoveQueryResult {
  save: SaveResult;
  removedName: string;
  removedUuid: string;
  queryType: "dataQuery" | "serverQuery";
}

/**
 * Remove a data query from a component.
 * Uses TplMgr.removeComponentQuery / removeComponentServerQuery for proper cleanup.
 */
export async function removeQuery(
  apiClient: PlasmicApiClient,
  componentUuid: string,
  queryRef: string
): Promise<RemoveQueryResult> {
  const component = findComponent(componentUuid);
  const session = requireSession();
  const tracker = getChangeTracker();
  const { query, queryType } = findQuery(component, queryRef);

  const removedName = query.name;
  const removedUuid = query.uuid;

  const tplMgr = new TplMgr({ site: session.site });

  const changes = tracker.withRecording(() => {
    if (queryType === "dataQuery") {
      tplMgr.removeComponentQuery(component, query);
    } else {
      tplMgr.removeComponentServerQuery(component, query);
    }
  });

  const componentIid = getComponentIid(component);
  const save = await saveOrAccumulate(
    apiClient,
    changes,
    `remove-query: ${removedName} from ${component.name}`,
    componentIid ? [componentIid] : []
  );

  return { save, removedName, removedUuid, queryType };
}

export interface UpdateQueryResult {
  save: SaveResult;
  queryUuid: string;
  name: string;
  queryType: "dataQuery" | "serverQuery";
}

/**
 * Update a data query's name.
 */
export async function updateQuery(
  apiClient: PlasmicApiClient,
  componentUuid: string,
  queryRef: string,
  newName?: string
): Promise<UpdateQueryResult> {
  const component = findComponent(componentUuid);
  requireSession();
  const tracker = getChangeTracker();
  const { query, queryType } = findQuery(component, queryRef);

  if (!newName) {
    throw new Error("At least a new name must be provided for update-query.");
  }

  const validName = validateQueryName(newName);

  // Check for duplicate names (excluding current query)
  const allQueries = [
    ...(component.dataQueries ?? []),
    ...(component.serverQueries ?? []),
  ].filter((q: any) => q.uuid !== query.uuid);
  if (allQueries.some((q: any) => q.name === validName)) {
    throw new Error(
      `Query "${validName}" already exists on component "${component.name}".`
    );
  }

  const changes = tracker.withRecording(() => {
    query.name = validName;
  });

  const componentIid = getComponentIid(component);
  const save = await saveOrAccumulate(
    apiClient,
    changes,
    `update-query: rename to ${validName} on ${component.name}`,
    componentIid ? [componentIid] : []
  );

  return {
    save,
    queryUuid: query.uuid,
    name: validName,
    queryType,
  };
}

// =============================================================================
// Mixins — CRUD for reusable style bundles + apply/remove on elements
// =============================================================================

export interface MixinInfo {
  uuid: string;
  name: string;
  styles: Record<string, string>;
  forTheme: boolean;
}

/**
 * List all mixins in the current project.
 */
export function listMixins(): MixinInfo[] {
  const session = requireSession();
  return (session.site.mixins ?? []).map((m: any) => ({
    uuid: m.uuid,
    name: m.name,
    styles: { ...(m.rs?.values ?? {}) },
    forTheme: m.forTheme ?? false,
  }));
}

export interface CreateMixinResult {
  save: SaveResult;
  mixinUuid: string;
  name: string;
}

/**
 * Find a mixin by name or UUID.
 */
function findMixin(site: any, mixinRef: string): any {
  const mixin = (site.mixins ?? []).find(
    (m: any) => m.uuid === mixinRef || m.name === mixinRef
  );
  if (!mixin) {
    throw new Error(
      `Mixin "${mixinRef}" not found. Use list-mixins to see available mixins.`
    );
  }
  return mixin;
}

/**
 * Create a new mixin with optional styles.
 */
export async function createMixin(
  apiClient: PlasmicApiClient,
  name: string,
  styles?: Record<string, string>
): Promise<CreateMixinResult> {
  const session = requireSession();
  const tracker = getChangeTracker();
  const tplMgr = new TplMgr({ site: session.site });

  const sanitized = styles ? sanitizeStyles(styles) : {};

  let mixinUuid = "";
  let mixinName = "";

  const changes = tracker.withRecording(() => {
    const mixin = tplMgr.addMixin(name);
    mixinUuid = mixin.uuid;
    mixinName = mixin.name;

    // Apply styles to the mixin's RuleSet
    if (Object.keys(sanitized).length > 0) {
      const rs = mixin.rs;
      if (rs && rs.values) {
        Object.assign(rs.values, sanitized);
      }
    }
  });

  const save = await saveOrAccumulate(
    apiClient,
    changes,
    `create-mixin: ${mixinName}`,
    []
  );

  return { save, mixinUuid, name: mixinName };
}

export interface UpdateMixinResult {
  save: SaveResult;
  mixinUuid: string;
  name: string;
  updatedFields: string[];
}

/**
 * Update a mixin's name and/or styles.
 */
export async function updateMixin(
  apiClient: PlasmicApiClient,
  mixinRef: string,
  newName?: string,
  styles?: Record<string, string>
): Promise<UpdateMixinResult> {
  const session = requireSession();
  const tracker = getChangeTracker();
  const tplMgr = new TplMgr({ site: session.site });
  const mixin = findMixin(session.site, mixinRef);

  if (!newName && !styles) {
    throw new Error("At least a new name or styles must be provided for update-mixin.");
  }

  const sanitized = styles ? sanitizeStyles(styles) : undefined;
  const updatedFields: string[] = [];

  const changes = tracker.withRecording(() => {
    if (newName) {
      tplMgr.renameMixin(mixin, newName);
      updatedFields.push("name");
    }
    if (sanitized) {
      const rs = mixin.rs;
      if (rs && rs.values) {
        Object.assign(rs.values, sanitized);
      }
      updatedFields.push("styles");
    }
  });

  const save = await saveOrAccumulate(
    apiClient,
    changes,
    `update-mixin: ${mixin.name}`,
    []
  );

  return { save, mixinUuid: mixin.uuid, name: mixin.name, updatedFields };
}

export interface RemoveMixinResult {
  save: SaveResult;
  removedName: string;
  removedUuid: string;
}

/**
 * Remove a mixin from the site. TplMgr.removeMixin handles reference cleanup.
 */
export async function removeMixin(
  apiClient: PlasmicApiClient,
  mixinRef: string
): Promise<RemoveMixinResult> {
  const session = requireSession();
  const tracker = getChangeTracker();
  const tplMgr = new TplMgr({ site: session.site });
  const mixin = findMixin(session.site, mixinRef);

  const removedName = mixin.name;
  const removedUuid = mixin.uuid;

  const changes = tracker.withRecording(() => {
    tplMgr.removeMixin(mixin);
  });

  const save = await saveOrAccumulate(
    apiClient,
    changes,
    `remove-mixin: ${removedName}`,
    []
  );

  return { save, removedName, removedUuid };
}

export interface ApplyMixinResult {
  save: SaveResult;
  mixinName: string;
  nodeUuid: string;
}

/**
 * Apply a mixin to an element's base VariantSetting.
 * Idempotent — applying the same mixin twice is a no-op.
 */
export async function applyMixin(
  apiClient: PlasmicApiClient,
  componentUuid: string,
  nodeRef: string,
  mixinRef: string
): Promise<ApplyMixinResult> {
  const component = findComponent(componentUuid);
  const session = requireSession();
  const nodeResult = resolveNode(component, nodeRef);
  const resolved = requireSingleNode(nodeResult, nodeRef);
  const tpl = resolved.node;

  const mixin = findMixin(session.site, mixinRef);
  const tplMgr = new TplMgr({ site: session.site });
  const tracker = getChangeTracker();

  const changes = tracker.withRecording(() => {
    const baseVs = tplMgr.ensureBaseVariantSetting(tpl);
    if (!baseVs.rs.mixins.includes(mixin)) {
      baseVs.rs.mixins.push(mixin);
    }
  });

  const componentIid = getComponentIid(component);
  const save = await saveOrAccumulate(
    apiClient,
    changes,
    `apply-mixin: ${mixin.name} on ${resolved.name ?? resolved.uuid}`,
    componentIid ? [componentIid] : []
  );

  return { save, mixinName: mixin.name, nodeUuid: resolved.uuid };
}

export interface DetachMixinResult {
  save: SaveResult;
  mixinName: string;
  nodeUuid: string;
}

/**
 * Remove a mixin from an element's base VariantSetting.
 */
export async function detachMixin(
  apiClient: PlasmicApiClient,
  componentUuid: string,
  nodeRef: string,
  mixinRef: string
): Promise<DetachMixinResult> {
  const component = findComponent(componentUuid);
  const session = requireSession();
  const nodeResult = resolveNode(component, nodeRef);
  const resolved = requireSingleNode(nodeResult, nodeRef);
  const tpl = resolved.node;

  const mixin = findMixin(session.site, mixinRef);
  const tplMgr = new TplMgr({ site: session.site });
  const tracker = getChangeTracker();

  const changes = tracker.withRecording(() => {
    const baseVs = tplMgr.ensureBaseVariantSetting(tpl);
    const idx = baseVs.rs.mixins.indexOf(mixin);
    if (idx < 0) {
      throw new Error(
        `Mixin "${mixin.name}" is not applied to this element. Use get-node-details to see applied mixins.`
      );
    }
    baseVs.rs.mixins.splice(idx, 1);
  });

  const componentIid = getComponentIid(component);
  const save = await saveOrAccumulate(
    apiClient,
    changes,
    `detach-mixin: ${mixin.name} from ${resolved.name ?? resolved.uuid}`,
    componentIid ? [componentIid] : []
  );

  return { save, mixinName: mixin.name, nodeUuid: resolved.uuid };
}

// =============================================================================
// Animations — CRUD for animation sequences + apply/remove on elements
// =============================================================================

/** Valid CSS animation directions */
const VALID_DIRECTIONS = ["normal", "reverse", "alternate", "alternate-reverse"] as const;
/** Valid CSS animation fill modes */
const VALID_FILL_MODES = ["none", "forwards", "backwards", "both"] as const;
/** Valid CSS animation play states */
const VALID_PLAY_STATES = ["paused", "running"] as const;

export interface AnimationSequenceInfo {
  uuid: string;
  name: string;
  keyframeCount: number;
}

export interface AnimationInfo {
  sequenceUuid: string;
  sequenceName: string;
  duration: string;
  delay: string;
  timingFunction: string;
  iterationCount: string;
  direction: string;
  fillMode: string;
  playState: string;
}

/**
 * List all animation sequences in the current project.
 */
export function listAnimationSequences(): AnimationSequenceInfo[] {
  const session = requireSession();
  return (session.site.animationSequences ?? []).map((s: any) => ({
    uuid: s.uuid,
    name: s.name,
    keyframeCount: s.keyframes?.length ?? 0,
  }));
}

/**
 * Find an animation sequence by name or UUID.
 */
function findAnimationSequence(site: any, seqRef: string): any {
  const seq = (site.animationSequences ?? []).find(
    (s: any) => s.uuid === seqRef || s.name === seqRef
  );
  if (!seq) {
    throw new Error(
      `Animation sequence "${seqRef}" not found. Use list-animation-sequences to see available sequences.`
    );
  }
  return seq;
}

export interface CreateAnimationSequenceResult {
  save: SaveResult;
  sequenceUuid: string;
  name: string;
}

/**
 * Create a new animation sequence with optional keyframes.
 * Each keyframe is { percentage: 0-100, styles: Record<string,string> }.
 */
export async function createAnimationSequence(
  apiClient: PlasmicApiClient,
  name: string,
  keyframes?: Array<{ percentage: number; styles: Record<string, string> }>
): Promise<CreateAnimationSequenceResult> {
  const session = requireSession();
  const tracker = getChangeTracker();
  const tplMgr = new TplMgr({ site: session.site });

  let seqUuid = "";
  let seqName = "";

  const changes = tracker.withRecording(() => {
    const seq = tplMgr.addAnimationSequence(name);
    seqUuid = seq.uuid;
    seqName = seq.name;

    if (keyframes && keyframes.length > 0) {
      for (const kf of keyframes) {
        if (kf.percentage < 0 || kf.percentage > 100) {
          throw new Error(`Keyframe percentage must be 0-100, got ${kf.percentage}`);
        }
        const sanitized = sanitizeStyles(kf.styles);
        const rs = new RuleSet({ values: sanitized, mixins: [], animations: null });
        const keyframe = new KeyFrame({ percentage: kf.percentage, rs });
        seq.keyframes.push(keyframe);
      }
    }
  });

  const save = await saveOrAccumulate(
    apiClient,
    changes,
    `create-animation-sequence: ${seqName}`,
    []
  );

  return { save, sequenceUuid: seqUuid, name: seqName };
}

export interface UpdateAnimationSequenceResult {
  save: SaveResult;
  sequenceUuid: string;
  name: string;
  updatedFields: string[];
}

/**
 * Update an animation sequence's name and/or keyframes.
 */
export async function updateAnimationSequence(
  apiClient: PlasmicApiClient,
  seqRef: string,
  newName?: string,
  keyframes?: Array<{ percentage: number; styles: Record<string, string> }>
): Promise<UpdateAnimationSequenceResult> {
  const session = requireSession();
  const tracker = getChangeTracker();
  const tplMgr = new TplMgr({ site: session.site });
  const seq = findAnimationSequence(session.site, seqRef);

  if (!newName && !keyframes) {
    throw new Error("At least a new name or keyframes must be provided for update-animation-sequence.");
  }

  const updatedFields: string[] = [];

  const changes = tracker.withRecording(() => {
    if (newName) {
      tplMgr.renameAnimationSequence(seq, newName);
      updatedFields.push("name");
    }
    if (keyframes) {
      seq.keyframes.length = 0; // clear existing
      for (const kf of keyframes) {
        if (kf.percentage < 0 || kf.percentage > 100) {
          throw new Error(`Keyframe percentage must be 0-100, got ${kf.percentage}`);
        }
        const sanitized = sanitizeStyles(kf.styles);
        const rs = new RuleSet({ values: sanitized, mixins: [], animations: null });
        const keyframe = new KeyFrame({ percentage: kf.percentage, rs });
        seq.keyframes.push(keyframe);
      }
      updatedFields.push("keyframes");
    }
  });

  const save = await saveOrAccumulate(
    apiClient,
    changes,
    `update-animation-sequence: ${seq.name}`,
    []
  );

  return { save, sequenceUuid: seq.uuid, name: seq.name, updatedFields };
}

export interface RemoveAnimationSequenceResult {
  save: SaveResult;
  removedName: string;
  removedUuid: string;
}

/**
 * Remove an animation sequence. TplMgr handles cleanup of all element references.
 */
export async function removeAnimationSequence(
  apiClient: PlasmicApiClient,
  seqRef: string
): Promise<RemoveAnimationSequenceResult> {
  const session = requireSession();
  const tracker = getChangeTracker();
  const tplMgr = new TplMgr({ site: session.site });
  const seq = findAnimationSequence(session.site, seqRef);

  const removedName = seq.name;
  const removedUuid = seq.uuid;

  const changes = tracker.withRecording(() => {
    tplMgr.removeAnimationSequence(seq);
  });

  const save = await saveOrAccumulate(
    apiClient,
    changes,
    `remove-animation-sequence: ${removedName}`,
    []
  );

  return { save, removedName, removedUuid };
}

export interface AddNodeAnimationResult {
  save: SaveResult;
  sequenceName: string;
  nodeUuid: string;
}

/**
 * Apply an animation to an element's base VariantSetting.
 * Creates an Animation instance referencing the sequence with timing parameters,
 * and pushes it onto the element's rs.animations[].
 */
export async function addNodeAnimation(
  apiClient: PlasmicApiClient,
  componentUuid: string,
  nodeRef: string,
  seqRef: string,
  duration?: string,
  delay?: string,
  timingFunction?: string,
  iterationCount?: string,
  direction?: string,
  fillMode?: string,
  playState?: string,
): Promise<AddNodeAnimationResult> {
  const component = findComponent(componentUuid);
  const session = requireSession();
  const nodeResult = resolveNode(component, nodeRef);
  const resolved = requireSingleNode(nodeResult, nodeRef);
  const tpl = resolved.node;

  const seq = findAnimationSequence(session.site, seqRef);
  const tplMgr = new TplMgr({ site: session.site });
  const tracker = getChangeTracker();

  // Validate direction, fillMode, playState
  if (direction && !(VALID_DIRECTIONS as readonly string[]).includes(direction)) {
    throw new Error(`Invalid direction "${direction}". Valid: ${VALID_DIRECTIONS.join(", ")}`);
  }
  if (fillMode && !(VALID_FILL_MODES as readonly string[]).includes(fillMode)) {
    throw new Error(`Invalid fillMode "${fillMode}". Valid: ${VALID_FILL_MODES.join(", ")}`);
  }
  if (playState && !(VALID_PLAY_STATES as readonly string[]).includes(playState)) {
    throw new Error(`Invalid playState "${playState}". Valid: ${VALID_PLAY_STATES.join(", ")}`);
  }

  const changes = tracker.withRecording(() => {
    const baseVs = tplMgr.ensureBaseVariantSetting(tpl);
    const animation = tplMgr.addAnimation(
      seq, duration, delay, timingFunction, iterationCount, direction, fillMode, playState
    );
    if (!baseVs.rs.animations) {
      baseVs.rs.animations = [];
    }
    baseVs.rs.animations.push(animation);
  });

  const componentIid = getComponentIid(component);
  const save = await saveOrAccumulate(
    apiClient,
    changes,
    `add-animation: ${seq.name} on ${resolved.name ?? resolved.uuid}`,
    componentIid ? [componentIid] : []
  );

  return { save, sequenceName: seq.name, nodeUuid: resolved.uuid };
}

export interface RemoveNodeAnimationResult {
  save: SaveResult;
  removedCount: number;
  nodeUuid: string;
}

/**
 * Remove animation(s) from an element's base VariantSetting.
 * If seqRef is provided, removes only animations referencing that sequence.
 * If animationIndex is provided, removes the animation at that index.
 * If neither is provided, removes all animations.
 */
export async function removeNodeAnimation(
  apiClient: PlasmicApiClient,
  componentUuid: string,
  nodeRef: string,
  seqRef?: string,
  animationIndex?: number,
): Promise<RemoveNodeAnimationResult> {
  const component = findComponent(componentUuid);
  const session = requireSession();
  const nodeResult = resolveNode(component, nodeRef);
  const resolved = requireSingleNode(nodeResult, nodeRef);
  const tpl = resolved.node;

  const tplMgr = new TplMgr({ site: session.site });
  const tracker = getChangeTracker();
  let removedCount = 0;

  const changes = tracker.withRecording(() => {
    const baseVs = tplMgr.ensureBaseVariantSetting(tpl);
    const animations = baseVs.rs.animations;

    if (!animations || animations.length === 0) {
      throw new Error("No animations on this element to remove.");
    }

    if (animationIndex !== undefined) {
      if (animationIndex < 0 || animationIndex >= animations.length) {
        throw new Error(
          `Animation index ${animationIndex} out of range (0-${animations.length - 1}).`
        );
      }
      animations.splice(animationIndex, 1);
      removedCount = 1;
    } else if (seqRef) {
      const seq = findAnimationSequence(session.site, seqRef);
      const before = animations.length;
      baseVs.rs.animations = animations.filter((a: any) => a.sequence !== seq);
      removedCount = before - baseVs.rs.animations.length;
      if (removedCount === 0) {
        throw new Error(
          `No animations referencing sequence "${seq.name}" found on this element.`
        );
      }
    } else {
      removedCount = animations.length;
      baseVs.rs.animations = [];
    }
  });

  const componentIid = getComponentIid(component);
  const save = await saveOrAccumulate(
    apiClient,
    changes,
    `remove-animation: ${removedCount} from ${resolved.name ?? resolved.uuid}`,
    componentIid ? [componentIid] : []
  );

  return { save, removedCount, nodeUuid: resolved.uuid };
}

// =============================================================================
// Themes — CRUD for site-level themes (typography + per-tag overrides)
// =============================================================================

/** Valid CSS selectors for ThemeStyle entries. */
const THEMABLE_TAGS = [
  "a", "blockquote", "code", "em", "h1", "h2", "h3", "h4", "h5", "h6",
  "i", "li", "ol", "p", "pre", "strong", "ul",
] as const;

export interface ThemeStyleInfo {
  selector: string;
  styles: Record<string, string>;
}

export interface ThemeInfo {
  index: number;
  isActive: boolean;
  defaultStyleName: string;
  defaultStyles: Record<string, string>;
  themeStyles: ThemeStyleInfo[];
}

/**
 * List all themes in the current project.
 * Themes don't have names/UUIDs — they are referenced by index in site.themes[].
 */
export function listThemes(): ThemeInfo[] {
  const session = requireSession();
  const themes = session.site.themes ?? [];
  const activeTheme = session.site.activeTheme;

  return themes.map((t: any, idx: number) => ({
    index: idx,
    isActive: t === activeTheme,
    defaultStyleName: t.defaultStyle?.name ?? "Unnamed",
    defaultStyles: { ...(t.defaultStyle?.rs?.values ?? {}) },
    themeStyles: (t.styles ?? []).map((ts: any) => ({
      selector: ts.selector,
      styles: { ...(ts.style?.rs?.values ?? {}) },
    })),
  }));
}

export interface CreateThemeResult {
  save: SaveResult;
  themeIndex: number;
}

/**
 * Create a new theme with default typography styles and optional per-tag overrides.
 */
export async function createTheme(
  apiClient: PlasmicApiClient,
  defaultStyles?: Record<string, string>,
  themeStyles?: Array<{ selector: string; styles: Record<string, string> }>,
  setActive?: boolean,
): Promise<CreateThemeResult> {
  const session = requireSession();
  const tracker = getChangeTracker();

  // Validate selectors
  if (themeStyles) {
    for (const ts of themeStyles) {
      const baseTag = ts.selector.split(":")[0];
      if (!(THEMABLE_TAGS as readonly string[]).includes(baseTag)) {
        throw new Error(
          `Invalid selector "${ts.selector}". Valid base tags: ${THEMABLE_TAGS.join(", ")}`
        );
      }
    }
  }

  let themeIndex = -1;

  const changes = tracker.withRecording(() => {
    const sanitizedDefault = defaultStyles ? sanitizeStyles(defaultStyles) : {};

    const defaultMixin = new Mixin({
      name: "Custom Typography",
      rs: new RuleSet({ values: sanitizedDefault, mixins: [], animations: null }),
      preview: null,
      uuid: randomUUID().slice(0, 8),
      forTheme: true,
      variantedRs: [],
    });

    const styles: any[] = [];
    if (themeStyles) {
      for (const ts of themeStyles) {
        const sanitized = sanitizeStyles(ts.styles);
        const mixin = new Mixin({
          name: `Theme "${ts.selector}"`,
          rs: new RuleSet({ values: sanitized, mixins: [], animations: null }),
          preview: null,
          uuid: randomUUID().slice(0, 8),
          forTheme: true,
          variantedRs: [],
        });
        styles.push(new ThemeStyle({ selector: ts.selector, style: mixin }));
      }
    }

    const theme = new Theme({
      defaultStyle: defaultMixin,
      styles,
      layout: null,
      addItemPrefs: {},
      active: false,
    });

    if (!session.site.themes) {
      session.site.themes = [];
    }
    session.site.themes.push(theme);
    themeIndex = session.site.themes.length - 1;

    if (setActive) {
      session.site.activeTheme = theme;
    }
  });

  const save = await saveOrAccumulate(
    apiClient,
    changes,
    `create-theme: index ${themeIndex}`,
    []
  );

  return { save, themeIndex };
}

export interface UpdateThemeResult {
  save: SaveResult;
  themeIndex: number;
  updatedFields: string[];
}

/**
 * Update a theme's default typography styles and/or per-tag overrides.
 */
export async function updateTheme(
  apiClient: PlasmicApiClient,
  themeIndex: number,
  defaultStyles?: Record<string, string>,
  themeStyles?: Array<{ selector: string; styles: Record<string, string> }>,
): Promise<UpdateThemeResult> {
  const session = requireSession();
  const tracker = getChangeTracker();
  const themes = session.site.themes ?? [];

  if (themeIndex < 0 || themeIndex >= themes.length) {
    throw new Error(
      `Theme index ${themeIndex} out of range (0-${themes.length - 1}). Use list-themes to see available themes.`
    );
  }

  if (!defaultStyles && !themeStyles) {
    throw new Error("At least defaultStyles or themeStyles must be provided for update-theme.");
  }

  // Validate selectors
  if (themeStyles) {
    for (const ts of themeStyles) {
      const baseTag = ts.selector.split(":")[0];
      if (!(THEMABLE_TAGS as readonly string[]).includes(baseTag)) {
        throw new Error(
          `Invalid selector "${ts.selector}". Valid base tags: ${THEMABLE_TAGS.join(", ")}`
        );
      }
    }
  }

  const updatedFields: string[] = [];

  const changes = tracker.withRecording(() => {
    const theme = themes[themeIndex];

    if (defaultStyles) {
      const sanitized = sanitizeStyles(defaultStyles);
      if (theme.defaultStyle?.rs?.values) {
        Object.assign(theme.defaultStyle.rs.values, sanitized);
      }
      updatedFields.push("defaultStyles");
    }

    if (themeStyles) {
      for (const ts of themeStyles) {
        // Find existing ThemeStyle for this selector, or create new one
        let existing = theme.styles.find((s: any) => s.selector === ts.selector);
        const sanitized = sanitizeStyles(ts.styles);

        if (existing) {
          if (existing.style?.rs?.values) {
            Object.assign(existing.style.rs.values, sanitized);
          }
        } else {
          const mixin = new Mixin({
            name: `Theme "${ts.selector}"`,
            rs: new RuleSet({ values: sanitized, mixins: [], animations: null }),
            preview: null,
            uuid: randomUUID().slice(0, 8),
            forTheme: true,
            variantedRs: [],
          });
          theme.styles.push(new ThemeStyle({ selector: ts.selector, style: mixin }));
        }
      }
      updatedFields.push("themeStyles");
    }
  });

  const save = await saveOrAccumulate(
    apiClient,
    changes,
    `update-theme: index ${themeIndex}`,
    []
  );

  return { save, themeIndex, updatedFields };
}

export interface RemoveThemeResult {
  save: SaveResult;
  removedIndex: number;
}

/**
 * Remove a theme from the project. Cannot remove the active theme.
 */
export async function removeTheme(
  apiClient: PlasmicApiClient,
  themeIndex: number,
): Promise<RemoveThemeResult> {
  const session = requireSession();
  const tracker = getChangeTracker();
  const themes = session.site.themes ?? [];

  if (themeIndex < 0 || themeIndex >= themes.length) {
    throw new Error(
      `Theme index ${themeIndex} out of range (0-${themes.length - 1}). Use list-themes to see available themes.`
    );
  }

  const theme = themes[themeIndex];
  if (theme === session.site.activeTheme) {
    throw new Error(
      "Cannot remove the active theme. Use set-active-theme to switch to another theme first."
    );
  }

  const changes = tracker.withRecording(() => {
    themes.splice(themeIndex, 1);
  });

  const save = await saveOrAccumulate(
    apiClient,
    changes,
    `remove-theme: index ${themeIndex}`,
    []
  );

  return { save, removedIndex: themeIndex };
}

export interface SetActiveThemeResult {
  save: SaveResult;
  activeThemeIndex: number;
}

/**
 * Set the active theme by index. Pass null to deactivate all themes.
 */
export async function setActiveTheme(
  apiClient: PlasmicApiClient,
  themeIndex: number | null,
): Promise<SetActiveThemeResult> {
  const session = requireSession();
  const tracker = getChangeTracker();
  const themes = session.site.themes ?? [];

  if (themeIndex !== null && (themeIndex < 0 || themeIndex >= themes.length)) {
    throw new Error(
      `Theme index ${themeIndex} out of range (0-${themes.length - 1}). Use list-themes to see available themes.`
    );
  }

  const changes = tracker.withRecording(() => {
    session.site.activeTheme = themeIndex !== null ? themes[themeIndex] : null;
  });

  const save = await saveOrAccumulate(
    apiClient,
    changes,
    `set-active-theme: index ${themeIndex ?? "none"}`,
    []
  );

  return { save, activeThemeIndex: themeIndex ?? -1 };
}

// ==========================================================================
// reorder-children
// ==========================================================================

export interface ReorderChildrenResult {
  save: SaveResult;
  parentName?: string;
  parentUuid: string;
  newOrder: string[];
}

/**
 * Reorder children of a container element to match the given order.
 * Uses TplMgr.reorderChildren() — partial lists supported (unlisted children appended at end).
 */
export async function reorderChildren(
  apiClient: PlasmicApiClient,
  componentUuid: string,
  parentRef: string,
  childRefs: string[],
): Promise<ReorderChildrenResult> {
  const component = findComponent(componentUuid);

  const parentResult = resolveNode(component, parentRef);
  const parent = requireSingleNode(parentResult, parentRef);

  if (!isKnownTplTag(parent.node)) {
    throw new Error(
      `Parent "${parentRef}" is not a TplTag and cannot have its children reordered.`
    );
  }

  const parentNode = parent.node;
  const currentChildren: any[] = parentNode.children ?? [];

  if (currentChildren.length === 0) {
    throw new Error(
      `Parent "${parentRef}" has no children to reorder.`
    );
  }

  // Resolve each childRef to a TplNode that must be a direct child
  const resolvedChildren: any[] = [];
  for (const ref of childRefs) {
    const childResult = resolveNode(component, ref);
    const child = requireSingleNode(childResult, ref);
    if (!currentChildren.includes(child.node)) {
      throw new Error(
        `Node "${ref}" is not a direct child of "${parentRef}".`
      );
    }
    resolvedChildren.push(child.node);
  }

  const session = requireSession();
  const tplMgr = new TplMgr({ site: session.site });
  const tracker = getChangeTracker();

  const changes = tracker.withRecording(() => {
    tplMgr.reorderChildren(parentNode, resolvedChildren);
  });

  const componentIid = getComponentIid(component);
  const save = await saveOrAccumulate(
    apiClient,
    changes,
    `reorder-children: ${parent.name ?? parentRef}`,
    componentIid ? [componentIid] : []
  );

  // Return the new order as UUID list
  const newOrder = (parentNode.children ?? []).map(
    (c: any) => c.uuid ?? "unknown"
  );

  return { save, parentName: parent.name, parentUuid: parent.uuid, newOrder };
}

// ==========================================================================
// convert-to-page / convert-to-component
// ==========================================================================

export interface ConvertToPageResult {
  save: SaveResult;
  componentName: string;
  path: string;
}

/**
 * Convert a component to a page with the given URL path.
 */
export async function convertToPage(
  apiClient: PlasmicApiClient,
  componentUuid: string,
  path?: string,
): Promise<ConvertToPageResult> {
  const component = findComponent(componentUuid);

  if (component.pageMeta) {
    throw new Error(
      `"${component.name}" is already a page (path: ${component.pageMeta.path}).`
    );
  }

  const session = requireSession();
  const tplMgr = new TplMgr({ site: session.site });
  const tracker = getChangeTracker();

  const changes = tracker.withRecording(() => {
    tplMgr.convertComponentToPage(component);
    if (path) {
      tplMgr.changePagePath(component, path);
    }
  });

  const save = await saveOrAccumulate(
    apiClient,
    changes,
    `convert-to-page: ${component.name}`,
    []
  );

  return {
    save,
    componentName: component.name,
    path: component.pageMeta?.path ?? path ?? "",
  };
}

export interface ConvertToComponentResult {
  save: SaveResult;
  componentName: string;
}

/**
 * Convert a page to a regular component. Removes pageMeta.
 */
export async function convertToComponent(
  apiClient: PlasmicApiClient,
  componentUuid: string,
): Promise<ConvertToComponentResult> {
  const component = findComponent(componentUuid);

  if (!component.pageMeta) {
    throw new Error(
      `"${component.name}" is already a component (not a page).`
    );
  }

  const session = requireSession();
  const tplMgr = new TplMgr({ site: session.site });
  const tracker = getChangeTracker();

  const changes = tracker.withRecording(() => {
    tplMgr.convertPageToComponent(component);
  });

  const save = await saveOrAccumulate(
    apiClient,
    changes,
    `convert-to-component: ${component.name}`,
    []
  );

  return { save, componentName: component.name };
}

// ==========================================================================
// Data Tokens CRUD
// ==========================================================================

function findDataToken(site: any, tokenRef: string): any {
  const tokens: any[] = site.dataTokens ?? [];
  // Try UUID match first
  const byUuid = tokens.find((t: any) => t.uuid === tokenRef);
  if (byUuid) return byUuid;
  // Try case-insensitive name match
  const lower = tokenRef.toLowerCase();
  const byName = tokens.find((t: any) => t.name.toLowerCase() === lower);
  if (byName) return byName;
  const names = tokens.map((t: any) => t.name).join(", ");
  throw new Error(
    `Data token "${tokenRef}" not found. Available: [${names}]`
  );
}

export interface DataTokenInfo {
  uuid: string;
  name: string;
  value: string;
  type: string;
}

export interface ListDataTokensResult {
  tokens: DataTokenInfo[];
}

/**
 * List all data tokens on the site.
 */
export function listDataTokens(): ListDataTokensResult {
  const session = requireSession();
  const tokens: any[] = session.site.dataTokens ?? [];
  return {
    tokens: tokens.map((t: any) => ({
      uuid: t.uuid,
      name: t.name,
      value: t.value,
      type: "Data",
    })),
  };
}

export interface CreateDataTokenResult {
  save: SaveResult;
  token: DataTokenInfo;
}

/**
 * Create a new data token with a name and optional JSON value.
 */
export async function createDataToken(
  apiClient: PlasmicApiClient,
  name: string,
  value?: string,
): Promise<CreateDataTokenResult> {
  const session = requireSession();
  const tplMgr = new TplMgr({ site: session.site });
  const tracker = getChangeTracker();

  let token: any;
  const changes = tracker.withRecording(() => {
    token = tplMgr.addDataToken({ name, value: value ?? "null" });
  });

  const save = await saveOrAccumulate(
    apiClient,
    changes,
    `create-data-token: ${token.name}`,
    []
  );

  return {
    save,
    token: { uuid: token.uuid, name: token.name, value: token.value, type: "Data" },
  };
}

export interface UpdateDataTokenResult {
  save: SaveResult;
  token: DataTokenInfo;
}

/**
 * Update a data token's name and/or value.
 */
export async function updateDataToken(
  apiClient: PlasmicApiClient,
  tokenRef: string,
  newName?: string,
  newValue?: string,
): Promise<UpdateDataTokenResult> {
  if (!newName && newValue === undefined) {
    throw new Error("At least one of name or value must be provided.");
  }

  const session = requireSession();
  const token = findDataToken(session.site, tokenRef);
  const tplMgr = new TplMgr({ site: session.site });
  const tracker = getChangeTracker();

  const changes = tracker.withRecording(() => {
    if (newName) {
      tplMgr.renameDataToken(session.projectId, token, newName);
    }
    if (newValue !== undefined) {
      token.value = newValue;
    }
  });

  const save = await saveOrAccumulate(
    apiClient,
    changes,
    `update-data-token: ${token.name}`,
    []
  );

  return {
    save,
    token: { uuid: token.uuid, name: token.name, value: token.value, type: "Data" },
  };
}

export interface RemoveDataTokenResult {
  save: SaveResult;
  removedName: string;
  removedUuid: string;
}

/**
 * Remove a data token from the site.
 */
export async function removeDataToken(
  apiClient: PlasmicApiClient,
  tokenRef: string,
): Promise<RemoveDataTokenResult> {
  const session = requireSession();
  const token = findDataToken(session.site, tokenRef);
  const tracker = getChangeTracker();

  const removedName = token.name;
  const removedUuid = token.uuid;

  const changes = tracker.withRecording(() => {
    const idx = session.site.dataTokens.indexOf(token);
    if (idx >= 0) session.site.dataTokens.splice(idx, 1);
  });

  const save = await saveOrAccumulate(
    apiClient,
    changes,
    `remove-data-token: ${removedName}`,
    []
  );

  return { save, removedName, removedUuid };
}

// ==========================================================================
// Global Variant Groups
// ==========================================================================

export interface GlobalVariantGroupInfo {
  uuid: string;
  name: string;
  type: string;
  multi: boolean;
  variants: Array<{ uuid: string; name: string; mediaQuery?: string }>;
}

export interface ListGlobalVariantGroupsResult {
  groups: GlobalVariantGroupInfo[];
}

/**
 * List all global variant groups (user-defined and screen).
 */
export function listGlobalVariantGroups(): ListGlobalVariantGroupsResult {
  const session = requireSession();
  const groups: any[] = session.site.globalVariantGroups ?? [];
  return {
    groups: groups.map((g: any) => ({
      uuid: g.uuid,
      name: g.param?.variable?.name ?? g.param?.name ?? "Unnamed",
      type: g.type ?? "global-user-defined",
      multi: g.multi ?? false,
      variants: (g.variants ?? []).map((v: any) => ({
        uuid: v.uuid,
        name: v.name,
        ...(v.mediaQuery ? { mediaQuery: v.mediaQuery } : {}),
      })),
    })),
  };
}

export interface CreateGlobalVariantGroupResult {
  save: SaveResult;
  group: GlobalVariantGroupInfo;
}

/**
 * Create a global variant group with optional initial variants.
 */
export async function createGlobalVariantGroup(
  apiClient: PlasmicApiClient,
  name: string,
  groupType?: "single" | "multi",
  initialVariants?: string[],
): Promise<CreateGlobalVariantGroupResult> {
  const session = requireSession();
  const tplMgr = new TplMgr({ site: session.site });
  const tracker = getChangeTracker();

  let group: any;
  const changes = tracker.withRecording(() => {
    group = tplMgr.createGlobalVariantGroup(name);
    if (groupType === "multi") {
      group.multi = true;
    }
    if (initialVariants) {
      for (const vName of initialVariants) {
        tplMgr.createGlobalVariant(group, vName);
      }
    }
  });

  const save = await saveOrAccumulate(
    apiClient,
    changes,
    `create-global-variant-group: ${name}`,
    []
  );

  return {
    save,
    group: {
      uuid: group.uuid,
      name: group.param?.variable?.name ?? name,
      type: group.type ?? "global-user-defined",
      multi: group.multi ?? false,
      variants: (group.variants ?? []).map((v: any) => ({
        uuid: v.uuid,
        name: v.name,
      })),
    },
  };
}

function findGlobalVariantGroup(site: any, groupRef: string): any {
  const groups: any[] = site.globalVariantGroups ?? [];
  const byUuid = groups.find((g: any) => g.uuid === groupRef);
  if (byUuid) return byUuid;
  const lower = groupRef.toLowerCase();
  const byName = groups.find(
    (g: any) => (g.param?.variable?.name ?? "").toLowerCase() === lower
  );
  if (byName) return byName;
  const names = groups.map((g: any) => g.param?.variable?.name ?? "Unnamed").join(", ");
  throw new Error(
    `Global variant group "${groupRef}" not found. Available: [${names}]`
  );
}

function findGlobalVariant(site: any, variantRef: string): { group: any; variant: any } {
  const groups: any[] = site.globalVariantGroups ?? [];
  for (const g of groups) {
    for (const v of g.variants ?? []) {
      if (v.uuid === variantRef) return { group: g, variant: v };
    }
  }
  for (const g of groups) {
    const lower = variantRef.toLowerCase();
    for (const v of g.variants ?? []) {
      if ((v.name ?? "").toLowerCase() === lower) return { group: g, variant: v };
    }
  }
  throw new Error(
    `Global variant "${variantRef}" not found.`
  );
}

export interface AddGlobalVariantResult {
  save: SaveResult;
  variant: { uuid: string; name: string; mediaQuery?: string };
}

/**
 * Add a variant to an existing global variant group.
 */
export async function addGlobalVariant(
  apiClient: PlasmicApiClient,
  groupRef: string,
  name: string,
): Promise<AddGlobalVariantResult> {
  const session = requireSession();
  const group = findGlobalVariantGroup(session.site, groupRef);
  const tplMgr = new TplMgr({ site: session.site });
  const tracker = getChangeTracker();

  let variant: any;
  const changes = tracker.withRecording(() => {
    variant = tplMgr.createGlobalVariant(group, name);
  });

  const save = await saveOrAccumulate(
    apiClient,
    changes,
    `add-global-variant: ${name} to ${group.param?.variable?.name}`,
    []
  );

  return {
    save,
    variant: { uuid: variant.uuid, name: variant.name },
  };
}

export interface RemoveGlobalVariantGroupResult {
  save: SaveResult;
  removedName: string;
  removedUuid: string;
}

/**
 * Remove an entire global variant group and all its variants.
 */
export async function removeGlobalVariantGroup(
  apiClient: PlasmicApiClient,
  groupRef: string,
): Promise<RemoveGlobalVariantGroupResult> {
  const session = requireSession();
  const group = findGlobalVariantGroup(session.site, groupRef);
  const tplMgr = new TplMgr({ site: session.site });
  const tracker = getChangeTracker();

  const removedName = group.param?.variable?.name ?? "Unnamed";
  const removedUuid = group.uuid;

  const changes = tracker.withRecording(() => {
    tplMgr.removeGlobalVariantGroup(group);
  });

  const save = await saveOrAccumulate(
    apiClient,
    changes,
    `remove-global-variant-group: ${removedName}`,
    []
  );

  return { save, removedName, removedUuid };
}

export interface RenameGlobalVariantResult {
  save: SaveResult;
  oldName: string;
  newName: string;
}

/**
 * Rename a global variant.
 */
export async function renameGlobalVariant(
  apiClient: PlasmicApiClient,
  variantRef: string,
  newName: string,
): Promise<RenameGlobalVariantResult> {
  const session = requireSession();
  const { variant } = findGlobalVariant(session.site, variantRef);
  const tplMgr = new TplMgr({ site: session.site });
  const tracker = getChangeTracker();

  const oldName = variant.name;

  const changes = tracker.withRecording(() => {
    tplMgr.renameVariant(variant, newName);
  });

  const save = await saveOrAccumulate(
    apiClient,
    changes,
    `rename-global-variant: ${oldName} → ${newName}`,
    []
  );

  return { save, oldName, newName: variant.name };
}

// ==========================================================================
// create-screen (screen breakpoint variant)
// ==========================================================================

export interface CreateScreenVariantResult {
  save: SaveResult;
  variantUuid: string;
  name: string;
  mediaQuery: string;
}

/**
 * Create a screen variant (responsive breakpoint).
 * At least one of minWidth/maxWidth must be provided.
 */
export async function createScreenVariant(
  apiClient: PlasmicApiClient,
  name: string,
  minWidth?: number,
  maxWidth?: number,
): Promise<CreateScreenVariantResult> {
  if (minWidth === undefined && maxWidth === undefined) {
    throw new Error("At least one of minWidth or maxWidth must be provided");
  }
  if (minWidth !== undefined && minWidth < 0) {
    throw new Error("minWidth must be a non-negative number");
  }
  if (maxWidth !== undefined && maxWidth < 0) {
    throw new Error("maxWidth must be a non-negative number");
  }
  if (minWidth !== undefined && maxWidth !== undefined && minWidth > maxWidth) {
    throw new Error("minWidth must be less than or equal to maxWidth");
  }

  const session = requireSession();
  const tplMgr = new TplMgr({ site: session.site });
  const tracker = getChangeTracker();

  // Build the ScreenSizeSpec-like object with a query() method
  const spec = makeScreenSpec(minWidth, maxWidth);

  let variant: any;
  const changes = tracker.withRecording(() => {
    variant = tplMgr.createScreenVariant({ name, spec });
  });

  const save = await saveOrAccumulate(
    apiClient,
    changes,
    `create-screen-variant: ${name}`,
    []
  );

  return {
    save,
    variantUuid: variant.uuid,
    name: variant.name,
    mediaQuery: variant.mediaQuery ?? spec.query(),
  };
}

// ==========================================================================
// update-screen (update screen breakpoint dimensions)
// ==========================================================================

export interface UpdateScreenVariantResult {
  save: SaveResult;
  variantUuid: string;
  name: string;
  mediaQuery: string;
}

/**
 * Update the breakpoint dimensions of an existing screen variant.
 * At least one of minWidth/maxWidth must be provided.
 */
export async function updateScreenVariant(
  apiClient: PlasmicApiClient,
  variantRef: string,
  minWidth?: number,
  maxWidth?: number,
): Promise<UpdateScreenVariantResult> {
  if (minWidth === undefined && maxWidth === undefined) {
    throw new Error("At least one of minWidth or maxWidth must be provided");
  }
  if (minWidth !== undefined && minWidth < 0) {
    throw new Error("minWidth must be a non-negative number");
  }
  if (maxWidth !== undefined && maxWidth < 0) {
    throw new Error("maxWidth must be a non-negative number");
  }
  if (minWidth !== undefined && maxWidth !== undefined && minWidth > maxWidth) {
    throw new Error("minWidth must be less than or equal to maxWidth");
  }

  const session = requireSession();
  const variant = findScreenVariant(session.site, variantRef);
  const tplMgr = new TplMgr({ site: session.site });
  const tracker = getChangeTracker();

  const spec = makeScreenSpec(minWidth, maxWidth);
  const query = spec.query();

  const changes = tracker.withRecording(() => {
    tplMgr.updateScreenVariantQuery(variant, query);
  });

  const save = await saveOrAccumulate(
    apiClient,
    changes,
    `update-screen-variant: ${variant.name}`,
    []
  );

  return {
    save,
    variantUuid: variant.uuid,
    name: variant.name,
    mediaQuery: query,
  };
}

// ==========================================================================
// rename (variant — component or global)
// ==========================================================================

export interface RenameVariantResult {
  save: SaveResult;
  oldName: string;
  newName: string;
  variantUuid: string;
}

/**
 * Rename a variant. If componentUuid is provided, looks up in that component's
 * variant groups. Otherwise looks up in global variant groups.
 */
export async function renameVariant(
  apiClient: PlasmicApiClient,
  variantRef: string,
  newName: string,
  componentUuid?: string,
): Promise<RenameVariantResult> {
  const session = requireSession();
  const tplMgr = new TplMgr({ site: session.site });
  const tracker = getChangeTracker();

  let variant: any;
  if (componentUuid) {
    const component = session.site.components?.find(
      (c: any) => c.uuid === componentUuid
    );
    if (!component) {
      throw new Error(`Component UUID "${componentUuid}" not found.`);
    }
    variant = findComponentVariant(component, variantRef);
  } else {
    const result = findGlobalVariant(session.site, variantRef);
    variant = result.variant;
  }

  const oldName = variant.name ?? variant.selectors?.[0] ?? "unnamed";

  const changes = tracker.withRecording(() => {
    tplMgr.renameVariant(variant, newName);
  });

  const save = await saveOrAccumulate(
    apiClient,
    changes,
    `rename-variant: ${oldName} → ${newName}`,
    []
  );

  return { save, oldName, newName: variant.name, variantUuid: variant.uuid };
}

// ==========================================================================
// remove (variant — component or global)
// ==========================================================================

export interface RemoveVariantResult {
  save: SaveResult;
  removedName: string;
  removedUuid: string;
}

/**
 * Remove a single variant. If componentUuid is provided, looks up in that
 * component's variant groups. Otherwise looks up in global variant groups.
 */
export async function removeVariant(
  apiClient: PlasmicApiClient,
  variantRef: string,
  componentUuid?: string,
): Promise<RemoveVariantResult> {
  const session = requireSession();
  const tplMgr = new TplMgr({ site: session.site });
  const tracker = getChangeTracker();

  let variant: any;
  let component: any = undefined;
  if (componentUuid) {
    component = session.site.components?.find(
      (c: any) => c.uuid === componentUuid
    );
    if (!component) {
      throw new Error(`Component UUID "${componentUuid}" not found.`);
    }
    variant = findComponentVariant(component, variantRef);
  } else {
    const result = findGlobalVariant(session.site, variantRef);
    variant = result.variant;
  }

  // Prevent removing base variant
  if (variant.name === "base" || variant.uuid === component?.variants?.[0]?.uuid) {
    throw new Error("Cannot remove the base variant.");
  }

  const removedName = variant.name ?? variant.selectors?.[0] ?? "unnamed";
  const removedUuid = variant.uuid;

  const changes = tracker.withRecording(() => {
    tplMgr.tryRemoveVariant(variant, component);
  });

  const save = await saveOrAccumulate(
    apiClient,
    changes,
    `remove-variant: ${removedName}`,
    []
  );

  return { save, removedName, removedUuid };
}

// ==========================================================================
// Variant helpers (shared)
// ==========================================================================

/**
 * Build a ScreenSizeSpec-like object from minWidth/maxWidth.
 * Produces the same CSS media query format as the real ScreenSizeSpec.
 */
function makeScreenSpec(minWidth?: number, maxWidth?: number) {
  return {
    minWidth,
    maxWidth,
    query() {
      const parts: string[] = [];
      if (minWidth !== undefined) parts.push(`(min-width:${minWidth}px)`);
      if (maxWidth !== undefined) parts.push(`(max-width:${maxWidth}px)`);
      return parts.join(" and ");
    },
  };
}

/**
 * Find a screen variant by UUID or name. Throws if not found or not a screen variant.
 */
function findScreenVariant(site: any, variantRef: string): any {
  const groups: any[] = site.globalVariantGroups ?? [];
  for (const g of groups) {
    if (g.type !== "global-screen") continue;
    for (const v of g.variants ?? []) {
      if (v.uuid === variantRef) return v;
    }
  }
  for (const g of groups) {
    if (g.type !== "global-screen") continue;
    const lower = variantRef.toLowerCase();
    for (const v of g.variants ?? []) {
      if ((v.name ?? "").toLowerCase() === lower) return v;
    }
  }
  throw new Error(
    `Screen variant "${variantRef}" not found. Use variant.list-global-groups to see available screen variants.`
  );
}

/**
 * Find a variant within a component's variant groups (including style variants).
 * Searches by UUID first, then by name (case-insensitive).
 */
function findComponentVariant(component: any, variantRef: string): any {
  // Search by UUID
  for (const group of component.variantGroups ?? []) {
    for (const v of group.variants ?? []) {
      if (v.uuid === variantRef) return v;
    }
  }
  for (const v of component.variants ?? []) {
    if (v.uuid === variantRef) return v;
  }

  // Search by name (case-insensitive)
  const lower = variantRef.toLowerCase();
  for (const group of component.variantGroups ?? []) {
    for (const v of group.variants ?? []) {
      if ((v.name ?? "").toLowerCase() === lower) return v;
    }
  }
  // Search style variants by selector
  for (const v of component.variants ?? []) {
    if (v.selectors?.some((s: string) => s.toLowerCase() === lower)) return v;
    if ((v.name ?? "").toLowerCase() === lower) return v;
  }

  throw new Error(
    `Variant "${variantRef}" not found in component "${component.name ?? component.uuid}".`
  );
}

// ==========================================================================
// get-code-component-meta (read-only)
// ==========================================================================

export interface CodeComponentMetaInfo {
  isCodeComponent: boolean;
  importPath?: string;
  importName?: string;
  displayName?: string;
  description?: string;
  isHostLess?: boolean;
  isContext?: boolean;
  providesData?: boolean;
  hasRef?: boolean;
  isRepeatable?: boolean;
  subComponents?: string[];
}

/**
 * Get code component metadata for a component.
 * Returns null-like info if the component is not a code component.
 */
export function getCodeComponentMeta(
  componentUuid: string,
): CodeComponentMetaInfo {
  const component = findComponent(componentUuid);

  if (!component.codeComponentMeta || component.type !== "code") {
    return { isCodeComponent: false };
  }

  const meta = component.codeComponentMeta;
  return {
    isCodeComponent: true,
    importPath: meta.importPath,
    importName: meta.importName,
    displayName: meta.displayName ?? undefined,
    description: meta.description ?? undefined,
    isHostLess: meta.isHostLess ?? false,
    isContext: meta.isContext ?? false,
    providesData: meta.providesData ?? false,
    hasRef: meta.hasRef ?? false,
    isRepeatable: meta.isRepeatable ?? false,
    subComponents: (component.subComps ?? []).map((c: any) => c.name),
  };
}

// ==========================================================================
// list-custom-functions (read-only)
// ==========================================================================

export interface CustomFunctionInfo {
  name: string;
  importPath: string;
  namespace?: string;
  displayName?: string;
  isDefaultExport: boolean;
  isQuery: boolean;
  params: Array<{ argName: string; displayName?: string; type?: string }>;
}

export interface ListCustomFunctionsResult {
  functions: CustomFunctionInfo[];
}

/**
 * List all custom functions registered in the project.
 */
export function listCustomFunctions(): ListCustomFunctionsResult {
  const session = requireSession();
  const fns: any[] = session.site.customFunctions ?? [];
  return {
    functions: fns.map((f: any) => ({
      name: f.importName,
      importPath: f.importPath,
      namespace: f.namespace ?? undefined,
      displayName: f.displayName ?? undefined,
      isDefaultExport: f.defaultExport ?? false,
      isQuery: f.isQuery ?? false,
      params: (f.params ?? []).map((p: any) => ({
        argName: p.argName,
        displayName: p.displayName ?? undefined,
        type: p.type?.name ?? p.type?._type ?? undefined,
      })),
    })),
  };
}

// ==========================================================================
// A/B Testing (Splits) CRUD
// ==========================================================================

function findSplit(site: any, splitRef: string): any {
  const splits: any[] = site.splits ?? [];
  const byUuid = splits.find((s: any) => s.uuid === splitRef);
  if (byUuid) return byUuid;
  const lower = splitRef.toLowerCase();
  const byName = splits.find((s: any) => s.name.toLowerCase() === lower);
  if (byName) return byName;
  const names = splits.map((s: any) => s.name).join(", ");
  throw new Error(
    `Split "${splitRef}" not found. Available: [${names}]`
  );
}

export interface SplitSliceInfo {
  uuid: string;
  name: string;
  prob?: number;
  cond?: string;
}

export interface SplitInfo {
  uuid: string;
  name: string;
  splitType: string;
  status: string;
  slices: SplitSliceInfo[];
  description?: string;
}

export interface ListSplitsResult {
  splits: SplitInfo[];
}

/**
 * List all A/B tests and segments.
 */
export function listSplits(): ListSplitsResult {
  const session = requireSession();
  const splits: any[] = session.site.splits ?? [];
  return {
    splits: splits.map((s: any) => ({
      uuid: s.uuid,
      name: s.name,
      splitType: s.splitType,
      status: s.status,
      description: s.description ?? undefined,
      slices: (s.slices ?? []).map((sl: any) => ({
        uuid: sl.uuid,
        name: sl.name,
        ...(sl.prob !== undefined ? { prob: sl.prob } : {}),
        ...(sl.cond !== undefined ? { cond: sl.cond } : {}),
      })),
    })),
  };
}

export interface CreateSplitResult {
  save: SaveResult;
  split: SplitInfo;
}

/**
 * Create a new A/B test or segment with weighted/conditioned slices.
 */
export async function createSplit(
  apiClient: PlasmicApiClient,
  name: string,
  splitType: "experiment" | "segment",
  slices: Array<{ name: string; prob?: number; cond?: string }>,
): Promise<CreateSplitResult> {
  if (slices.length === 0) {
    throw new Error("At least one slice is required.");
  }

  const session = requireSession();
  const tracker = getChangeTracker();

  const splitSlices = slices.map((sl) => {
    if (splitType === "experiment") {
      return new RandomSplitSlice({
        uuid: randomUUID(),
        name: sl.name,
        prob: sl.prob ?? Math.round(100 / slices.length),
        externalId: undefined,
        contents: [],
      });
    } else {
      return new SegmentSplitSlice({
        uuid: randomUUID(),
        name: sl.name,
        cond: sl.cond ?? "{}",
        externalId: undefined,
        contents: [],
      });
    }
  });

  const split = new Split({
    uuid: randomUUID(),
    name,
    splitType,
    slices: splitSlices,
    status: "new",
    targetEvents: [],
    description: undefined,
    externalId: undefined,
  });

  const changes = tracker.withRecording(() => {
    if (!session.site.splits) session.site.splits = [];
    session.site.splits.push(split);
  });

  const save = await saveOrAccumulate(
    apiClient,
    changes,
    `create-split: ${name}`,
    []
  );

  return {
    save,
    split: {
      uuid: split.uuid,
      name: split.name,
      splitType: split.splitType,
      status: split.status,
      slices: splitSlices.map((sl: any) => ({
        uuid: sl.uuid,
        name: sl.name,
        ...(sl.prob !== undefined ? { prob: sl.prob } : {}),
        ...(sl.cond !== undefined ? { cond: sl.cond } : {}),
      })),
    },
  };
}

export interface UpdateSplitResult {
  save: SaveResult;
  split: SplitInfo;
}

/**
 * Update a split's name, status, and/or slices.
 */
export async function updateSplit(
  apiClient: PlasmicApiClient,
  splitRef: string,
  newName?: string,
  newStatus?: "new" | "running" | "stopped",
  newSlices?: Array<{ name: string; prob?: number; cond?: string }>,
): Promise<UpdateSplitResult> {
  if (!newName && !newStatus && !newSlices) {
    throw new Error("At least one of name, status, or slices must be provided.");
  }

  const session = requireSession();
  const split = findSplit(session.site, splitRef);
  const tracker = getChangeTracker();

  const changes = tracker.withRecording(() => {
    if (newName) split.name = newName;
    if (newStatus) split.status = newStatus;
    if (newSlices) {
      const splitSlices = newSlices.map((sl) => {
        if (split.splitType === "experiment") {
          return new RandomSplitSlice({
            uuid: randomUUID(),
            name: sl.name,
            prob: sl.prob ?? Math.round(100 / newSlices.length),
            externalId: undefined,
            contents: [],
          });
        } else {
          return new SegmentSplitSlice({
            uuid: randomUUID(),
            name: sl.name,
            cond: sl.cond ?? "{}",
            externalId: undefined,
            contents: [],
          });
        }
      });
      split.slices = splitSlices;
    }
  });

  const save = await saveOrAccumulate(
    apiClient,
    changes,
    `update-split: ${split.name}`,
    []
  );

  return {
    save,
    split: {
      uuid: split.uuid,
      name: split.name,
      splitType: split.splitType,
      status: split.status,
      slices: (split.slices ?? []).map((sl: any) => ({
        uuid: sl.uuid,
        name: sl.name,
        ...(sl.prob !== undefined ? { prob: sl.prob } : {}),
        ...(sl.cond !== undefined ? { cond: sl.cond } : {}),
      })),
    },
  };
}

export interface RemoveSplitResult {
  save: SaveResult;
  removedName: string;
  removedUuid: string;
}

/**
 * Remove a split from the site.
 */
export async function removeSplit(
  apiClient: PlasmicApiClient,
  splitRef: string,
): Promise<RemoveSplitResult> {
  const session = requireSession();
  const split = findSplit(session.site, splitRef);
  const tplMgr = new TplMgr({ site: session.site });
  const tracker = getChangeTracker();

  const removedName = split.name;
  const removedUuid = split.uuid;

  const changes = tracker.withRecording(() => {
    tplMgr.removeSplit(split);
  });

  const save = await saveOrAccumulate(
    apiClient,
    changes,
    `remove-split: ${removedName}`,
    []
  );

  return { save, removedName, removedUuid };
}

// ==========================================================================
// Image Assets CRUD
// ==========================================================================

function findImageAsset(site: any, assetRef: string): any {
  const assets: any[] = site.imageAssets ?? [];
  const byUuid = assets.find((a: any) => a.uuid === assetRef);
  if (byUuid) return byUuid;
  const lower = assetRef.toLowerCase();
  const byName = assets.find((a: any) => (a.name ?? "").toLowerCase() === lower);
  if (byName) return byName;
  const names = assets.map((a: any) => a.name).join(", ");
  throw new Error(
    `Image asset "${assetRef}" not found. Available: [${names}]`
  );
}

export interface ImageAssetInfo {
  uuid: string;
  name: string;
  type: string;
  width?: number;
  height?: number;
  aspectRatio?: number;
}

export interface ListAssetsResult {
  assets: ImageAssetInfo[];
}

/**
 * List all image assets in the project with optional type filter.
 */
export function listAssets(
  type?: string,
): ListAssetsResult {
  const session = requireSession();
  let assets: any[] = session.site.imageAssets ?? [];

  if (type) {
    assets = assets.filter((a: any) => a.type === type);
  }

  return {
    assets: assets.map((a: any) => ({
      uuid: a.uuid,
      name: a.name,
      type: a.type,
      ...(a.width != null ? { width: a.width } : {}),
      ...(a.height != null ? { height: a.height } : {}),
      ...(a.aspectRatio != null ? { aspectRatio: a.aspectRatio } : {}),
    })),
  };
}

export interface UploadAssetResult {
  save: SaveResult;
  assetUuid: string;
  name: string;
  type: string;
}

/**
 * Create an image asset from a URL (fetched and embedded as dataUri) or inline dataUri.
 */
export async function uploadAsset(
  apiClient: PlasmicApiClient,
  name: string,
  type: string,
  opts: { url?: string; dataUri?: string; width?: number; height?: number },
): Promise<UploadAssetResult> {
  if (!opts.url && !opts.dataUri) {
    throw new Error("Either url or dataUri must be provided.");
  }

  let dataUri = opts.dataUri;

  if (opts.url) {
    try {
      const response = await fetch(opts.url);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      const contentType = response.headers.get("content-type") ?? "image/png";
      if (!contentType.startsWith("image/")) {
        throw new Error(`URL does not point to a supported image format (got: ${contentType})`);
      }
      const buffer = await response.arrayBuffer();
      const base64 = Buffer.from(buffer).toString("base64");
      dataUri = `data:${contentType};base64,${base64}`;
    } catch (err: unknown) {
      throw new Error(`Failed to fetch image from URL: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  const session = requireSession();
  const tplMgr = new TplMgr({ site: session.site });
  const tracker = getChangeTracker();

  let assetUuid = "";
  let assetName = "";
  let assetType = "";

  const aspectRatio = (opts.width && opts.height)
    ? opts.width / opts.height
    : undefined;

  const changes = tracker.withRecording(() => {
    const asset = tplMgr.addImageAsset({
      name,
      type,
      dataUri: dataUri!,
      width: opts.width,
      height: opts.height,
      aspectRatio,
    });
    assetUuid = asset.uuid;
    assetName = asset.name;
    assetType = asset.type;
  });

  const save = await saveOrAccumulate(
    apiClient,
    changes,
    `upload-asset: ${assetName}`,
    []
  );

  return { save, assetUuid, name: assetName, type: assetType };
}

export interface RenameAssetResult {
  save: SaveResult;
  assetUuid: string;
  oldName: string;
  newName: string;
}

/**
 * Rename an image asset by reference (UUID or name).
 */
export async function renameAsset(
  apiClient: PlasmicApiClient,
  assetRef: string,
  newName: string,
): Promise<RenameAssetResult> {
  const session = requireSession();
  const asset = findImageAsset(session.site, assetRef);
  const tplMgr = new TplMgr({ site: session.site });
  const tracker = getChangeTracker();

  const oldName = asset.name;

  const changes = tracker.withRecording(() => {
    tplMgr.renameImageAsset(asset, newName);
  });

  const save = await saveOrAccumulate(
    apiClient,
    changes,
    `rename-asset: ${oldName} → ${newName}`,
    []
  );

  return { save, assetUuid: asset.uuid, oldName, newName: asset.name };
}

export interface RemoveAssetResult {
  save: SaveResult;
  removedName: string;
  removedUuid: string;
}

/**
 * Remove an image asset. TplMgr.removeImageAsset() handles reference cleanup.
 */
export async function removeAsset(
  apiClient: PlasmicApiClient,
  assetRef: string,
): Promise<RemoveAssetResult> {
  const session = requireSession();
  const asset = findImageAsset(session.site, assetRef);
  const tplMgr = new TplMgr({ site: session.site });
  const tracker = getChangeTracker();

  const removedName = asset.name;
  const removedUuid = asset.uuid;

  const changes = tracker.withRecording(() => {
    tplMgr.removeImageAsset(asset);
  });

  const save = await saveOrAccumulate(
    apiClient,
    changes,
    `remove-asset: ${removedName}`,
    []
  );

  return { save, removedName, removedUuid };
}

export interface SetImageResult {
  save: SaveResult;
  nodeUuid: string;
  nodeName?: string;
  imageSource: string;
}

/**
 * Set an image on an element. For <img> tags, sets the src attribute as an
 * ImageAssetRef (when assetRef provided) or CustomCode (when src URL provided).
 * For non-img elements, sets background-image CSS property.
 */
export async function setImage(
  apiClient: PlasmicApiClient,
  componentUuid: string,
  nodeRef: string,
  opts: { assetRef?: string; src?: string },
  variant?: string,
): Promise<SetImageResult> {
  if (!opts.assetRef && !opts.src) {
    throw new Error("Either assetRef or src must be provided.");
  }

  const session = requireSession();
  const component = findComponent(componentUuid);
  const result = resolveNode(component, nodeRef);
  const resolved = requireSingleNode(result, nodeRef);

  if (!isKnownTplTag(resolved.node)) {
    throw new Error(
      `set-image requires a TplTag element but got ${resolved.node?._type ?? "unknown"}.`
    );
  }
  const tplMgr = new TplMgr({ site: session.site });
  const tracker = getChangeTracker();

  // Resolve target variant (null = base)
  const resolvedVariant = variant
    ? resolveVariant(session.site, component, variant)
    : null;

  const tag = resolved.node.tag;
  const isImgTag = tag === "img";
  let imageSource = "";

  // Resolve asset if assetRef provided
  let asset: any = undefined;
  if (opts.assetRef) {
    asset = findImageAsset(session.site, opts.assetRef);
    imageSource = `asset:${asset.name}`;
  } else {
    imageSource = opts.src!;
  }

  const changes = tracker.withRecording(() => {
    const vs = resolvedVariant
      ? ensureVariantSetting(resolved.node, [resolvedVariant])
      : tplMgr.ensureBaseVariantSetting(resolved.node);

    if (isImgTag) {
      // For img elements, set the src attr
      if (!vs.attrs) vs.attrs = {};
      if (asset) {
        vs.attrs.src = new ImageAssetRef({ asset });
      } else {
        vs.attrs.src = new CustomCode({
          code: JSON.stringify(opts.src),
          fallback: null,
        });
      }
    } else {
      // For non-img elements, set background CSS
      if (!vs.rs) vs.rs = new RuleSet({ values: {}, mixins: [], animations: null });
      if (!vs.rs.values) vs.rs.values = {};
      // Escape quotes and backslashes in URL to prevent malformed CSS
      const escapedUrl = asset
        ? (asset.dataUri ?? "")
        : (opts.src ?? "").replace(/["\\]/g, "\\$&");
      vs.rs.values["background"] = `url("${escapedUrl}")`;
    }
  });

  const componentIid = getComponentIid(component);
  const save = await saveOrAccumulate(
    apiClient,
    changes,
    `set-image on ${resolved.node.name ?? resolved.node.uuid}`,
    componentIid ? [componentIid] : []
  );

  return {
    save,
    nodeUuid: resolved.node.uuid,
    nodeName: resolved.node.name,
    imageSource,
  };
}
