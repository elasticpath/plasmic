/**
 * Dev Host Variant Sync — fetches code component variant metadata from
 * a running dev host and syncs it into the in-memory site model.
 *
 * Why this exists: The Plasmic persisted project bundle does not contain
 * code component variant data (e.g., "Selected", "Disabled" states).
 * Studio gets this data by connecting to the dev host via iframe. The MCP
 * has no browser, so it fetches the same data via an HTTP API route
 * (`/api/plasmic-registry`) exposed by the `@elasticpath/plasmic-registry`
 * package running in the dev host app.
 *
 * The sync:
 * 1. Fetches the dev host's component registry (full serialized metadata)
 * 2. Extracts only variant-bearing components (~3-5 entries, ~1-3 KB)
 * 3. Populates `codeComponentMeta.variants` on matching code components
 *    (mirrors Studio's `syncCodeComponentsVariants()`)
 * 4. Creates `Variant` objects on wrapper components for each variant key
 *    (mirrors `TplMgr.createCodeComponentVariant()`)
 *
 * Failure is non-fatal — if the dev host is offline, returns 404, or times
 * out, the project still loads normally without CC variant data.
 */

/** Shape of a component entry from the registry API response. */
interface RegistryComponent {
  name: string;
  variants?: Record<string, { cssSelector: string; displayName: string }>;
  [key: string]: unknown;
}

/** Result of a dev host sync attempt. */
export interface SyncResult {
  devHostSynced: boolean;
  syncedVariantComponents: string[];
}

const FETCH_TIMEOUT_MS = 5_000;

/**
 * Fetches the component registry from a dev host's /api/plasmic-registry endpoint.
 *
 * Returns the array of component metadata, or null on any failure (non-fatal).
 * The full response is discarded after extracting the components array —
 * callers should filter to only variant-bearing entries immediately.
 */
export async function fetchDevHostRegistry(
  hostUrl: string
): Promise<RegistryComponent[] | null> {
  const url = normalizeUrl(hostUrl) + "/api/plasmic-registry";
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    let response: Response;
    try {
      response = await fetch(url, { signal: controller.signal });
    } finally {
      clearTimeout(timeout);
    }

    if (!response.ok) {
      console.error(
        `[plasmic-mcp] Dev host sync: ${url} returned ${response.status}`
      );
      return null;
    }

    const data = await response.json();
    if (!data?.components || !Array.isArray(data.components)) {
      console.error(
        `[plasmic-mcp] Dev host sync: malformed response from ${url}`
      );
      return null;
    }

    return data.components as RegistryComponent[];
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(
      `[plasmic-mcp] Dev host sync: failed to fetch ${url}: ${message}`
    );
    return null;
  }
}

/** Remove trailing slashes from a URL. */
function normalizeUrl(url: string): string {
  return url.replace(/\/+$/, "");
}

/** Strip `$dev` suffix from a component name for flexible matching. */
function stripDevSuffix(name: string): string {
  return name.replace(/\$dev$/, "");
}

/**
 * Find a code component in the site model by name, with flexible $dev matching.
 *
 * Tries: exact match → with $dev → without $dev → base name comparison.
 */
function findCodeComponentByName(site: any, registryName: string): any | null {
  const components = site.components ?? [];
  // Exact match first
  for (const comp of components) {
    if (!comp.codeComponentMeta) continue;
    if (comp.name === registryName) return comp;
  }
  // Try $dev suffix variations
  const baseName = stripDevSuffix(registryName);
  for (const comp of components) {
    if (!comp.codeComponentMeta) continue;
    if (stripDevSuffix(comp.name) === baseName) return comp;
  }
  return null;
}

/**
 * Syncs variant metadata from registry components to matching code components
 * in the site model. Mirrors Studio's `syncCodeComponentsVariants()`.
 *
 * Overwrites existing `codeComponentMeta.variants` — dev host is source of truth.
 *
 * @returns Names of code components whose variants were synced.
 */
export function syncVariantMetadata(
  site: any,
  registryComponents: RegistryComponent[]
): string[] {
  const synced: string[] = [];

  for (const regComp of registryComponents) {
    if (!regComp.variants || Object.keys(regComp.variants).length === 0)
      continue;

    const codeComp = findCodeComponentByName(site, regComp.name);
    if (!codeComp) continue;

    // Overwrite codeComponentMeta.variants (mirrors syncCodeComponentsVariants)
    const variantMetas: Record<
      string,
      { cssSelector: string; displayName: string }
    > = {};
    for (const [key, { cssSelector, displayName }] of Object.entries(
      regComp.variants
    )) {
      variantMetas[key] = { cssSelector, displayName };
    }
    codeComp.codeComponentMeta.variants = variantMetas;

    synced.push(codeComp.name);
  }

  return synced;
}

