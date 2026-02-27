import type { SerializedComponentMeta } from "./types";

/**
 * Top-level CodeComponentMeta fields that are always non-serializable
 * (functions, React elements, or objects containing functions).
 */
const NON_SERIALIZABLE_TOP_LEVEL_FIELDS = new Set([
  "figmaPropsTransform",
  "treeLabel",
  "componentHelpers",
  "refActions",
  "actions",
  "templates",
]);

/**
 * Strips non-serializable fields from a CodeComponentMeta.
 *
 * Preserves all JSON-safe fields including prop type descriptors,
 * states, variants, display metadata, etc. Functions and React elements
 * are stripped — JSON.parse(JSON.stringify()) naturally removes functions
 * and undefined values while preserving all declarative data.
 *
 * @param meta - Raw CodeComponentMeta from the host registry
 * @returns Serialized metadata safe for HTTP transport
 */
export function serializeComponentMeta(meta: unknown): SerializedComponentMeta {
  if (!meta || typeof meta !== "object") {
    return { name: "" };
  }

  const raw = meta as Record<string, unknown>;

  // Build a clean object excluding known non-serializable fields.
  // JSON roundtrip handles nested functions (e.g., hidden callbacks in props)
  // by naturally omitting them.
  const filtered: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (NON_SERIALIZABLE_TOP_LEVEL_FIELDS.has(key)) continue;
    if (typeof value === "function") continue;
    filtered[key] = value;
  }

  // JSON roundtrip: strips remaining nested functions, Symbols, undefined.
  // React elements (which have Symbol $$typeof) lose their type identity.
  try {
    const serialized = JSON.parse(JSON.stringify(filtered));
    // Ensure name is always present
    if (typeof serialized.name !== "string") {
      serialized.name = typeof raw.name === "string" ? raw.name : "";
    }
    return serialized as SerializedComponentMeta;
  } catch {
    // Fallback for circular references or other JSON errors
    return { name: typeof raw.name === "string" ? raw.name : "" };
  }
}
