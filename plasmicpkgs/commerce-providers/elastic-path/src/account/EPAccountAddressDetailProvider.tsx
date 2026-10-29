/** EPAccountAddressDetailProvider — one saved address from the loaded book. */

import { DataProvider, useSelector } from "@plasmicapp/host";
import registerComponent, {
  CodeComponentMeta,
} from "@plasmicapp/host/registerComponent";
import React from "react";
import type { EpAccountAddress } from "../identity/operations";
import { Registerable } from "../registerable";
import type {
  AccountAddressBookContext,
  AccountAddressDetailData,
} from "./types";

interface EPAccountAddressDetailProviderProps {
  children?: React.ReactNode;
  className?: string;
  addressId?: string;
}

const LOADING_DETAIL: AccountAddressDetailData = {
  status: "loading",
  error: null,
};

const NOT_FOUND_DETAIL: AccountAddressDetailData = {
  status: "not-found",
  error: null,
};

function detailForBook(
  book: AccountAddressBookContext | undefined,
  addressId: string | undefined
): {
  detail: AccountAddressDetailData;
  address?: EpAccountAddress;
  index: number;
} {
  if (!book || book.status === "loading") {
    return { detail: LOADING_DETAIL, index: -1 };
  }
  if (book.status === "error") {
    return {
      detail: { status: "error", error: book.error },
      index: -1,
    };
  }
  const id = typeof addressId === "string" ? addressId.trim() : "";
  const addresses = book.status === "ready" ? book.addresses : [];
  const index = id ? addresses.findIndex((address) => address.id === id) : -1;
  if (index < 0) {
    return { detail: NOT_FOUND_DETAIL, index: -1 };
  }
  return {
    detail: { status: "ready", error: null },
    address: addresses[index],
    index,
  };
}

export const epAccountAddressDetailProviderMeta: CodeComponentMeta<EPAccountAddressDetailProviderProps> =
  {
    name: "plasmic-commerce-ep-account-address-detail-provider",
    displayName: "EP Account Address Detail Provider",
    description:
      "Publishes one saved address from the already-loaded address book as `$ctx.currentAccountAddress`, and `$ctx.accountAddressDetailData` (`status`: `loading | ready | not-found | error`, `error`). Set Address ID from a route or query param. `loading` is the book’s initial read. `not-found` is a resolved book with no matching row, including after that address is deleted. `error` is the book’s own load error. It does not read Elastic Path again, has no actions, and does not navigate. Place inside an EP Account Address Provider.",
    props: {
      addressId: {
        type: "string",
        displayName: "Address ID",
        description:
          "The saved address to show. A blank or unknown id publishes no current address. Use `$ctx.accountAddressDetailData.status` to show a not-found message instead of the edit form.",
      },
      children: {
        type: "slot",
        defaultValue: [
          {
            type: "component",
            name: "plasmic-commerce-ep-account-address-field",
            props: { field: "line_1" },
          },
        ],
      },
    },
    providesData: true,
    importPath: "@elasticpath/plasmic-ep-commerce-elastic-path",
    importName: "EPAccountAddressDetailProvider",
    parentComponentName: "plasmic-commerce-ep-account-address-provider",
  };

export function EPAccountAddressDetailProvider(
  props: EPAccountAddressDetailProviderProps
) {
  const { children, className, addressId } = props;
  const book = useSelector("accountAddresses") as
    | AccountAddressBookContext
    | undefined;
  const { detail, address, index } = detailForBook(book, addressId);

  const body = address ? (
    <DataProvider name="currentAccountAddress" data={address}>
      <DataProvider name="currentAccountAddressIndex" data={index}>
        {children}
      </DataProvider>
    </DataProvider>
  ) : (
    children
  );

  return (
    <div className={className} data-ep-account-address-detail="">
      <DataProvider name="accountAddressDetailData" data={detail}>
        {body}
      </DataProvider>
    </div>
  );
}

export function registerEPAccountAddressDetailProvider(
  loader?: Registerable,
  customMeta?: CodeComponentMeta<EPAccountAddressDetailProviderProps>
) {
  const doRegisterComponent: typeof registerComponent = (...args) =>
    loader ? loader.registerComponent(...args) : registerComponent(...args);
  doRegisterComponent(
    EPAccountAddressDetailProvider,
    customMeta ?? epAccountAddressDetailProviderMeta
  );
}
