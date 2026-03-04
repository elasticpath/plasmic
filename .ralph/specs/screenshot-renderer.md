# Headless Canvas Screenshot — Studio Rendering Pipeline Reuse

## Jobs to Be Done

- As an MCP agent making design changes, I want an accurate screenshot of the
  current component state so that I can verify my edits visually and self-correct
  without human feedback.
- As a developer using Plasmic MCP, I want screenshots to show exactly what
  Plasmic Studio's canvas shows — including code components like CloverPayButton —
  not a stale or approximated render.

## Background: How the Dev Host Canvas Works

`packages/host/src/index.ts` sets `window.__Sub` synchronously on script load:

```typescript
root.__Sub = { React, ReactDOM, jsxRuntime, setPlasmicRootNode, ... }
```

`packages/host/src/canvas-host.tsx` (`_PlasmicCanvasHost`):

- When `#canvas=true` is in the hash: `shouldRenderStudio = false` — the host
  does NOT attempt to contact Studio or set up any Comlink RPC.
- It simply renders `plasmicRootNode.get()` inside a portal into `#plasmic-app`.
- `setPlasmicRootNode(element)` updates `plasmicRootNode` and triggers a re-render.
- That is the entire mechanism. No handshake required.

The Comlink / `PLASMIC_HOST_REGISTER` protocol lives in
`platform/wab/src/wab/client/frame-ctx/host-frame-ctx.tsx` — that is Studio's
**internal artboard framing code**, not part of the dev host at all. We do not
need to implement or replicate it.

## Approach: Reuse Studio Code, No Custom Renderer

```
Playwright (headless Chromium)
  ├─ parent page (set via page.setContent — no server needed)
  │    ├─ page.addScriptTag(headless-renderer.js)
  │    │    └─ esbuild bundle of WAB canvas-rendering.ts
  │    │       exposes window.__HeadlessRenderer = {
  │    │         renderTplNode,        ← canvas-rendering.ts (unchanged)
  │    │         wrapWithContext,      ← shared/contexts.ts  (unchanged)
  │    │         makeEmptyRenderingCtx ← canvas-rendering.ts (unchanged)
  │    │         deserSite             ← shared/bundles.ts   (unchanged)
  │    │       }
  │    │
  │    └─ page.evaluate(orchestrate, { bundle, componentName, origin })
  │         ├─ creates <iframe src="/plasmic-host#canvas=true&componentName=X&origin=Y">
  │         ├─ waits for iframe load + window.__Sub to be defined
  │         ├─ const sub = iframe.contentWindow.__Sub
  │         ├─ const site = __HeadlessRenderer.deserSite(bundle)
  │         ├─ const component = site.components.find(c => c.name === componentName)
  │         ├─ const ctx = __HeadlessRenderer.makeEmptyRenderingCtx(minimalVc, component.tplTree.uuid)
  │         ├─ const element = __HeadlessRenderer.renderTplNode(component.tplTree, ctx)
  │         └─ sub.setPlasmicRootNode(element)   ← same call Studio makes
  │
  └─ page.frames()[1].screenshot({ type: 'png', fullPage: true })
```

## What We Reuse Unchanged

| File | What it provides |
|---|---|
| `packages/host/src/canvas-host.tsx` | `PlasmicCanvasHost` — runs in the iframe, sets up `__Sub`, renders `plasmicRootNode` |
| `packages/host/src/index.ts` | Sets `window.__Sub = { React, ReactDOM, setPlasmicRootNode, ... }` |
| `platform/wab/src/wab/client/components/canvas/canvas-rendering.ts` | `renderTplNode`, `useRenderedFrameRoot`, `makeEmptyRenderingCtx` |
| `platform/wab/src/wab/shared/contexts.ts` | `wrapWithContext` |
| `platform/wab/src/wab/shared/bundles.ts` | `deserSite` — deserialises WAB bundle to site model |
| Dev host code components (CloverPayButton, etc.) | Already registered in the iframe's React tree |

## New Code Required

### 1. `packages/plasmic-mcp/src/headless-renderer-entry.ts` (esbuild entry)

```typescript
// Imports WAB rendering functions — zero custom logic
import { renderTplNode, makeEmptyRenderingCtx } from
  "@/wab/client/components/canvas/canvas-rendering";
import { wrapWithContext } from "@/wab/shared/contexts";
import { deserSite } from "@/wab/shared/bundles";

(window as any).__HeadlessRenderer = {
  renderTplNode,
  makeEmptyRenderingCtx,
  wrapWithContext,
  deserSite,
};
```

### 2. `packages/plasmic-mcp/src/headless-canvas.ts` (~150 lines)

Playwright orchestration only:

```typescript
export async function captureWithStudioPipeline(opts: {
  devHostUrl: string;   // e.g. http://localhost:3021
  componentName: string;
  bundle: object;       // serialised WAB bundle from session
  width?: number;
  height?: number;
  timeout?: number;
}): Promise<string>     // base64 PNG
```

Internally:
1. `chromium.launch({ headless: true })`
2. `page.setContent('<html><body></body></html>')` (parent frame, no URL)
3. `page.addScriptTag({ path: 'dist/headless-renderer.js' })`
4. `page.evaluate(orchestrate, { devHostUrl, componentName, bundle })` — the
   function runs in the browser; creates the iframe, waits for `__Sub`, calls
   `renderTplNode`, calls `setPlasmicRootNode`
