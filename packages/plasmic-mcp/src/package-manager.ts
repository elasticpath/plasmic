/**
 * Hostless package management — add, remove, upgrade, and list project dependencies.
 *
 * Reuses WAB shared functions (unbundle, project-deps, sites) for all model
 * mutations. Validation logic mirrors Studio's ProjectDependencyManager to
 * ensure identical error messages and behaviour.
 *
 * Functions accept explicit dependencies (apiClient, session objects) rather
 * than importing singletons, matching the established edit-tools.ts pattern.
 */

import type { PlasmicApiClient } from "./api-client.js";
import { requireSession } from "./session.js";
import { TplMgr } from "@/wab/shared/TplMgr";
import { unbundleProjectDependency } from "@/wab/shared/core/tagged-unbundle";
import {
  extractTransitiveDepsFromComponentDefaultSlots,
  extractTransitiveHostLessPackages,
  syncGlobalContexts,
  upgradeProjectDeps,
} from "@/wab/shared/core/project-deps";
import {
  isHostLessPackage,
  getNonTransitiveDepDefaultComponents,
} from "@/wab/shared/core/sites";
import { isReusableComponent } from "@/wab/shared/core/components";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PackageInfo {
  name: string;
  pkgId: string;
  projectId: string;
  version: string;
  isHostLess: boolean;
  latestVersion?: string;
}

export interface AddPackageResult {
  name: string;
  pkgId: string;
  version: string;
  componentCount: number;
}

export interface RemovePackageResult {
  name: string;
  pkgId: string;
  version: string;
}

export interface UpgradePackageResult {
  name: string;
  pkgId: string;
  oldVersion: string;
  newVersion: string;
}

// ---------------------------------------------------------------------------
// list-packages
// ---------------------------------------------------------------------------

/**
 * List all direct project dependencies with optional latest-version lookup.
 *
 * Reads `site.projectDependencies` and optionally fetches the latest published
 * version metadata from the server for each package, so callers can see which
 * packages have available updates.
 */
export async function listPackages(
  apiClient: PlasmicApiClient
): Promise<PackageInfo[]> {
  const session = requireSession();
  const deps: any[] = session.site.projectDependencies ?? [];

  const results: PackageInfo[] = [];

  for (const dep of deps) {
    const info: PackageInfo = {
      name: dep.name ?? dep.site?.name ?? "Unknown",
      pkgId: dep.pkgId,
      projectId: dep.projectId,
      version: dep.version,
      isHostLess: dep.site ? isHostLessPackage(dep.site) : false,
    };

    // Try to fetch latest version metadata (non-fatal if it fails)
    try {
      const meta = await apiClient.getPkgVersionMeta(dep.pkgId);
      info.latestVersion = meta.pkg.version;
    } catch {
      // Server may not have metadata for all packages — skip silently
    }

    results.push(info);
  }

  return results;
}

// ---------------------------------------------------------------------------
// add-package
// ---------------------------------------------------------------------------

/**
 * Add a hostless package to the current project by its source project ID.
 *
 * Replicates Studio's `ProjectDependencyManager.addByProjectId()`:
 * 1. Self-import check
 * 2. Fetch published package info
 * 3. Already-imported check
 * 4. Auth-enabled dependency check
 * 5. Download full PkgVersion bundle + transitive deps
 * 6. Unbundle into ProjectDependency model
 * 7. Circular dependency + version conflict checks
 * 8. Mutate site model (push dep, extract transitives, sync contexts)
 */
