# Design Guidance Improvements

The `design` and `node` tool descriptions currently describe *what* the tools do
but give the LLM minimal guidance on *how to design well*. This spec captures
improvements to tool descriptions, action schemas, and prompt fragments that help
LLMs produce higher-quality, more consistent Plasmic designs without requiring new
infrastructure.

Ships alongside `design-html-bridge.md` and `design-visual-feedback.md`.

## Jobs to Be Done

- As a developer using Claude Code, I want the LLM to use design tokens instead of
  raw hex values so that the output stays consistent with the project's design system.
- As a developer, I want the LLM to choose the right Plasmic structural primitives
  (stack vs grid, TplTag vs TplComponent) so that the resulting component tree is
  maintainable and editable in Studio.
- As a developer, I want the `inspect` tool to surface enough context that the LLM
  can understand the existing design system before making changes.

## Acceptance Criteria

- [ ] The `design` tool description includes a **Design System First** instruction:
      *"If the project has design tokens (check with `inspect.listDesignSystem`),
      prefer token references over raw values for consistency. Raw CSS values are
      always valid — this is advisory only."*
- [ ] The `node.updateStyles` action description includes a **Layout Guidance** note
      listing when to use flexbox vs grid, and when to prefer a component over a
      raw tag.
- [ ] Each action description in `node`, `design`, and `inspect` tools includes at
      least one **few-shot example** in the schema `description` field showing a
      realistic input → expected output pair. Examples are chosen to demonstrate
      correct token usage, layout choice, and naming conventions.
- [ ] A new `inspect` action `listDesignSystem` returns a compact summary of all
      active tokens (colours, spacing, typography) in one call, reducing the number
      of tool calls needed for context-gathering.
- [ ] The `inspect.readComponentTree` output includes a `layoutHint` field per node
      (`"flex-row"`, `"flex-col"`, `"grid"`, `"block"`) derived from existing style
      data, making layout structure immediately readable.
- [ ] All `inspect` read-only actions (`listDesignSystem`, `readComponentTree`, etc.)
      are annotated with `readOnlyHint: true` in their `ToolAnnotation`. Mutating
      actions in `node` and `design` are annotated with `destructiveHint: true` where
      appropriate (e.g. `removeChild`, `removeToken`).
- [ ] `listDesignSystem` and `readComponentTree` define an `outputSchema` (JSON Schema)
      matching their return shape, enabling structured chaining per the June 2025 MCP
      spec update.
- [ ] All existing tests pass. New unit tests cover `listDesignSystem` and
      `layoutHint` output shape.

## Happy Path

1. Developer asks Claude: *"Add a card component with our brand colours"*
2. Claude calls `inspect.listDesignSystem` to see available tokens
   (`--color-brand-primary`, `--spacing-md`, etc.).
3. Claude calls `component.create` then `node.addChild` for card structure.
4. Claude calls `node.updateStyles` using token names rather than hex values.
5. Result is a card that matches the design system without any manual correction.

## Edge Cases

| Scenario | Expected behaviour |
|----------|-------------------|
| Project has no design tokens | `listDesignSystem` returns empty list with a note; LLM falls back to raw values |
| Token name is ambiguous | `listDesignSystem` returns all tokens; LLM picks the closest match |
| LLM ignores guidance and uses raw values | Tool still works; guidance is advisory only |
| `layoutHint` cannot be determined | Field is omitted from the node output |

## Out of Scope

- Automatic token creation based on raw values used (auto-tokenisation)
- Linting or validation that rejects raw values when tokens exist
- Changes to how tokens are stored in the Plasmic model
