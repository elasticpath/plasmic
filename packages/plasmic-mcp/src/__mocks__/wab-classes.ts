/**
 * Mock for @/wab/shared/model/classes
 *
 * Type guard functions check a _type property on objects.
 * Tests create plain objects with _type set to simulate model class instances.
 */

export const isKnownTplTag = (obj: any): boolean => obj?._type === "TplTag";
export const isKnownTplComponent = (obj: any): boolean =>
  obj?._type === "TplComponent";
export const isKnownTplSlot = (obj: any): boolean =>
  obj?._type === "TplSlot";
export const isKnownRawText = (obj: any): boolean =>
  obj?._type === "RawText";
export const isKnownExprText = (obj: any): boolean =>
  obj?._type === "ExprText";
export const isKnownCustomCode = (obj: any): boolean =>
  obj?._type === "CustomCode";
export const isKnownRenderExpr = (obj: any): boolean =>
  obj?._type === "RenderExpr";
export const isKnownVarRef = (obj: any): boolean => obj?._type === "VarRef";
export const isKnownObjectPath = (obj: any): boolean =>
  obj?._type === "ObjectPath";
export const isKnownImageAsset = (obj: any): boolean =>
  obj?._type === "ImageAsset";
export const isKnownImageAssetRef = (obj: any): boolean =>
  obj?._type === "ImageAssetRef";
export const isKnownStyleTokenRef = (obj: any): boolean =>
  obj?._type === "StyleTokenRef";
export const isKnownRep = (obj: any): boolean => obj?._type === "Rep";
export const isKnownPropParam = (obj: any): boolean =>
  obj?._type === "PropParam";
export const isKnownSlotParam = (obj: any): boolean =>
  obj?._type === "SlotParam";
export const isKnownStateParam = (obj: any): boolean =>
  obj?._type === "StateParam";
export const isKnownStateChangeHandlerParam = (obj: any): boolean =>
  obj?._type === "StateChangeHandlerParam";
export const isKnownGlobalVariantGroupParam = (obj: any): boolean =>
  obj?._type === "GlobalVariantGroupParam";
export const isKnownStyleMarker = (obj: any): boolean =>
  obj?._type === "StyleMarker";
export const isKnownNodeMarker = (obj: any): boolean =>
  obj?._type === "NodeMarker";
export const isKnownState = (obj: any): boolean =>
  obj?._type === "State" || obj?._type === "NamedState" || obj?._type === "VariantGroupState";
export const isKnownNamedState = (obj: any): boolean =>
  obj?._type === "NamedState";

/** Mock constructor for CodeComponentVariantMeta — registered variant metadata. */
export class CodeComponentVariantMeta {
  _type = "CodeComponentVariantMeta";
  cssSelector: string;
  displayName: string;
  constructor(args: { cssSelector: string; displayName: string }) {
    this.cssSelector = args.cssSelector;
    this.displayName = args.displayName;
  }
}

/** Mock constructors for model classes used by edit-tools.ts */
export class RawText {
  _type = "RawText";
  text: string;
  markers: any[];
  constructor(args: { text: string; markers: any[] }) {
    this.text = args.text;
    this.markers = args.markers;
  }
}

export class CustomCode {
  _type = "CustomCode";
  code: string;
  fallback: any;
  constructor(args: { code: string; fallback: any }) {
    this.code = args.code;
    this.fallback = args.fallback;
  }
}

/** Mock constructor for ExprText — dynamic text bound to a code expression. */
export class ExprText {
  _type = "ExprText";
  expr: any;
  html: boolean;
  constructor(args: { expr: any; html: boolean }) {
    this.expr = args.expr;
    this.html = args.html;
  }
}

/** Mock constructor for ObjectPath — structured data path expression. */
export class ObjectPath {
  _type = "ObjectPath";
  path: Array<string | number>;
  fallback: any;
  constructor(args: { path: Array<string | number>; fallback: any }) {
    this.path = args.path;
    this.fallback = args.fallback;
  }
}

/** Mock constructor for VarRef — variable reference. */
export class VarRef {
  _type = "VarRef";
  variable: any;
  constructor(args: { variable: any }) {
    this.variable = args.variable;
  }
}

