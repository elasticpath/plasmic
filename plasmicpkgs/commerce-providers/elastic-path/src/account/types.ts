import type { EpAccountAddress } from "../identity/operations";

/**
 * Studio-facing account identity published as `$ctx.account`.
 *
 * This is the Provider boundary. Tokens, expiry, and session internals never
 * appear here. `accountMember` carries the session member id, plus name and
 * email when the account-member read returns that same id. `state` is a
 * derived discriminator — Gate matches slots, not `state` alone.
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
  name?: string;
  email?: string;
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
  isSelecting: boolean;
};

export type AccountGateWhen =
  | "authenticated"
  | "anonymous"
  | "selected"
  | "lapsed";

export type AccountFieldName =
  | "accountMember.id"
  | "accountMember.name"
  | "accountMember.email"
  | "selectedAccount.name"
  | "selectedAccount.id"
  | "lapsedAccount.name"
  | "lapsedAccount.id";

/** `$ctx.accountAddresses.status`. */
export type AccountAddressBookStatus = "loading" | "ready" | "empty" | "error";

export type AccountAddressBookError = {
  code: string;
  message: string;
};

export type AccountAddressBookContext = {
  status: AccountAddressBookStatus;
  addresses: EpAccountAddress[];
  total: number;
  error: AccountAddressBookError | null;
};

/** `$ctx.accountAddressDetailData.status`. Derived from the loaded address book. */
export type AccountAddressDetailStatus =
  | "loading"
  | "ready"
  | "not-found"
  | "error";

export type AccountAddressDetailData = {
  status: AccountAddressDetailStatus;
  error: AccountAddressBookError | null;
};

export type AccountAddressPreviewState =
  | "auto"
  | "withAddresses"
  | "empty"
  | "loading"
  | "error"
  | "noSelectedAccount"
  | "lapsed";

export type AccountAddressFieldName =
  | "name"
  | "first_name"
  | "last_name"
  | "company_name"
  | "phone_number"
  | "instructions"
  | "line_1"
  | "line_2"
  | "city"
  | "county"
  | "region"
  | "postcode"
  | "country";
