import tracer from "dd-trace";
import { logger } from "@/wab/server/observability";
import { isStampedIgnoreError } from "@/wab/shared/error-handling";

const ignoredErrorMessages = [
  "CSRF token mismatch",
  "Connection closed before response fulfilled",
  "Query runner already released",
];

function shouldIgnoreErrorByMessage(message: string) {
  return ignoredErrorMessages.some((pattern) => message.includes(pattern));
}

function shouldIgnoreError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }
  if (shouldIgnoreErrorByMessage(error.message || "")) {
    return true;
  }
  if (isStampedIgnoreError(error)) {
    return true;
  }
  return false;
}

/**
 * Capture an exception and attach it to the active Datadog span.
 * Falls back to logging if no span is active.
 */
export function captureException(
  error: unknown,
  context?: Record<string, unknown>
) {
  const err = error instanceof Error ? error : new Error(String(error));

  if (shouldIgnoreError(err)) {
    return;
  }

  logger().error(`captureException: ${err.message}`, context as any);

  const span = tracer.scope().active();
  if (span) {
    span.setTag("error", true);
    span.setTag("error.message", err.message);
    span.setTag("error.stack", err.stack);
    if (context) {
      for (const [key, value] of Object.entries(context)) {
        span.setTag(`error.context.${key}`, String(value));
      }
    }
  }
}

/**
 * Capture a message (non-error event) and attach it to the active Datadog span.
 */
export function captureMessage(
  message: string,
  context?: Record<string, unknown>
) {
  if (shouldIgnoreErrorByMessage(message)) {
    return;
  }

  logger().warn(message, context as any);

  const span = tracer.scope().active();
  if (span) {
    span.setTag("event.message", message);
    if (context) {
      for (const [key, value] of Object.entries(context)) {
        span.setTag(`event.context.${key}`, String(value));
      }
    }
  }
}

/**
 * Capture an exception with additional breadcrumb context.
 * Replaces the Sentry.withScope() pattern.
 */
export function captureExceptionWithScope(
  error: unknown,
  breadcrumbs: Record<string, unknown>
) {
  captureException(error, breadcrumbs);
}
