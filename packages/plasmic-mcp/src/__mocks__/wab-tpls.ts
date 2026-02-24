/**
 * Mock for @/wab/shared/core/tpls
 */

export const mockMkTplTagX = jest.fn();

export function mkTplTagX(tag: string, opts?: any, ...children: any[]): any {
  return mockMkTplTagX(tag, opts, ...children);
}

export function flattenTpls(tplRoot: any): any[] {
  const result: any[] = [];
  function walk(node: any) {
    if (!node) return;
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
