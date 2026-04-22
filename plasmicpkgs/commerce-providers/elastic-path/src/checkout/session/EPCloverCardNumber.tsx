/**
 * EPCloverCardNumber — Plasmic component for the Clover card number iframe field.
 */
import registerComponent, {
  CodeComponentMeta,
} from "@plasmicapp/host/registerComponent";
import React from "react";
import type { Registerable } from "../../registerable";
import { EPCloverCardFieldInternal } from "./EPCloverCardField";
import type { CloverCardFieldStyleProps } from "./EPCloverCardField";

export type EPCloverCardNumberProps = CloverCardFieldStyleProps;

export function EPCloverCardNumber(props: EPCloverCardNumberProps) {
  return (
    <EPCloverCardFieldInternal
      {...props}
      fieldType="CARD_NUMBER"
      designLabel="Card Number"
    />
  );
}

const SHARED_STYLE_PROPS = {
  placeholder: { type: "string" as const, displayName: "Placeholder" },
  inputFontFamily: {
    type: "string" as const,
    displayName: "Font Family",
    advanced: true,
  },
  inputFontSize: {
    type: "string" as const,
    displayName: "Font Size",
    defaultValue: "16px",
    advanced: true,
  },
  inputColor: {
    type: "string" as const,
    displayName: "Text Color",
    defaultValue: "#333333",
    advanced: true,
  },
  inputPadding: {
    type: "string" as const,
    displayName: "Input Padding",
    defaultValue: "12px",
    advanced: true,
  },
  fieldHeight: {
    type: "string" as const,
    displayName: "Field Height",
    defaultValue: "44px",
    advanced: true,
  },
  fieldBorderColor: {
    type: "string" as const,
    displayName: "Border Color",
    defaultValue: "#d1d5db",
    advanced: true,
  },
  fieldBorderRadius: {
    type: "string" as const,
    displayName: "Border Radius",
    defaultValue: "6px",
    advanced: true,
  },
  errorColor: {
    type: "string" as const,
    displayName: "Error Color",
    defaultValue: "#dc2626",
    advanced: true,
  },
};

export const epCloverCardNumberMeta: CodeComponentMeta<EPCloverCardNumberProps> = {
  name: "plasmic-commerce-ep-clover-card-number",
  displayName: "EP Clover Card Number",
  description:
    "Clover card number input field (PCI-compliant iframe). Place inside EPCloverPayment.",
  props: {
    ...SHARED_STYLE_PROPS,
  },
  importPath: "@elasticpath/plasmic-ep-commerce-elastic-path",
  importName: "EPCloverCardNumber",
};

export function registerEPCloverCardNumber(
  loader?: Registerable,
  customMeta?: CodeComponentMeta<EPCloverCardNumberProps>
) {
  const doRegisterComponent: typeof registerComponent = (...args) =>
    loader ? loader.registerComponent(...args) : registerComponent(...args);
  doRegisterComponent(
    EPCloverCardNumber,
    customMeta ?? epCloverCardNumberMeta
  );
}

// Re-export shared style props for other field components
export { SHARED_STYLE_PROPS };
