/**
 * Field discovery by sampling.
 *
 * The definition endpoints that would describe a Custom API's fields refuse
 * implicit tokens (see docs/adr/0001), but an entry carries its custom fields
 * flat at the top level — so one entry is enough to recover the field names a
 * designer needs when writing a filter.
 */

export interface SampledField {
  name: string;
  type: string;
}

/**
 * Keys Elastic Path puts on every entry. None of them is a custom field, and
 * the timestamps a designer might look for are nested inside `meta` rather than
 * sitting at the top level.
 */
const ENVELOPE_KEYS = new Set(["id", "type", "links", "meta"]);

export function fieldsFromSample(entries: unknown[]): SampledField[] {
  const [sample] = entries;
  if (!sample || typeof sample !== "object") {
    return [];
  }

  const entry = sample as Record<string, unknown>;
  return Object.keys(entry)
    .filter((name) => !ENVELOPE_KEYS.has(name))
    .map((name) => ({ name, type: inferType(entry[name]) }));
}

/**
 * The filter parameter's hint. Help text cannot be derived from sampled data —
 * only a hint can — so this is where the field names have to land, which is also
 * where the designer is typing.
 */
export function filterHint(fields: SampledField[]): string {
  if (fields.length === 0) {
    return "eq(status,published) — combine conditions with a colon";
  }

  const named = fields.map((f) => `${f.name} (${f.type})`).join(", ");
  return `eq(field,value) — from a sample entry: ${named}`;
}

/**
 * What the JSON can tell us, and no more: Elastic Path's integer and float both
 * arrive as a JSON number, and a null value hides its field's type entirely.
 */
function inferType(value: unknown): string {
  if (value === null || value === undefined) {
    return "unknown";
  }
  if (Array.isArray(value)) {
    return "list";
  }
  const type = typeof value;
  return type === "object" ? "unknown" : type;
}
