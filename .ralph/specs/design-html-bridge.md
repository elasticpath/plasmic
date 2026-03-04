# Design HTML Bridge

LLMs have extensive HTML/CSS training but little Plasmic WAB training. This spec
describes an `importHtml` action for the MCP `node` tool: the LLM generates valid
HTML+CSS, the MCP parses it using Plasmic's existing web-importer pipeline (ported
to Node.js via jsdom), and maps the resulting WIElement tree to a sequence of
existing edit tool calls.

## Background: Existing Pipeline

Plasmic Studio already ships a complete HTML import pipeline, used by the Copilot
feature (`CopilotUiPrompt.tsx`) for AI-generated HTML:

```
Raw HTML string
  → parseHtmlToWebImporterTree(html, site)   [platform/wab/.../web-importer/html-parser.ts]
  → WIElement tree  (plain JSON — container | text | svg | component nodes)
  → processWebImporterTree()                 [platform/wab/.../WebImporter.tsx]
  → Plasmic TPL nodes inserted into canvas
```

`html-parser.ts` uses browser APIs (`DOMParser`, `document`, `window.getComputedStyle`).
The MCP runs in Node.js, so we polyfill these with **jsdom** (already used in the
html-parser test suite — line 707 of html-parser.ts acknowledges the jsdom environment).

`processWebImporterTree` requires a browser-side `studioCtx` and cannot be reused
from Node.js. Instead we implement a **`wiTreeToEditCalls()`** mapper that converts
the JSON-serializable `WIElement` tree into calls to the existing MCP edit-tool
functions (`addChild`, `updateStyles`, `updateText`, etc.).

## Jobs to Be Done

- As a developer using Claude Code with Plasmic MCP, I want to describe a UI element
  in HTML/CSS so the LLM can express complex designs in a familiar language and the
  MCP faithfully imports them into Plasmic.
- As an autonomous agent, I want a single `importHtml` call to handle structural
  nesting, styles, pseudo-class variants, and responsive breakpoints so I don't have
  to orchestrate dozens of individual tool calls.

## Acceptance Criteria

- [ ] A new `node` action `importHtml` is registered in `server.ts` with schema:
      `{ parentNodeId: string, html: string, position?: "append" | "prepend" }`.
- [ ] `packages/plasmic-mcp/src/html-importer.ts` implements the import pipeline:
      1. Polyfill `DOMParser` / `document` / `window` using `jsdom`
      2. Call `parseHtmlToWebImporterTree(html, site)` from the existing WAB
         `@/wab/client/web-importer/html-parser` module
      3. Map the resulting `WIElement` tree via `wiTreeToEditCalls()` to a sequence
         of existing edit-tool function calls
      4. Return the root node UUID of the imported subtree
- [ ] `wiTreeToEditCalls()` handles all four `WIElement` types:
      - `WIContainer` → `addChild(tag)` + `updateStyles(safeStyles)`
      - `WIText` → `addChild(tag)` + `updateText(text)` + `updateStyles(safeStyles)`
      - `WISVG` → `addChild("div")` with raw SVG stored as a `dangerouslySetInnerHTML`
        custom attr (best-effort; SVG upload is out of scope for v1)
      - `WIComponent` → `addChild(componentName)` matching by name in the site model
- [ ] Style variants are handled:
      - Base variant `safeStyles` → `updateStyles` with no `variant` param
      - Style variants (`:hover`, `:focus`, etc.) → `createStyleVariant` then
        `updateStyles` with the new variant UUID
      - Screen variants → match to existing screen variants by breakpoint width via
        `listVariants`, then `updateStyles` with the matched variant UUID
- [ ] `jsdom` is added to `packages/plasmic-mcp/package.json` dependencies.
- [ ] A unit test in `__tests__/html-importer.test.ts` covers:
      - Simple `<div>` with inline styles → correct `addChild` + `updateStyles` calls
      - Nested container with text child → correct recursive mapping
      - `:hover` style variant → `createStyleVariant` + `updateStyles` calls
      - Unknown/ignored tags (script, iframe) → skipped
- [ ] All ~1,470 existing tests continue to pass.
- [ ] No changes to existing MCP tool schemas (backwards compatible).

## Happy Path

