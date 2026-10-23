/** EPAccountAddressList — repeats children for each saved address. */

import {
  DataProvider,
  repeatedElement,
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
import type { AccountAddressBookContext } from "./types";

interface EPAccountAddressListProps {
  children?: React.ReactNode;
  className?: string;
}

export const epAccountAddressListMeta: CodeComponentMeta<EPAccountAddressListProps> =
  {
    name: "plasmic-commerce-ep-account-address-list",
    displayName: "EP Account Address List",
    description:
      "Repeats children for each saved address. Each row provides currentAccountAddress and currentAccountAddressIndex. Renders no rows while addresses are loading, empty, or failed. Place inside an EP Account Address Provider.",
    props: {
      children: {
        type: "slot",
        defaultValue: [
          {
            type: "vbox",
            children: [
              {
                type: "component",
                name: "plasmic-commerce-ep-account-address-field",
                props: { field: "name" },
              },
              {
                type: "component",
                name: "plasmic-commerce-ep-account-address-field",
                props: { field: "line_1" },
              },
              {
                type: "component",
                name: "plasmic-commerce-ep-account-address-field",
                props: { field: "city" },
              },
              {
                type: "component",
                name: "plasmic-commerce-ep-account-address-field",
                props: { field: "postcode" },
              },
              {
                type: "component",
                name: "plasmic-commerce-ep-account-address-field",
                props: { field: "country" },
              },
            ],
          },
        ],
      },
    },
    importPath: "@elasticpath/plasmic-ep-commerce-elastic-path",
    importName: "EPAccountAddressList",
    parentComponentName: "plasmic-commerce-ep-account-address-provider",
    providesData: true,
  };

export function EPAccountAddressList(props: EPAccountAddressListProps) {
  const { children, className } = props;
  const book = useSelector("accountAddresses") as
    | AccountAddressBookContext
    | undefined;
  const inEditor = !!usePlasmicCanvasContext();
  const addresses: EpAccountAddress[] =
    book?.status === "ready"
      ? book.addresses
      : !book && inEditor
        ? MOCK_ACCOUNT_ADDRESSES
        : [];

  if (addresses.length === 0) return null;

  return (
    <div className={className} role="list" aria-label="Saved addresses">
      {addresses.map((address, i) => (
        <div key={address.id} role="listitem">
          <DataProvider name="currentAccountAddress" data={address}>
            <DataProvider name="currentAccountAddressIndex" data={i}>
              {repeatedElement(i, children)}
            </DataProvider>
          </DataProvider>
        </div>
      ))}
    </div>
  );
}

export function registerEPAccountAddressList(
  loader?: Registerable,
  customMeta?: CodeComponentMeta<EPAccountAddressListProps>
) {
  const doRegisterComponent: typeof registerComponent = (...args) =>
    loader ? loader.registerComponent(...args) : registerComponent(...args);
  doRegisterComponent(
    EPAccountAddressList,
    customMeta ?? epAccountAddressListMeta
  );
}
