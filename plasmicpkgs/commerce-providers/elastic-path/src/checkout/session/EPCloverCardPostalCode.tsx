/**
 * EPCloverCardPostalCode — Plasmic component for the Clover postal code iframe field.
 */
import registerComponent, {
  ComponentMeta,
} from "@plasmicapp/host/registerComponent";
import React from "react";
import type { Registerable } from "../../registerable";
import { EPCloverCardFieldInternal } from "./EPCloverCardField";
import type { CloverCardFieldStyleProps } from "./EPCloverCardField";
import { SHARED_STYLE_PROPS } from "./EPCloverCardNumber";

export type EPCloverCardPostalCodeProps = CloverCardFieldStyleProps;

export function EPCloverCardPostalCode(props: EPCloverCardPostalCodeProps) {
  return (
    <EPCloverCardFieldInternal
      {...props}
      fieldType="CARD_POSTAL_CODE"
      designLabel="Postal Code"
    />
  );
}

export const epCloverCardPostalCodeMeta: ComponentMeta<EPCloverCardPostalCodeProps> =
  {
    name: "plasmic-commerce-ep-clover-card-postal-code",
    displayName: "EP Clover Card Postal Code",
    description:
      "Clover postal code input field (PCI-compliant iframe). Place inside EPCloverPayment.",
    props: {
      ...SHARED_STYLE_PROPS,
    },
    importPath: "@elasticpath/plasmic-ep-commerce-elastic-path",
    importName: "EPCloverCardPostalCode",
  };

export function registerEPCloverCardPostalCode(
  loader?: Registerable,
  customMeta?: ComponentMeta<EPCloverCardPostalCodeProps>
) {
  const doRegisterComponent: typeof registerComponent = (...args) =>
    loader ? loader.registerComponent(...args) : registerComponent(...args);
  doRegisterComponent(
    EPCloverCardPostalCode,
    customMeta ?? epCloverCardPostalCodeMeta
  );
}
