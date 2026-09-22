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
    /** Apply a partial bundle update (incremental changes from server). */
    unbundlePartial(bundle: any, uuid: string): void;
    /** Get all UUIDs known to the bundler (project + dependency UUIDs). */
    allUuids(): string[];
    /** Look up a live model instance by its address (uuid + iid). */
    objByAddr(addr: { uuid: string; iid: string }): any | undefined;

    /** Maps instance uid (number) to its serialization address (uuid + iid).
     *  Public for tests and defensive access. Populated during unbundle(). */
    _uid2addr: Map<number, { uuid: string; iid: string }>;
    /** Maps address key string to live instance.
     *  Public for tests and defensive access. Populated during unbundle(). */
    _addr2inst: Map<string, any>;

    /** Returns the cached full bundle snapshot from the last bundle pass.
     *  Used by save-manager's pre-save validators (gap #71) to walk the
     *  entire bundle graph for reference integrity checks. */
    cachedBundle(): { map: Record<string, any>; root: string; deps: string[] } | undefined;
  }

  /** Pre-save validator — walks every IID in the bundle map and asserts
   *  each `{__ref: iid}` points to an existing entry. Throws on dangling
   *  refs. Used by save-manager to reject corrupt bundles before they
   *  reach the server (gap #71). */
  export function checkExistingReferences(bundle: unknown): void;

  /** Pre-save validator — walks the reachable graph from bundle.root and
   *  asserts weak/strong-ref consistency. Throws on weak refs to
   *  unreachable instances (the classic parentKey-orphan corruption
   *  pattern from gap #70). */
  export function checkRefsInBundle(bundle: unknown, opts?: unknown): void;
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
    dataTokens: any[];
    activeScreenVariantGroup: any;
    customFunctions: any[];
    splits: any[];
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

  /** Model class for dynamic text bound to an expression.
   *  expr is typically a CustomCode or ObjectPath instance.
   *  html controls whether the expression result is rendered as HTML. */
  export class ExprText {
    constructor(args: { expr: any; html: boolean });
    expr: any;
    html: boolean;
  }

  /** Model class for structured data path expressions (e.g., ["$ctx", "product", "name"]).
   *  Represents dot-notation object access paths. */
  export class ObjectPath {
    constructor(args: { path: Array<string | number>; fallback: any });
    path: Array<string | number>;
    fallback: any;
  }

  /** Model class for variable references. Points to a component state variable. */
  export class VarRef {
    constructor(args: { variable: any });
    variable: any;
  }

  /** Model class for renderable slot content. Contains an array of TplNode children. */
  export class RenderExpr {
    constructor(args: { tpl: any[] });
    tpl: any[];
  }

  /** Model class for parameter argument bindings. Binds a Param to an Expr. */
  export class Arg {
    constructor(args: { param: any; expr: any });
    param: any;
    expr: any;
  }

  /** Model class for RuleSet — CSS property values + mixins + animations. */
  export class RuleSet {
    constructor(args: { values: Record<string, string>; mixins: any[]; animations: any });
    values: Record<string, string>;
    mixins: any[];
    animations: any;
  }

  /** Model class for ArgType — function parameter descriptor (name + type). */
  export class ArgType {
    constructor(args: { name?: "arg"; argName: string; type: any; displayName?: string | null });
    name: "arg";
    argName: string;
    displayName: string | null;
    type: any;
  }

  /** Model class for StyleMarker — CSS formatting applied to a text range. */
  export class StyleMarker {
    constructor(args: { position: number; length: number; rs: any });
    position: number;
    length: number;
    rs: any;
  }

  /** Model class for NodeMarker — inline TplTag element (link, code) embedded in text. */
  export class NodeMarker {
    constructor(args: { position: number; length: number; tpl: any });
    position: number;
    length: number;
    tpl: any;
  }

  /** Model class for Rep — data repetition binding (collection → element/index vars). */
  export class Rep {
    constructor(args: { element: any; index: any; collection: any });
    element: any;
    index: any;
    collection: any;
  }

  /** Model class for Var — named variable with unique UUID. */
  export class Var {
    constructor(args: { name: string; uuid: string });
    name: string;
    uuid: string;
  }

  /** Model class for PropParam — component prop definition. */
  export class PropParam {
    constructor(args: any);
    variable: any;
    uuid: string;
    type: any;
    advanced: boolean;
    enumValues: any[];
    origin: any;
    exportType: string;
    defaultExpr: any;
    previewExpr: any;
    propEffect: any;
    description: any;
    displayName: any;
    about: any;
    isRepeated: any;
    isMainContentSlot: boolean;
    required: boolean;
    mergeWithParent: boolean;
    isLocalizable: boolean;
  }

  /** Model class for Text type descriptor. */
  export class Text {
    constructor(args: any);
    name: string;
  }

  /** Model class for Num type descriptor. */
  export class Num {
    constructor(args: any);
    name: string;
  }

  /** Model class for BoolType type descriptor. */
  export class BoolType {
    constructor(args: any);
    name: string;
  }

  /** Model class for AnyType type descriptor. */
  export class AnyType {
    constructor(args: any);
    name: string;
  }

  /** Model class for HrefType type descriptor. */
  export class HrefType {
    constructor(args: any);
    name: string;
  }

  /** Model class for FunctionType type descriptor. */
  export class FunctionType {
    constructor(args: any);
    name: string;
    params: any[];
  }

  export function isKnownTplTag(x: any): boolean;
  export function isKnownTplComponent(x: any): boolean;
  export function isKnownTplSlot(x: any): boolean;
  export function isKnownRawText(x: any): boolean;
  export function isKnownExprText(x: any): boolean;
  export function isKnownCustomCode(x: any): boolean;
  export function isKnownFunctionExpr(x: any): boolean;
  export function isKnownRenderExpr(x: any): boolean;
  export function isKnownVarRef(x: any): boolean;
  export function isKnownObjectPath(x: any): boolean;
  export function isKnownImageAsset(x: any): boolean;
  export function isKnownImageAssetRef(x: any): boolean;
  export function isKnownStyleTokenRef(x: any): boolean;
  export function isKnownStyleMarker(x: any): boolean;
  export function isKnownNodeMarker(x: any): boolean;
  export function isKnownState(x: any): boolean;
  export function isKnownNamedState(x: any): boolean;
  export function isKnownEventHandler(x: any): boolean;
  export function isKnownInteraction(x: any): boolean;
  export function isKnownComponentDataQuery(x: any): boolean;
  export function isKnownComponentServerQuery(x: any): boolean;
  export function isKnownMixin(x: any): boolean;
  export function isKnownKeyFrame(x: any): boolean;
  export function isKnownAnimationSequence(x: any): boolean;
  export function isKnownAnimation(x: any): boolean;
  export function isKnownTheme(x: any): boolean;
  export function isKnownThemeStyle(x: any): boolean;
  export function isKnownThemeLayoutSettings(x: any): boolean;
  export function isKnownDataToken(x: any): boolean;
  export function isKnownPageMeta(x: any): boolean;
  export function isKnownGlobalVariantGroup(x: any): boolean;
  export function isKnownSplit(x: any): boolean;
  export function isKnownRandomSplitSlice(x: any): boolean;
  export function isKnownSegmentSplitSlice(x: any): boolean;

  /** Model class for Mixin — reusable style bundle stored at site level. */
  export class Mixin {
    constructor(args: {
      name: string;
      rs: any;
      preview?: string | null;
      uuid: string;
      forTheme?: boolean;
      variantedRs?: any[];
    });
    name: string;
    rs: any;
    preview: string | null;
    uuid: string;
    forTheme: boolean;
    variantedRs: any[];
  }

  /** Model class for KeyFrame — a percentage stop in an animation sequence. */
  export class KeyFrame {
    constructor(args: { percentage: number; rs: any });
    uid: number;
    percentage: number;
    rs: any;
  }

  /** Model class for AnimationSequence — site-level named @keyframes definition. */
  export class AnimationSequence {
    constructor(args: { name: string; uuid: string; keyframes?: KeyFrame[] });
    uid: number;
    name: string;
    readonly uuid: string;
    keyframes: KeyFrame[];
  }

  /** Model class for Animation — element-level application of an AnimationSequence with timing. */
  export class Animation {
    constructor(args: {
      sequence: AnimationSequence;
      duration?: string;
      timingFunction?: string;
      iterationCount?: string;
      direction?: string;
      delay?: string;
      fillMode?: string;
      playState?: string;
    });
    uid: number;
    sequence: AnimationSequence;
    duration: string;
    timingFunction: string;
    iterationCount: string;
    direction: string;
    delay: string;
    fillMode: string;
    playState: string;
  }

  /** Model class for ThemeLayoutSettings — layout defaults for a theme. */
  export class ThemeLayoutSettings {
    constructor(args: { rs: any });
    uid: number;
    rs: any;
  }

  /** Model class for ThemeStyle — per-selector CSS override within a theme. */
  export class ThemeStyle {
    constructor(args: { selector: string; style: any });
    uid: number;
    readonly selector: string;
    style: any;
  }

  /** Model class for Theme — a site-level theme with typography defaults and per-tag overrides. */
  export class Theme {
    constructor(args: {
      defaultStyle: any;
      styles?: ThemeStyle[];
      layout?: ThemeLayoutSettings | null;
      addItemPrefs?: Record<string, any>;
      active?: boolean;
    });
    uid: number;
    defaultStyle: any;
    styles: ThemeStyle[];
    layout: ThemeLayoutSettings | null | undefined;
    addItemPrefs: Record<string, any>;
    readonly active: boolean;
  }

  /** Model class for ComponentDataQuery — client-side data query on a component. */
  export class ComponentDataQuery {
    constructor(args: { uuid: string; name: string; op?: any });
    uuid: string;
    name: string;
    op: any;
  }

  /** Model class for ComponentServerQuery — server-side data query on a component. */
  export class ComponentServerQuery {
    constructor(args: { uuid: string; name: string; op?: any });
    uuid: string;
    name: string;
    op: any;
  }

  /** Model class for CustomFunctionExpr — an expression that calls a
   *  registered CustomFunction. Used as the `op` of a serverQuery to bind
   *  the query to `ep.getProduct` etc. Mirrors Studio's
   *  `ServerQueryOpPicker` construction pattern — `func` is the
   *  CustomFunction reference, `args` is the array of FunctionArgs. */
  export class CustomFunctionExpr {
    constructor(args: { func: any; args: any[] });
    func: any;
    args: any[];
  }

  /** Model class for FunctionArg — a single argument of a CustomFunctionExpr.
   *  `argType` is a WeakRef to the ArgType in `func.params`; `expr` is
   *  typically a CustomCode or ObjectPath carrying the argument value. */
  export class FunctionArg {
    constructor(args: { uuid: string; expr: any; argType: any });
    uuid: string;
    expr: any;
    argType: any;
  }

  /** Model class for EventHandler — event handler expression containing interactions. */
  export class EventHandler {
    constructor(args: { interactions: any[] });
    interactions: any[];
  }

  /** Model class for Interaction — single action step within an EventHandler. */
  export class Interaction {
    constructor(args: any);
    interactionName: string;
    actionName: string;
    args: any[];
    condExpr: any;
    conditionalMode: string;
    uuid: string;
    parent: any;
  }

  /** Model class for NameArg — named argument binding (name → expr). */
  export class NameArg {
    constructor(args: { name: string; expr: any });
    name: string;
    expr: any;
  }

  /** Model class for FunctionExpr — anonymous function expression. */
  export class FunctionExpr {
    constructor(args: { argNames: string[]; bodyExpr: any });
    argNames: string[];
    bodyExpr: any;
  }

  /** Model class for state value parameter (extends Param pattern). */
  export class StateParam {
    constructor(args: any);
    variable: any;
    uuid: string;
    type: any;
    state: any;
    enumValues: any[];
    origin: any;
    exportType: string;
    defaultExpr: any;
    previewExpr: any;
    propEffect: any;
    description: any;
    displayName: any;
    about: any;
    isRepeated: any;
    isMainContentSlot: boolean;
    required: boolean;
    mergeWithParent: boolean;
    isLocalizable: boolean;
  }

  /** Model class for state onChange handler parameter. */
  export class StateChangeHandlerParam {
    constructor(args: any);
    variable: any;
    uuid: string;
    type: any;
    state: any;
    enumValues: any[];
    origin: any;
    exportType: string;
    defaultExpr: any;
    previewExpr: any;
    propEffect: any;
    description: any;
    displayName: any;
    about: any;
    isRepeated: any;
    isMainContentSlot: boolean;
    required: boolean;
    mergeWithParent: boolean;
    isLocalizable: boolean;
  }

  /** Model class for NamedState — named state variable on a component. */
  export class NamedState {
    constructor(args: any);
    name: string;
    param: any;
    accessType: string;
    variableType: string;
    onChangeParam: any;
    tplNode: any;
    implicitState: any;
  }

  /** Model class for DataToken — site-level JSON data value referenced as $ctx.tokenName. */
  export class DataToken {
    constructor(args: {
      name: string;
      type?: "Data";
      value?: string;
      uuid: string;
      variantedValues?: any[];
      isRegistered?: boolean;
      regKey?: any;
    });
    name: string;
    readonly type: "Data";
    value: string;
    readonly uuid: string;
    variantedValues: any[];
    isRegistered: boolean;
    regKey: any;
  }

  /** Model class for PageMeta — page-level SEO and routing metadata. */
  export class PageMeta {
    constructor(args: {
      path: string;
      params?: Record<string, string>;
      query?: Record<string, string>;
      title?: any;
      description?: any;
      canonical?: any;
      roleId?: any;
      openGraphImage?: any;
    });
    path: string;
    params: Record<string, string>;
    query: Record<string, string>;
    title: any;
    description: any;
    canonical: any;
    roleId: any;
    openGraphImage: any;
  }

  /** Model class for RandomSplitSlice — probability-based A/B test bucket. */
  export class RandomSplitSlice {
    constructor(args: { uuid: string; name: string; prob: number; contents?: any[]; externalId?: any });
    readonly uuid: string;
    name: string;
    prob: number;
    contents: any[];
    externalId: any;
  }

  /** Model class for SegmentSplitSlice — condition-based segment bucket. */
  export class SegmentSplitSlice {
    constructor(args: { uuid: string; name: string; cond?: string; contents?: any[]; externalId?: any });
    readonly uuid: string;
    name: string;
    cond: string;
    contents: any[];
    externalId: any;
  }

  /** Model class for Split — A/B test or segment definition. */
  export class Split {
    constructor(args: {
      uuid: string;
      name: string;
      splitType?: string;
      slices?: any[];
      status?: string;
      targetEvents?: string[];
      description?: any;
      externalId?: any;
    });
    readonly uuid: string;
    name: string;
    splitType: string;
    slices: any[];
    status: string;
    targetEvents: string[];
    description: any;
    externalId: any;
  }

  /** Model class for VariantsRef — expression referencing variant objects.
   *  Used by Studio for variant group prop bindings (e.g., VariantsPicker → mkVariantGroupArgExpr). */
  export class VariantsRef {
    constructor(args: { variants: any[] });
    variants: any[];
  }

  /** Model class for ImageAsset — site-level image with metadata and data URI. */
  export class ImageAsset {
    constructor(args: {
      uuid: string;
      name: string;
      type: string;
      dataUri?: string | null;
      width?: number | null;
      height?: number | null;
      aspectRatio?: number | null;
    });
    readonly uuid: string;
    name: string;
    readonly type: string;
    dataUri: string | null;
    width: number | null;
    height: number | null;
    aspectRatio: number | null;
  }

  /** Model class for ImageAssetRef — expression referencing an ImageAsset. */
  export class ImageAssetRef {
    constructor(args: { asset: any });
    asset: any;
  }

  /** Model class for CodeComponentVariantMeta — registered variant metadata from code components.
   *  Comes from ComponentMeta.variants in code component registration. */
  export class CodeComponentVariantMeta {
    constructor(args: { cssSelector: string; displayName: string });
    cssSelector: string;
    displayName: string;
  }

  /** Model class for Variant — a variant state within a component or global group.
   *  Code component variants have codeComponentName and codeComponentVariantKeys set. */
  export class Variant {
    readonly uuid: string;
    name: string;
    selectors: string[] | null | undefined;
    codeComponentName: string | null | undefined;
    codeComponentVariantKeys: string[] | null | undefined;
    parent: any;
    mediaQuery: string | null | undefined;
    description: string | null | undefined;
    forTpl: any;
  }

  /** Model class for GlobalVariantGroup — site-level variant group (custom or screen). */
  export class GlobalVariantGroup {
    constructor(args: {
      uuid: string;
      param: any;
      variants?: any[];
      multi?: boolean;
      type?: string;
    });
    readonly uuid: string;
    param: any;
    variants: any[];
    multi: boolean;
    type: string;
  }
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

  /** Interface for the change recorder used by rebase/conflict resolution.
   *  Matches platform/wab/src/wab/shared/core/observable-model.ts IChangeRecorder. */
  export interface IChangeRecorder {
    prune(): void;
    getToBeDeletedInsts(): Set<any>;
    getDeletedInstsWithDanglingRefs(): Set<any>;
    getPathToChild(inst: any): ChangeNode[] | undefined;
    getAnyPathToChild(inst: any): ChangeNode[] | undefined;
    getRefsToInst(inst: any, all?: boolean): any[];
    getChangesSoFar(): ModelChange[];
    withRecording(f: () => void): RecordedChanges;
    dispose(): void;
    setExtraListener(newListener: (change: ModelChange) => void): void;
    maybeObserveComponents(components: any[], componentContext?: any): boolean;
    isRecording: boolean;
  }

  export class ChangeRecorder implements IChangeRecorder {
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
    prune(): void;
    getToBeDeletedInsts(): Set<any>;
    getDeletedInstsWithDanglingRefs(): Set<any>;
    getPathToChild(inst: any): ChangeNode[] | undefined;
    getAnyPathToChild(inst: any): ChangeNode[] | undefined;
    getRefsToInst(inst: any, all?: boolean): any[];
    getChangesSoFar(): ModelChange[];
    setExtraListener(newListener: (change: ModelChange) => void): void;
    maybeObserveComponents(components: any[], componentContext?: any): boolean;
    isRecording: boolean;
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

  export function emptyRecordedChanges(): RecordedChanges;
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

  /** Parameters for creating a TplComponent node via mkTplComponentX. */
  export interface MkTplComponentParams {
    /** The Component model object to instantiate. */
    component: any;
    /** The base variant of the OWNING component (not the instantiated one). */
    baseVariant: any;
    /** Optional display name for the TplComponent node. */
    name?: string;
    /** Prop/slot argument bindings. */
    args?: any[] | Record<string, any>;
    /** Children to wire into the component's default "children" slot. */
    children?: any[];
  }

  /** Create a TplTag node with optional children. */
  export function mkTplTagX(
    tag: string,
    opts?: MkTplTagOpts,
    ...children: any[]
  ): any;

  /** Create a TplComponent node (component instance).
   *  Resolves args, wires children into the default slot, and creates
   *  a VariantSetting with the base variant. */
  export function mkTplComponentX(params: MkTplComponentParams): any;

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

  /** Deep-clone a TplNode tree, creating new instances with new UUIDs. */
  export function clone(node: any): any;

  export function isTplTag(x: any): boolean;

  /** Register a component's tplTree root in the TPLROOT_TO_COMPONENT WeakMap.
   *  Required for TplMgr.ensureBaseVariantSetting() to find the owning component. */
  export function trackComponentRoot(component: any): void;

  /** Register a component → site mapping in the COMPONENT_TO_SITE WeakMap.
   *  Required for getOwnerSite() lookups. */
  export function trackComponentSite(component: any, site: any): void;

  /** Walk every expression (CustomCode, ObjectPath, TemplatedString, etc.)
   *  referenced anywhere in a component's tplTree, styles, data queries,
   *  params, and interactions. Used by `data.remove-query`'s pre-flight
   *  reference check (gap #70) to detect `$queries.<name>` bindings
   *  before deleting the query. */
  export function findExprsInComponent(component: any): Array<{ expr: any; [key: string]: any }>;
}

