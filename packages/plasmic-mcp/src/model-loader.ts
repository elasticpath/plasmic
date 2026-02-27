/**
 * Model loader: fetches a Plasmic project bundle and unbundles it into
 * a live in-memory Site object graph.
 *
 * Key design decisions:
 * - Uses FastBundler.unbundle() directly (NOT tagged-unbundle.ts) to avoid
 *   importing SharedApi.ts which pulls in stripe, data-sources, and window APIs.
 * - Loads dependency packages (depPkgs) before unbundling the main project so
 *   that cross-project component references resolve correctly.
 * - Initializes MobX with enforceActions: "never" before first unbundle, since
 *   the model classes use MobX observables internally.
 *
 * Reference: platform/wab/src/wab/shared/core/bundle-migration-utils.ts
 */

import type { PlasmicApiClient } from "./api-client.js";
import { FastBundler } from "@/wab/shared/bundler";
import { meta } from "@/wab/shared/model/classes-metas";
import * as classesModule from "@/wab/shared/model/classes";
import { trackComponentRoot, trackComponentSite } from "@/wab/shared/core/tpls";

let mobxInitialized = false;

function initMobx(): void {
  if (mobxInitialized) {return;}
  // import-mobx.ts conditionally loads mobx dev build in Node.
  // Our esbuild alias normalizes mobx/dist/mobx.cjs.development.js → mobx
  // so all code uses the same module instance.
  //
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const mobx = require("mobx");
  mobx.configure({ enforceActions: "never" });
  mobxInitialized = true;
  console.error("[plasmic-mcp] MobX initialized (enforceActions: never)");
}

export interface LoadedModel {
  site: any;
  bundler: FastBundler;
  projectName: string;
  /** Current revision number from the API response. */
  revisionNum: number;
  /** Server model version for incremental save requests. */
  modelVersion: number;
  /** Server hostless data version for incremental save requests. */
  hostlessDataVersion: number;
}

/**
 * Parse a dep package's model field, which may be a string or already-parsed object.
 */
function parseDepModel(model: unknown): any {
  if (typeof model === "string") {
    return JSON.parse(model);
  }
  return model;
}

export async function loadProject(
  apiClient: PlasmicApiClient,
  projectId: string
): Promise<LoadedModel> {
  initMobx();

  console.error(`[plasmic-mcp] Fetching project bundle for ${projectId}...`);
  const response = await apiClient.getProjectBundle(projectId);

  const bundleJson = JSON.parse(response.rev.data);
  const projectName = response.project?.name ?? projectId;
  const revisionNum = response.rev.revision;
  const modelVersion = response.modelVersion ?? 0;
  const hostlessDataVersion = response.hostlessDataVersion ?? 0;

  const bundler = new FastBundler(meta, classesModule);

  // Unbundle dependency packages first so cross-project xrefs resolve
  const depPkgs = response.depPkgs ?? [];
  if (depPkgs.length > 0) {
    console.error(
      `[plasmic-mcp] Loading ${depPkgs.length} dependency package(s)...`
    );
    for (const depPkg of depPkgs) {
      const depBundle = parseDepModel(depPkg.model);
      bundler.unbundle(depBundle, depPkg.id);
    }
    console.error(
      `[plasmic-mcp] All dependencies loaded.`
    );
  }

  console.error(`[plasmic-mcp] Unbundling project "${projectName}"...`);
  const result = bundler.unbundle(bundleJson, projectId);

  // Initialize parent tracking for fastBundle (incremental saves).
  // Must be called after unbundle() with the same bundle JSON and UUID.
  bundler.recomputeParents(bundleJson, projectId);

  const site = narrowToSite(result);

  // Register component → root and component → site mappings in the WeakMaps
  // used by TplMgr.ensureBaseVariantSetting() and getOwnerSite().
  // Without this, edit tools cannot determine the base variant for any node.
  const components = site.components ?? [];
  for (const comp of components) {
    trackComponentRoot(comp);
    trackComponentSite(comp, site);
  }

  const componentCount = components.length;
  console.error(
    `[plasmic-mcp] Project loaded: ${componentCount} components`
  );

  return { site, bundler, projectName, revisionNum, modelVersion, hostlessDataVersion };
}

/**
 * Narrow the unbundled result to a Site instance.
 * FastBundler.unbundle() returns a generic ObjInst which may be
 * a Site (for project bundles) or ProjectDependency (for dep bundles).
 * Pattern from bundle-migration-utils.ts.
 */
function narrowToSite(obj: unknown): any {
  if (classesModule.Site.isKnown(obj)) {
    return obj;
  }
  if (classesModule.ProjectDependency.isKnown(obj)) {
    return (obj as any).site;
  }
  throw new Error(
    "Unbundled object is neither a Site nor a ProjectDependency. " +
      "The project bundle may be in an unexpected format."
  );
}
