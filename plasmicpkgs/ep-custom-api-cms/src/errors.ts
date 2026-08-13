/**
 * Maps a failed Commerce Extensions response onto an error a designer can act
 * on. Studio surfaces the message in the query panel, so each one has to name
 * the thing to go and change — the wording here is the wording the package
 * documentation uses for the same condition.
 */

export interface EpErrorResponse {
  status: number;
  body?: unknown;
}

export interface EntriesErrorContext {
  customApi: string;
  /**
   * Set for a single-entry read. A 404 then has two possible causes — an unknown
   * Custom API or an unknown entry — and the designer needs to know which
   * identifier to go and check.
   */
  entry?: string;
}

/**
 * Elastic Path reports failures as `{ errors: [{ title, detail }] }`. The
 * detail is the actionable half — for a rejected filter it names the position
 * and token it choked on — so it is surfaced verbatim rather than summarised.
 */
function firstDetail(body: unknown): string | undefined {
  const errors = (body as { errors?: unknown })?.errors;
  if (!Array.isArray(errors) || errors.length === 0) {
    return undefined;
  }
  const detail = (errors[0] as { detail?: unknown }).detail;
  return typeof detail === "string" && detail.trim() ? detail : undefined;
}

export function mapEntriesError(
  res: EpErrorResponse,
  ctx: EntriesErrorContext
): Error {
  if (res.status === 400) {
    const detail = firstDetail(res.body);
    return new Error(
      `Elastic Path rejected the query for Custom API "${ctx.customApi}"` +
        (detail ? `: ${detail}` : ".")
    );
  }
  if (res.status === 401) {
    return new Error(
      "Elastic Path rejected the access token. Check the client id and region host on this query — " +
        "the client id must belong to the store that owns the Custom API."
    );
  }
  if (res.status === 403) {
    return new Error(
      `Elastic Path refused to read Custom API "${ctx.customApi}". Most often the store has not exposed its ` +
        `entries to shoppers — check for a Custom API role policy granting the shopper role list and read ` +
        `permissions on "${ctx.customApi}", and that the client id belongs to that store.`
    );
  }
  if (res.status === 404) {
    if (ctx.entry) {
      const detail = firstDetail(res.body);
      return new Error(
        `Custom API "${ctx.customApi}" has no entry "${ctx.entry}"` +
          (detail ? ` (${detail})` : "") +
          ". Check the identifier this query is bound to — an entry id, or the value of the Custom API's url-slug field."
      );
    }
    return new Error(
      `This store has no Custom API with the slug "${ctx.customApi}". ` +
        "Check the slug in Commerce Manager under Commerce Extensions — it is the slug, not the display name."
    );
  }
  if (res.status === 422) {
    return new Error(
      `Elastic Path timed out reading Custom API "${ctx.customApi}". ` +
        "Narrow the filter or ask for fewer entries — exact-match filters are far cheaper than wildcards on a large Custom API."
    );
  }
  return new Error(
    `Elastic Path rejected the request for Custom API "${ctx.customApi}" (HTTP ${res.status}).`
  );
}
