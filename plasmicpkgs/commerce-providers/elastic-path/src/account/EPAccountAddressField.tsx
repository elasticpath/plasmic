/** EPAccountAddressField — displays one value of the current saved address. */

import {
  usePlasmicCanvasContext,
  useSelector,
} from "@plasmicapp/host";
import registerComponent, {
  CodeComponentMeta,
} from "@plasmicapp/host/registerComponent";
import React from "react";
import type { EpAccountAddress } from "../identity/operations";
import { Registerable } from "../registerable";
import { MOCK_ACCOUNT_ADDRESSES } from "../utils/design-time-data";
import type { AccountAddressFieldName } from "./types";

interface EPAccountAddressFieldProps {
  field?: AccountAddressFieldName;
  className?: string;
}

export const epAccountAddressFieldMeta: CodeComponentMeta<EPAccountAddressFieldProps> =
  {
    name: "plasmic-commerce-ep-account-address-field",
    displayName: "EP Account Address Field",
    description:
      "Displays one field of the current saved address. Place inside an EP Account Address List or an EP Account Address Detail Provider. A missing value is blank. The address id is not a display choice.",
    props: {
      field: {
        type: "choice",
        options: [
          { label: "Name", value: "name" },
          { label: "First name", value: "first_name" },
          { label: "Last name", value: "last_name" },
          { label: "Company name", value: "company_name" },
          { label: "Phone number", value: "phone_number" },
          { label: "Instructions", value: "instructions" },
          { label: "Line 1", value: "line_1" },
          { label: "Line 2", value: "line_2" },
          { label: "City", value: "city" },
          { label: "County", value: "county" },
          { label: "Region", value: "region" },
          { label: "Postcode", value: "postcode" },
          { label: "Country", value: "country" },
        ],
        defaultValue: "name",
        displayName: "Field",
      },
    },
    importPath: "@elasticpath/plasmic-ep-commerce-elastic-path",
    importName: "EPAccountAddressField",
    parentComponentName: "plasmic-commerce-ep-account-address-provider",
  };

function addressFieldValue(
  address: EpAccountAddress,
  field: AccountAddressFieldName
): string {
  const value = address[field];
  return typeof value === "string" ? value : "";
}

export function EPAccountAddressField(props: EPAccountAddressFieldProps) {
  const { field = "name", className } = props;
  const current = useSelector("currentAccountAddress") as
    | EpAccountAddress
    | undefined;
  const inEditor = !!usePlasmicCanvasContext();
  const address = current ?? (inEditor ? MOCK_ACCOUNT_ADDRESSES[0] : undefined);

  if (!address) return null;

  return (
    <span className={className} data-ep-account-address-field="">
      {addressFieldValue(address, field)}
    </span>
  );
}

export function registerEPAccountAddressField(
  loader?: Registerable,
  customMeta?: CodeComponentMeta<EPAccountAddressFieldProps>
) {
  const doRegisterComponent: typeof registerComponent = (...args) =>
    loader ? loader.registerComponent(...args) : registerComponent(...args);
  doRegisterComponent(
    EPAccountAddressField,
    customMeta ?? epAccountAddressFieldMeta
  );
}
