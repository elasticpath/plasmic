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
export const isKnownImageAssetRef = (obj: any): boolean =>
  obj?._type === "ImageAssetRef";
export const isKnownStyleTokenRef = (obj: any): boolean =>
  obj?._type === "StyleTokenRef";

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
