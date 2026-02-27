# Plasmic MCP Eval System — Implementation Plan

## Status Summary

**All tasks complete**. P1-P9 fully implemented. All audit findings resolved. Skill documentation updated for code component variants, dryRun, and inspect params.

- MCP server: 8 STRAP tools, 103 actions
- Eval system: harness, graders, visual capture, dashboard, CI, 70 scenarios
- Total tests: 1,427 (1,290 unit + 137 integration across 28 suites)
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
| P9 | Contract & Doc Fixes | dryRun support for 5 component actions (rename/delete/convert-to-page/convert-to-component/update-page-meta), explicit dryRun rejection for 3 API-based actions (create-page/create/clone), `update-split` slices support, eval scenario childTags fix, skill doc accuracy (dryRun claim, code component variants, inspect params), INDEX.md regeneration (55→70 scenarios). Background longhands now compose into shorthand. `_cache` field removed from inspect.node response. `description` Zod annotation clarified. project-save-refresh eval guard (requiredMode: integration). Dashboard regression alerts show all grader results with badges, screenshots, and error details. 20 new tests. |

## Known Issues

_None currently tracked._
