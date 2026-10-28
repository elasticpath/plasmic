import type { EpAccountSummary, EpSessionEnvelope } from "./session-shape";

export interface EpAccountLoginRequest {
  username: string;
  password: string;
  name?: string;
}

export interface EpAccountLoginResult extends EpSessionEnvelope {
  accounts: EpAccountSummary[];
  total: number;
}

export interface EpAccountRegisterRequest {
  username: string;
  password: string;
  name: string;
  email: string;
}

export interface EpAccountRosterResult {
  accounts: EpAccountSummary[];
  /** Across all pages, not the length of `accounts`. */
  total: number;
}

export interface EpAccountRosterRequest {
  limit?: number;
  offset?: number;
}

export interface EpSelectAccountRequest {
  /** `null` deselects. */
  accountId: string | null;
}

/** The authenticated member's profile. `id` is always the session's member id. */
export interface EpAccountMemberResult {
  id: string;
  name?: string;
  email?: string;
}

/** A profile edit. At least one field is required; omitted fields stay unchanged. */
export type EpAccountMemberUpdateRequest =
  | { name: string; email?: string }
  | { email: string; name?: string };

/** One saved address of the selected organisation. */
export interface EpAccountAddress {
  id: string;
  name?: string;
  first_name?: string;
  last_name?: string;
  company_name?: string;
  phone_number?: string;
  instructions?: string;
  line_1?: string;
  line_2?: string;
  city?: string;
  county?: string;
  region?: string;
  postcode?: string;
  country?: string;
}

/** The selected organisation's saved addresses. `total` is `addresses.length`. */
export interface EpAccountAddressResult {
  addresses: EpAccountAddress[];
  total: number;
}

/** The saved address to delete. The server trims `id` and chooses the account. */
export interface EpAccountAddressDeleteRequest {
  id: string;
}

/** A saved address to create. At least one field is required at runtime. */
export interface EpAccountAddressCreateRequest {
  name?: string;
  first_name?: string;
  last_name?: string;
  company_name?: string;
  phone_number?: string;
  instructions?: string;
  line_1?: string;
  line_2?: string;
  city?: string;
  county?: string;
  region?: string;
  postcode?: string;
  country?: string;
}

/**
 * The identity operations. `void` marks one that takes no input; a union with
 * `void` marks one whose input is optional.
 */
export interface EpIdentityOperations {
  getSession: { request: void; response: EpSessionEnvelope | null };
  signInAnonymously: { request: void; response: EpSessionEnvelope };
  refresh: { request: void; response: EpSessionEnvelope };
  login: { request: EpAccountLoginRequest; response: EpAccountLoginResult };
  register: {
    request: EpAccountRegisterRequest;
    response: EpAccountLoginResult;
  };
  roster: {
    request: EpAccountRosterRequest | void;
    response: EpAccountRosterResult;
  };
  selectAccount: {
    request: EpSelectAccountRequest;
    response: EpSessionEnvelope;
  };
  rollAccount: { request: void; response: EpSessionEnvelope };
  logout: { request: void; response: EpSessionEnvelope };
  member: { request: void; response: EpAccountMemberResult };
  accountAddresses: { request: void; response: EpAccountAddressResult };
  createAccountAddress: {
    request: EpAccountAddressCreateRequest;
    response: EpAccountAddress;
  };
  deleteAccountAddress: {
    request: EpAccountAddressDeleteRequest;
    response: { id: string };
  };
  updateMember: {
    request: EpAccountMemberUpdateRequest;
    response: EpAccountMemberResult;
  };
}

export type EpIdentityOperationName = keyof EpIdentityOperations;

export interface EpIdentityRoute {
  readonly path: string;
  readonly method: "GET" | "POST";
}

/**
 * Paths under `/api/ep`, where the auth handler is mounted. `/get-session` is
 * better-auth's own endpoint; the rest are the plugin's, hence the second `/ep`.
 */
export const EP_IDENTITY_ROUTES: {
  readonly [K in EpIdentityOperationName]: EpIdentityRoute;
} = {
  getSession: { path: "/get-session", method: "GET" },
  signInAnonymously: { path: "/ep/anonymous", method: "POST" },
  refresh: { path: "/ep/refresh", method: "POST" },
  login: { path: "/ep/account/login", method: "POST" },
  register: { path: "/ep/account/register", method: "POST" },
  roster: { path: "/ep/account/roster", method: "POST" },
  selectAccount: { path: "/ep/account/select", method: "POST" },
  rollAccount: { path: "/ep/account/roll", method: "POST" },
  logout: { path: "/ep/account/logout", method: "POST" },
  member: { path: "/ep/account/member", method: "POST" },
  accountAddresses: { path: "/ep/account/addresses", method: "POST" },
  createAccountAddress: {
    path: "/ep/account/addresses/create",
    method: "POST",
  },
  deleteAccountAddress: {
    path: "/ep/account/addresses/delete",
    method: "POST",
  },
  updateMember: { path: "/ep/account/member/update", method: "POST" },
};

export const EP_IDENTITY_OPERATION_NAMES = Object.keys(
  EP_IDENTITY_ROUTES
) as EpIdentityOperationName[];

/**
 * What an endpoint returns before `createEpAuthRoutes` redacts it. Session
 * keys stay loose because the stored session is wider than what the client
 * sees; every other key is checked exactly.
 */
export type EpIdentityPayload<K extends EpIdentityOperationName> =
  NonNullable<EpIdentityOperations[K]["response"]> extends EpSessionEnvelope
    ? Omit<
        NonNullable<EpIdentityOperations[K]["response"]>,
        "session" | "user"
      > & { session: Record<string, unknown>; user: Record<string, unknown> }
    : NonNullable<EpIdentityOperations[K]["response"]>;

/** Hands `payload` straight back; the work is the type argument. */
export function epIdentityPayload<K extends EpIdentityOperationName>(
  operation: K,
  payload: EpIdentityPayload<K>
): EpIdentityPayload<K> {
  void operation;
  return payload;
}

type RequestOf<K extends EpIdentityOperationName> =
  EpIdentityOperations[K]["request"];

type ArgsOf<K extends EpIdentityOperationName> = [RequestOf<K>] extends [void]
  ? []
  : void extends RequestOf<K>
  ? [input?: Exclude<RequestOf<K>, void>]
  : [input: RequestOf<K>];

export type EpIdentityClient = {
  [K in EpIdentityOperationName]: (
    ...args: ArgsOf<K>
  ) => Promise<EpIdentityOperations[K]["response"]>;
};