/** Mock constructor for RenderExpr — slot content containing TplNode children. */
export class RenderExpr {
  _type = "RenderExpr";
  tpl: any[];
  constructor(args: { tpl: any[] }) {
    this.tpl = args.tpl;
  }
}

/** Mock constructor for Var — named variable with unique UUID. */
export class Var {
  _type = "Var";
  name: string;
  uuid: string;
  constructor(args: { name: string; uuid: string }) {
    this.name = args.name;
    this.uuid = args.uuid;
  }
}

/** Mock constructor for VariantsRef — expression referencing variant objects. */
export class VariantsRef {
  _type = "VariantsRef";
  variants: any[];
  constructor(args: { variants: any[] }) {
    this.variants = args.variants;
  }
}

/** Mock constructor for ImageAsset — site-level image with metadata and data URI. */
export class ImageAsset {
  _type = "ImageAsset";
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
  }) {
    this.uuid = args.uuid;
    this.name = args.name;
    this.type = args.type;
    this.dataUri = args.dataUri ?? null;
    this.width = args.width ?? null;
    this.height = args.height ?? null;
    this.aspectRatio = args.aspectRatio ?? null;
  }
}

/** Mock constructor for ImageAssetRef — expression referencing an ImageAsset. */
export class ImageAssetRef {
  _type = "ImageAssetRef";
  asset: any;
  constructor(args: { asset: any }) {
    this.asset = args.asset;
  }
}

/** Mock constructor for Rep — data repetition binding (collection → element/index vars). */
export class Rep {
  _type = "Rep";
  element: any;
  index: any;
  collection: any;
  constructor(args: { element: any; index: any; collection: any }) {
    this.element = args.element;
    this.index = args.index;
    this.collection = args.collection;
  }
}

/** Mock constructor for Arg — parameter argument binding (param → expr). */
export class Arg {
  _type = "Arg";
  param: any;
  expr: any;
  constructor(args: { param: any; expr: any }) {
    this.param = args.param;
    this.expr = args.expr;
  }
}

/** Mock constructor for StyleToken — design token (color, spacing, font, etc.). */
export class StyleToken {
  _type = "StyleToken";
  name: string;
  type: string;
  value: string;
  uuid: string;
  variantedValues: any[];
  isRegistered: boolean;
  regKey: any;
  constructor(args: {
    name: string;
    type: string;
    value: string;
    uuid: string;
    variantedValues?: any[];
    isRegistered?: boolean;
    regKey?: any;
  }) {
    this.name = args.name;
    this.type = args.type;
    this.value = args.value;
    this.uuid = args.uuid;
    this.variantedValues = args.variantedValues ?? [];
    this.isRegistered = args.isRegistered ?? false;
    this.regKey = args.regKey ?? undefined;
  }
}

/** Mock constructor for PropParam — component prop definition. */
export class PropParam {
  _type = "PropParam";
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
  constructor(args: any) {
    this.variable = args.variable;
    this.uuid = args.uuid;
    this.type = args.type;
    this.advanced = args.advanced ?? false;
    this.enumValues = args.enumValues ?? [];
    this.origin = args.origin ?? null;
    this.exportType = args.exportType ?? "External";
    this.defaultExpr = args.defaultExpr ?? null;
    this.previewExpr = args.previewExpr ?? null;
    this.propEffect = args.propEffect ?? null;
    this.description = args.description ?? null;
    this.displayName = args.displayName ?? null;
    this.about = args.about ?? null;
    this.isRepeated = args.isRepeated ?? null;
    this.isMainContentSlot = args.isMainContentSlot ?? false;
    this.required = args.required ?? false;
    this.mergeWithParent = args.mergeWithParent ?? false;
    this.isLocalizable = args.isLocalizable ?? false;
  }
}

/** Mock type constructors — used by addProp to create type objects for params. */
export class Text {
  _type = "Text";
  name = "text";
  constructor(_args: any) {}
}

export class Num {
  _type = "Num";
  name = "num";
  constructor(_args: any) {}
}

export class BoolType {
  _type = "BoolType";
  name = "bool";
  constructor(_args: any) {}
}

export class AnyType {
  _type = "AnyType";
  name = "any";
  constructor(_args: any) {}
}

export class HrefType {
  _type = "HrefType";
  name = "href";
  constructor(_args: any) {}
}

