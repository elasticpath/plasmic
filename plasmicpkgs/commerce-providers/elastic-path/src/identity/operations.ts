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

export interface EpSetCartRequest {
  cartId: string;
}

/**
 * The identity operations. `void` marks one that takes no input; a union with
 * `void` marks one whose input is optional.
 */
export interface EpIdentityOperations {
  getSession: { request: void; response: EpSessionEnvelope | null };
  signInAnonymously: { request: void; response: EpSessionEnvelope };
  refresh: { request: void; response: EpSessionEnvelope };
  setCart: { request: EpSetCartRequest; response: EpSessionEnvelope };
  login: { request: EpAccountLoginRequest; response: EpAccountLoginResult };
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
}

export type EpIdentityOperationName = keyof EpIdentityOperations;

export interface EpIdentityRoute {
  readonly path: string;
  readonly method: "GET" | "POST";
}

/**
 * Paths under the base path the auth handler was mounted at. `/get-session` is
 * better-auth's own endpoint; the rest are the plugin's, hence the second `/ep`.
 */
export const EP_IDENTITY_ROUTES: {
  readonly [K in EpIdentityOperationName]: EpIdentityRoute;
} = {
  getSession: { path: "/get-session", method: "GET" },
  signInAnonymously: { path: "/ep/anonymous", method: "POST" },
  refresh: { path: "/ep/refresh", method: "POST" },
  setCart: { path: "/ep/cart", method: "POST" },
  login: { path: "/ep/account/login", method: "POST" },
  roster: { path: "/ep/account/roster", method: "POST" },
  selectAccount: { path: "/ep/account/select", method: "POST" },
  rollAccount: { path: "/ep/account/roll", method: "POST" },
  logout: { path: "/ep/account/logout", method: "POST" },
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
