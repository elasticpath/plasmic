export interface EpCallErrorInfo {
  message: string;
  code?: string;
  correlationId?: string;
  /** The route sent the failing function's own message. */
  forwarded?: boolean;
  cause?: unknown;
}

const CALL_ERROR_BRAND = Symbol.for(
  "@elasticpath/plasmic-ep-commerce-elastic-path/call-error"
);

interface CallErrorBrand {
  forwarded: boolean;
}

function brandOf(err: unknown): CallErrorBrand | undefined {
  if (!(err instanceof Error)) return undefined;
  const brand = (err as { [CALL_ERROR_BRAND]?: unknown })[CALL_ERROR_BRAND];
  return brand && typeof brand === "object"
    ? (brand as CallErrorBrand)
    : undefined;
}

export function makeEpCallError(info: EpCallErrorInfo): Error {
  const err = new Error(info.message) as Error & {
    code?: string;
    correlationId?: string;
    cause?: unknown;
  };
  if (info.code) err.code = info.code;
  if (info.correlationId) err.correlationId = info.correlationId;
  if (info.cause !== undefined) err.cause = info.cause;
  Object.defineProperty(err, CALL_ERROR_BRAND, {
    value: { forwarded: Boolean(info.forwarded) } satisfies CallErrorBrand,
  });
  return err;
}

/** True when the error's message is the one the failing function raised. */
export function carriesForwardedMessage(err: unknown): err is Error {
  return brandOf(err)?.forwarded === true;
}

/**
 * Maps a server-side failure to a stable code. A code this package already
 * put on the error wins; another library's `code` (for example Node's
 * `ECONNREFUSED`) does not.
 */
export function classifyEpFailure(err: unknown): string {
  if (brandOf(err)) {
    const code = (err as { code?: unknown }).code;
    if (typeof code === "string" && code) return code;
  }
  const message = err instanceof Error ? err.message : String(err ?? "");
  if (/not enough stock|insufficient stock/i.test(message)) {
    return "insufficient_stock";
  }
  if (/no cart on session|no EP session/i.test(message)) {
    return "no_session";
  }
  if (/^epApplyPromoCode:|^epRemovePromoCode:/.test(message)) {
    return "invalid_promo_code";
  }
  return "dispatch_failed";
}

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
      info.forwarded = res.status !== 404 && res.status !== 405;
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
    /* ignore */
  }
  return info;
}
