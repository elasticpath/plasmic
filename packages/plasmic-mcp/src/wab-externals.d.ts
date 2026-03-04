/**
 * Ambient module declarations for @/wab/* imports.
 *
 * These provide type stubs for `tsc --noEmit` type-checking only.
 * At build time, esbuild resolves these imports to real wab source via its
 * bundle plugin. At test time, vitest resolves them to src/__mocks__/wab-*.ts.
 *
 * Signatures mirror the mock files but without vitest dependencies.
 * Use `any` broadly — real type safety comes from esbuild bundling actual wab source.
 */

// ---------------------------------------------------------------------------
// @/wab/shared/Variants
// ---------------------------------------------------------------------------
declare module "@/wab/shared/Variants" {
  export function mkVariant(opts: {
    name?: string;
    codeComponentName?: string;
    codeComponentVariantKeys?: string[];
    selectors?: string[];
  }): any;
  export function ensureVariantSetting(tpl: any, variants: any[]): any;
  export function tryGetVariantSetting(tpl: any, variants: any[]): any | undefined;
  export function isBaseVariant(variants: any): boolean;
  export function isScreenVariant(variant: any): boolean;
  export function isScreenVariantGroup(group: any): boolean;
  export function isGlobalVariant(variant: any): boolean;
  export function isGlobalVariantGroup(group: any): boolean;
  export function getBaseVariant(component: any): any;
}

// ---------------------------------------------------------------------------
// @/wab/shared/core/tpls
// ---------------------------------------------------------------------------
declare module "@/wab/shared/core/tpls" {
  export const TplTagType: {
    Text: string;
    Image: string;
    Columns: string;
    Column: string;
    Other: string;
  };
  export function mkTplTagX(tag: string, opts?: any, ...children: any[]): any;
  export function mkTplComponentX(params: any): any;
  export function mkTplInlinedText(
    text: string,
    variants: any[],
    tag: string,
    opts?: any
  ): any;
  export function flattenTpls(tplRoot: any): any[];
  export function clone(node: any): any;
  export function isTplTag(x: any): boolean;
  export function trackComponentRoot(comp: any): void;
  export function trackComponentSite(comp: any, site: any): void;
}

// ---------------------------------------------------------------------------
// @/wab/shared/code-components/code-components
// ---------------------------------------------------------------------------
declare module "@/wab/shared/code-components/code-components" {
  export function elementSchemaToTpl(...args: any[]): any;
}

// ---------------------------------------------------------------------------
// @/wab/shared/model/classes
// ---------------------------------------------------------------------------
declare module "@/wab/shared/model/classes" {
  // Type guards
  export function isKnownTplTag(obj: any): boolean;
  export function isKnownTplComponent(obj: any): boolean;
  export function isKnownTplSlot(obj: any): boolean;
  export function isKnownRawText(obj: any): boolean;
  export function isKnownExprText(obj: any): boolean;
  export function isKnownCustomCode(obj: any): boolean;
  export function isKnownRenderExpr(obj: any): boolean;
  export function isKnownVarRef(obj: any): boolean;
  export function isKnownObjectPath(obj: any): boolean;
  export function isKnownImageAsset(obj: any): boolean;
  export function isKnownImageAssetRef(obj: any): boolean;
  export function isKnownStyleTokenRef(obj: any): boolean;
  export function isKnownRep(obj: any): boolean;
  export function isKnownPropParam(obj: any): boolean;
  export function isKnownSlotParam(obj: any): boolean;
  export function isKnownStateParam(obj: any): boolean;
  export function isKnownStateChangeHandlerParam(obj: any): boolean;
  export function isKnownGlobalVariantGroupParam(obj: any): boolean;
  export function isKnownStyleMarker(obj: any): boolean;
  export function isKnownNodeMarker(obj: any): boolean;
  export function isKnownState(obj: any): boolean;
  export function isKnownNamedState(obj: any): boolean;
  export function isKnownEventHandler(obj: any): boolean;
  export function isKnownInteraction(obj: any): boolean;
  export function isKnownComponentDataQuery(obj: any): boolean;
  export function isKnownComponentServerQuery(obj: any): boolean;
  export function isKnownMixin(obj: any): boolean;
  export function isKnownKeyFrame(obj: any): boolean;
  export function isKnownAnimationSequence(obj: any): boolean;
  export function isKnownAnimation(obj: any): boolean;
  export function isKnownTheme(obj: any): boolean;
  export function isKnownThemeStyle(obj: any): boolean;
  export function isKnownThemeLayoutSettings(obj: any): boolean;
  export function isKnownDataToken(obj: any): boolean;
  export function isKnownPageMeta(obj: any): boolean;
  export function isKnownGlobalVariantGroup(obj: any): boolean;
  export function isKnownSplit(obj: any): boolean;
  export function isKnownRandomSplitSlice(obj: any): boolean;
  export function isKnownSegmentSplitSlice(obj: any): boolean;