export class FunctionType {
  _type = "FunctionType";
  name = "func";
  params: any[];
  constructor(args: any) {
    this.params = args.params ?? [];
  }
}

/** Mock constructor for ArgType — function parameter descriptor. */
export class ArgType {
  _type = "ArgType";
  name = "arg";
  argName: string;
  displayName: string | null;
  type: any;
  constructor(args: { argName: string; type: any; displayName?: string | null }) {
    this.argName = args.argName;
    this.type = args.type;
    this.displayName = args.displayName ?? null;
  }
}

/** Mock constructor for RuleSet — CSS property values + mixins. */
export class RuleSet {
  _type = "RuleSet";
  values: Record<string, string>;
  mixins: any[];
  animations: any;
  constructor(args: { values: Record<string, string>; mixins: any[]; animations: any }) {
    this.values = args.values ?? {};
    this.mixins = args.mixins ?? [];
    this.animations = args.animations ?? null;
  }
}

/** Mock constructor for StyleMarker — CSS formatting on a text range. */
export class StyleMarker {
  _type = "StyleMarker";
  position: number;
  length: number;
  rs: any;
  constructor(args: { position: number; length: number; rs: any }) {
    this.position = args.position;
    this.length = args.length;
    this.rs = args.rs;
  }
}

/** Mock constructor for NodeMarker — inline TplTag element (link, code) in text. */
export class NodeMarker {
  _type = "NodeMarker";
  position: number;
  length: number;
  tpl: any;
  constructor(args: { position: number; length: number; tpl: any }) {
    this.position = args.position;
    this.length = args.length;
    this.tpl = args.tpl;
  }
}

/** Mock constructor for StateParam — state value parameter (extends Param pattern). */
export class StateParam {
  _type = "StateParam";
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
  constructor(args: any) {
    this.variable = args.variable;
    this.uuid = args.uuid;
    this.type = args.type;
    this.state = args.state ?? null;
    this.enumValues = args.enumValues ?? [];
    this.origin = args.origin ?? null;
    this.exportType = args.exportType ?? "ToolsOnly";
    this.defaultExpr = args.defaultExpr ?? null;
    this.previewExpr = args.previewExpr ?? null;
    this.propEffect = args.propEffect ?? null;
    this.description = args.description ?? null;
    this.displayName = args.displayName ?? null;
    this.about = args.about ?? null;
    this.isRepeated = args.isRepeated ?? null;
    this.isMainContentSlot = args.isMainContentSlot ?? false;
    this.required = args.required ?? false;
    this.mergeWithParent = args.mergeWithParent ?? false;
    this.isLocalizable = args.isLocalizable ?? false;
  }
}

/** Mock constructor for StateChangeHandlerParam — state onChange handler. */
export class StateChangeHandlerParam {
  _type = "StateChangeHandlerParam";
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
  constructor(args: any) {
    this.variable = args.variable;
    this.uuid = args.uuid;
    this.type = args.type;
    this.state = args.state ?? null;
    this.enumValues = args.enumValues ?? [];
    this.origin = args.origin ?? null;
    this.exportType = args.exportType ?? "ToolsOnly";
    this.defaultExpr = args.defaultExpr ?? null;
    this.previewExpr = args.previewExpr ?? null;
    this.propEffect = args.propEffect ?? null;
    this.description = args.description ?? null;
    this.displayName = args.displayName ?? null;
    this.about = args.about ?? null;
    this.isRepeated = args.isRepeated ?? null;
    this.isMainContentSlot = args.isMainContentSlot ?? false;
    this.required = args.required ?? false;
    this.mergeWithParent = args.mergeWithParent ?? false;
    this.isLocalizable = args.isLocalizable ?? false;
  }
}

/** Mock constructor for NamedState — named state variable on a component. */
export class NamedState {
  _type = "NamedState";
  name: string;
  param: any;
  accessType: string;
  variableType: string;
  onChangeParam: any;
  tplNode: any;
  implicitState: any;
  constructor(args: any) {
    this.name = args.name;
    this.param = args.param;
    this.accessType = args.accessType ?? "private";
    this.variableType = args.variableType ?? "text";
    this.onChangeParam = args.onChangeParam;
    this.tplNode = args.tplNode ?? null;
    this.implicitState = args.implicitState ?? null;
  }
}

