# Design Pattern Library

LLMs perform significantly better when they can select from a named, well-scoped
pattern rather than composing multi-step workflows from low-level primitives. This
spec describes a pattern library for the Plasmic MCP: a static registry of pre-built
UI element trees (hero sections, cards, navbars, forms, etc.) that the LLM can
instantiate and customise, rather than building from scratch.

## Precedent

This is an established MCP pattern used in production:
- **Chakra UI MCP**: `list_component_templates`, `get_component_templates`
- **react-design-systems-mcp**: `generate_pattern_code` for named UI patterns
- **Figma**: explicitly endorses design-system-backed MCP as the AI bridge for design
- MCP community guidance: *"Repeated tool sequences = time to bundle into a compound
  workflow tool"* — the pattern library is exactly that bundle.

## Jobs to Be Done

- As a developer using Claude Code, I want to say "add a hero section" and have the
  LLM instantiate a well-structured, editable Plasmic element tree rather than
  assembling it from individual `addChild` + `updateStyles` calls.
- As an autonomous agent, I want to browse available patterns by name so I can
  select the most appropriate starting point and apply customisations on top.

## Acceptance Criteria

- [ ] A new `inspect` action `listPatterns` returns the full pattern catalogue:
      `{ name, description, tags, previewDescription }[]` with no required parameters.
- [ ] A new `node` action `applyPattern` instantiates a named pattern into the tree:
      schema `{ patternName: string, parentNodeId: string, customisations?: Record<string, string> }`.
      Returns `{ rootNodeId: string }`.
- [ ] The pattern registry is defined in
      `packages/plasmic-mcp/src/patterns/registry.ts` as a static array of
      `PatternDefinition` objects. Each definition contains:
      - `name` — unique slug (e.g. `"hero-split"`)
      - `description` — one sentence
      - `tags` — string array (e.g. `["layout", "marketing", "hero"]`)
      - `previewDescription` — plain-text description of visual output
      - `tree` — a `PlasmicElement` tree (same format as `plasmic-patterns.md` skill)
- [ ] Users can register their own patterns by placing `*.pattern.json` files in a
      configurable directory (`PLASMIC_MCP_PATTERNS_DIR`, defaults to
      `.plasmic/patterns/`). User-defined patterns are merged with the built-in
      registry at startup and take precedence on name collision.
- [ ] The initial registry ships with at least 8 built-in starter patterns covering
      common UI building blocks (these are starting points only, not a prescribed
      design system):
      - `hero-centered` — centred heading, subheading, CTA button
      - `hero-split` — heading + copy left, image placeholder right
      - `card-basic` — image, title, body, action link
      - `card-grid` — 3-column responsive grid of `card-basic` instances
      - `navbar-simple` — logo left, nav links centre, CTA right
      - `form-contact` — name, email, message fields with submit button
      - `feature-row` — icon, heading, body repeated 3× horizontally
      - `footer-simple` — logo, nav columns, copyright line
- [ ] `applyPattern` converts the `PlasmicElement` tree to edit tool calls using
      the same `wiTreeToEditCalls()` mapper built for `node.importHtml`
      (reusing the mapper rather than duplicating logic).
- [ ] `customisations` is a flat `Record<string, string>` of token substitutions
      applied to the tree before instantiation (e.g.
      `{ "headingText": "Ship faster", "ctaLabel": "Get started" }`).
      Each pattern declares its customisation keys in the registry entry.
- [ ] `listPatterns` is marked `readOnlyHint: true` in its `ToolAnnotation`.
- [ ] Unit tests in `__tests__/pattern-library.test.ts` cover:
      - `listPatterns` returns all 8 patterns with correct shape
      - `applyPattern("hero-centered", parentId)` calls the expected edit tool sequence
      - `applyPattern` with customisations substitutes values correctly
      - Unknown `patternName` returns a clear error
- [ ] All ~1,470 existing tests continue to pass.
- [ ] No changes to existing MCP tool schemas.

## Happy Path

1. Developer: *"Add a contact form to this page"*
2. Claude calls `inspect.listPatterns` — sees `form-contact` in the list.
3. Claude calls `node.applyPattern` with `patternName: "form-contact"`,
   `parentNodeId: <page root>`,
   `customisations: { "submitLabel": "Send message" }`.
4. MCP instantiates the PlasmicElement tree via `wiTreeToEditCalls()`:
   creates a vertical stack, three input fields, a textarea, and a styled button.
5. Returns `{ rootNodeId: "..." }`.
6. Developer sees a complete, editable contact form in Plasmic Studio.

## Edge Cases

| Scenario | Expected behaviour |
|----------|-------------------|
| Unknown `patternName` | `{ error: "Pattern 'foo' not found. Call listPatterns to see available patterns." }` |
| `parentNodeId` not found | Existing node-not-found error from `node-resolver` |
| Customisation key not declared by pattern | Key ignored with a warning in the response |
| Pattern tree references a component not in the project | That node is skipped; rest of tree instantiates normally |
| `listPatterns` called with no session | Returns the static catalogue (no session required — patterns are static) |

## Out of Scope

- Pattern versioning
- Pattern thumbnail images (text `previewDescription` only)
- Semantic search over patterns (the catalogue is small enough that `listPatterns` + LLM selection is sufficient)
