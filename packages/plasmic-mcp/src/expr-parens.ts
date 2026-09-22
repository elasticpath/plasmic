/**
 * Paren handling for stored code expressions.
 *
 * Studio wraps every user-authored JS expression in parentheses: that wrap is
 * what marks the stored string as code to evaluate rather than an inert JSON
 * literal (`isRealCodeExpr` tests `code.startsWith("(")`). Read paths therefore
 * have to undo it, so what an agent reads back matches what the write tools
 * accept.
 */

import * as acorn from "acorn";

/**
 * Removes one wrapping parenthesis pair from a stored expression.
 *
 * Only a pair that wraps the *whole* expression is removed. `(1) > (0)` starts
 * with `(` and ends with `)` without those being a matched pair, so a naive
 * slice would mangle it into `1) > (0`; `preserveParens` reports a whole-span
 * ParenthesizedExpression only when the wrap really is one pair.
 *
 * Anything unparseable is returned unchanged — read paths report what is stored
 * and must never throw on legacy or hand-edited values.
 */
export function stripCodeParens(code: string): string {
  if (!code.startsWith("(")) {
    return code;
  }
  try {
    const node: any = acorn.parseExpressionAt(code, 0, {
      ecmaVersion: 2020,
      preserveParens: true,
    });
    if (node.type === "ParenthesizedExpression" && node.end === code.length) {
      return code.slice(node.expression.start, node.expression.end);
    }
  } catch {
    // fall through
  }
  return code;
}