  // Model classes
  export class CodeComponentVariantMeta {
    _type: string;
    cssSelector: string;
    displayName: string;
    constructor(args: { cssSelector: string; displayName: string });
  }

  export class RawText {
    _type: string;
    text: string;
    markers: any[];
    constructor(args: { text: string; markers: any[] });
  }

  export class CustomCode {
    _type: string;
    code: string;
    fallback: any;
    constructor(args: { code: string; fallback: any });
  }

  export class ExprText {
    _type: string;
    expr: any;
    html: boolean;
    constructor(args: { expr: any; html: boolean });
  }

  export class ObjectPath {
    _type: string;
    path: Array<string | number>;
    fallback: any;
    constructor(args: { path: Array<string | number>; fallback: any });
  }

  export class VarRef {
    _type: string;
    variable: any;
    constructor(args: { variable: any });
  }

  export class RenderExpr {
    _type: string;
    tpl: any[];
    constructor(args: { tpl: any[] });
  }

  export class Var {
    _type: string;
    name: string;
    uuid: string;
    constructor(args: { name: string; uuid: string });
  }

  export class Arg {
    _type: string;
    param: any;
    expr: any;
    constructor(args: { param: any; expr: any });
  }

  export class ImageAsset {
    _type: string;
    uuid: string;
    name: string;
    type: string;
    dataUri: string | null;
    width: number | null;
    height: number | null;
    aspectRatio: number | null;
    constructor(args: {
      uuid: string;
      name: string;
      type: string;
      dataUri?: string | null;
      width?: number | null;
      height?: number | null;
      aspectRatio?: number | null;
    });
  }

  export class ImageAssetRef {
    _type: string;
    asset: any;
    constructor(args: { asset: any });
  }

  export class Rep {
    _type: string;
    element: any;
    index: any;
    collection: any;
    constructor(args: { element: any; index: any; collection: any });
  }

  export class PropParam {
    _type: string;
    variable: any;
    uuid: string;
    type: any;
    constructor(args: any);
  }

  export class StateParam {
    _type: string;
    variable: any;
    uuid: string;
    type: any;
    state: any;
    constructor(args: any);
  }

  export class StateChangeHandlerParam {
    _type: string;
    variable: any;
    uuid: string;
    type: any;
    state: any;
    constructor(args: any);
  }

  export class NamedState {
    _type: string;
    name: string;
    param: any;
    accessType: string;
    variableType: string;
    onChangeParam: any;
    tplNode: any;
    implicitState: any;
    constructor(args: any);
  }

  export class EventHandler {
    _type: string;
    interactions: any[];
    constructor(args: { interactions: any[] });
  }

  export class Interaction {
    _type: string;
    interactionName: string;
    actionName: string;
    args: any[];
    condExpr: any;
    conditionalMode: string;
    uuid: string;
    parent: any;
    constructor(args: any);
  }

  export class NameArg {
    _type: string;
    name: string;
    expr: any;
    constructor(args: { name: string; expr: any });
  }

  export class FunctionExpr {
    _type: string;
    argNames: string[];
    bodyExpr: any;
    constructor(args: { argNames: string[]; bodyExpr: any });
  }