let variantIdCounter = 0;
/** Generate a unique ID for synced variant objects. */
function mkSyncVariantId(): string {
  return `sync-${Date.now()}-${++variantIdCounter}`;
}

/**
 * Find all wrapper components whose tplTree root is a TplComponent
 * referencing the given code component.
 *
 * Checks both `typeTag` (real WAB model instances use a getter) and
 * `_type` (mock/duck-typed objects) for compatibility with both
 * integration and unit test environments.
 */
function findWrapperComponents(site: any, codeComp: any): any[] {
  const wrappers: any[] = [];
  for (const comp of site.components ?? []) {
    const root = comp.tplTree;
    const tag = root?.typeTag ?? root?._type;
    if (tag === "TplComponent" && root.component === codeComp) {
      wrappers.push(comp);
    }
  }
  return wrappers;
}

/**
 * Creates missing Variant objects on wrapper components for each variant key.
 * Mirrors `TplMgr.createCodeComponentVariant()`.
 *
 * Does not duplicate existing variants — checks before creating.
 */
export function ensureVariantObjects(
  site: any,
  registryComponents: RegistryComponent[]
): void {
  for (const regComp of registryComponents) {
    if (!regComp.variants || Object.keys(regComp.variants).length === 0)
      continue;

    const codeComp = findCodeComponentByName(site, regComp.name);
    if (!codeComp) continue;

    // Find wrapper components whose tplTree root references this code component
    const wrappers = findWrapperComponents(site, codeComp);

    for (const wrapper of wrappers) {
      if (!wrapper.variants) wrapper.variants = [];

      for (const key of Object.keys(regComp.variants)) {
        // Check if variant already exists for this key on this wrapper
        const exists = wrapper.variants.some(
          (v: any) =>
            v.codeComponentName === codeComp.name &&
            Array.isArray(v.codeComponentVariantKeys) &&
            v.codeComponentVariantKeys.includes(key)
        );
        if (exists) continue;

        // Create new Variant object (mirrors TplMgr.createCodeComponentVariant)
        const variant = {
          uuid: mkSyncVariantId(),
          name: "",
          codeComponentName: codeComp.name,
          codeComponentVariantKeys: [key],
          selectors: undefined,
          parent: undefined,
          mediaQuery: undefined,
          description: undefined,
          forTpl: undefined,
        };

        wrapper.variants.push(variant);
      }
    }
  }
}

/**
 * Orchestrates the full dev host variant sync.
 *
 * Called from server.ts on `project.set` and `project.refresh`.
 * Non-fatal — returns `{ devHostSynced: false }` on any failure.
 */
export async function syncFromDevHost(
  site: any,
  hostUrl: string | undefined
): Promise<SyncResult> {
  if (!hostUrl) {
    return { devHostSynced: false, syncedVariantComponents: [] };
  }

  console.error(`[plasmic-mcp] Syncing variants from dev host: ${hostUrl}`);

  const components = await fetchDevHostRegistry(hostUrl);
  if (!components) {
    console.error(
      `[plasmic-mcp] Dev host sync: skipped (fetch failed or no data)`
    );
    return { devHostSynced: false, syncedVariantComponents: [] };
  }

  // Filter to only variant-bearing components — discard the rest immediately
  const variantComponents = components.filter(
    (c) => c.variants && Object.keys(c.variants).length > 0
  );

  if (variantComponents.length === 0) {
    console.error(
      `[plasmic-mcp] Dev host sync: no variant-bearing components found`
    );
    return { devHostSynced: true, syncedVariantComponents: [] };
  }

  console.error(
    `[plasmic-mcp] Dev host sync: ${variantComponents.length} variant-bearing component(s) found`
  );

  const syncedNames = syncVariantMetadata(site, variantComponents);
  ensureVariantObjects(site, variantComponents);

  console.error(
    `[plasmic-mcp] Dev host sync complete: synced ${syncedNames.length} component(s): ${syncedNames.join(", ")}`
  );

  return { devHostSynced: true, syncedVariantComponents: syncedNames };
}