declare module "@/wab/shared/refactoring" {
  /** Returns true if the given expression references the named query
   *  (`$queries.<name>`). Used alongside a regex fallback for MCP's
   *  pre-flight check before `data.remove-query` — Studio's primary
   *  source of truth for query reference detection. */
  export function isQueryUsedInExpr(queryName: string, expr: any): boolean;

  /** Returns true if the given expression references the named data
   *  token (`$dataTokens.<name>`). Mirror helper to `isQueryUsedInExpr`
   *  for the token-deletion pre-flight path. */
  export function isDataTokenUsedInExpr(tokenName: string, expr: any): boolean;
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
    /** Rename a component with automatic name deduplication.
     *  Handles unique naming via getUniqueComponentName internally. */
    renameComponent(component: any, name: string): void;
    /** Remove a component from the site.
     *  Throws if other components reference it via TplComponent instances.
     *  Handles page link removal, arena cleanup, and default component refs. */
    removeComponent(component: any): void;
    /** Create a component-level style variant (hover/focus/pressed).
     *  Pushes to component.variants (not variantGroups). */
    createStyleVariant(component: any, selectors?: string[]): [any, boolean];
    /** Create an element-level (private) style variant.
     *  The variant is scoped to a specific TplNode via forTpl. */
    createPrivateStyleVariant(component: any, tpl: any, selectors?: string[]): any;
    /** Create a new named variant group on a component.
     *  Handles StateParam, onChangeParam, and linked state creation internally.
     *  optionsType: "singleChoice" | "multiChoice" | "standalone". */
    createVariantGroup(opts: {
      component: any;
      name?: string;
      optionsType?: string;
    }): any;
    /** Add a named variant to an existing ComponentVariantGroup.
     *  Name is auto-deduplicated via getUniqueVariantName(). */
    createVariant(component: any, group: any, name?: string): any;
    /** Add a style token to the site. Returns the created StyleToken. */
    addStyleToken(opts: { name: string; tokenType: string; value: string }): any;
    /** Rename a style token with automatic name deduplication. */
    renameStyleToken(token: any, name: string): void;
    /** Duplicate a style token with auto-generated unique name. */
    duplicateStyleToken(token: any): any;
    /** Get a unique parameter name for a component, deduplicating if needed. */
    getUniqueParamName(component: any, name?: string): string;
    /** Rename a parameter and fix up $props.x expressions throughout the component. */
    renameParam(component: any, param: any, name: string): void;
    /** Remove a client-side data query from a component.
     *  Cleans up QueryInvalidationExpr references. */
    removeComponentQuery(component: any, query: any): void;
    /** Remove a server-side query from a component.
     *  Cleans up QueryInvalidationExpr references. */
    removeComponentServerQuery(component: any, query: any): void;
    /** Clean up QueryInvalidationExpr references to removed queries. */
    clearReferencesToRemovedQueries(removedQueries: string[] | string): void;
    /** Add a mixin to the site. Returns the created Mixin. */
    addMixin(name?: string, mixin?: any): any;
    /** Remove a mixin from site and clean up all element references. */
    removeMixin(mixin: any): void;
    /** Rename a mixin with automatic name deduplication. */
    renameMixin(mixin: any, name: string): void;
    /** Duplicate a mixin with auto-generated unique name. */
    duplicateMixin(mixin: any): any;
    /** Create a new AnimationSequence with optional name; pushed to site.animationSequences. */
    addAnimationSequence(name?: string, animationSequence?: any): any;
    /** Remove an AnimationSequence and clean up all element Animation references. */
    removeAnimationSequence(sequence: any): void;
    /** Rename an AnimationSequence with unique name logic. */
    renameAnimationSequence(sequence: any, name: string): void;
    /** Deep-clone an AnimationSequence with new UUID and unique name. */
    duplicateAnimationSequence(sequence: any): any;
    /** Create an Animation instance (not yet attached to any RuleSet). */
    addAnimation(
      sequence: any,
      duration?: string,
      delay?: string,
      timingFunction?: string,
      iterationCount?: string,
      direction?: string,
      fillMode?: string,
      playState?: string,
    ): any;
    /** Reorder children of a TplTag. Partial list supported — unlisted children appended at end. */
    reorderChildren(tpl: any, reorderedChildren: any[]): void;
    /** Convert a component to a page. Creates pageMeta with auto-generated path from name. */
    convertComponentToPage(component: any): void;
    /** Convert a page to a regular component. Removes pageMeta. */
    convertPageToComponent(component: any): void;
    /** Change the URL path of a page. Handles sanitization and uniqueness. */
    changePagePath(page: any, path: string): void;
    /** Add a data token to the site. Returns the created DataToken. */
    addDataToken(opts: { name?: string; prefix?: string; value?: string }): any;
    /** Rename a data token with expression fixup. */
    renameDataToken(projectId: string, token: any, name: string): void;
    /** Duplicate a data token with auto-generated unique name. */
    duplicateDataToken(token: any): any;
    /** Create a global variant group (user-defined). Returns the group. */
    createGlobalVariantGroup(name?: string): any;
    /** Create a variant in a global variant group. Returns the variant. */
    createGlobalVariant(group: any, name?: string, extra?: { mediaQuery?: string | null }): any;
    /** Create a screen variant with responsive breakpoint. Returns the variant. */
    createScreenVariant(opts: { name: string; spec: any }): any;
    /** Remove an entire global variant group and all its variants. */
    removeGlobalVariantGroup(group: any): void;
    /** Update the CSS media query for a screen variant. */
    updateScreenVariantQuery(variant: any, query: string): void;
    /** Rename a single variant. */
    renameVariant(variant: any, name?: string): void;
    /** Rename a variant group. */
    renameVariantGroup(group: any, name?: string): void;
    /** Remove a split from the site. */
    removeSplit(split: any): void;
    /** Create an ImageAsset and add it to site.imageAssets. Returns the new asset. */
    addImageAsset(opts: {
      name?: string;
      type: string;
      dataUri?: string;
      width?: number;
      height?: number;
      aspectRatio?: number;
    }): any;
    /** Rename an image asset with automatic name deduplication. */
    renameImageAsset(asset: any, name: string): void;
    /** Remove an image asset and clean up all references. */
    removeImageAsset(asset: any): void;
    /** Add a component to the site and set up arenas.
     *  Handles sub-components, arena creation, and MobX observation. */
    attachComponent(
      component: any,
      originalComponent?: any,
      originalComponentSite?: any
    ): void;
    /** Get a unique component name, deduplicating with suffix if needed. */
    getUniqueComponentName(name?: string): string;
    /** Check if a TplNode can be extracted to a new component.
     *  Returns false for root nodes, columns, and nodes inside text. */
    canExtractComponent(tpl: any): boolean;
    /** Remove a state from a component's states array and clean up params. */
    removeState(component: any, state: any): void;
    /** Attempt to remove a variant; no-op if the variant cannot be removed. */
    tryRemoveVariant(variant: any, component: any): void;
  }
}

