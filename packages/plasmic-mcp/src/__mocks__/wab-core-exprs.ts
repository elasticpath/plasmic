export interface ExprCtx {
  component: any;
  projectFlags: any;
  inStudio: boolean;
}
export function getRawCode() {
  return "";
}

/**
 * Mirrors `customCode` in @/wab/shared/core/exprs: wraps the code in parens so
 * `isRealCodeExpr` returns true, marking it code to evaluate rather than a
 * JSON literal.
 */
export function customCode(code: string, fallback: any = null) {
  return { _type: "CustomCode", code: `(${code})`, fallback };
}
