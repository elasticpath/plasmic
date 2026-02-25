/**
 * Type declarations for @/wab/ modules imported via esbuild path aliases.
 * These modules come from platform/wab/src/wab/ and are bundled by esbuild
 * using the @/ → platform/wab/src/ alias. TypeScript only sees these stubs.
 *
 * M1: bundler, classes-metas, classes
 * M2: InstUtil, observable-model, tpls, RuleSetHelpers, undo-util, TplMgr
 */

// --- M1 modules ---

declare module "@/wab/shared/bundler" {
  export class FastBundler {
    constructor(meta: any, classes: any);
    unbundle(bundle: any, uuid: string): any;
    bundle(site: any, uuid: string): any;
    /** Serialize only changed instances into a partial Bundle. */
    fastBundle(
      root: any,
      uuid: string,
      changedInsts: ReadonlyArray<{ readonly inst: any; readonly field: string }>
    ): any;
    /** Look up the address (uuid + iid) for a live model instance. */
    addrOf(inst: any): { uuid: string; iid: string } | undefined;
    /** Initialize parent tracking for fastBundle. Must be called after unbundle()
     *  with the same bundle JSON and UUID to enable incremental saves. */
    recomputeParents(bundle: any, uuid: string): void;
  }
}

declare module "@/wab/shared/model/classes-metas" {
  export const meta: any;
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

  /** Model class for raw text content. Constructable with { text, markers }. */
  export class RawText {
    constructor(args: { text: string; markers: any[] });
    text: string;
    markers: any[];
  }

  /** Model class for dynamic code expressions. Constructable with { code, fallback }. */
  export class CustomCode {
    constructor(args: { code: string; fallback: any });
    code: string;
    fallback: any;
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

// --- M2 modules ---

declare module "@/wab/shared/model/InstUtil" {
  /** Model introspection utility — knows field types, class hierarchy, etc. */
  export class InstUtil {
    constructor(meta: any, realClasses: Record<string, Function>);
  }
  /** Pre-constructed singleton from meta + classes. */
  export const instUtil: InstUtil;
}

declare module "@/wab/shared/core/observable-model" {
  export interface ChangeNode {
    readonly inst: any;
    readonly field: string;
  }

  export type ModelChange = {
    type: string;
    path?: ChangeNode[];
    changeNode: ChangeNode;
    [key: string]: any;
  };

  export type ModelChangeListener = (event: ModelChange) => void;

  export interface RecordedChanges {
    changes: ModelChange[];
    newInsts: any[];
    removedInsts: any[];
  }

  export class ChangeRecorder {
    constructor(opts: {
      inst: any;
      _instUtil: any;
      excludeFields?: any[];
      excludeClasses?: any[];
      isExternalRef?: (obj: any) => boolean;
      visitNodeListener?: (inst: any) => void;
      skipInitialObserveFields?: any[];
      incremental?: boolean;
    });
    withRecording(f: () => void): RecordedChanges;
    dispose(): void;
  }

  export function observeModel(
    rootInst: any,
    opts: {
      instUtil: any;
      listener: ModelChangeListener;
      incremental?: boolean;
      [key: string]: any;
    }
  ): { dispose: () => void };

  export const emptyRecordedChanges: RecordedChanges;
  export function mergeRecordedChanges(a: RecordedChanges, b: RecordedChanges): RecordedChanges;
}

declare module "@/wab/shared/core/tpls" {
  export interface MkTplTagOpts {
    id?: string;
    name?: string;
    uuid?: string;
    attrs?: Record<string, any>;
    variants?: any[];
    baseVariant?: any;
    type?: any;
    styles?: Record<string, string>;
  }

  /** Create a TplTag node with optional children. */
  export function mkTplTagX(
    tag: string,
    opts?: MkTplTagOpts,
    ...children: any[]
  ): any;

  /** Create a text TplTag node. Sets type: "text", creates RawText on the variant setting.
   *  This is what Studio uses to create text nodes. */
  export function mkTplInlinedText(
    text: string,
    variantCombo: any[],
    tag?: string,
    opts?: MkTplTagOpts
  ): any;

  /** Flatten a Tpl tree into a list of all nodes. */
  export function flattenTpls(tplRoot: any): any[];

  export function isTplTag(x: any): boolean;

  /** Register a component's tplTree root in the TPLROOT_TO_COMPONENT WeakMap.
   *  Required for TplMgr.ensureBaseVariantSetting() to find the owning component. */
  export function trackComponentRoot(component: any): void;

  /** Register a component → site mapping in the COMPONENT_TO_SITE WeakMap.
   *  Required for getOwnerSite() lookups. */
  export function trackComponentSite(component: any, site: any): void;
}

declare module "@/wab/shared/RuleSetHelpers" {
  export interface IRuleSetHelpersX {
    has(prop: string): boolean;
    get(prop: string): string;
    getRaw(prop: string): string | undefined;
    set(prop: string, val: string): void;
    clear(prop: string): void;
    clearAll(props: string[]): void;
    merge(props: Record<string, string>): void;
    props(): string[];
  }

  export class RuleSetHelpers implements IRuleSetHelpersX {
    constructor(rs: any, forTag: string);
    has(prop: string): boolean;
    get(prop: string): string;
    getRaw(prop: string): string | undefined;
    set(prop: string, val: string): void;
    clear(prop: string): void;
    clearAll(props: string[]): void;
    merge(props: Record<string, string>): void;
    props(): string[];
  }

  /** Create a size-aware RSH proxy for a TplNode's RuleSet. */
  export function RSH(rs: any, tpl: any): IRuleSetHelpersX;
}

declare module "@/wab/shared/core/undo-util" {
  import type { ModelChange } from "@/wab/shared/core/observable-model";
  /** Apply the inverse of each change in reverse order to roll back mutations. */
  export function undoChanges(changes: ModelChange[]): void;
}

declare module "@/wab/shared/TplMgr" {
  export class TplMgr {
    constructor(args: { site: any });
    /** Ensure a base VariantSetting exists on the node, creating if absent. */
    ensureBaseVariantSetting(tpl: any): any;
    /** Get the base variant for a component. */
    ensureBaseVariant(comp: any): any;
  }
}