declare module "@/wab/shared/Variants" {
  /**
   * Get or create a VariantSetting for the given variant combo on a TplNode.
   * If no VariantSetting exists matching the combo, creates one and pushes
   * it to tpl.vsettings. Returns the (possibly new) VariantSetting.
   */
  export function ensureVariantSetting(tpl: any, variants: any[]): any;

  /**
   * Find an existing VariantSetting matching the variant combo.
   * Returns undefined if none exists (does not create).
   */
  export function tryGetVariantSetting(tpl: any, variants: any[]): any | undefined;

  /** Check if a variant (or variant combo) is the base variant. */
  export function isBaseVariant(variants: any): boolean;

  /** Check if a variant belongs to a screen (responsive breakpoint) group. */
  export function isScreenVariant(variant: any): boolean;

  /** Check if a variant group is the screen breakpoint group. */
  export function isScreenVariantGroup(group: any): boolean;

  /** Check if a variant is global (belongs to a GlobalVariantGroup). */
  export function isGlobalVariant(variant: any): boolean;

  /** Check if a variant group is global (screen or user-defined). */
  export function isGlobalVariantGroup(group: any): boolean;

  /** Get the base variant for a component (component.variants[0]). */
  export function getBaseVariant(component: any): any;

  /** Check if a variant is a code component variant (has codeComponentName and codeComponentVariantKeys). */
  export function isCodeComponentVariant(variant: any): boolean;
}

