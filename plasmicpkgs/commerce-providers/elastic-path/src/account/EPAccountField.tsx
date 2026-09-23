/**
 * EPAccountField — displays one shallow `$ctx.account` value.
 */

import { useSelector } from "@plasmicapp/host";
import registerComponent, {
  CodeComponentMeta,
} from "@plasmicapp/host/registerComponent";
import React from "react";
import { Registerable } from "../registerable";
import type { AccountContext, AccountFieldName } from "./types";

interface EPAccountFieldProps {
  field?: AccountFieldName;
  className?: string;
}

export const epAccountFieldMeta: CodeComponentMeta<EPAccountFieldProps> = {
  name: "plasmic-commerce-ep-account-field",
  displayName: "EP Account Field",
  description:
    "Displays one account identity field (member id, selected organisation, lapsed organisation, state). Must be inside an EP Account Provider.",
  props: {
    field: {
      type: "choice",
      options: [
        { label: "Member id", value: "accountMember.id" },
        { label: "Selected account name", value: "selectedAccount.name" },
        { label: "Selected account id", value: "selectedAccount.id" },
        { label: "Lapsed account name", value: "lapsedAccount.name" },
        { label: "Lapsed account id", value: "lapsedAccount.id" },
        { label: "Account state", value: "state" },
      ],
      defaultValue: "selectedAccount.name",
      displayName: "Field",
    },
  },
  importPath: "@elasticpath/plasmic-ep-commerce-elastic-path",
  importName: "EPAccountField",
  parentComponentName: "plasmic-commerce-ep-account-provider",
};

function accountFieldValue(
  account: AccountContext,
  field: AccountFieldName
): string {
  switch (field) {
    case "accountMember.id":
      return account.accountMember?.id ?? "";
    case "selectedAccount.name":
      return account.selectedAccount?.name ?? "";
    case "selectedAccount.id":
      return account.selectedAccount?.id ?? "";
    case "lapsedAccount.name":
      return account.lapsedAccount?.name ?? "";
    case "lapsedAccount.id":
      return account.lapsedAccount?.id ?? "";
    case "state":
      return account.state;
  }
}

export function EPAccountField(props: EPAccountFieldProps) {
  const { field = "selectedAccount.name", className } = props;
  const account = useSelector("account") as AccountContext | undefined;

  if (!account) return null;

  return (
    <span className={className} data-ep-account-field="">
      {accountFieldValue(account, field)}
    </span>
  );
}

export function registerEPAccountField(
  loader?: Registerable,
  customMeta?: CodeComponentMeta<EPAccountFieldProps>
) {
  const doRegisterComponent: typeof registerComponent = (...args) =>
    loader ? loader.registerComponent(...args) : registerComponent(...args);
  doRegisterComponent(EPAccountField, customMeta ?? epAccountFieldMeta);
}
