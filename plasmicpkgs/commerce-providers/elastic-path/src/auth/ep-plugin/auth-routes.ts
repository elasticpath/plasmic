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

// Entries are dot-delimited PATHS, not field names. The account
// credential lives inside `epAccount` alongside the organisation's id
// and name, so allowlisting the field would release the credential with
// it; naming paths releases the two readable values and nothing else.
//
// `token` is deliberately absent: it is the better-auth session id, which
// lives in an HttpOnly cookie precisely so scripts cannot read it.
// `epAccount.expires` is withheld too — it is a credential's timestamp,
// and rolling on use makes it close to meaningless anyway.
const SESSION_ALLOWLIST = [
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
];

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
  const raw = payload.session;
  if (!raw || typeof raw !== "object") return payload;

  // Lapse before filtering, not after: the page reads this route rather
  // than `api.getSession`, and `epAccount.expires` is withheld — so a
  // stale selection reported here is one the page cannot possibly work
  // out is dead.
  const session = applyAccountLapse(raw, Math.floor(Date.now() / 1000));

  const kept: Record<string, unknown> = {};
  for (const entry of SESSION_ALLOWLIST) {
    const path = entry.split(".");
    const read = readPath(session, path);
    if (read.found) writePath(kept, path, read.value);
  }
  return { ...payload, session: kept };
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
