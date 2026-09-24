/**
 * EPAccountGate — renders children when `$ctx.account` matches `when`.
 *
 * Consumes the Provider's published account context. It does not know
 * whether that context came from a fixture or (later) live identity.
 * Matching children render with no wrapper so the Gate stays valid
 * inside phrasing content and does not become a layout box.
 */

import { useSelector } from "@plasmicapp/host";
import registerComponent, {
  CodeComponentMeta,
} from "@plasmicapp/host/registerComponent";
import React from "react";
import { Registerable } from "../registerable";
import type { AccountContext, AccountGateWhen } from "./types";

interface EPAccountGateProps {
  children?: React.ReactNode;
  when?: AccountGateWhen;
  className?: string;
}

export const epAccountGateMeta: CodeComponentMeta<EPAccountGateProps> = {
  name: "plasmic-commerce-ep-account-gate",
  displayName: "EP Account Gate",
  description:
    "Renders children when the current `$ctx.account` matches the chosen condition. Drop separate gates for authenticated vs anonymous content. Must be inside an EP Account Provider.",
  props: {
    when: {
      type: "choice",
      options: [
        { label: "Authenticated", value: "authenticated" },
        { label: "Anonymous", value: "anonymous" },
        { label: "Account selected", value: "selected" },
        { label: "Lapsed account", value: "lapsed" },
      ],
      defaultValue: "authenticated",
      displayName: "When",
      description:
        "Authenticated means an account member is present (including when an organisation is selected or lapsed). Anonymous means no member. Account selected and lapsed match those slots independently.",
    },
    children: {
      type: "slot",
      defaultValue: [
        {
          type: "text",
          value: "Account content",
        },
      ],
    },
  },
  importPath: "@elasticpath/plasmic-ep-commerce-elastic-path",
  importName: "EPAccountGate",
  parentComponentName: "plasmic-commerce-ep-account-provider",
  styleSections: false,
};

/**
 * Gate conditions read the published slots, not the `state` discriminator
 * alone, so `authenticated` stays true when a member has a selected or
 * lapsed organisation.
 */
function accountGateMatches(
  account: AccountContext | undefined,
  when: AccountGateWhen
): boolean {
  if (!account) return false;
  switch (when) {
    case "anonymous":
      return account.accountMember == null;
    case "authenticated":
      return account.accountMember != null;
    case "selected":
      return account.selectedAccount != null;
    case "lapsed":
      return account.lapsedAccount != null;
  }
}

export function EPAccountGate(props: EPAccountGateProps) {
  const { children, when = "authenticated" } = props;
  const account = useSelector("account") as AccountContext | undefined;

  if (!accountGateMatches(account, when)) {
    return null;
  }

  return children ?? null;
}

export function registerEPAccountGate(
  loader?: Registerable,
  customMeta?: CodeComponentMeta<EPAccountGateProps>
) {
  const doRegisterComponent: typeof registerComponent = (...args) =>
    loader ? loader.registerComponent(...args) : registerComponent(...args);
  doRegisterComponent(EPAccountGate, customMeta ?? epAccountGateMeta);
}
