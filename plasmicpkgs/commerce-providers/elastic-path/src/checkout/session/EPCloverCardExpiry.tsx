/**
 * EPCloverCardExpiry — Plasmic component for the Clover card expiry iframe field.
 */
import registerComponent, {
  ComponentMeta,
} from "@plasmicapp/host/registerComponent";
import React from "react";
import type { Registerable } from "../../registerable";
import { EPCloverCardFieldInternal } from "./EPCloverCardField";
import type { CloverCardFieldStyleProps } from "./EPCloverCardField";
import { SHARED_STYLE_PROPS } from "./EPCloverCardNumber";

export type EPCloverCardExpiryProps = CloverCardFieldStyleProps;

export function EPCloverCardExpiry(props: EPCloverCardExpiryProps) {
  return (
    <EPCloverCardFieldInternal
      {...props}
      fieldType="CARD_DATE"
      designLabel="MM / YY"
    />
  );
}

export const epCloverCardExpiryMeta: ComponentMeta<EPCloverCardExpiryProps> = {
  name: "plasmic-commerce-ep-clover-card-expiry",
  displayName: "EP Clover Card Expiry",
  description:
    "Clover card expiry input field (PCI-compliant iframe). Place inside EPCloverPayment.",
  props: {
    ...SHARED_STYLE_PROPS,
  },
  importPath: "@elasticpath/plasmic-ep-commerce-elastic-path",
  importName: "EPCloverCardExpiry",
};

export function registerEPCloverCardExpiry(
  loader?: Registerable,
  customMeta?: ComponentMeta<EPCloverCardExpiryProps>
) {
  const doRegisterComponent: typeof registerComponent = (...args) =>
    loader ? loader.registerComponent(...args) : registerComponent(...args);
  doRegisterComponent(
    EPCloverCardExpiry,
    customMeta ?? epCloverCardExpiryMeta
  );
}