5. `page.frames()[1].screenshot(...)` → buffer → base64

### 3. Minimal ViewCtx duck-type (inside `headless-canvas.ts`)

`renderTplNode` and `makeEmptyRenderingCtx` access a small subset of ViewCtx.
We pass a plain object:

```typescript
const minimalVc = {
  canvasCtx: { Sub: sub },            // sub = iframe.contentWindow.__Sub
  site,                               // from deserSite(bundle)
  viewMode: () => "display",
  focusedTpl: () => null,
  variantTplMgr: () => buildVariantTplMgr(site),  // from existing WAB util
  // remaining fields: null/empty — renderTplNode falls back gracefully
};
```

All fields derived from the WAB bundle already in the MCP session.

### 4. `build.mjs` update — second esbuild entry

```javascript
// Add alongside existing packages/plasmic-mcp build:
await esbuild.build({
  entryPoints: ['packages/plasmic-mcp/src/headless-renderer-entry.ts'],
  bundle: true,
  outfile: 'packages/plasmic-mcp/dist/headless-renderer.js',
  platform: 'browser',
  format: 'iife',
  alias: { '@/wab': 'platform/wab/src/wab' },
});
```

### 5. `screenshot.ts` + `server.ts` — wire-in

`screenshot.ts`: replace the `page.goto(url)` path with
`captureWithStudioPipeline(...)` when a `bundle` + `componentName` are provided.

`server.ts` `capture-screenshot` case: pass `session.bundle` and `comp.name`
instead of a URL.

## Acceptance Criteria

- [ ] `inspect.capture-screenshot` returns a PNG that shows the component as
      rendered by the dev host, including code components (CloverPayButton renders
      as its real button, not a placeholder).
- [ ] The screenshot reflects the current **saved** WAB state.
- [ ] Zero modifications to `canvas-rendering.ts`, `canvas-host.tsx`,
      `host/src/index.ts`, or any other upstream file.
- [ ] When the dev host is not running the iframe fails to load within 8s and
      the action returns a clear error, not a hang.
- [ ] Works for non-page components (no URL route required).
- [ ] All existing tests pass (~1,470).
- [ ] New unit tests cover: iframe setup, `__Sub` polling, `renderTplNode` call,
      `setPlasmicRootNode` injection.

## Happy Path

1. Agent calls `node.update-styles` + `project.save`.
2. Agent calls `inspect.capture-screenshot { componentUuid: "g_Kr9fC1vxOJ" }`.
3. MCP resolves component name (`checkout-mcp`) and gets current bundle from session.
4. Playwright launches headless Chromium; parent page loads `headless-renderer.js`.
5. `page.evaluate` creates iframe → `http://localhost:3021/plasmic-host#canvas=true&componentName=checkout-mcp&origin=http://localhost:3021&globalVariants={}&interactive=false`
6. Dev host iframe loads: `window.__Sub` is set, `PlasmicCanvasHost` mounts, `plasmicRootNode` = null.
7. `page.evaluate` polls until `iframe.contentWindow.__Sub` is defined.
8. Calls `__HeadlessRenderer.renderTplNode(component.tplTree, ctx)` using `sub.React`.
9. Calls `sub.setPlasmicRootNode(element)` → host re-renders with real component tree.
10. CloverPayButton, CloverCardNumber etc. render via their actual implementations.
11. `page.frames()[1].screenshot()` → base64 PNG returned as `image/png` MCP block.

## Edge Cases

| Scenario | Expected behaviour |
|---|---|
| Dev host not running | iframe load timeout after 8s → `{ error: "Dev host unavailable at <url>" }` |
| `__Sub` not defined after iframe load | Poll with 100ms interval up to 5s, then error |
| Component not found in bundle | Return existing component-not-found error |
| `renderTplNode` throws | Catch + return `{ error: "Render failed: <message>" }` |
| Code component throws during render | `ErrorBoundary` in `PlasmicCanvasHost` catches; screenshot shows error boundary |
| Non-page (reusable) component | Works — `tplTree` rendered directly, no route needed |
| WAB bundle version mismatch on `deserSite` | Throw with clear version message |

## Out of Scope

- Comlink / `PLASMIC_HOST_REGISTER` handshake (not needed — `setPlasmicRootNode` is called directly)
- Tree-to-HTML fallback renderer (separate feature if desired)
- Auto-screenshot after every tool call
- Pixel-diff / visual regression testing
- Video / animation capture
- Any modification to upstream WAB or host package files

## File Plan

| File | Action |
|---|---|
| `packages/plasmic-mcp/src/headless-renderer-entry.ts` | **Create** — esbuild entry; imports WAB fns, exposes on `window.__HeadlessRenderer` |
| `packages/plasmic-mcp/src/headless-canvas.ts` | **Create** — Playwright orchestration + ViewCtx duck-type (~150 lines) |
| `packages/plasmic-mcp/src/screenshot.ts` | **Update** — call `captureWithStudioPipeline` when bundle provided |
| `packages/plasmic-mcp/src/server.ts` | **Update** — pass bundle + componentName to capture-screenshot |
| `packages/plasmic-mcp/src/__tests__/headless-canvas.test.ts` | **Create** — unit tests |
| `build.mjs` | **Update** — second esbuild entry for `headless-renderer-entry.ts` |
| `platform/wab/src/**` | **No change** |
| `packages/host/src/**` | **No change** |