declare module "@/wab/shared/core/components" {
  /**
   * Extract a subtree from a component into a new reusable component.
   * Replaces the original subtree with a TplComponent instance that
   * references the newly created component.
   *
   * Returns the TplComponent instance (replacement node). The new
   * Component is available at `result.component`.
   *
   * After calling, you must call `tplMgr.attachComponent(result.component)`
   * to register the new component with the site.
   */
  export function extractComponent(opts: {
    site: any;
    name: string;
    tpl: any;
    containingComponent: any;
    resurfaceParams?: boolean;
    tplMgr: any;
    getCanvasEnvForTpl: (node: any) => any;
  }): any;
}

// --- External modules without type declarations ---

declare module "css-initials" {
  /** Map of CSS property names (kebab-case) to their initial values. */
  const cssInitials: Record<string, string>;
  export default cssInitials;
}

declare module "@/wab/shared/site-invariants" {
  export class InvariantError extends Error {
    constructor(message: string, data?: any);
    data?: any;
  }

  /** Validates the entire site model. Throws InvariantError on first violation.
   *  Matches the check that Studio performs in StudioCtx.trySave(). */
  export function assertSiteInvariants(
    site: any,
    componentUuidsToSkip?: Set<string>
  ): void;
}

// --- WebSocket live sync prerequisites (P0.0) ---