export async function addPackage(
  apiClient: PlasmicApiClient,
  sourceProjectId: string
): Promise<AddPackageResult> {
  const session = requireSession();
  const site = session.site;
  const bundler = session.bundler;

  // 1. Self-import check
  if (sourceProjectId === session.projectId) {
    throw new Error("You cannot import the current project.");
  }

  // 2. Fetch published package info
  const { pkg: maybePkg } = await apiClient.getPkgByProjectId(sourceProjectId);
  if (!maybePkg) {
    throw new Error(
      `Project "${sourceProjectId}" has no published versions.`
    );
  }
  const pkg = maybePkg;

  // 3. Already-imported check
  const existingDeps: any[] = site.projectDependencies ?? [];
  if (existingDeps.some((d: any) => d.pkgId === pkg.id)) {
    throw new Error(`"${pkg.name}" has already been imported.`);
  }

  // 4. Auth-enabled dependency check
  const authConfig = await apiClient.getAppAuthPubConfig(sourceProjectId);
  if (authConfig.isAuthEnabled) {
    throw new Error(
      `You cannot import "${pkg.name}" because it has auth enabled.`
    );
  }

  // 5. Fetch own package info for circular dependency checking
  let myPkg: { id: string } | undefined;
  try {
    const { pkg: maybeMyPkg } = await apiClient.getPkgByProjectId(
      session.projectId
    );
    myPkg = maybeMyPkg;
  } catch {
    // Current project may not be published — that's fine, no circular check needed
  }

  // 6. Download full PkgVersion bundle + transitive dep bundles
  const { pkg: latest, depPkgs } = await apiClient.getPkgVersion(pkg.id);

  // 7. Unbundle into ProjectDependency model
  const { projectDependency, depPkgs: depPkgVersions } =
    unbundleProjectDependency(bundler, latest, depPkgs);

  // 8. Circular dependency + version conflict checks
  canAddDependency(site, projectDependency, myPkg);

  // 9. Mutate site model
  addDependencyToSite(site, projectDependency);

  // Count available components
  const depComponents = (projectDependency.site?.components ?? []).filter(
    (c: any) => isReusableComponent(c)
  );

  return {
    name: projectDependency.name ?? pkg.name,
    pkgId: projectDependency.pkgId ?? pkg.id,
    version: projectDependency.version ?? latest.version,
    componentCount: depComponents.length,
  };
}

// ---------------------------------------------------------------------------
// remove-package
// ---------------------------------------------------------------------------

/**
 * Remove a package from the current project by pkgId or package name.
 *
 * Replicates Studio's `ProjectDependencyManager.removeByPkgId()`:
 * 1. Find the dependency by pkgId or name
 * 2. Check for hostless package dependents
 * 3. Remove via TplMgr
 */
export async function removePackage(
  apiClient: PlasmicApiClient,
  pkgIdOrName: string
): Promise<RemovePackageResult> {
  const session = requireSession();
  const site = session.site;
  const deps: any[] = site.projectDependencies ?? [];

  // Find by pkgId first, then by name
  const dep =
    deps.find((d: any) => d.pkgId === pkgIdOrName) ??
    deps.find(
      (d: any) =>
        (d.name ?? "").toLowerCase() === pkgIdOrName.toLowerCase()
    );

  if (!dep) {
    throw new Error(
      `Package "${pkgIdOrName}" is not installed. Use project.list-packages to see installed packages.`
    );
  }

  // Check for hostless dependents
  const dependents = getHostLessPackageDependents(site, dep.pkgId);
  if (dependents.length > 0) {
    const depNames = dependents
      .map((d: any) => d.name ?? d.pkgId)
      .join(", ");
    throw new Error(
      `Cannot remove "${dep.name ?? dep.pkgId}" because it is a dependency of: ${depNames}`
    );
  }

  // Remove via TplMgr
  const tplMgr = new TplMgr({ site });
  (tplMgr as any).removeProjectDep?.(dep) ??
    removeProjectDepManually(site, dep);

  return {
    name: dep.name ?? "Unknown",
    pkgId: dep.pkgId,
    version: dep.version,
  };
}

// ---------------------------------------------------------------------------
// upgrade-package
// ---------------------------------------------------------------------------

/**
 * Upgrade one or all packages to their latest published versions.
 *
 * When pkgId is provided, upgrades only that package.
 * When pkgId is omitted, upgrades all outdated packages.
 *
 * Replicates Studio's upgrade flow:
 * 1. Identify packages to upgrade
 * 2. Download new PkgVersion bundles
 * 3. Unbundle into ProjectDependency models
 * 4. Call upgradeProjectDeps for atomic model remapping
 */
