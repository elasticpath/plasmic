/**
 * Mock for @/wab/shared/core/tpls
 */

import { vi } from "vitest";

export const TplTagType = {
  Text: "text",
  Image: "image",
  Columns: "columns",
  Column: "column",
  Other: "other",
};

export const mockMkTplTagX = vi.fn();
export const mockMkTplInlinedText = vi.fn();
export const mockMkTplComponentX = vi.fn();
export const mockTrackComponentRoot = vi.fn();
export const mockTrackComponentSite = vi.fn();

export function mkTplTagX(tag: string, opts?: any, ...children: any[]): any {
  return mockMkTplTagX(tag, opts, ...children);
}

export function mkTplComponentX(params: any): any {
  return mockMkTplComponentX(params);
}

export function mkTplInlinedText(
  text: string,
  variants: any[],
  tag: string,
  opts?: any
): any {
  return mockMkTplInlinedText(text, variants, tag, opts);
}

export function flattenTpls(tplRoot: any): any[] {
  const result: any[] = [];
  function walk(node: any) {
    if (!node) {return;}
    result.push(node);
    if (node.children) {
      for (const child of node.children) {
        walk(child);
      }
    }
  }
  walk(tplRoot);
  return result;
}

/**
 * Mock clone: deep-clone a duck-typed TplNode.
 * Mirrors WAB's real clone() which creates new instances of everything.
 */
function cloneExpr(expr: any): any {
  if (!expr) return expr;
  if (expr._type === "RenderExpr") {
    return { ...expr, tpl: (expr.tpl ?? []).map((t: any) => clone(t)) };
  }
  return { ...expr };
}

function cloneText(text: any): any {
  if (!text) return text;
  if (text._type === "ExprText") {
    return { ...text, expr: cloneExpr(text.expr) };
  }
  return { ...text, markers: [...(text.markers ?? [])] };
}

function cloneAttrs(attrs: any): any {
  if (!attrs) return attrs;
  const result: any = {};
  for (const [k, v] of Object.entries(attrs)) {
    result[k] = cloneExpr(v);
  }
  return result;
}

export function clone(node: any): any {
  if (!node) return node;
  const cloned: any = {
    ...node,
    uuid: `clone-${node.uuid ?? Math.random().toString(36).slice(2)}`,
    parent: null,
    children: (node.children ?? []).map((c: any) => clone(c)),
    vsettings: (node.vsettings ?? []).map((vs: any) => ({
      ...vs,
      rs: vs.rs ? { values: { ...vs.rs.values }, mixins: [...(vs.rs.mixins ?? [])] } : vs.rs,
      text: cloneText(vs.text),
      attrs: cloneAttrs(vs.attrs),
      args: (vs.args ?? []).map((arg: any) => ({
        ...arg,
        expr: cloneExpr(arg.expr),
      })),
    })),
  };
  // Handle TplSlot defaultContents
  if (node.defaultContents) {
    cloned.defaultContents = node.defaultContents.map((c: any) => {
      const cc = clone(c);
      cc.parent = cloned;
      return cc;
    });
  }
  for (const child of cloned.children) {
    child.parent = cloned;
  }
  return cloned;
}

export function isTplTag(x: any): boolean {
  return x?._type === "TplTag";
}

export function trackComponentRoot(comp: any): void {
  mockTrackComponentRoot(comp);
}

export function trackComponentSite(comp: any, site: any): void {
  mockTrackComponentSite(comp, site);
}

// Fixup pipeline predicates
export function isTplSlot(x: any): boolean {
  return x?._type === "TplSlot";
}
export function isTplComponent(x: any): boolean {
  return x?._type === "TplComponent";
}
export function isTplContainer(x: any): boolean {
  return x?._type === "TplTag" && !x?.type;
}
export function isTplTagOrComponent(x: any): boolean {
  return isTplTag(x) || isTplComponent(x);
}
export function isTplVariantable(x: any): boolean {
  return isTplTag(x) || isTplComponent(x) || isTplSlot(x);
}
export function isGrid(_x: any): boolean {
  return false;
}
export function isComponentRoot(_x: any): boolean {
  return false;
}
export function isTplColumns(_x: any): boolean {
  return false;
}
export function findVariantSettingsUnderTpl(_tpl: any): any[] {
  return [];
}
export function getTplOwnerComponent(_tpl: any): any {
  return undefined;
}
export function tryGetOwnerSite(_comp: any): any | undefined {
  return undefined;
}
export function buildParamToComponent(_components: any[]): Map<any, any> {
  return new Map();
}

/**
 * Unit-test stub for Studio's `findExprsInComponent` — returns an empty
 * list so reference-detection guards (e.g. the gap #70 pre-flight check
 * in `removeQuery`) treat mock components as having no bindings.
 * Integration tests in `real-integration.test.ts` use the real helper
 * against a real bundle.
 */
export function findExprsInComponent(
  _component: any
): Array<{ node: any; expr: any }> {
  return [];
}
