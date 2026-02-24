/**
 * Type declarations for @/wab/ modules imported via esbuild path aliases.
 * These modules come from platform/wab/src/wab/ and are bundled by esbuild
 * using the @/ → platform/wab/src/ alias. TypeScript only sees these stubs.
 */

declare module "@/wab/shared/bundler" {
  export class FastBundler {
    constructor(meta: any, classes: any);
    unbundle(bundle: any, uuid: string): any;
    bundle(site: any, uuid: string, version: string): any;
  }
}

declare module "@/wab/shared/model/classes-metas" {
  export const meta: any;
  export const CLASSES: Record<string, any>;
  export const modelSchemaHash: string;
}

declare module "@/wab/shared/model/classes" {
  export class Site {
    static isKnown(obj: unknown): obj is Site;
    components: any[];
    arenas: any[];
    globalVariantGroups: any[];
    styleTokens: any[];
    mixins: any[];
    themes: any[];
    imageAssets: any[];
    projectDependencies: any[];
  }

  export class ProjectDependency {
    static isKnown(obj: unknown): obj is ProjectDependency;
    site: Site;
  }

  export function isKnownTplTag(x: any): boolean;
  export function isKnownTplComponent(x: any): boolean;
  export function isKnownTplSlot(x: any): boolean;
  export function isKnownRawText(x: any): boolean;
  export function isKnownExprText(x: any): boolean;
  export function isKnownCustomCode(x: any): boolean;
  export function isKnownRenderExpr(x: any): boolean;
  export function isKnownVarRef(x: any): boolean;
  export function isKnownImageAssetRef(x: any): boolean;
  export function isKnownStyleTokenRef(x: any): boolean;
}