declare module "@/wab/shared/server-updates-utils" {
  import type { RecordedChanges, ModelChange, IChangeRecorder } from "@/wab/shared/core/observable-model";

  export interface DeletedAssetsSummary {
    deletedComponents: any[];
    deletedImageAssets: any[];
    deletedMixins: any[];
    deletedTokens: any[];
    deletedParams: any[];
    deletedVariantGroups: any[];
    deletedVariants: any[];
    deletedVars: any[];
    deletedStates: any[];
    deletedTplNodes: any[];
    deletedComponentDataQueries: any[];
    deletedThemes: any[];
    deletedArgTypes: any[];
    deletedExprs: any[];
  }

  /** Undo local changes and resolve conflicts with server changes.
   *  Core rebase function — imported from Studio's shared code. */
  export function undoChangesAndResolveConflicts(
    site: any,
    recorder: IChangeRecorder,
    serverSummary: DeletedAssetsSummary,
    changes: ModelChange[]
  ): RecordedChanges;

  /** Create an empty DeletedAssetsSummary with all arrays empty. */
  export function getEmptyDeletedAssetsSummary(): DeletedAssetsSummary;

  /** Populate a DeletedAssetsSummary from a list of deleted model instances. */
  export function updateSummaryFromDeletedInstances(
    summary: DeletedAssetsSummary,
    insts: any[],
    opts?: { includeTplNodesAndExprs?: boolean }
  ): DeletedAssetsSummary;

