import { serializeComponentMeta } from "./serialize";
import type { SerializedComponentMeta } from "./types";

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
  const root = globalThis as Record<string, unknown>;
  const registry = root.__PlasmicComponentRegistry;

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
