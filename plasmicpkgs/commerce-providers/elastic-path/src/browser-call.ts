/** Branch on this rather than message text, which is withheld in production. */
export function readEpErrorCode(err: unknown): string | undefined {
  if (!err || typeof err !== "object") return undefined;
  const code = (err as { code?: unknown }).code;
  return typeof code === "string" && code ? code : undefined;
}