  /** Fix dangling references after applying server updates. */
  export function fixDanglingReferenceConflicts(
    site: any,
    recorder: IChangeRecorder,
    deletedSummary: DeletedAssetsSummary
  ): void;
}

declare module "@/wab/commons/asyncutil" {
  /** A push/pull queue for sequential async processing.
   *  Used by Studio's modelChangeQueue for processing socket updates. */
  export class PushPullQueue<T> {
    push(item: T): void;
    pull(): Promise<T>;
  }

  /** Drain an async queue until idle. */
  export function drainQueue(queue: any): Promise<void>;
}

declare module "@/wab/shared/api/socket" {
  /** Events the client can send to the server. */
  export type ClientToServerEvents = {
    subscribe: (data: {
      namespace: string;
      projectIds?: string[];
      studio?: boolean;
    }) => unknown | Promise<unknown>;
    view: (data: any) => unknown | Promise<unknown>;
  };

  /** Events the server can send to the client. */
  export type ServerToClientEvents = {
    connect: (data: {}) => unknown | Promise<unknown>;
    disconnect: (data: {}) => unknown | Promise<unknown>;
    initServerInfo: (data: {
      modelSchemaHash: number;
      bundleVersion: string;
      selfPlayerId: number;
    }) => unknown | Promise<unknown>;
    commentsUpdate: (data: {}) => unknown | Promise<unknown>;
    update: (data: {
      projectId: string;
      rev: { revision: number; branchId: string | null };
    }) => unknown | Promise<unknown>;
    players: (data: { sessions: any[] }) => unknown | Promise<unknown>;
    error: (data: string) => unknown | Promise<unknown>;
    publish: (data: any) => unknown | Promise<unknown>;
    hostlessDataVersionUpdate: (data: {
      hostlessDataVersion: number;
    }) => unknown | Promise<unknown>;
  };
}

declare module "@/wab/shared/ApiSchema" {
  export const arenaTypes: readonly ["custom", "page", "component"];
  export type ArenaType = (typeof arenaTypes)[number];

