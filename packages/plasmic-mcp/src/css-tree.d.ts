/**
 * Minimal type declarations for css-tree v3.
 * css-tree v3 does not ship built-in TypeScript types.
 * Only the APIs used by html-importer.ts are typed here.
 */
declare module "css-tree" {
  interface CssNode {
    type: string;
    children?: CssNodeList;
    [key: string]: unknown;
  }

  interface CssNodeList {
    forEach(callback: (node: CssNode, item: unknown, list: CssNodeList) => void): void;
  }

  interface Block extends CssNode {
    type: "Block";
  }

  interface Declaration extends CssNode {
    type: "Declaration";
    property: string;
    value: CssNode;
  }

  interface Rule extends CssNode {
    type: "Rule";
    prelude: CssNode;
    block: Block | null;
  }

  interface SelectorList extends CssNode {
    type: "SelectorList";
  }

  interface Selector extends CssNode {
    type: "Selector";
  }

  interface Atrule extends CssNode {
    type: "Atrule";
    name: string;
    prelude: CssNode | null;
    block: CssNode | null;
  }

  interface ParseOptions {
    context?: string;
    parseValue?: boolean;
    onParseError?: (error: Error) => void;
  }

  function parse(source: string, options?: ParseOptions): CssNode;
  function generate(node: CssNode): string;

  type WalkCallback = (this: WalkContext, node: CssNode) => void;

  interface WalkContext {
    atrule?: Atrule;
    rule?: Rule;
  }

  function walk(ast: CssNode, callback: WalkCallback): void;
}
