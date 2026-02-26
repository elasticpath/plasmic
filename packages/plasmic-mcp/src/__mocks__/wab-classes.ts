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