  export interface ArenaInfo {
    type: ArenaType;
    uuidOrName: string;
    focused: boolean;
  }

  export interface PlayerSelectionInfo {
    selectableFrameUuid: string;
    selectableKey?: string;
  }

  export interface PlayerCursorInfo {
    [key: string]: any;
  }

  export interface PlayerPositionInfo {
    [key: string]: any;
  }

  export interface UpdatePlayerViewRequest {
    projectId: string;
    branchId: string | null;
    arena: ArenaInfo | null;
    selection: PlayerSelectionInfo | null;
    cursor: PlayerCursorInfo | null;
    position: PlayerPositionInfo | null;
  }

  export interface InitServerInfo {
    modelSchemaHash: number;
    bundleVersion: string;
    selfPlayerId: number;
  }

  export interface PlayerViewInfo {
    branchId?: string;
    arenaInfo?: ArenaInfo;
    selectionInfo?: PlayerSelectionInfo;
    cursorInfo?: PlayerCursorInfo;
    positionInfo?: PlayerPositionInfo;
  }

  export interface ServerSessionsInfo {
    sessions: any[];
  }
}

declare module "@/wab/shared/Arenas" {
  import type { ArenaType } from "@/wab/shared/ApiSchema";

  /** Get the arena type ("custom" | "component" | "page") for an arena object. */
  export function getArenaType(arena: any): ArenaType;

  /** Get the identifying UUID or name for an arena.
   *  Returns arena.name for custom arenas, component.uuid for component/page arenas. */
  export function getArenaUuidOrName(arena: any): string;
}

declare module "@/wab/shared/collections" {
  /** Return a reversed copy of an array (does not mutate the original). */
  export function arrayReversed<T>(xs: ReadonlyArray<T>): T[];
}

declare module "@/wab/shared/common" {
  /** Set difference: returns elements in `a` that are not in `b`. */
  export function xDifference<T>(a: Iterable<T>, b: Iterable<T>): Set<T>;
}

// ---------------------------------------------------------------------------
// Codegen pipeline (used by preview-server.ts for in-memory component rendering)
// ---------------------------------------------------------------------------

declare module "@/wab/shared/codegen/types" {
  export interface ExportOpts {
    lang: string;
    platform: string;
    forceAllProps?: boolean;
    uncontrolledProps?: boolean;
    shouldTransformWritableStates?: boolean;
    forceRootDisabled?: boolean;
    imageOpts: { scheme: string };
    stylesOpts: { scheme: string };
    codeOpts: { reactRuntime: string };
    fontOpts: { scheme: string };
    codeComponentStubs: boolean;
    skinnyReactWeb: boolean;
    skinny: boolean;
    importHostFromReactWeb: boolean;
    idFileNames?: boolean;
    hostLessComponentsConfig: string;
    includeImportedTokens?: boolean;
    useComponentSubstitutionApi: boolean;
    useGlobalVariantsSubstitutionApi: boolean;
    useCodeComponentHelpersRegistry: boolean;
    useCustomFunctionsStub: boolean;
    isLivePreview?: boolean;
    targetEnv: string;
    localization?: any;
    relPathFromManagedToImplDir?: string;
  }

  export interface ComponentExportOutput {
    id: string;
    componentName: string;
    plasmicName: string;
    displayName: string;
    renderModule: string;
    skeletonModule: string;
    cssRules: string;
    renderModuleFileName: string;
    skeletonModuleFileName: string;
    cssFileName: string;
    scheme: string;
    isPage: boolean;
    path?: string;
  }

  export interface ProjectConfig {
    cssFileName: string;
    cssRules: string;
    projectId: string;
    projectName: string;
    indirect: boolean;
    revision: number;
    version: string;
    projectRevId: string;
    hasStyleTokenOverrides: boolean;
    projectModuleBundle?: { fileName: string; module: string };
    styleTokensProviderBundle?: { fileName: string; module: string };
    dataTokensBundle?: { fileName: string; module: string };
    globalContextBundle?: { fileName: string; module: string };
    splitsProviderBundle?: { fileName: string; module: string };
  }

  export interface SerializerSiteContext {
    projectFlags: any;
    cssProjectDependencies: any;
    cssVarResolver: any;
    customFunctionToOwnerSite: Map<any, any>;
  }
}

declare module "@/wab/shared/codegen/react-p" {
  import type {
    ExportOpts,
    ComponentExportOutput,
    ProjectConfig,
    SerializerSiteContext,
  } from "@/wab/shared/codegen/types";

  export function exportReactPresentational(
    componentGenHelper: any,
    component: any,
    site: any,
    projectConfig: ProjectConfig,
    s3ImageLinks: Record<string, string>,
    isPlasmicHosted: boolean,
    forceAllCsr: boolean,
    appAuthProvider: any,
    opts?: ExportOpts,
    siteCtx?: SerializerSiteContext
  ): ComponentExportOutput;

  export function exportStyleConfig(
    opts: { targetEnv: string }
  ): { defaultStyleCssFileName: string; defaultStyleCssRules: string };

  export function exportProjectConfig(
    site: any,
    projectName: string,
    projectId: string,
    revision: number,
    projectRevId: string,
    version: string,
    exportOpts: Partial<ExportOpts>,
    indirect?: boolean,
    scheme?: string
  ): ProjectConfig;

  export function computeSerializerSiteContext(site: any): SerializerSiteContext;
}

declare module "@/wab/shared/codegen/codegen-helpers" {
  export class SiteGenHelper {
    constructor(site: any, isStudio: boolean);
    allStyleTokensAndOverrides(): any[];
    allMixins(): any[];
    allImageAssets(): any[];
  }

