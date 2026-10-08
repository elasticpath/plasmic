export interface EpCallErrorInfo {
  message: string;
  code?: string;
  correlationId?: string;
  /** The route sent the failing function's own message. */
  forwarded?: boolean;
}

const forwardedMessageErrors = new WeakSet<Error>();

export function makeEpCallError(info: EpCallErrorInfo): Error {
  const err = new Error(info.message) as Error & {
    code?: string;
    correlationId?: string;
  };
  if (info.code) err.code = info.code;
  if (info.correlationId) err.correlationId = info.correlationId;
  if (info.forwarded) forwardedMessageErrors.add(err);
  return err;
}

/** True when the error's message is the one the failing function raised. */
export function carriesForwardedMessage(err: unknown): err is Error {
  return err instanceof Error && forwardedMessageErrors.has(err);
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
