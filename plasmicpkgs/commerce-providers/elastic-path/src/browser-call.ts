declare global {
  interface Window {
    /**
     * Absolute origin of the consumer's app, for when the code runs at a
     * different origin than the app — Studio's data-query preview. Unset
     * means a relative URL, which is the same-origin canvas-iframe case.
     */
    __epProxyOrigin?: string;
  }
}

export function resolveConsumerOrigin(): string {
  if (typeof window === "undefined") return "";
  const pinned = window.__epProxyOrigin;
  return pinned ? pinned.replace(/\/$/, "") : "";
}

/** Branch on this rather than message text, which is withheld in production. */
export function readEpErrorCode(err: unknown): string | undefined {
  if (!err || typeof err !== "object") return undefined;
  const code = (err as { code?: unknown }).code;
  return typeof code === "string" && code ? code : undefined;
}
