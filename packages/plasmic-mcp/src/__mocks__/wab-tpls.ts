/**
 * Mock for @/wab/shared/core/tpls
 */

export const mockMkTplTagX = jest.fn();
export const mockMkTplInlinedText = jest.fn();
export const mockTrackComponentRoot = jest.fn();
export const mockTrackComponentSite = jest.fn();

export function mkTplTagX(tag: string, opts?: any, ...children: any[]): any {
  return mockMkTplTagX(tag, opts, ...children);
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