/** Mock constructor for EventHandler — event handler expression containing interactions. */
export class EventHandler {
  _type = "EventHandler";
  interactions: any[];
  constructor(args: { interactions: any[] }) {
    this.interactions = args.interactions ?? [];
  }
}

/** Mock constructor for Interaction — single action step within an EventHandler. */
export class Interaction {
  _type = "Interaction";
  interactionName: string;
  actionName: string;
  args: any[];
  condExpr: any;
  conditionalMode: string;
  uuid: string;
  parent: any;
  constructor(args: any) {
    this.interactionName = args.interactionName;
    this.actionName = args.actionName;
    this.args = args.args ?? [];
    this.condExpr = args.condExpr ?? null;
    this.conditionalMode = args.conditionalMode ?? "always";
    this.uuid = args.uuid;
    this.parent = args.parent;
  }
}

/** Mock constructor for NameArg — named argument binding (name → expr). */
export class NameArg {
  _type = "NameArg";
  name: string;
  expr: any;
  constructor(args: { name: string; expr: any }) {
    this.name = args.name;
    this.expr = args.expr;
  }
}

/** Mock constructor for FunctionExpr — anonymous function expression (for runCode actions). */
export class FunctionExpr {
  _type = "FunctionExpr";
  argNames: string[];
  bodyExpr: any;
  constructor(args: { argNames: string[]; bodyExpr: any }) {
    this.argNames = args.argNames ?? [];
    this.bodyExpr = args.bodyExpr;
  }
}

export const isKnownEventHandler = (obj: any): boolean =>
  obj?._type === "EventHandler" || obj?._type === "GenericEventHandler";
export const isKnownInteraction = (obj: any): boolean =>
  obj?._type === "Interaction";

/** Mock constructor for ComponentDataQuery — client-side data query on a component. */
export class ComponentDataQuery {
  _type = "ComponentDataQuery";
  uuid: string;
  name: string;
  op: any;
  constructor(args: { uuid: string; name: string; op?: any }) {
    this.uuid = args.uuid;
    this.name = args.name;
    this.op = args.op ?? null;
  }
}

/** Mock constructor for ComponentServerQuery — server-side query on a component. */
export class ComponentServerQuery {
  _type = "ComponentServerQuery";
  uuid: string;
  name: string;
  op: any;
  constructor(args: { uuid: string; name: string; op?: any }) {
    this.uuid = args.uuid;
    this.name = args.name;
    this.op = args.op ?? null;
  }
}

export const isKnownComponentDataQuery = (obj: any): boolean =>
  obj?._type === "ComponentDataQuery";
export const isKnownComponentServerQuery = (obj: any): boolean =>
  obj?._type === "ComponentServerQuery";
export const isKnownMixin = (obj: any): boolean =>
  obj?._type === "Mixin";

/** Mock constructor for Mixin — reusable style bundle stored at site level. */
export class Mixin {
  _type = "Mixin";
  name: string;
  rs: any;
  preview: string | null;
  uuid: string;
  forTheme: boolean;
  variantedRs: any[];
  constructor(args: {
    name: string;
    rs: any;
    preview?: string | null;
    uuid: string;
    forTheme?: boolean;
    variantedRs?: any[];
  }) {
    this.name = args.name;
    this.rs = args.rs;
    this.preview = args.preview ?? null;
    this.uuid = args.uuid;
    this.forTheme = args.forTheme ?? false;
    this.variantedRs = args.variantedRs ?? [];
  }
}

export const isKnownKeyFrame = (obj: any): boolean =>
  obj?._type === "KeyFrame";
export const isKnownAnimationSequence = (obj: any): boolean =>
  obj?._type === "AnimationSequence";
export const isKnownAnimation = (obj: any): boolean =>
  obj?._type === "Animation";

/** Mock constructor for KeyFrame — a percentage stop in an animation sequence. */
export class KeyFrame {
  _type = "KeyFrame";
  uid: number;
  percentage: number;
  rs: any;
  constructor(args: { percentage: number; rs: any }) {
    this.uid = Math.floor(Math.random() * 1e9);
    this.percentage = args.percentage;
    this.rs = args.rs;
  }
}

