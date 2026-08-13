/**
 * Mounts the EP auth handler, redacting credentials from `/get-session`.
 *
 *   // app/api/ep/[...path]/route.ts
 *   import { createEpAuthRoutes } from
 *     "@elasticpath/plasmic-ep-commerce-elastic-path/server";
 *   import { epAuth } from "@/lib/ep-auth";
 *
 *   export const { GET, POST } = createEpAuthRoutes(epAuth);
 *
 * better-auth's `/get-session` returns the whole session record, and this
 * package stores the shopper's EP access token on it. Mounting
 * better-auth's `toNextJsHandler` directly therefore hands that token to
 * any same-origin script for the cost of one fetch — the same exposure
 * the `serverToken` prop used to create, in pull form rather than push.
 *
 * `epCartId` survives: it is not a credential, and the checkout
 * components read it from here.
 */
import { toNextJsHandler } from "better-auth/next-js";
import type { EpAuth } from "./create-ep-auth-better";

const REDACTED_FIELDS = ["epAccessToken", "epClientId", "epHost"];

function redactSessionPayload(payload: any): any {
  if (!payload || typeof payload !== "object") return payload;
  const session = payload.session;
  if (!session || typeof session !== "object") return payload;

  const kept: Record<string, unknown> = {};
  for (const key of Object.keys(session)) {
    if (REDACTED_FIELDS.indexOf(key) === -1) kept[key] = session[key];
  }
  return { ...payload, session: kept };
}

function isGetSession(request: Request): boolean {
  try {
    return new URL(request.url).pathname.endsWith("/get-session");
  } catch {
    return false;
  }
}

function withRedaction(
  handler: (request: Request) => Promise<Response>
): (request: Request) => Promise<Response> {
  return async (request: Request) => {
    const response = await handler(request);
    if (!isGetSession(request) || !response.ok) return response;

    const cloned = response.clone();
    let payload: any;
    try {
      payload = await cloned.json();
    } catch {
      return response;
    }

    return new Response(JSON.stringify(redactSessionPayload(payload)), {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
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
