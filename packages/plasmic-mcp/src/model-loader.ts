/**
 * Model loader: fetches a Plasmic project bundle and unbundles it into
 * a live in-memory Site object graph.
 *
 * Key design decisions:
 * - Uses FastBundler.unbundle() directly (NOT tagged-unbundle.ts) to avoid
 *   importing SharedApi.ts which pulls in stripe, data-sources, and window APIs.
 * - Skips dependency package loading for MVP. Cross-project component references
 *   will be unresolved — acceptable limitation for Milestone 1.
 * - Initializes MobX with enforceActions: "never" before first unbundle, since
 *   the model classes use MobX observables internally.
 *
 * Reference: platform/wab/src/wab/shared/core/bundle-migration-utils.ts
 */

import type { PlasmicApiClient } from "./api-client.js";
import { FastBundler } from "@/wab/shared/bundler";
import { meta } from "@/wab/shared/model/classes-metas";
import * as classesModule from "@/wab/shared/model/classes";

let mobxInitialized = false;

function initMobx(): void {
  if (mobxInitialized) return;
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

  console.error(`[plasmic-mcp] Unbundling project "${projectName}"...`);
  const bundler = new FastBundler(meta, classesModule);
  const result = bundler.unbundle(bundleJson, projectId);

  const site = narrowToSite(result);

  const componentCount = site.components?.length ?? 0;
  console.error(
    `[plasmic-mcp] Project loaded: ${componentCount} components`
  );

  return { site, bundler, projectName };
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
