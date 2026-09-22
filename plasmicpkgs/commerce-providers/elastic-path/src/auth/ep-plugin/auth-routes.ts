/**
 * Mounts the EP auth handler, redacting credentials from every response.
 *
 *   // app/api/ep/[...path]/route.ts
 *   import { createEpAuthRoutes } from
 *     "@elasticpath/plasmic-ep-commerce-elastic-path/server";
 *   import { epAuth } from "@/lib/ep-auth";
 *
 *   export const { GET, POST } = createEpAuthRoutes(epAuth);
 *
 * Every endpoint on this handler returns the session record, and the
 * session carries the shopper's EP credentials — the anonymous access
 * token on all of them, plus the account-management token once a shopper
 * logs in. Mounting better-auth's `toNextJsHandler` directly therefore
 * hands those to any same-origin script for the cost of one fetch.
 * `/ep/refresh` is the sharpest: it rotates the token and returns the new
 * value, and `/ep/anonymous` needs no cookie at all.
 *
 * The session is filtered to an allowlist rather than stripped of known
 * credential fields, so a field added to the session later is withheld by
 * default instead of leaking until someone notices.
 */
import { toNextJsHandler } from "better-auth/next-js";
import type { EpAuth } from "./create-ep-auth-better";
import { applyAccountLapse } from "./envelope";
import type { EpEnvelopeAccountFields } from "./envelope";
import { RELEASED_SESSION_PATHS } from "../../identity/session-shape";
import type { ReleasedSessionPath } from "../../identity/session-shape";

// The account slots carry the credential beside the id and name, so a
// released path that no longer names a stored field would rot silently.
type AccountGroupPath = Extract<
  ReleasedSessionPath,
  `epAccount.${string}` | `epLapsedAccount.${string}` | "epMemberId"
>;

type StoredAccountPath = {
  [K in keyof EpEnvelopeAccountFields & string]-?: NonNullable<
    EpEnvelopeAccountFields[K]
  > extends object
    ? `${K}.${keyof NonNullable<EpEnvelopeAccountFields[K]> & string}`
    : K;
}[keyof EpEnvelopeAccountFields & string];

type AssertEmpty<T extends never> = T;

export type AssertEveryReleasedAccountPathIsStored = AssertEmpty<
  Exclude<AccountGroupPath, StoredAccountPath>
>;

function readPath(source: any, path: string[]): { found: boolean; value?: unknown } {
  let cursor = source;
  for (const segment of path) {
    if (!cursor || typeof cursor !== "object" || !(segment in cursor)) {
      return { found: false };
    }
    cursor = cursor[segment];
  }
  return { found: true, value: cursor };
}

function writePath(
  target: Record<string, any>,
  path: string[],
  value: unknown
): void {
  let cursor = target;
  for (const segment of path.slice(0, -1)) {
    if (!cursor[segment] || typeof cursor[segment] !== "object") {
      cursor[segment] = {};
    }
    cursor = cursor[segment];
  }
  cursor[path[path.length - 1]] = value;
}

function redactSessionPayload(payload: any): any {
  if (!payload || typeof payload !== "object") return payload;
  const stored = payload.session;
  if (!stored || typeof stored !== "object") return payload;

  const session = applyAccountLapse(stored, Math.floor(Date.now() / 1000));

  const released: Record<string, unknown> = {};
  for (const entry of RELEASED_SESSION_PATHS) {
    const path = entry.split(".");
    const read = readPath(session, path);
    if (read.found) writePath(released, path, read.value);
  }
  return { ...payload, session: released };
}

function withRedaction(
  handler: (request: Request) => Promise<Response>
): (request: Request) => Promise<Response> {
  return async (request: Request) => {
    const response = await handler(request);
    if (!response.ok) return response;

    const cloned = response.clone();
    let payload: any;
    try {
      payload = await cloned.json();
    } catch {
      return response;
    }

    // Rebuilding shrinks the body, so a copied Content-Length would
    // overstate it — a truncated read rather than an error.
    const headers = new Headers(response.headers);
    headers.delete("content-length");

    return new Response(JSON.stringify(redactSessionPayload(payload)), {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  };
}

export function createEpAuthRoutes(epAuth: EpAuth): {
  GET: (request: Request) => Promise<Response>;
  POST: (request: Request) => Promise<Response>;
} {
  const handler = toNextJsHandler(epAuth.handler);
  return {
    GET: withRedaction(handler.GET),
    POST: withRedaction(handler.POST),
  };
}
