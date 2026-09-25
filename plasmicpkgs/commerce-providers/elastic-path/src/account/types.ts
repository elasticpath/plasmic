/**
 * Studio-facing account identity published as `$ctx.account`.
 *
 * This is the Provider boundary. Tokens, expiry, and session internals never
 * appear here. Member profile fields (name, email) are not part of this
 * contract. `state` is a derived discriminator — Gate matches slots, not
 * `state` alone.
 */

export type AccountState =
  | "anonymous"
  | "memberOnly"
  | "selected"
  | "lapsed";

export type AccountPreviewState = "auto" | AccountState;

export type AccountRef = {
  id: string;
  name?: string;
};

export type AccountMember = {
  id: string;
};

export type AccountRoster = {
  accounts: AccountRef[];
  total: number;
};

export type AccountContext = {
  state: AccountState;
  accountMember: AccountMember | null;
  selectedAccount: AccountRef | null;
  accountRoster: AccountRoster;
  lapsedAccount: AccountRef | null;
  isLoading: boolean;
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
  | "lapsedAccount.id";
