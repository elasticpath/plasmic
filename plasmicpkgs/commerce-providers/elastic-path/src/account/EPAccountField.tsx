/**
 * EPAccountField — displays one shallow `$ctx.account` value.
 *
 * In Studio, a missing `$ctx.account` uses the selected-account mock
 * floor so the field can be styled without a Provider.
 */

import {
  usePlasmicCanvasContext,
  useSelector,
} from "@plasmicapp/host";
import registerComponent, {
  CodeComponentMeta,
} from "@plasmicapp/host/registerComponent";
import React from "react";
import { Registerable } from "../registerable";
import { MOCK_ACCOUNT_SELECTED } from "../utils/design-time-data";
import type { AccountContext, AccountFieldName } from "./types";

interface EPAccountFieldProps {
  field?: AccountFieldName;
  className?: string;
}

export const epAccountFieldMeta: CodeComponentMeta<EPAccountFieldProps> = {
  name: "plasmic-commerce-ep-account-field",
  displayName: "EP Account Field",
  description:
    "Displays one account identity field (member id, selected organisation, lapsed organisation). Place inside an EP Account Provider; Studio uses a sample identity when none is published.",
  props: {
    field: {
      type: "choice",
      options: [
        { label: "Member id", value: "accountMember.id" },
        { label: "Selected account name", value: "selectedAccount.name" },
        { label: "Selected account id", value: "selectedAccount.id" },
        { label: "Lapsed account name", value: "lapsedAccount.name" },
        { label: "Lapsed account id", value: "lapsedAccount.id" },
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
  }
}

export function EPAccountField(props: EPAccountFieldProps) {
  const { field = "selectedAccount.name", className } = props;
  const published = useSelector("account") as AccountContext | undefined;
  const inEditor = !!usePlasmicCanvasContext();
  const account = published ?? (inEditor ? MOCK_ACCOUNT_SELECTED : undefined);

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
