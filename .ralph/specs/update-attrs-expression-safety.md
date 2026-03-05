# update-attrs Expression Safety

Covers gap #25 — `node.update-attrs` accepting expression strings that produce invalid JSX codegen.

## Context

### What the Bug Was (Historical)
A build loop passed `value: "expr:$state.firstName"` to `node.update-attrs`. The old
implementation stored this as raw code without quoting, producing `value={expr:$state.firstName}`
in generated JSX — invalid syntax that broke all page loads with esbuild errors.

### Current State
The current `createAttrExpr` function already JSON-stringifies unknown values, so
`"expr:$state.firstName"` now produces `value={"expr:$state.firstName"}` — a valid JSX string
literal. The original exact bug no longer reproduces.

However, two risks remain:
1. **Invalid JS in dynamic expressions**: A caller passes `"$state.firstName +"` (with `$` prefix
   = dynamic mode). This strips the `$` and stores `state.firstName +` as `CustomCode`, producing
   `value={state.firstName +}` — a syntax error that breaks codegen.
2. **Unintentional literal storage**: A caller passes `"state.firstName"` expecting it to bind
   to state but it is stored as the string literal `"state.firstName"`. No error, silent wrong
   behaviour.

## Jobs to Be Done

- As an MCP caller, I want `update-attrs` to reject dynamic expressions that are not valid
  JavaScript before they corrupt the Plasmic bundle.
- As an MCP caller, I want a warning when I pass a value that looks like it should be a dynamic
  expression but will be stored as a static literal.

## Acceptance Criteria

- [ ] `$expression` where the expression string fails acorn JS parse → rejected with error
      `"Invalid JS expression: <error message>. Use $<valid-js-expr> or {{valid-js-expr}}"`
- [ ] `{{expression}}` where the expression string fails acorn JS parse → same error
- [ ] `$state.firstName` (valid JS, valid dynamic expression) → accepted, CustomCode stored
- [ ] `$state.firstName +` (invalid JS) → rejected
- [ ] Static string `"hello"` → accepted as literal, no warning
- [ ] Static string that looks like an expression (`"state.firstName"`, containing `.`) → accepted
      with a `warning` field in the response: `"Value stored as literal string. If you intended
      a dynamic binding, use $state.firstName or {{state.firstName}}"`
- [ ] The warning triggers for strings matching `/(^|\s)\$(state|ctx|queries|props|pageCtx)\./`
      or containing standalone `$state.`, `$ctx.`, `$queries.` not wrapped in `$...|{{...}}`
- [ ] Validation happens in `createAttrExpr` (shared) so `update-props` benefits too
- [ ] Unit tests cover all accept/reject/warn cases
- [ ] No new runtime dependencies — use `acorn` (already a declared dependency)

## Implementation Design

### `validateJsExpression(code: string): void`

New helper in `edit-tools.ts` (or a shared `expr-validator.ts`). Uses `acorn.parseExpressionAt`
to attempt parsing `code` as a JS expression. Throws with the acorn error message if parsing
fails.

```typescript
import * as acorn from "acorn";

function validateJsExpression(code: string): void {
  try {
    acorn.parseExpressionAt(code, 0, { ecmaVersion: 2020 });
  } catch (err: any) {
    throw new Error(
      `Invalid JS expression: ${err.message}. Use $<valid-js-expr> or {{valid-js-expr}}.`
    );
  }
}
```

### `checkLiteralWarning(value: string): string | null`

Returns a warning string if the value looks like a dangling expression reference:

```typescript
const EXPR_PATTERN = /\$(state|ctx|queries|props|pageCtx)\./;

function checkLiteralWarning(value: string): string | null {
  if (EXPR_PATTERN.test(value)) {
    return `Value "${value}" stored as a static string literal. If you intended a dynamic binding, wrap it: $${value} or {{${value}}}.`;
  }
  return null;
}
```

### Updated `createAttrExpr`

```typescript
function createAttrExpr(value: unknown, warnings: string[]): any {
  if (typeof value === "string") {
    if (value.startsWith("$")) {
      const code = value.slice(1);
      validateJsExpression(code);  // throws on invalid JS
      return new CustomCode({ code, fallback: null });
    }
    if (value.startsWith("{{") && value.endsWith("}}")) {
      const code = value.slice(2, -2).trim();
      validateJsExpression(code);  // throws on invalid JS
      return new CustomCode({ code, fallback: null });
    }
    // Static literal — check for accidental expression patterns
    const warning = checkLiteralWarning(value);
    if (warning) warnings.push(warning);
    return new CustomCode({ code: JSON.stringify(value), fallback: null });
  }
  return new CustomCode({
    code: value === undefined ? "undefined" : JSON.stringify(value),
    fallback: null,
  });
}
```

### `UpdateAttrsResult` — add `warnings`

```typescript
export interface UpdateAttrsResult {
  save: SaveResult;
  nodeName?: string;
  nodeUuid: string;
  updatedAttributes: string[];
  removedAttributes: string[];
  warnings?: string[];  // NEW — non-fatal issues with stored values
}
```

`update-props` (`UpdatePropsResult`) should get the same `warnings` field.

## Happy Path

1. Caller passes `{ value: "$state.firstName" }` → validates as `state.firstName` (valid JS) →
   stored as `CustomCode({ code: "state.firstName" })` → page bundles cleanly
2. Caller passes `{ value: "Submit" }` → no warning, stored as `"Submit"` literal → correct

## Edge Cases

| Scenario | Expected behaviour |
|----------|--------------------|
| `{ value: "$state.x +" }` | Error: invalid JS — rejected before save |
| `{ value: "{{state.x +}}" }` | Error: invalid JS — rejected before save |
| `{ value: "state.firstName" }` | Warning in response: looks like expression, stored as literal |
| `{ value: "$ctx.user.name" }` | Accepted — valid JS, stored as dynamic expr |
| `{ value: "hello world" }` | No warning, stored as literal |
| `{ value: 42 }` | Accepted, stored as `CustomCode("42")` |
| `{ value: true }` | Accepted, stored as `CustomCode("true")` |
| `{ value: null }` | Attribute removed |

## Out of Scope

- Full codegen dry-run validation (adds latency, requires codegen server access)
- Blocking all use of `value` on `<input>` elements (there are valid static uses)
- Runtime JS evaluation or type-checking of the expression
- Validating that referenced state variables (`$state.firstName`) actually exist in the component