/** Mock constructor for AnimationSequence — site-level named @keyframes definition. */
export class AnimationSequence {
  _type = "AnimationSequence";
  uid: number;
  name: string;
  uuid: string;
  keyframes: KeyFrame[];
  constructor(args: { name: string; uuid: string; keyframes?: KeyFrame[] }) {
    this.uid = Math.floor(Math.random() * 1e9);
    this.name = args.name;
    this.uuid = args.uuid;
    this.keyframes = args.keyframes ?? [];
  }
}

/** Mock constructor for Animation — element-level application of an AnimationSequence with timing. */
export class Animation {
  _type = "Animation";
  uid: number;
  sequence: AnimationSequence;
  duration: string;
  timingFunction: string;
  iterationCount: string;
  direction: string;
  delay: string;
  fillMode: string;
  playState: string;
  constructor(args: {
    sequence: AnimationSequence;
    duration?: string;
    timingFunction?: string;
    iterationCount?: string;
    direction?: string;
    delay?: string;
    fillMode?: string;
    playState?: string;
  }) {
    this.uid = Math.floor(Math.random() * 1e9);
    this.sequence = args.sequence;
    this.duration = args.duration ?? "1s";
    this.timingFunction = args.timingFunction ?? "ease";
    this.iterationCount = args.iterationCount ?? "1";
    this.direction = args.direction ?? "normal";
    this.delay = args.delay ?? "0s";
    this.fillMode = args.fillMode ?? "none";
    this.playState = args.playState ?? "running";
  }
}

export const isKnownTheme = (obj: any): boolean =>
  obj?._type === "Theme";
export const isKnownThemeStyle = (obj: any): boolean =>
  obj?._type === "ThemeStyle";
export const isKnownThemeLayoutSettings = (obj: any): boolean =>
  obj?._type === "ThemeLayoutSettings";

/** Mock constructor for ThemeLayoutSettings — layout defaults. */
export class ThemeLayoutSettings {
  _type = "ThemeLayoutSettings";
  uid: number;
  rs: any;
  constructor(args: { rs: any }) {
    this.uid = Math.floor(Math.random() * 1e9);
    this.rs = args.rs;
  }
}

/** Mock constructor for ThemeStyle — per-selector CSS override within a theme. */
export class ThemeStyle {
  _type = "ThemeStyle";
  uid: number;
  selector: string;
  style: any; // Mixin
  constructor(args: { selector: string; style: any }) {
    this.uid = Math.floor(Math.random() * 1e9);
    this.selector = args.selector;
    this.style = args.style;
  }
}

/** Mock constructor for Theme — a site-level theme with typography and per-tag overrides. */
export class Theme {
  _type = "Theme";
  uid: number;
  defaultStyle: any; // Mixin
  styles: ThemeStyle[];
  layout: ThemeLayoutSettings | null;
  addItemPrefs: Record<string, any>;
  active: boolean;
  constructor(args: {
    defaultStyle: any;
    styles?: ThemeStyle[];
    layout?: ThemeLayoutSettings | null;
    addItemPrefs?: Record<string, any>;
    active?: boolean;
  }) {
    this.uid = Math.floor(Math.random() * 1e9);
    this.defaultStyle = args.defaultStyle;
    this.styles = args.styles ?? [];
    this.layout = args.layout ?? null;
    this.addItemPrefs = args.addItemPrefs ?? {};
    this.active = args.active ?? false;
  }
}

export const isKnownDataToken = (obj: any): boolean =>
  obj?._type === "DataToken";

/** Mock constructor for DataToken — site-level JSON data value. */
export class DataToken {
  _type = "DataToken";
  name: string;
  type = "Data" as const;
  value: string;
  uuid: string;
  variantedValues: any[];
  isRegistered: boolean;
  regKey: any;
  constructor(args: {
    name: string;
    value?: string;
    uuid: string;
    variantedValues?: any[];
    isRegistered?: boolean;
    regKey?: any;
  }) {
    this.name = args.name;
    this.value = args.value ?? "null";
    this.uuid = args.uuid;
    this.variantedValues = args.variantedValues ?? [];
    this.isRegistered = args.isRegistered ?? false;
    this.regKey = args.regKey ?? undefined;
  }
}

