/**
 * Mock for @/wab/shared/model/classes-metas
 *
 * CLASSES provides constructors for model instances used by edit tools.
 * Each constructor creates a plain object with _type set for type guard checks.
 */

export const meta = {};

/**
 * Model class constructors that create plain objects with _type discriminators.
 * Used by edit-tools.ts to create new RawText and CustomCode instances.
 */
export const CLASSES: Record<string, new (args: any) => any> = {
  RawText: class RawText {
    _type = "RawText";
    text: string;
    markers: any[];
    constructor(args: { text: string; markers?: any[] }) {
      this.text = args.text;
      this.markers = args.markers ?? [];
    }
  } as any,
  CustomCode: class CustomCode {
    _type = "CustomCode";
    code: string;
    fallback: any;
    constructor(args: { code: string; fallback?: any }) {
      this.code = args.code;
      this.fallback = args.fallback ?? null;
    }
  } as any,
};

export const modelSchemaHash = "mock-hash";