  export class StyleToken {
    _type: string;
    name: string;
    type: string;
    value: string;
    uuid: string;
    variantedValues: any[];
    isRegistered: boolean;
    regKey: any;
    constructor(args: any);
  }

  export class RuleSet {
    _type: string;
    values: Record<string, string>;
    mixins: any[];
    animations: any;
    constructor(args: { values: Record<string, string>; mixins: any[]; animations: any });
  }

  export class StyleMarker {
    _type: string;
    position: number;
    length: number;
    rs: any;
    constructor(args: { position: number; length: number; rs: any });
  }

  export class NodeMarker {
    _type: string;
    position: number;
    length: number;
    tpl: any;
    constructor(args: { position: number; length: number; tpl: any });
  }

  export class Mixin {
    _type: string;
    name: string;
    rs: any;
    preview: string | null;
    uuid: string;
    forTheme: boolean;
    variantedRs: any[];
    constructor(args: any);
  }

  export class KeyFrame {
    _type: string;
    uid: number;
    percentage: number;
    rs: any;
    constructor(args: { percentage: number; rs: any });
  }

  export class AnimationSequence {
    _type: string;
    uid: number;
    name: string;
    uuid: string;
    keyframes: KeyFrame[];
    constructor(args: { name: string; uuid: string; keyframes?: KeyFrame[] });
  }

  export class Animation {
    _type: string;
    uid: number;
    sequence: AnimationSequence;
    duration: string;
    timingFunction: string;
    iterationCount: string;
    direction: string;
    delay: string;
    fillMode: string;
    playState: string;
    constructor(args: any);
  }

  export class ThemeLayoutSettings {
    _type: string;
    uid: number;
    rs: any;
    constructor(args: { rs: any });
  }

  export class ThemeStyle {
    _type: string;
    uid: number;
    selector: string;
    style: any;
    constructor(args: { selector: string; style: any });
  }

  export class Theme {
    _type: string;
    uid: number;
    defaultStyle: any;
    styles: ThemeStyle[];
    layout: ThemeLayoutSettings | null;
    addItemPrefs: Record<string, any>;
    active: boolean;
    constructor(args: any);
  }

  export class DataToken {
    _type: string;
    name: string;
    type: string;
    value: string;
    uuid: string;
    variantedValues: any[];
    isRegistered: boolean;
    regKey: any;
    constructor(args: any);
  }

  export class PageMeta {
    _type: string;
    path: string;
    params: Record<string, string>;
    query: Record<string, string>;
    title: any;
    description: any;
    canonical: any;
    roleId: any;
    openGraphImage: any;
    constructor(args: any);
  }

  export class GlobalVariantGroup {
    _type: string;
    uuid: string;
    param: any;
    variants: any[];
    multi: boolean;
    type: string;
    constructor(args: any);
  }

  export class RandomSplitSlice {
    _type: string;
    uuid: string;
    name: string;
    prob: number;
    contents: any[];
    externalId: any;
    constructor(args: any);
  }

  export class SegmentSplitSlice {
    _type: string;
    uuid: string;
    name: string;
    cond: string;
    contents: any[];
    externalId: any;
    constructor(args: any);
  }

  export class Split {
    _type: string;
    uuid: string;
    name: string;
    splitType: string;
    slices: any[];
    status: string;
    targetEvents: string[];
    description: any;
    externalId: any;
    constructor(args: any);
  }

  export class ComponentDataQuery {
    _type: string;
    uuid: string;
    name: string;
    op: any;
    constructor(args: { uuid: string; name: string; op?: any });
  }

  export class ComponentServerQuery {
    _type: string;
    uuid: string;
    name: string;
    op: any;
    constructor(args: { uuid: string; name: string; op?: any });
  }

  // Type constructors
  export class Text {
    _type: string;
    constructor(args: any);
  }

  export class Num {
    _type: string;
    constructor(args: any);
  }

  export class BoolType {
    _type: string;
    constructor(args: any);
  }