  export class ComponentGenHelper {
    constructor(siteHelper: SiteGenHelper, resolver: any);
  }
}

declare module "@/wab/shared/codegen/variants" {
  export function exportGlobalVariantGroup(
    group: any,
    opts: { idFileNames: boolean }
  ): { contextFileName: string; contextModule: string };
}

declare module "@/wab/shared/codegen/image-assets" {
  export function exportIconAsset(
    asset: any,
    opts: { idFileNames: boolean }
  ): { fileName: string; module: string };

  export function extractUsedIconAssetsForComponents(
    site: any,
    components: any[]
  ): Set<any>;
}

declare module "@/wab/shared/core/project-deps" {
  export function walkDependencyTree(
    site: any,
    scope: "all" | "direct"
  ): Array<{ site: any; projectId: string; name: string }>;
}

declare module "@/wab/shared/core/styles" {
  export class CssVarResolver {
    constructor(
      tokens: any[],
      mixins: any[],
      assets: any[],
      activeTheme: any,
      opts?: { keepAssetRefs?: boolean; useCssVariables?: boolean }
    );
  }
}

// --- Preview-script mirror dependencies (live-syncer.ts:498-670) ---

declare module "@/wab/shared/codegen/util" {
  /** JSON.stringify-equivalent string literal emitter used by code generators. */
  export function jsLiteral(value: any): string;
  /** Converts an identifier to a valid JS variable name (camelCase, safe chars). */
  export function toVarName(name: string): string;
}

declare module "@/wab/shared/codegen/react-p/serialize-utils" {
  import type { ProjectConfig } from "@/wab/shared/codegen/types";

  export function makeComponentSkeletonIdFileName(component: any): string;
  export function makeCodeComponentHelperSkeletonIdFileName(component: any): string;
  /** `import GlobalContextsProvider from "./PlasmicGlobalContextsProvider"` */
  export function makeGlobalContextsImport(projectConfig: ProjectConfig): string;
  /** Wraps content in `<GlobalContextsProvider>{...}</GlobalContextsProvider>` */
  export function wrapGlobalContexts(content: string): string;
  /** `import {<ProviderName>} from "./<filename>"` per global variant group. */
  export function makeGlobalGroupImports(
    globalGroups: any[],
    opts?: { idFileNames?: boolean }
  ): string;
  /** Prop name Studio sets on the root preview component (`__plasmicIsPreviewRoot`). */
  export function makePlasmicIsPreviewRootComponent(): string;
  /** Wraps content in the group's variant provider binding to an expression. */
  export function wrapGlobalProviderWithCustomValue(
    vg: any,
    content: string,
    curlyBrackets: boolean,
    value: string
  ): string;
}

declare module "@/wab/shared/core/sites" {
  /** Returns global variant groups active for preview, optionally including deps. */
  export function allGlobalVariantGroups(
    site: any,
    opts?: {
      includeDeps?: "all" | "direct";
      excludeEmpty?: boolean;
      excludeMediaQuery?: boolean;
      excludeInactiveScreenVariants?: boolean;
      includeActiveScreenVariantsFromDeps?: boolean;
    }
  ): any[];
}

declare module "@/wab/shared/core/exprs" {
  export interface ExprCtx {
    component: any | null;
    projectFlags: any;
    inStudio: boolean;
  }
  /** Serializes a Plasmic expression node back to raw JS source. */
  export function getRawCode(expr: any, ctx: ExprCtx): string;
  /** Builds a CustomCode whose `code` is wrapped in parens, so that
   *  `isRealCodeExpr` treats it as code to evaluate rather than a JSON literal. */
  export function customCode(code: string, fallback?: any): any;
}

declare module "@/wab/shared/parser-utils" {
  /** Parses JS source with acorn. Throws on a syntax error. */
  export function parseJsCode(code: string): any;
}

declare module "@/wab/shared/devflags" {
  /** Runtime dev-flags bag. Treat fields as optional booleans. */
  export const DEVFLAGS: Record<string, any>;
}

declare module "@/wab/shared/plume/plume-registry" {
  interface PlumeEditorPlugin {
    getArtboardRootDefaultProps?(component: any): Record<string, any> | undefined;
  }
  /** Returns the Plume editor plugin for a component, if any (Select, Button, etc.). */
  export function getPlumeEditorPlugin(component: any): PlumeEditorPlugin | undefined;
}

// --- Dev-host ingestion dependencies (mirrors Studio's
// server/code-components/code-components.ts usage pattern) ---

declare module "@/wab/shared/code-components/code-components" {
  /** Reads registered components/contexts/tokens/traits/functions/libs from
   *  a Window-like object's `__Plasmic*Registry` globals. */
  export class CodeComponentsRegistry {
    constructor(win: unknown, builtins: Record<string, unknown>);
  }
  /** Master orchestrator: type-checks, adds new, fixes missing, refreshes
   *  metas, upserts tokens/functions/libs. Returns a failable result. */
  export function syncCodeComponents(
    ctx: unknown,
    callbacks: unknown,
    opts?: { force?: boolean }
  ): Promise<unknown>;
}

declare module "@/wab/shared/utils/url-utils" {
  /** Substitutes [slug] / [[...catchall]] placeholders in a page path template. */
  export function substituteUrlParams(
    template: string,
    params: Record<string, string>
  ): string;
  /**
   * Matches a URL path against a page path template.
   * `getMatchingPagePathParams("/product/[slug]", "/product/foo")` →
   * `{slug: "foo"}`. Returns `false` when the template doesn't match.
   */
  export function getMatchingPagePathParams(
    pagePath: string,
    lookup: string
  ): Record<string, string> | false;
}