1. Developer: *"Add a two-column hero section with a heading on the left and an image
   placeholder on the right"*
2. Claude generates HTML+CSS:
   ```html
   <style>
     .hero { display: flex; gap: 48px; padding: 64px; }
     .hero-text { flex: 1; }
     .hero-text h1 { font-size: 48px; font-weight: 700; color: #1a1a1a; }
     .hero-img { width: 480px; height: 320px; background: #e5e7eb; border-radius: 12px; }
   </style>
   <div class="hero">
     <div class="hero-text"><h1>Ship faster with Plasmic</h1></div>
     <div class="hero-img"></div>
   </div>
   ```
3. Claude calls `node.importHtml` with `parentNodeId` = page root UUID, `html` = above.
4. MCP: jsdom parses HTML → `parseHtmlToWebImporterTree` produces WIElement tree.
5. MCP: `wiTreeToEditCalls()` maps the tree to:
   - `addChild("div", rootId)` → heroId
   - `updateStyles(heroId, { display:"flex", gap:"48px", paddingTop:"64px", ... })`
   - `addChild("div", heroId)` → heroTextId
   - `addChild("h1", heroTextId)` → h1Id
   - `updateStyles(h1Id, { fontSize:"48px", fontWeight:"700", color:"#1a1a1a" })`
   - `updateText(h1Id, "Ship faster with Plasmic")`
   - `addChild("div", heroId)` → heroImgId
   - `updateStyles(heroImgId, { width:"480px", height:"320px", background:"#e5e7eb", borderRadius:"12px" })`
6. Changes saved; `importHtml` returns `{ rootNodeId: heroId }`.
7. Developer sees a correctly structured two-column layout in Plasmic Studio.

## WIElement → Edit Tool Call Mapping

| WIElement field | Edit tool call |
|----------------|---------------|
| `type: "container"`, `tag` | `addChild({ tag })` |
| `type: "text"`, `tag`, `text` | `addChild({ tag })` + `updateText({ text })` |
| `type: "svg"` | `addChild({ tag: "div" })` + `updateAttrs({ dangerouslySetInnerHTML })` |
| `type: "component"`, `component` | `addChild({ componentName: component })` |
| `variantSettings[base].safeStyles` | `updateStyles({ styles })` |
| `variantSettings[base].unsafeStyles` | `updateStyles({ styles })` (already expanded to longhand by parser) |
| `variantSettings[style].selectors` | `createStyleVariant({ selector })` + `updateStyles({ styles, variant })` |
| `variantSettings[screen].width` | match via `listVariants` → `updateStyles({ styles, variant })` |
| `attrs` | `updateAttrs({ attrs })` (excluding `__name`, `class`) |
| `children` | recurse, passing new node UUID as `parentNodeId` |

## Edge Cases

| Scenario | Expected behaviour |
|----------|-------------------|
| HTML references a CSS token var (e.g. `var(--token-brand)`) | `renameTokenVarNameToUuid` (called inside parser) maps it; MCP resolves to token ref if found |
| `window.getComputedStyle` called by parser | jsdom returns empty/default computed styles; parser already handles this gracefully (falls back to explicit styles) |
| `elt.innerText` in jsdom | Already handled — html-parser.ts line 710 uses `textContent` as fallback |
| Screen variant width has no matching Plasmic breakpoint | Style applied to base variant with a console.error warning |
| `WIComponent` name not found in site model | Skip the node, log a warning, continue with siblings |
| SVG with complex paths | Stored as raw HTML attr (best-effort); no asset upload in v1 |
| Deeply nested HTML (>10 levels) | Recurse fully; Plasmic supports deep nesting |
| Empty or whitespace-only HTML | Return `{ error: "No importable elements found" }` |
| `parseHtmlToWebImporterTree` returns `null` wiTree | Return `{ error: "HTML parse failed" }` |

## Out of Scope

- SVG asset upload (stored as raw HTML attr in v1)
- CSS animation / `@keyframes` mapping (existing `design` tool handles animations)
- `@font-face` injection
- Image upload / `<img src>` asset management
- Automatic design token substitution (raw values used; LLM should use `listDesignSystem` first if tokens are desired)
- Changes to `html-parser.ts` or `WebImporter.tsx` in platform/wab
- Any changes to existing MCP tool schemas
