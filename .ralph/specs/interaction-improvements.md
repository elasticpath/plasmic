# Interaction Improvements

## Jobs to Be Done
- As an LLM building interactive components, I want `updateVariable` with `operation: "toggle"` to auto-invert a boolean state without requiring a `value` arg, so that the most common toggle pattern is a single, simple call.
- As an LLM writing custom interaction code, I want `customFunction` to accept standard JavaScript including single-quoted strings, so that I don't encounter mysterious 500 errors.

## Context

### Gap #39 (Minor) — updateVariable toggle requires value

`buildActionArgs()` in `edit-tools.ts:5698-5721` always builds a `value` NameArg, even when `operation` is `"toggle"`. If the LLM omits `value`, the NameArg gets `undefined` → `CustomCode({ code: "undefined" })`, which doesn't toggle anything. The batch then fails because the validation expects a value.

In Plasmic Studio, the "toggle" operation auto-generates `!$state.variableName` without user input.

### Gap #38 (Medium) — customFunction single quotes cause 500

`buildActionArgs()` in `edit-tools.ts:5724-5737` stores the code string as-is in `CustomCode({ code, fallback: null })`. The code is NOT validated by `validateJsExpression()` (unlike `update-attrs` expressions). Single-quoted strings in the code body cause Plasmic's server-side expression parser to return HTTP 500 instead of a descriptive error.

The actual parsing happens server-side in Plasmic's WAB codegen, not in the MCP. However, the MCP should:
1. Pre-validate the code to catch syntax issues before saving
2. Normalize single quotes to double quotes if the server can't handle them
3. Return a clear error if validation fails

**Studio behavior:** Studio's code editor accepts single quotes. The issue may be specific to how MCP serializes the expression through the save API vs how Studio's in-browser editor stores it.

## Acceptance Criteria

### Gap #39: toggle operation
- [ ] `updateVariable` with `operation: "toggle"` auto-generates `value: "!$state.<variableName>"` when no `value` arg is provided
- [ ] Explicitly providing `value` still works and takes precedence
- [ ] `operation: "toggle"` with a non-boolean state returns an error: "Toggle operation requires a boolean state variable"
- [ ] Response includes the auto-generated value expression for transparency
- [ ] Unit tests: toggle without value, toggle with explicit value, toggle on non-boolean state

### Gap #38: customFunction single quotes
- [ ] Investigate root cause: is the 500 from MCP save serialization or from Plasmic server codegen?
- [ ] Match Studio behavior: if Studio accepts single quotes, MCP must too
- [ ] If server rejects single quotes, normalize them in MCP before saving (replace `'` with `"` in string literals only, not in template literals or nested quotes)
- [ ] Pre-validate customFunction code via `validateJsExpression()` before storing
- [ ] If validation fails, return a descriptive error (not 500)
- [ ] Response includes a note if any normalization was applied: "Single quotes in string literals were converted to double quotes for compatibility"
- [ ] Unit tests: single quotes, double quotes, mixed quotes, template literals, nested quotes, syntax errors

## Happy Path

### Toggle
1. LLM calls `interaction.add({ ..., actionType: "updateVariable", args: { variable: "menuOpen", operation: "toggle" } })`
2. MCP auto-generates `value: "!$state.menuOpen"`
3. Interaction is created with correct NameArgs
4. At runtime, clicking toggles the boolean state

### customFunction
1. LLM calls `interaction.add({ ..., actionType: "customFunction", args: { code: "document.getElementById('drawer').style.display = 'flex'" } })`
2. MCP validates the code via acorn parser
3. If single quotes need normalization, applies it and includes note in response
4. Interaction is created and works at runtime

## Edge Cases

| Scenario | Expected behaviour |
|----------|-------------------|
| `toggle` on a text/number state | Error: "Toggle requires boolean state" |
| `toggle` with explicit `value: "!$state.x"` | Uses provided value, no auto-generation |
| `toggle` with explicit `value: "true"` | Uses provided value (even if not a toggle expression) |
| customFunction with template literals containing single quotes | Preserve as-is (template literals use backticks) |
| customFunction with nested quotes: `"it's"` | Preserve (single quote inside double-quoted string is fine) |
| customFunction with syntax error | Descriptive error from acorn validation |
| customFunction with empty string | Error: "customFunction code cannot be empty" |

## Implementation Notes

### Toggle auto-value (edit-tools.ts ~5698-5721)

In the `updateVariable` case, after extracting `operation`:
```typescript
if (operation === "toggle" && !value) {
  value = `!$state.${stateName}`;
}
```

### customFunction validation (edit-tools.ts ~5724-5737)

Before creating the FunctionExpr:
```typescript
validateJsExpression(code); // Reuse existing acorn-based validator
```

For single-quote normalization, investigate whether the issue is in MCP serialization or server-side first. If server-side, normalization may not help (the code goes through codegen regardless).

## Out of Scope
- Adding new interaction action types
- Fixing server-side expression parsing (that's a Plasmic platform issue)
- Supporting multi-line code editors or code formatting