  export class AnyType {
    _type: string;
    constructor(args: any);
  }

  export class HrefType {
    _type: string;
    constructor(args: any);
  }

  export class FunctionType {
    _type: string;
    params: any[];
    constructor(args: any);
  }

  export class ArgType {
    _type: string;
    argName: string;
    displayName: string | null;
    type: any;
    constructor(args: { argName: string; type: any; displayName?: string | null; name?: string });
  }

  export class Site {
    static isKnown(obj: any): boolean;
  }

  export class ProjectDependency {
    static isKnown(obj: any): boolean;
  }

  export const justClasses: { Site: typeof Site; ProjectDependency: typeof ProjectDependency };
}

// ---------------------------------------------------------------------------
// @/wab/shared/model/classes-metas
// ---------------------------------------------------------------------------
declare module "@/wab/shared/model/classes-metas" {
  export const meta: any;
  export const modelSchemaHash: string;
}

// ---------------------------------------------------------------------------
// @/wab/shared/bundler
// ---------------------------------------------------------------------------
declare module "@/wab/shared/bundler" {
  export class FastBundler {
    constructor(meta: any, classes: any);
    unbundle(bundle: any, projectId: string): any;
    bundle(site: any, projectId: string, version?: number): any;
    fastBundle(root: any, uuid: string, changedInsts: any[]): any;
    addrOf(inst: any): { uuid: string; iid: string } | undefined;
    recomputeParents(bundle: any, projectId: string): void;
  }
}

// ---------------------------------------------------------------------------
// @/wab/shared/core/observable-model
// ---------------------------------------------------------------------------
declare module "@/wab/shared/core/observable-model" {
  export interface RecordedChanges {
    changes: any[];
    newInsts: any[];
    removedInsts: any[];
  }

  export interface ModelChange {
    [key: string]: any;
  }

  export class ChangeRecorder {
    constructor(opts: any);
    withRecording(fn: () => void): RecordedChanges;
    dispose(): void;
  }

  export function observeModel(rootInst: any, opts: any): { dispose: () => void };
  export function emptyRecordedChanges(): RecordedChanges;
  export function mergeRecordedChanges(a: RecordedChanges, b: RecordedChanges): RecordedChanges;
}

// ---------------------------------------------------------------------------
// @/wab/shared/model/InstUtil
// ---------------------------------------------------------------------------
declare module "@/wab/shared/model/InstUtil" {
  export class InstUtil {
    constructor(meta: any, realClasses: any);
  }
  export const instUtil: InstUtil;
}

