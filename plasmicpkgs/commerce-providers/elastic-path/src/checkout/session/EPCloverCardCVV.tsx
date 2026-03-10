/**
 * EPCloverCardCVV — Plasmic component for the Clover CVV iframe field.
 */
import registerComponent, {
  ComponentMeta,
} from "@plasmicapp/host/registerComponent";
import React from "react";
import type { Registerable } from "../../registerable";
import { EPCloverCardFieldInternal } from "./EPCloverCardField";
import type { CloverCardFieldStyleProps } from "./EPCloverCardField";
import { SHARED_STYLE_PROPS } from "./EPCloverCardNumber";

export type EPCloverCardCVVProps = CloverCardFieldStyleProps;

export function EPCloverCardCVV(props: EPCloverCardCVVProps) {
  return (
    <EPCloverCardFieldInternal
      {...props}
      fieldType="CARD_CVV"
      designLabel="CVV"
    />
  );
}

export const epCloverCardCVVMeta: ComponentMeta<EPCloverCardCVVProps> = {
  name: "plasmic-commerce-ep-clover-card-cvv",
  displayName: "EP Clover Card CVV",
  description:
    "Clover CVV input field (PCI-compliant iframe). Place inside EPCloverPayment.",
  props: {
    ...SHARED_STYLE_PROPS,
  },
  importPath: "@elasticpath/plasmic-ep-commerce-elastic-path",
  importName: "EPCloverCardCVV",
};

export function registerEPCloverCardCVV(
  loader?: Registerable,
  customMeta?: ComponentMeta<EPCloverCardCVVProps>
) {
  const doRegisterComponent: typeof registerComponent = (...args) =>
    loader ? loader.registerComponent(...args) : registerComponent(...args);
  doRegisterComponent(
    EPCloverCardCVV,
    customMeta ?? epCloverCardCVVMeta
  );
}