export const isKnownPageMeta = (obj: any): boolean =>
  obj?._type === "PageMeta";

/** Mock constructor for PageMeta — page-level SEO and routing metadata. */
export class PageMeta {
  _type = "PageMeta";
  path: string;
  params: Record<string, string>;
  query: Record<string, string>;
  title: any;
  description: any;
  canonical: any;
  roleId: any;
  openGraphImage: any;
  constructor(args: {
    path: string;
    params?: Record<string, string>;
    query?: Record<string, string>;
    title?: any;
    description?: any;
    canonical?: any;
    roleId?: any;
    openGraphImage?: any;
  }) {
    this.path = args.path;
    this.params = args.params ?? {};
    this.query = args.query ?? {};
    this.title = args.title ?? null;
    this.description = args.description ?? "";
    this.canonical = args.canonical ?? null;
    this.roleId = args.roleId ?? null;
    this.openGraphImage = args.openGraphImage ?? null;
  }
}

export const isKnownGlobalVariantGroup = (obj: any): boolean =>
  obj?._type === "GlobalVariantGroup";

/** Mock constructor for GlobalVariantGroup — site-level variant group (custom or screen breakpoints). */
export class GlobalVariantGroup {
  _type = "GlobalVariantGroup";
  uuid: string;
  param: any;
  variants: any[];
  multi: boolean;
  type: string;
  constructor(args: {
    uuid: string;
    param: any;
    variants?: any[];
    multi?: boolean;
    type?: string;
  }) {
    this.uuid = args.uuid;
    this.param = args.param;
    this.variants = args.variants ?? [];
    this.multi = args.multi ?? false;
    this.type = args.type ?? "global-user-defined";
  }
}

export const isKnownSplit = (obj: any): boolean =>
  obj?._type === "Split";
export const isKnownRandomSplitSlice = (obj: any): boolean =>
  obj?._type === "RandomSplitSlice";
export const isKnownSegmentSplitSlice = (obj: any): boolean =>
  obj?._type === "SegmentSplitSlice";

/** Mock constructor for RandomSplitSlice — probability-based A/B test bucket. */
export class RandomSplitSlice {
  _type = "RandomSplitSlice";
  uuid: string;
  name: string;
  prob: number;
  contents: any[];
  externalId: any;
  constructor(args: { uuid: string; name: string; prob: number; contents?: any[]; externalId?: any }) {
    this.uuid = args.uuid;
    this.name = args.name;
    this.prob = args.prob;
    this.contents = args.contents ?? [];
    this.externalId = args.externalId ?? null;
  }
}

/** Mock constructor for SegmentSplitSlice — condition-based segment bucket. */
export class SegmentSplitSlice {
  _type = "SegmentSplitSlice";
  uuid: string;
  name: string;
  cond: string;
  contents: any[];
  externalId: any;
  constructor(args: { uuid: string; name: string; cond?: string; contents?: any[]; externalId?: any }) {
    this.uuid = args.uuid;
    this.name = args.name;
    this.cond = args.cond ?? "{}";
    this.contents = args.contents ?? [];
    this.externalId = args.externalId ?? null;
  }
}

/** Mock constructor for Split — A/B test or segment definition. */
export class Split {
  _type = "Split";
  uuid: string;
  name: string;
  splitType: string;
  slices: any[];
  status: string;
  targetEvents: string[];
  description: any;
  externalId: any;
  constructor(args: {
    uuid: string;
    name: string;
    splitType?: string;
    slices?: any[];
    status?: string;
    targetEvents?: string[];
    description?: any;
    externalId?: any;
  }) {
    this.uuid = args.uuid;
    this.name = args.name;
    this.splitType = args.splitType ?? "experiment";
    this.slices = args.slices ?? [];
    this.status = args.status ?? "new";
    this.targetEvents = args.targetEvents ?? [];
    this.description = args.description ?? null;
    this.externalId = args.externalId ?? null;
  }
}

export class Site {
  static isKnown(obj: any): boolean {
    return obj?._type === "Site";
  }
}

export class ProjectDependency {
  static isKnown(obj: any): boolean {
    return obj?._type === "ProjectDependency";
  }
}

export const justClasses = { Site, ProjectDependency };
