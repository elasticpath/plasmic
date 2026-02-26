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
