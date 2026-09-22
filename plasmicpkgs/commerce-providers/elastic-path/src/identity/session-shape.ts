export interface EpAccountSummary {
  id: string;
  name?: string;
}

export interface ReleasedEpSession {
  id: string;
  userId: string;
  expiresAt: string;
  createdAt: string;
  updatedAt: string;
  epCartId?: string;
  epExpires?: number;
  epMemberId?: string;
  epAccount?: EpAccountSummary;
  epLapsedAccount?: EpAccountSummary;
}

export interface ReleasedEpUser {
  id: string;
  email: string;
  emailVerified?: boolean;
  name?: string;
  image?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

export interface EpSessionEnvelope {
  user: ReleasedEpUser;
  session: ReleasedEpSession;
}

/** The paths `createEpAuthRoutes` filters every session-returning response to. */
export const RELEASED_SESSION_PATHS = [
  "id",
  "userId",
  "expiresAt",
  "createdAt",
  "updatedAt",
  "epCartId",
  "epExpires",
  "epMemberId",
  "epAccount.id",
  "epAccount.name",
  "epLapsedAccount.id",
  "epLapsedAccount.name",
] as const;

export type ReleasedSessionPath = (typeof RELEASED_SESSION_PATHS)[number];

// A field with no released path, or a released path with no field, fails the
// `never` constraint below — so no client method can be typed as returning
// something the handler strips. Two levels deep, not recursive: a recursive
// walk here defeats the checker.
type LeafKeys<T> = {
  [K in keyof T & string]-?: NonNullable<T[K]> extends object ? never : K;
}[keyof T & string];

type GroupKeys<T> = {
  [K in keyof T & string]-?: NonNullable<T[K]> extends object ? K : never;
}[keyof T & string];

type DottedPaths<T> =
  | LeafKeys<T>
  | {
      [K in GroupKeys<T>]: `${K}.${LeafKeys<NonNullable<T[K]>>}`;
    }[GroupKeys<T>];

type AssertEmpty<T extends never> = T;

export type AssertEveryFieldIsReleased = AssertEmpty<
  Exclude<DottedPaths<ReleasedEpSession>, ReleasedSessionPath>
>;

export type AssertEveryReleasedPathHasAField = AssertEmpty<
  Exclude<ReleasedSessionPath, DottedPaths<ReleasedEpSession>>
>;
