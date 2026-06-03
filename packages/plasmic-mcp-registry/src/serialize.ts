import type {
  SerializedComponentMeta,
  SerializedContextMeta,
  SerializedFunctionMeta,
} from "./types";

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

/** JSON-safe descriptor fields worth carrying over when degrading a prop. */
const PRESERVED_PROP_FIELDS = [
  "displayName",
  "description",
  "defaultValue",
  "advanced",
] as const;

/**
 * Degrade `choice` props whose `options` is a function to a plain `string`
 * control.
 *
 * A Plasmic prop control function (dynamic, context-driven options fed via
 * setControlContextData) cannot survive JSON transport: the JSON roundtrip
 * drops the function, leaving a `choice` with no `options` — which is invalid
 * and fatals downstream registration. Since a choice's stored value is a string
 * key either way, a `string` control is the safe degraded form: MCP consumers
 * can still read and write the value, and the live host meta (which keeps the
 * function) still renders the dynamic dropdown in Studio. Static (array)
 * options are left untouched.
 */
function degradeDynamicChoiceProps(props: unknown): unknown {
  if (!props || typeof props !== "object") return props;
  const result: Record<string, unknown> = {};
  for (const [name, descriptor] of Object.entries(
    props as Record<string, unknown>,
  )) {
    const d = descriptor as Record<string, unknown> | null;
    if (
      d &&
      typeof d === "object" &&
      d.type === "choice" &&
      typeof d.options === "function"
    ) {
      const degraded: Record<string, unknown> = { type: "string" };
      for (const key of PRESERVED_PROP_FIELDS) {
        if (key in d && typeof d[key] !== "function") degraded[key] = d[key];
      }
      result[name] = degraded;
    } else {
      result[name] = descriptor;
    }
  }
  return result;
}

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

  // Degrade dynamic (function-options) choice props before the roundtrip so
  // they survive as valid `string` controls instead of invalid empty choices.
  if (filtered.props) {
    filtered.props = degradeDynamicChoiceProps(filtered.props);
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

/**
 * Strips non-serializable fields from a GlobalContextMeta.
 *
 * Context metas have no explicit top-level fields to strip (unlike
 * components which have 6 explicit fields). The `component` ref is at
 * entry level, handled by the reader. JSON roundtrip strips function
 * callbacks in props (hidden, validator, control, etc.) and function-bearing
 * parameter types in globalActions.
 *
 * @param meta - Raw GlobalContextMeta from the host registry
 * @returns Serialized metadata safe for HTTP transport
 */
export function serializeContextMeta(meta: unknown): SerializedContextMeta {
  if (!meta || typeof meta !== "object") {
    return { name: "" };
  }

  const raw = meta as Record<string, unknown>;

  // Filter out top-level functions (shouldn't be any on context metas,
  // but defensive for consistency with component serialization)
  const filtered: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (typeof value === "function") continue;
    filtered[key] = value;
  }

  // Degrade dynamic (function-options) choice props to valid string controls.
  if (filtered.props) {
    filtered.props = degradeDynamicChoiceProps(filtered.props);
  }

  // JSON roundtrip: strips nested function callbacks in props and globalActions
  try {
    const serialized = JSON.parse(JSON.stringify(filtered));
    if (typeof serialized.name !== "string") {
      serialized.name = typeof raw.name === "string" ? raw.name : "";
    }
    return serialized as SerializedContextMeta;
  } catch {
    return { name: typeof raw.name === "string" ? raw.name : "" };
  }
}

/**
 * Strips non-serializable fields from a CustomFunctionMeta.
 *
 * The `function` ref is at entry level (not meta level), handled by the
 * reader. `fnContext` is a callback returning { dataKey, fetcher } — must
 * be explicitly stripped. params array entries may have function fields
 * (control, hidden) — JSON roundtrip handles these.
 *
 * @param meta - Raw CustomFunctionMeta from the host registry
 * @returns Serialized metadata safe for HTTP transport
 */
export function serializeFunctionMeta(meta: unknown): SerializedFunctionMeta {
  if (!meta || typeof meta !== "object") {
    return { name: "" };
  }

  const raw = meta as Record<string, unknown>;

  // Filter out top-level functions and explicitly non-serializable fields.
  // fnContext is the only known non-serializable meta field on CustomFunctionMeta.
  const filtered: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (key === "fnContext") continue;
    if (typeof value === "function") continue;
    filtered[key] = value;
  }

  // JSON roundtrip: strips nested function fields in params (control, hidden)
  try {
    const serialized = JSON.parse(JSON.stringify(filtered));
    if (typeof serialized.name !== "string") {
      serialized.name = typeof raw.name === "string" ? raw.name : "";
    }
    return serialized as SerializedFunctionMeta;
  } catch {
    return { name: typeof raw.name === "string" ? raw.name : "" };
  }
}
