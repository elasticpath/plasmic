import {
  serializeComponentMeta,
  serializeContextMeta,
  serializeFunctionMeta,
} from "./serialize";
import type {
  FullRegistryResponse,
  SerializedComponentMeta,
  SerializedContextMeta,
  SerializedFunctionMeta,
  TokenRegistration,
  TraitRegistration,
} from "./types";

const g = globalThis as Record<string, unknown>;

/**
 * Reads globalThis.__PlasmicComponentRegistry and returns the full
 * serializable metadata for all registered components.
 *
 * Non-serializable fields (functions, React elements) are stripped.
 * Everything else is preserved so consumers can use any field.
 *
 * This reads from the same global that @plasmicapp/host's
 * registerComponent() writes to — a stable public contract.
 *
 * @returns Array of serialized component metadata (empty if no registrations)
 */
export function getComponentRegistry(): SerializedComponentMeta[] {
  const registry = g.__PlasmicComponentRegistry;

  if (!Array.isArray(registry)) {
    return [];
  }

  return registry.map((entry: unknown) => {
    if (!entry || typeof entry !== "object") {
      return { name: "" };
    }
    const { meta } = entry as { meta?: unknown };
    return serializeComponentMeta(meta);
  });
}

/**
 * Reads globalThis.__PlasmicContextRegistry and returns the full
 * serializable metadata for all registered global contexts.
 *
 * Why: Global contexts provide data to the component tree (e.g.,
 * commerce providers, CMS contexts). The MCP server needs their
 * metadata for understanding provider hierarchy and globalActions.
 *
 * Entry shape: { component, meta } — component ref is discarded.
 *
 * @returns Array of serialized context metadata (empty if no registrations)
 */
export function getContextRegistry(): SerializedContextMeta[] {
  const registry = g.__PlasmicContextRegistry;

  if (!Array.isArray(registry)) {
    return [];
  }

  return registry.map((entry: unknown) => {
    if (!entry || typeof entry !== "object") {
      return { name: "" };
    }
    const { meta } = entry as { meta?: unknown };
    return serializeContextMeta(meta);
  });
}

/**
 * Reads globalThis.__PlasmicFunctionsRegistry and returns the full
 * serializable metadata for all registered custom functions.
 *
 * Why: Custom functions provide data binding and query capabilities.
 * The MCP server needs their signatures for data binding operations.
 *
 * Entry shape: { function, meta } — function ref is discarded.
 *
 * @returns Array of serialized function metadata (empty if no registrations)
 */
export function getFunctionRegistry(): SerializedFunctionMeta[] {
  const registry = g.__PlasmicFunctionsRegistry;

  if (!Array.isArray(registry)) {
    return [];
  }

  return registry.map((entry: unknown) => {
    if (!entry || typeof entry !== "object") {
      return { name: "" };
    }
    const { meta } = entry as { meta?: unknown };
    return serializeFunctionMeta(meta);
  });
}

/**
 * Reads globalThis.__PlasmicTokenRegistry and returns all registered tokens.
 *
 * Why: Design tokens define the visual language (colors, spacing, fonts).
 * The MCP server needs them for design token resolution.
 *
 * Token entries are stored DIRECTLY in the global array (no { meta } wrapper).
 * Tokens are already fully serializable — no stripping needed.
 *
 * @returns Array of token registrations (empty if no registrations)
 */
export function getTokenRegistry(): TokenRegistration[] {
  const registry = g.__PlasmicTokenRegistry;

  if (!Array.isArray(registry)) {
    return [];
  }

  // Tokens are already JSON-safe, but filter out malformed entries
  return registry.filter(
    (entry: unknown): entry is TokenRegistration =>
      !!entry &&
      typeof entry === "object" &&
      typeof (entry as TokenRegistration).name === "string" &&
      typeof (entry as TokenRegistration).value === "string" &&
      typeof (entry as TokenRegistration).type === "string"
  );
}

/**
 * Reads globalThis.__PlasmicTraitRegistry and returns all registered traits.
 *
 * Why: Traits enable trait-based component queries and filtering.
 *
 * Trait entries have shape { trait: string, meta: TraitMeta }.
 * Traits are already fully serializable — no stripping needed.
 * (ChoiceTrait.options is a plain string[], not a function.)
 *
 * @returns Array of trait registrations (empty if no registrations)
 */
export function getTraitRegistry(): TraitRegistration[] {
  const registry = g.__PlasmicTraitRegistry;

  if (!Array.isArray(registry)) {
    return [];
  }

  // Traits are already JSON-safe, but filter out malformed entries
  return registry.filter(
    (entry: unknown): entry is TraitRegistration =>
      !!entry &&
      typeof entry === "object" &&
      typeof (entry as TraitRegistration).trait === "string" &&
      !!(entry as TraitRegistration).meta &&
      typeof (entry as TraitRegistration).meta === "object"
  );
}

/**
 * Reads all five Plasmic global registries and returns them in one response.
 *
 * Why: A single HTTP fetch from the MCP server retrieves all metadata
 * at once — components, contexts, functions, tokens, and traits.
 *
 * @returns Full registry response with all five metadata arrays
 */
export function getFullRegistry(): FullRegistryResponse {
  return {
    components: getComponentRegistry(),
    contexts: getContextRegistry(),
    functions: getFunctionRegistry(),
    tokens: getTokenRegistry(),
    traits: getTraitRegistry(),
  };
}
