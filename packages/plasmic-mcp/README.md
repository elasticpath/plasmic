# @elasticpath/plasmic-mcp

MCP server for Plasmic Studio with an embedded editing engine. Create pages, edit components, manage design systems — all from Claude Code or any MCP client.

## Setup

### Prerequisites

- Node.js >= 18
- A Plasmic project ID and API token

### Environment Variables

| Variable | Description |
|----------|-------------|
| `PLASMIC_AUTH_USER` | Your Plasmic account email |
| `PLASMIC_AUTH_TOKEN` | Plasmic API token |
| `PLASMIC_AUTH_HOST` | Plasmic Studio host URL (optional — defaults to production) |

### Claude Code

Add to `~/.claude/settings.json`:

```json
{
  "mcpServers": {
    "plasmic": {
      "command": "npx",
      "args": ["@elasticpath/plasmic-mcp"],
      "env": {
        "PLASMIC_AUTH_USER": "you@example.com",
        "PLASMIC_AUTH_TOKEN": "your-token"
      }
    }
  }
}
```

### Claude Desktop

Add to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "plasmic": {
      "command": "npx",
      "args": ["@elasticpath/plasmic-mcp"],
      "env": {
        "PLASMIC_AUTH_USER": "you@example.com",
        "PLASMIC_AUTH_TOKEN": "your-token"
      }
    }
  }
}
```

## Quick Start

```
1. project.set       → Connect to a project by ID
2. inspect.summary   → See pages, components, tokens, variants
3. node.update-styles → Change styles on an element
4. project.save      → Persist changes to Plasmic
```

## Tool Reference

The server exposes 8 domain tools following the STRAP pattern (Structured Tool Resource Action Pattern), consolidating 103 actions into a manageable surface:

| Domain | # | Actions | Purpose |
|--------|---|---------|---------|
| `project` | 8 | set, list, get-meta, save, refresh, begin-batch, end-batch, undo | Session lifecycle |
| `inspect` | 8 | tree, summary, node, subtree, export, style-properties, preview-url, page-meta | Read-only queries |
| `component` | 18 | list, create-page, create, clone, rename, delete, extract, convert-to-page, convert-to-component, update-page-meta, list-props, add-prop, update-prop, remove-prop, list-states, add-state, update-state, remove-state | Component/page lifecycle |
| `node` | 15 | add, remove, move, clone, reorder, update-styles, update-text, update-rich-text, update-attrs, set-visibility, set-image, apply-mixin, detach-mixin, add-animation, remove-animation | Element mutations |
| `variant` | 12 | list, create-style, create-group, list-global-groups, create-global-group, add-global, remove-global-group, rename-global, create-screen, update-screen, rename, remove | Variant management |
| `design` | 22 | list-tokens, create-token, update-token, remove-token, duplicate-token, list-mixins, create-mixin, update-mixin, remove-mixin, list-animations, create-animation, update-animation, remove-animation, list-themes, create-theme, update-theme, remove-theme, set-active-theme, list-assets, upload-asset, rename-asset, remove-asset | Design system |
| `data` | 16 | set-data-cond, set-data-rep, list-queries, add-query, update-query, remove-query, list-data-tokens, create-data-token, update-data-token, remove-data-token, list-splits, create-split, update-split, remove-split, get-code-meta, list-functions | Data bindings |
| `interaction` | 4 | list, add, update, remove | Event handlers |

Every tool call takes `{ "action": "<action-name>", ...params }`.

## Prompt Examples

Natural-language prompts you can use with Claude Code when the skills are installed.

**Page creation** (triggers `/plasmic-create-page`):
- "Create a pricing page with a hero section, 3-column feature grid, and a CTA button"
- "Add a testimonials page with customer quote cards in a responsive grid"
- "Build a contact form page with name, email, message fields and a submit button"

**Component creation** (triggers `/plasmic-create-component`):
- "Create a reusable card component with an image, title, description, and link"
- "Make a header component with a logo, nav links, and a signup button"
- "Build a footer component with 3 columns and a copyright notice"

**Editing & styling** (triggers `/plasmic-edit`):
- "Change the background color of the Card component to use our brand-primary token"
- "Make the hero heading 48px on desktop and 28px on mobile"
- "Add 16px padding and a subtle box shadow to the pricing cards"
- "Style the Header component instance with a sticky position and white background"

**Dynamic data** (triggers `/plasmic-edit`):
- "Bind the product name to `$ctx.product.name` with a fallback of 'Untitled'"
- "Repeat the product card for each item in the products query"
- "Show the discount badge only if `$ctx.product.onSale` is true"

**Interactions** (triggers `/plasmic-edit`):
- "Add an onClick handler to the CTA button that navigates to /pricing"
- "When the user clicks 'Add to Cart', increment the cart counter state"

**Design system** (triggers `/plasmic`):
- "List all the available color tokens"
- "Create a new spacing token called 'section-gap' with value 64px"
- "Apply the heading-mixin to the page title"

**Inspection** (triggers `/plasmic-inspect`):
- "Show me the structure of the homepage"
- "What props does the ProductCard component have?"
- "What variants and breakpoints are defined?"

## Tool Call Examples

Concrete JSON payloads for direct MCP integration.

### Browse a project

```json
{ "action": "set", "projectId": "abc123" }
```
```json
{ "action": "summary", "componentUuid": "<uuid>" }
```

### Create a page

```json
{
  "action": "create-page",
  "name": "PricingPage",
  "path": "/pricing",
  "body": {
    "type": "vbox",
    "styles": { "padding": "64px 24px", "gap": "48px", "alignItems": "center" },
    "children": [
      { "type": "text", "value": "Pricing", "tag": "h1", "styles": { "fontSize": "48px" } },
      { "type": "text", "value": "Choose a plan that works for you." }
    ]
  }
}
```

### Edit styles

```json
{
  "action": "update-styles",
  "componentUuid": "<uuid>",
  "nodeRef": "Hero Title",
  "styles": { "fontSize": "48px", "color": "#1a1a1a", "fontWeight": "700" }
}
```

### Style a component instance

```json
{
  "action": "update-styles",
  "componentUuid": "<uuid>",
  "nodeRef": "Header",
  "styles": { "position": "sticky", "top": "0", "backgroundColor": "#ffffff" }
}
```

### Add children to a slot

```json
{
  "action": "add",
  "componentUuid": "<uuid>",
  "parentRef": "Card",
  "slot": "children",
  "child": { "type": "text", "value": "Slot content" }
}
```

### Dynamic text

```json
{
  "action": "update-text",
  "componentUuid": "<uuid>",
  "nodeRef": "Product Name",
  "text": "$ctx.product.name",
  "dynamic": true,
  "fallback": "Untitled"
}
```

### Batch edits

```json
{ "action": "begin-batch" }
```
```json
{ "action": "update-styles", "componentUuid": "<uuid>", "nodeRef": "...", "styles": { "..." : "..." } }
```
```json
{ "action": "update-text", "componentUuid": "<uuid>", "nodeRef": "...", "text": "..." }
```
```json
{ "action": "end-batch" }
```

### Code component variants

`variant.list` returns code component variants alongside standard variants:

```json
{
  "action": "list",
  "componentUuid": "<uuid>"
}
// Response includes:
// "codeComponentVariants": [{ "key": "selected", "label": "Selected" }, ...]
```

Target a code component variant when styling:

```json
{
  "action": "update-styles",
  "componentUuid": "<uuid>",
  "nodeRef": "ProductCard",
  "variant": "selected",
  "styles": { "borderColor": "#0070f3", "boxShadow": "0 0 0 2px #0070f3" }
}
```

Create a style variant with a CSS selector for a code component:

```json
{
  "action": "create-style",
  "componentUuid": "<uuid>",
  "name": "Selected State",
  "selector": "[data-selected]"
}
```

### Undo

```json
{ "action": "undo" }
```

### Dry run

Preview a mutation without persisting changes:

```json
{
  "action": "update-styles",
  "componentUuid": "<uuid>",
  "nodeRef": "Hero Title",
  "styles": { "fontSize": "64px" },
  "dryRun": true
}
```

Returns the result the action *would* produce (including a change summary) but does not save. Supported on all mutation domains except `variant`.

### Inspect efficiently

Use progressive disclosure to stay within context budgets:

```json
{ "action": "summary", "componentUuid": "<uuid>", "maxDepth": 2 }
```
```json
{ "action": "subtree", "componentUuid": "<uuid>", "nodeRef": "Hero Section", "maxDepth": 3 }
```
```json
{ "action": "tree", "componentUuid": "<uuid>", "format": "concise", "maxChars": 8000 }
```

## Claude Code Skills

Six slash commands are available when the skill files are installed in `.claude/commands/`:

| Command | Description |
|---------|-------------|
| `/plasmic` | General tool router — routes requests to the right domain tool, context budget guidance |
| `/plasmic-inspect` | Progressive tree navigation: summary, node, subtree, tree |
| `/plasmic-edit` | Edit existing pages/components: styles, text, data, interactions, structure |
| `/plasmic-create-page` | Create pages with PlasmicElement trees |
| `/plasmic-create-component` | Create or clone reusable components |
| `/plasmic-patterns` | PlasmicElement pattern library: hero, grid, card, form, nav, footer, etc. |

## Development

```bash
npm run dev              # Start dev server (tsx)
npm run build            # Build distribution
npm test                 # All tests (1,427 passing)
npm run test:unit        # Unit tests only (mocked WAB)
npm run test:integration # Integration tests (real WAB)
npm run typecheck        # TypeScript validation
npm run eval             # Run evaluation scenarios
npm run eval:validate    # Validate scenario YAML files
npm run eval:dashboard   # Start eval results dashboard
npm run eval:cleanup     # Clean up old results (90-day retention)
```

The eval harness runs YAML-defined scenarios at mock and integration tiers, grading results with state checks, visual LLM judge, and human spot-check flags.

## Dev Host Variant Sync

Code component variants (e.g., "Selected", "Disabled" states) are not stored in the persisted project bundle — Studio normally gets them by connecting to the dev host via iframe. The MCP has no browser, so it fetches the same data via an HTTP API route.

### How It Works

On `project.set`, if the project has a `hostUrl` configured, dev host sync runs automatically. On `project.refresh`, the dev host is re-queried and fresh variant data replaces the previous sync results. Steps:

1. MCP fetches `{hostUrl}/api/plasmic-registry` (5-second timeout)
2. Extracts only variant-bearing components from the response
3. Populates `codeComponentMeta.variants` on matching code components in the site model
4. Creates `Variant` objects on wrapper components for each variant key
5. Records minimal sync state: `{ devHostSynced: true, syncedVariantComponents: [...] }`

Sync failure is non-fatal — if the dev host is offline or returns an error, the project loads normally without variant data.

### Prerequisites

- The Plasmic project must have `hostUrl` set in project settings (e.g., `http://localhost:3388`)
- The dev host app must expose a `/api/plasmic-registry` endpoint using `@elasticpath/plasmic-registry`

