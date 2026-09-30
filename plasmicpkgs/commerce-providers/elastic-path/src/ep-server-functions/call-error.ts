/**
 * Error shaping shared by the two browser transports — the session proxy and
 * the session-free design route. Both answer with the same JSON error shape,
 * and callers branch on `code` rather than on message text, which the routes
 * withhold in production.
 */

export interface EpCallErrorInfo {
  message: string;
  code?: string;
  correlationId?: string;
}

export function makeEpCallError(info: EpCallErrorInfo): Error {
  const err = new Error(info.message) as Error & {
    code?: string;
    correlationId?: string;
  };
  if (info.code) err.code = info.code;
  if (info.correlationId) err.correlationId = info.correlationId;
  return err;
}

/**
 * Reads a route's error body into a code/message pair.
 *
 * A storefront that never mounted the route answers with its own 404 page, or
 * with a 405 when a page route sits at that path and refuses the POST. Neither
 * carries a body to read a code out of, and without a code of its own that
 * case is indistinguishable from the route failing — callers can only branch
 * on the code.
 */
export async function readEpCallError(
  res: Response,
  label: string
): Promise<EpCallErrorInfo> {
  const info: EpCallErrorInfo = {
    message: `${label} failed (${res.status})`,
  };
  if (res.status === 404 || res.status === 405) {
    info.code = "route_not_found";
  }
  try {
    const body = (await res.json()) as {
      message?: string;
      code?: string;
      correlationId?: string;
      error?: string | { message?: string };
    };
    if (typeof body.code === "string" && body.code.trim()) {
      info.code = body.code;
    }
    if (typeof body.correlationId === "string" && body.correlationId.trim()) {
      info.correlationId = body.correlationId;
    }
    if (typeof body.message === "string" && body.message.trim()) {
      info.message = body.message;
    } else if (typeof body.error === "string" && body.error.trim()) {
      info.message = body.error;
    } else if (
      body.error &&
      typeof body.error === "object" &&
      typeof body.error.message === "string" &&
      body.error.message.trim()
    ) {
      info.message = body.error.message;
    }
  } catch {
    // ignore parse failures — use status fallback
  }
  return info;
}
