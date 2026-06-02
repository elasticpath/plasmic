export type ExtensionFieldType =
  | "string"
  | "number"
  | "boolean"
  | "null"
  | "array"
  | "object";

export interface ExtensionField {
  key: string;
  label: string;
  value: unknown;
  type: ExtensionFieldType;
  displayValue: string;
}

export interface ExtensionTemplate {
  slug: string;
  label: string;
  fields: ExtensionField[];
  fieldCount: number;
}

export interface ExtensionsData {
  templateCount: number;
  isEmpty: boolean;
}

/** A `{ label, value }` option for a Plasmic `choice` prop. */
export interface ChoiceObject {
  label: string;
  value: string;
}