### Setting Up the Dev Host API Route

Install the registry package and add an API route to your Next.js dev host app:

```typescript
// app/api/plasmic-registry/route.ts
import "../../../plasmic-init-server";
import { getComponentRegistry } from "@elasticpath/plasmic-registry";

export function GET() {
  return Response.json({ components: getComponentRegistry() });
}
```

Where `plasmic-init-server.ts` is a server-compatible version of your component registration file (no `"use client"` directive).

### Verifying the Sync

After `project.set`, the response includes sync status:

```json
{
  "projectId": "abc123",
  "projectName": "My Project",
  "componentCount": 42,
  "pageCount": 5,
  "devHostSynced": true,
  "syncedVariantComponents": ["EPBundleOptionTrigger$dev"]
}
```

Call `variant.list` on a wrapper component to see code component variants:

```json
{
  "action": "list",
  "componentUuid": "<wrapper-component-uuid>"
}
```

Response includes `codeComponentVariants`:

```json
{
  "codeComponentVariants": [
    { "key": "selected", "displayName": "Selected", "cssSelector": "[data-selected]" }
  ]
}
```

Then style the variant:

```json
{
  "action": "update-styles",
  "componentUuid": "<wrapper-uuid>",
  "nodeRef": "root",
  "variant": "selected",
  "styles": { "backgroundColor": "#e0f0ff" }
}
```

## Architecture

- **STRAP pattern** — 8 domain tools consolidate 103 actions, keeping the MCP tool surface manageable for LLMs
- **Embedded WAB engine** — editing operations run against Plasmic's own `platform/wab/src/wab/` classes (no separate API calls for edits)
- **Vitest workspace** — unit tests (mocked WAB) + integration tests (real WAB classes)
- **Stdio transport** — JSON-RPC over stdin/stdout; all logging goes to stderr
- **Eval system** — YAML scenarios, three-tier grading (state checks, visual LLM judge, human spot-check), Playwright visual capture
- **Dev Host Sync** — automatic code component variant discovery from running dev host via `/api/plasmic-registry`

## License

See repository root for license information.
