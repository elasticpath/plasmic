/**
 * predictionsSource — autocomplete-core source descriptor for EP query suggestions.
 *
 * Pure factory: takes a `postMultiSearch` callable plus the configured
 * suggestion field name, returns the descriptor `@algolia/autocomplete-core`
 * expects under `sources`. Owns the request-body shape (the `type=autocomplete`
 * multi-search body) and the response → items mapping. Errors from the
 * adapter become an empty list rather than a thrown rejection — autocomplete
 * UI must not crash a search page when the autocomplete collection is missing
 * or the network drops.
 */

export interface PredictionsSourceConfig {
  predictionsField: string;
  postMultiSearch: (body: MultiSearchBody) => Promise<MultiSearchResponse>;
}

export interface MultiSearchBody {
  searches: Array<{
    type: "autocomplete";
    q: string;
    include_fields: string;
    highlight_full_fields: string;
  }>;
}

export interface MultiSearchResponse {
  results?: Array<{ hits?: Array<Record<string, unknown>> }>;
}

export interface PredictionsSourceItem extends Record<string, unknown> {
  _raw: Record<string, unknown>;
}

export interface PredictionsSourceDescriptor {
  sourceId: "predictions";
  getItems: (params: { query: string }) => Promise<PredictionsSourceItem[]>;
}

export function predictionsSource(
  config: PredictionsSourceConfig
): PredictionsSourceDescriptor {
  const { predictionsField, postMultiSearch } = config;

  return {
    sourceId: "predictions",
    async getItems({ query }) {
      try {
        const response = await postMultiSearch({
          searches: [
            {
              type: "autocomplete",
              q: query,
              include_fields: predictionsField,
              highlight_full_fields: predictionsField,
            },
          ],
        });
        const hits = response?.results?.[0]?.hits ?? [];
        return hits.map((hit) => {
          // EP/Typesense responses wrap suggestion fields under `document`
          // and highlight markup under `highlight`. When that shape is
          // present, flatten `document` so designers can bind
          // `$ctx.currentSuggestion.item.q` directly. Otherwise fall back
          // to spreading the hit as-is. The raw hit is preserved on `_raw`
          // either way (e.g. for highlight HTML at `_raw.highlight.q.value`).
          const wrappedDocument =
            hit && typeof hit === "object" && "document" in hit
              ? (hit as { document?: Record<string, unknown> }).document
              : undefined;
          const flattened =
            wrappedDocument && typeof wrappedDocument === "object"
              ? wrappedDocument
              : hit;
          return { ...flattened, _raw: hit };
        });
      } catch {
        return [];
      }
    },
  };
}
