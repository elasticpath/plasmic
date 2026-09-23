/**
 * Studio-facing account identity published as `$ctx.account`.
 *
 * This is the Provider boundary. Tokens, expiry, and session internals never
 * appear here. Member profile fields (name, email) are not part of this
 * contract.
 */

export type AccountState =
  | "anonymous"
  | "authenticated"
  | "selected"
  | "lapsed";

export type AccountPreviewState = "auto" | AccountState;

export type AccountRef = {
  id: string;
  name: string;
};

export type AccountMember = {
  id: string;
};

export type AccountContext = {
  state: AccountState;
  accountMember: AccountMember | null;
  selectedAccount: AccountRef | null;
  accountRoster: AccountRef[];
  lapsedAccount: AccountRef | null;
};

export type AccountGateWhen =
  | "authenticated"
  | "anonymous"
  | "selected"
  | "lapsed";

export type AccountFieldName =
  | "accountMember.id"
  | "selectedAccount.name"
  | "selectedAccount.id"
  | "lapsedAccount.name"
  | "lapsedAccount.id"
  | "state";