// ---------------------------------------------------------------------------
// @/wab/shared/RuleSetHelpers
// ---------------------------------------------------------------------------
declare module "@/wab/shared/RuleSetHelpers" {
  export class RuleSetHelpers {
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
  export function RSH(rs: any, tpl: any): RuleSetHelpers;
}

// ---------------------------------------------------------------------------
// @/wab/shared/TplMgr
// ---------------------------------------------------------------------------
declare module "@/wab/shared/TplMgr" {
  export class TplMgr {
    constructor(args: { site: any });
    ensureBaseVariantSetting(tpl: any): any;
    ensureBaseVariant(comp: any): any;
    renameComponent(component: any, name: string): void;
    removeComponent(component: any): void;
    createStyleVariant(component: any, selectors?: string[]): any;
    createPrivateStyleVariant(component: any, tpl: any, selectors?: string[]): any;
    createVariantGroup(opts: { component: any; name?: string; optionsType?: string }): any;
    createVariant(component: any, group: any, name?: string): any;
    addStyleToken(opts: any): any;
    renameStyleToken(token: any, name: string): void;
    duplicateStyleToken(token: any): any;
    getUniqueParamName(component: any, name?: string): string;
    renameParam(component: any, param: any, name: string): void;
    removeComponentQuery(component: any, query: any): void;
    removeComponentServerQuery(component: any, query: any): void;
    clearReferencesToRemovedQueries(removedQueries: string[] | string): void;
    reorderChildren(tpl: any, reorderedChildren: any[]): void;
    convertComponentToPage(component: any): void;
    convertPageToComponent(component: any): void;
    changePagePath(page: any, path: string): void;
    addDataToken(opts: any): any;
    renameDataToken(projectId: string, token: any, name: string): void;
    duplicateDataToken(token: any): any;
    createGlobalVariantGroup(name?: string): any;
    createGlobalVariant(group: any, name?: string, extra?: any): any;
    createScreenVariant(opts: any): any;
    removeGlobalVariantGroup(group: any): void;
    updateScreenVariantQuery(variant: any, query: string): void;
    renameVariant(variant: any, name?: string): void;
    renameVariantGroup(group: any, name?: string): void;
    removeSplit(split: any): void;
    addImageAsset(opts: any): any;
    renameImageAsset(asset: any, name: string): void;
    removeImageAsset(asset: any): void;
    attachComponent(component: any, originalComponent?: any, originalComponentSite?: any): void;
    getUniqueComponentName(name?: string): string;
    canExtractComponent(tpl: any): boolean;
    removeState(component: any, state: any): void;
    tryRemoveVariant(variant: any, component: any): void;
    addMixin(name?: string, mixin?: any): any;
    removeMixin(mixin: any): void;
    renameMixin(mixin: any, name: string): void;
    duplicateMixin(mixin: any): any;
    addAnimationSequence(name?: string, animationSequence?: any): any;
    removeAnimationSequence(sequence: any): void;
    renameAnimationSequence(sequence: any, name: string): void;
    duplicateAnimationSequence(sequence: any): any;
    addAnimation(
      sequence: any,
      duration?: string,
      delay?: string,
      timingFunction?: string,
      iterationCount?: string,
      direction?: string,
      fillMode?: string,
      playState?: string
    ): any;
  }

  export function getTplComponentArg(tpl: any, vs: any, argVar: any): any;
  export function setTplComponentArg(tpl: any, vs: any, argVar: any, expr: any): void;
}

// ---------------------------------------------------------------------------
// @/wab/shared/core/undo-util
// ---------------------------------------------------------------------------
declare module "@/wab/shared/core/undo-util" {
  export function undoChanges(changes: any[]): void;
}

// ---------------------------------------------------------------------------
// @/wab/shared/core/components
// ---------------------------------------------------------------------------
declare module "@/wab/shared/core/components" {
  export function extractComponent(opts: any): any;
  export function isReusableComponent(component: any): boolean;
}

// ---------------------------------------------------------------------------
// @/wab/shared/site-invariants
// ---------------------------------------------------------------------------
declare module "@/wab/shared/site-invariants" {
  export function assertSiteInvariants(site: any): void;
}

// ---------------------------------------------------------------------------
// @/wab/shared/core/tagged-unbundle
// ---------------------------------------------------------------------------
declare module "@/wab/shared/core/tagged-unbundle" {
  export function unbundleProjectDependency(
    bundler: any,
    pkgInfo: any,
    depPkgInfos: any[]
  ): { projectDependency: any; depPkgs: any[] };
}

// ---------------------------------------------------------------------------
// @/wab/shared/core/project-deps
// ---------------------------------------------------------------------------
declare module "@/wab/shared/core/project-deps" {
  export function extractTransitiveDepsFromComponentDefaultSlots(
    site: any,
    components: any[],
    depMap?: any
  ): any[];
  export function extractTransitiveHostLessPackages(site: any): any[];
  export function syncGlobalContexts(
    projectDependency: any,
    site: any
  ): void;
  export function upgradeProjectDeps(
    site: any,
    deps: Array<{ oldDep: any; newDep?: any }>
  ): void;
}

// ---------------------------------------------------------------------------
// @/wab/shared/core/sites
// ---------------------------------------------------------------------------
declare module "@/wab/shared/core/sites" {
  export function isHostLessPackage(site: any): boolean;
  export function getNonTransitiveDepDefaultComponents(
    site: any
  ): Record<string, any>;
}