export async function upgradePackage(
  apiClient: PlasmicApiClient,
  pkgId?: string
): Promise<UpgradePackageResult[]> {
  const session = requireSession();
  const site = session.site;
  const bundler = session.bundler;
  const deps: any[] = site.projectDependencies ?? [];

  // Identify packages to upgrade
  const depsToCheck = pkgId
    ? deps.filter((d: any) => d.pkgId === pkgId)
    : deps;

  if (pkgId && depsToCheck.length === 0) {
    throw new Error(
      `Package "${pkgId}" is not installed. Use project.list-packages to see installed packages.`
    );
  }

  // Check which packages have newer versions available
  const upgradeCandidates: Array<{
    oldDep: any;
    latestVersion: string;
    latestPkgVersionInfo: any;
    latestDepPkgs: any[];
  }> = [];

  for (const dep of depsToCheck) {
    try {
      const meta = await apiClient.getPkgVersionMeta(dep.pkgId);
      if (meta.pkg.version !== dep.version) {
        // Download full bundle for upgrade
        const { pkg: latest, depPkgs: latestDepPkgs } =
          await apiClient.getPkgVersion(dep.pkgId);
        upgradeCandidates.push({
          oldDep: dep,
          latestVersion: meta.pkg.version,
          latestPkgVersionInfo: latest,
          latestDepPkgs,
        });
      }
    } catch {
      // Skip packages that can't be fetched
      console.error(
        `[plasmic-mcp] Could not fetch latest version for pkg ${dep.pkgId}, skipping upgrade`
      );
    }
  }

  // Single package requested but already at latest
  if (pkgId && upgradeCandidates.length === 0) {
    const dep = depsToCheck[0];
    throw new Error(
      `"${dep.name ?? pkgId}" is already at latest version (${dep.version}).`
    );
  }

  // Batch: nothing to upgrade
  if (!pkgId && upgradeCandidates.length === 0) {
    return [];
  }

  // Unbundle new versions and build upgrade pairs
  const upgradePairs: Array<{ oldDep: any; newDep: any }> = [];
  const results: UpgradePackageResult[] = [];

  for (const candidate of upgradeCandidates) {
    const { projectDependency: newDep } = unbundleProjectDependency(
      bundler,
      candidate.latestPkgVersionInfo,
      candidate.latestDepPkgs
    );

    upgradePairs.push({
      oldDep: candidate.oldDep,
      newDep,
    });

    results.push({
      name: candidate.oldDep.name ?? candidate.oldDep.pkgId,
      pkgId: candidate.oldDep.pkgId,
      oldVersion: candidate.oldDep.version,
      newVersion: candidate.latestVersion,
    });
  }

  // Pre-flight: check for transitive version conflicts (mirrors Studio's ensureCanUpgradeDeps)
  ensureCanUpgradeDeps(site, upgradePairs.map((p) => p.newDep));

  // Perform atomic upgrade via WAB shared function
  upgradeProjectDeps(site, upgradePairs);

  return results;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Pre-upgrade conflict detector. Simulates the post-upgrade dependency tree
 * (substituting new deps for old) and BFS-walks the full transitive graph to
 * verify no package appears at two different versions.
 *
 * Mirrors Studio's `ProjectDependencyManager.ensureCanUpgradeDeps`.
 */
function ensureCanUpgradeDeps(site: any, targetDeps: any[]): void {
  const result: Record<string, any> = {};
  const directDeps: any[] = site.projectDependencies ?? [];

  // Build the starting queue: substitute new deps where applicable
  const queue: any[] = directDeps.map((d: any) => {
    const replacement = targetDeps.find((t: any) => t.pkgId === d.pkgId);
    return replacement ?? d;
  });

  while (queue.length > 0) {
    const dep = queue.shift()!;
    if (!dep.pkgId) continue;

    if (result[dep.pkgId]) {
      if (result[dep.pkgId].version !== dep.version) {
        throw new Error(
          `Upgrading '${dep.name ?? dep.pkgId}' (${dep.projectId ?? dep.pkgId}) failed due to conflicting dependencies. ` +
            `${dep.name ?? dep.pkgId} has two conflicting versions: ${dep.version} and ${result[dep.pkgId].version}. ` +
            `Please reconcile these versions before trying again.`
        );
      }
      continue;
    }

    result[dep.pkgId] = dep;
    const transitiveDeps: any[] = dep.site?.projectDependencies ?? [];
    queue.push(...transitiveDeps);
  }
}

/**
 * Validate that a dependency can be added without creating circular deps
 * or version conflicts. Mirrors Studio's `canAddDependency`.
 */
function canAddDependency(
  site: any,
  dep: any,
  myPkg?: { id: string }
): void {
  const localDepMap = buildDependencyMap(site);
  const importedDepMap = buildDependencyMap(dep);

  for (const pkgId in importedDepMap) {
    // Circular dependency check
    if (myPkg && pkgId === myPkg.id) {
      throw new Error(
        `Importing "${dep.name ?? dep.projectId}" failed because of a circular dependency: ` +
          `it depends on a package that depends on the current project.`
      );
    }

    // Version conflict check
    if (
      localDepMap[pkgId] &&
      localDepMap[pkgId] !== importedDepMap[pkgId]
    ) {
      throw new Error(
        `Importing "${dep.name ?? dep.projectId}" failed due to conflicting dependencies: ` +
          `package ${pkgId} is required at version ${importedDepMap[pkgId]} ` +
          `but version ${localDepMap[pkgId]} is already installed.`
      );
    }
  }
}

/**
 * Build a map of pkgId → version from a site or dependency's dependency tree.
 */
function buildDependencyMap(siteOrDep: any): Record<string, string> {
  const map: Record<string, string> = {};
  const deps: any[] =
    siteOrDep.projectDependencies ??
    siteOrDep.site?.projectDependencies ??
    [];

  for (const dep of deps) {
    if (dep.pkgId) {
      map[dep.pkgId] = dep.version;
    }
    // Recurse into transitive deps
    const transitive = buildDependencyMap(dep);
    Object.assign(map, transitive);
  }

  return map;
}

/**
 * Mutate site model to add a dependency, including transitive deps,
 * global contexts, and default components. Mirrors Studio's `addDependency`.
 */
function addDependencyToSite(site: any, projectDependency: any): void {
  // Push the new dependency
  if (!site.projectDependencies) {
    site.projectDependencies = [];
  }
  site.projectDependencies.push(projectDependency);

  // Extract and add transitive deps (default slot contents + hostless packages)
  const reusableComponents = (projectDependency.site?.components ?? []).filter(
    (c: any) => isReusableComponent(c)
  );

  const transitiveDeps = [
    ...extractTransitiveDepsFromComponentDefaultSlots(
      site,
      reusableComponents
    ),
    ...extractTransitiveHostLessPackages(site),
  ];

  // Deduplicate and add transitive deps not already present
  const existingPkgIds = new Set(
    site.projectDependencies.map((d: any) => d.pkgId)
  );
  for (const dep of transitiveDeps) {
    if (dep.pkgId && !existingPkgIds.has(dep.pkgId)) {
      site.projectDependencies.push(dep);
      existingPkgIds.add(dep.pkgId);
    }
  }

  // Sync global contexts from the imported project
  syncGlobalContexts(projectDependency, site);

  // Copy default components from the dependency
  const depDefaults = getNonTransitiveDepDefaultComponents(
    projectDependency.site
  );
  if (!site.defaultComponents) {
    site.defaultComponents = {};
  }
  // Dep defaults go first, existing site defaults take precedence
  site.defaultComponents = { ...depDefaults, ...site.defaultComponents };
}

/**
 * Find hostless packages that depend on the given pkgId.
 * Mirrors Studio's `getHostLessPackageDependents`.
 */
function getHostLessPackageDependents(
  site: any,
  targetPkgId: string
): any[] {
  const deps: any[] = site.projectDependencies ?? [];
  return deps.filter((dep: any) => {
    if (!dep.site || !isHostLessPackage(dep.site)) return false;
    if (dep.pkgId === targetPkgId) return false;
    // Check if this hostless package depends on the target
    const depDeps: any[] = dep.site.projectDependencies ?? [];
    return depDeps.some((dd: any) => dd.pkgId === targetPkgId);
  });
}

/**
 * Manually remove a project dependency from the site.
 * Fallback when TplMgr.removeProjectDep is not available.
 */
function removeProjectDepManually(site: any, dep: any): void {
  const idx = (site.projectDependencies ?? []).indexOf(dep);
  if (idx >= 0) {
    site.projectDependencies.splice(idx, 1);
  }
}
