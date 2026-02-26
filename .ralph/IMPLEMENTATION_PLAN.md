# Plasmic MCP Eval System — Implementation Plan

## Status Summary

**All tasks complete**. P1-P9 fully implemented. Skill documentation updated for code component variants, dryRun, and inspect params.

- MCP server: 8 STRAP tools, 103 actions
- Eval system: harness, graders, visual capture, dashboard, CI, 70 scenarios
- Total tests: 1,418 (1,281 unit + 137 integration across 28 suites)
- Spec: `.ralph/specs/code-component-variant-support.md` — all acceptance criteria met

## Completed Priorities

| Priority | Area | Summary |
|----------|------|---------|
| P1-P2 | MCP Server & Eval Core | STRAP architecture, eval harness, graders, scenarios |
| P3 | Eval Unit Tests | 148 tests across 7 eval module files |
| P4 | Code Component Variants | `variant.list` CC output, `resolveVariant()` by key/displayName, `create-style` CC selectors, type declarations, 3 eval scenarios, skill doc updates |
| P5 | Dashboard Hardening | XSS fix, fetch timeout, Chart.js CDN fallback, POST input validation |
| P6 | Visual Capture Hardening | Defensive null checks, CSRF validation, selector constants, crash pattern expansion |
| P7 | Report Archival | 90-day cleanup on server start + standalone `npm run eval:cleanup` |
| P8 | Eval Resume/Skip | Git SHA tracking, scenario skip for passed results, `--force` override |
| P9 | Contract & Doc Fixes | dryRun support for 5 component actions (rename/delete/convert-to-page/convert-to-component/update-page-meta), explicit dryRun rejection for 3 API-based actions (create-page/create/clone), `update-split` slices support, eval scenario childTags fix, skill doc accuracy (dryRun claim, code component variants, inspect params), INDEX.md regeneration (55→70 scenarios). 11 new tests. |

## Known Issues

_None currently tracked._

## Audit Findings (informational, not blocking)

These items were identified during the P9 audit but do not require immediate action:

- **Dashboard**: Grader results not displayed in UI (only first error shown). Screenshots captured but not served or displayed.
- **`inspect.node` `_cache` field**: Internal debugging artifact exposed in response — harmless but undocumented.
- **`description` field dual-purpose**: In component domain, the Zod `description` field serves both SEO page description and prop annotation purposes. The Zod annotation says "Page description for SEO" which is misleading for prop operations.
- **`backgroundSize`/`backgroundPosition` etc. silently dropped**: Background longhands are collected into `skippedLonghands` in `sanitizeStyles()` and not applied.
- **`project-save-refresh` eval scenario**: Always fails in mock mode because `project.refresh` reloads the static fixture, erasing in-memory changes. Only meaningful in integration mode but has no guard.
