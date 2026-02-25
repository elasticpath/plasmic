/**
 * Mock for @/wab/shared/core/tpls
 */

import { vi } from "vitest";

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

export function isTplTag(x: any): boolean {
  return x?._type === "TplTag";
}

export function trackComponentRoot(comp: any): void {
  mockTrackComponentRoot(comp);
}

export function trackComponentSite(comp: any, site: any): void {
  mockTrackComponentSite(comp, site);
}
