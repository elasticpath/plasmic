# Plasmic Design Agent Skill (`/plasmic-design`)

## Jobs to Be Done

- As a **developer**, I want to describe a design intent and have Claude orchestrate all the Plasmic tool calls in the right order, so I get a production-quality result without manually sequencing inspect → edit → verify cycles.
- As a **designer** (non-technical), I want to describe what I want in plain language and have Claude plan, execute, and self-correct until the result matches my intent, so I don't need to understand the underlying MCP tool API.

## Overview

A new Claude Code skill (`.claude/commands/plasmic-design.md`) that implements an **agentic loop** over existing Plasmic MCP tools. Unlike single-pass skills (`/plasmic-create-page`, `/plasmic-edit`), this skill orchestrates a structured 4-phase loop:

```
Gather Context → Written Plan + Confirm → Batched Execution → Verify + Self-Correct
```

The skill is **prompt-only** — it uses existing MCP tools and requires no new server-side code.

## Acceptance Criteria

- [ ] The skill produces noticeably higher-quality output than `/plasmic-create-page` or `/plasmic-edit` on the same prompt (structural consistency, token usage, alignment)
- [ ] The skill detects and self-corrects at least one structural or style deviation during the verify phase without user intervention
- [ ] The skill works for both **page creation** and **component editing** as its target
- [ ] No new MCP tools are required — the skill uses only the existing 8 domain tools
- [ ] Auto-retry on deviation is bounded (max 2 correction attempts per phase); on failure the skill surfaces the deviation clearly to the user
- [ ] All features are in scope: layout, typography, design tokens, responsive breakpoints, data binding, interactions, animations, multi-page/multi-component coordination

## Happy Path

### Phase 1 — Gather Context
1. Ensure a project is active (`project.set` / `project.list` if needed)
2. Load design tokens: `design.list-tokens` (all types)
3. Load component inventory: `component.list`
4. If the request targets an existing component: `inspect.summary` on target(s)
5. Load available mixins, animations, global variant groups if relevant to the request
6. If the request is underspecified or ambiguous, ask 1–2 targeted clarifying questions before proceeding

### Phase 2 — Written Plan + Confirmation
1. Output a structured **Design Plan** in markdown:
   - Target: page name/path or component name
   - Sections/components to create or modify
   - Layout structure (hierarchy, flex direction, nesting)
   - Typography choices (mapped to tokens where available)
   - Colour choices (mapped to tokens where available)
   - Responsive behaviour (breakpoints if applicable)
   - Data binding / queries (if applicable)
   - Interactions (if applicable)
2. Ask the user to confirm or revise before executing

### Phase 3 — Batched Execution
Execute in logical phases, not a single flat call sequence:
1. **Structural phase** — Create containers, layout hierarchy, page/component scaffold
2. **Content phase** — Add text nodes, images, slot content
3. **Style phase** — Apply colours, spacing, typography (using design tokens)
4. **Enhancement phase** — Responsive variants, data binding, interactions, animations (as applicable)

Each phase is a discrete batch of tool calls. Proceed to verify before starting the next phase.

### Phase 4 — Verify + Self-Correct (per phase)
1. After each batch: `inspect.summary` on affected component(s)
2. Compare actual tree structure against the plan
3. If deviation found:
   - Attempt correction automatically (max 2 retries per phase)
   - If still unresolved after 2 retries: surface the deviation to the user with a clear description
4. On success: proceed to the next phase

### Completion
- Output a **final summary**: what was built, any corrections made, any deviations that required user attention
- Offer relevant next steps (e.g., "Add data binding?", "Create responsive breakpoints?", "Extract as reusable component?")

## Edge Cases

| Scenario | Expected Behaviour |
|---|---|
| User request is ambiguous (e.g., "make it look good") | Ask 1–2 targeted questions before planning. Never guess silently on ambiguous intent. |
| Design token doesn't exist for a required value | Use closest matching token or raw CSS value; note the gap in the plan output |
| Verify shows deviation after 2 retries | Report clearly: what was expected, what was found, what was attempted. Do not loop indefinitely. |
| Target component doesn't exist yet | Treat as creation task — create component/page as part of Phase 3 |
| User rejects the plan in Phase 2 | Revise the plan based on feedback and re-confirm. Do not execute until confirmed. |
| Request spans multiple pages/components | Plan and execute each component sequentially; report cross-component progress clearly |
| An enhancement phase (data/interactions) requires clarification mid-execution | Pause, ask the user, then resume. Do not skip or guess. |

## Skill Interface

- **Invoked as:** `/plasmic-design <natural language description>`
- **Arguments:** Free-form design intent, optionally including target component/page name
- **Existing tools used:** `project`, `inspect`, `component`, `design`, `node`, `variant`, `data`, `interaction`
- **No new MCP tools required**

## Implementation Notes

- The skill file lives at `.claude/commands/plasmic-design.md`
- Format mirrors existing skills: tool reference section + explicit numbered instructions + `$ARGUMENTS` substitution
- Phase structure should be explicit in the prompt instructions so Claude follows the loop reliably
- Design token usage should be preferred but not enforced — raw CSS remains valid when no token maps cleanly
- The plan output (Phase 2) should be structured enough for the user to meaningfully approve or reject it

## Out of Scope

- No new MCP server tools or server-side code changes
- No changes to existing skill files (this is additive)
- The skill does not replace other skills — it is a new, more powerful entry point for complex design tasks
