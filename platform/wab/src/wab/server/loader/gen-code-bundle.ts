import { DbMgr } from "@/wab/server/db/DbMgr";
import {
  LOADER_ASSETS_BUCKET,
  LOADER_CACHE_BUST,
  makeCodegenBucketPath,
  makeBundleBucketPath,
  tryGetCachedPublishedBundle,
} from "@/wab/server/loader/ep-gen-code-bundle";
import {
  makeExportOpts,
} from "@/wab/server/loader/ep-loader-export-opts";
import {
  extractProjectId,
  mkVersionToSync,
  resolveProjectDeps,
  VersionToSync,
} from "@/wab/server/loader/resolve-projects";
import { logger } from "@/wab/server/observability";
import { withSpan, withTimeSpent } from "@/wab/server/util/apm-util";
import {
  tryGetS3CacheEntry,
  upsertS3CacheEntry,
} from "@/wab/server/util/s3-util";
import {
  CachedCodegenOutputBundle,
  ComponentReference,
} from "@/wab/server/workers/codegen";
import { PlasmicWorkerPool } from "@/wab/server/workers/pool";
import { ensureDevFlags } from "@/wab/server/workers/worker-utils";
import { ProjectId } from "@/wab/shared/ApiSchema";
import { ExportOpts, ExportPlatformOptions } from "@/wab/shared/codegen/types";
import { unzip3 } from "@/wab/shared/collections";
import { tuple } from "@/wab/shared/common";
import { LocalizationKeyScheme } from "@/wab/shared/localization";
import { getConnection } from "typeorm";

export { LOADER_CACHE_BUST, LOADER_ASSETS_BUCKET };
export { LOADER_CODEGEN_OPTS_DEFAULTS } from "@/wab/server/loader/ep-loader-export-opts";

/**
 * This represents the version of the loader API wire format; should reflect the
 * latest number noted in Api of loader-core package.  You should bump this number in
 * loader-core and here to reflect any BACKWARDS-INCOMPATIBLE response changes;
 * it will then invalidate the previously cached responses.
 *
 * See past loader versions documented at server/routes/loader.ts. Update that list if
 * you bump this version!
 */
export const LATEST_LOADER_VERSION = 10;

export async function genPublishedLoaderCodeBundle(
  dbMgr: DbMgr,
  pool: PlasmicWorkerPool,
  opts: {
    platform?: string;
    platformOptions: ExportPlatformOptions;
    projectVersions: Record<string, VersionToSync>;
    loaderVersion: number;
    browserOnly: boolean;
    i18nKeyScheme: LocalizationKeyScheme | undefined;
    i18nTagPrefix: string | undefined;
    skipHead?: boolean;
  }
) {
  const { projectVersions } = opts;

  const cachedBundle = await tryGetCachedPublishedBundle(projectVersions, opts);
  if (cachedBundle !== null) {
    return cachedBundle;
  }

  const allProjectVersions = await withSpan(
    "loader-resolve-deps",
    async () => ({
      ...(await resolveProjectDeps(dbMgr, projectVersions)),
      ...projectVersions,
    }),
    undefined,
    {
      project_count: Object.keys(projectVersions).length,
      project_ids: Object.keys(projectVersions),
      projects: Object.entries(projectVersions).map(
        ([id, v]) => `${id}@${v.version}`
      ),
    }
  );

  await ensureDevFlags(dbMgr);

  return await genLoaderCodeBundleForProjectVersions(
    dbMgr,
    allProjectVersions,
    pool,
    {
      platform: opts.platform,
      platformOptions: opts.platformOptions,
      loaderVersion: opts.loaderVersion,
      browserOnly: opts.browserOnly,
      mode: "production",
      i18nKeyScheme: opts.i18nKeyScheme,
      i18nTagPrefix: opts.i18nTagPrefix,
      skipHead: opts.skipHead,
    }
  );
}

export async function genLatestLoaderCodeBundle(
  dbMgr: DbMgr,
  pool: PlasmicWorkerPool,
  opts: {
    platform?: string;
    platformOptions: ExportPlatformOptions;
    projectIdsBranches: { id: string; branchName: string | undefined }[];
    loaderVersion: number;
    browserOnly: boolean;
    i18nKeyScheme: LocalizationKeyScheme | undefined;
    i18nTagPrefix: string | undefined;
    skipHead?: boolean;
  }
) {
  const projectIdsBranches = opts.projectIdsBranches;

  const projectVersions = Object.fromEntries(
    projectIdsBranches.map(({ id, branchName }) => {
      return [id, mkVersionToSync(branchName ?? "latest")];
    })
  );

  const allProjectVersions = {
    // Get the resolved deps from seed projectIds
    ...(await resolveProjectDeps(dbMgr, projectVersions)),

    // The seed projectIds themselves should be "latest" or a branchName
    ...projectVersions,
  };

  await ensureDevFlags(dbMgr);

  return await genLoaderCodeBundleForProjectVersions(
    dbMgr,
    allProjectVersions,
    pool,
    {
      platform: opts.platform,
      platformOptions: opts.platformOptions,
      loaderVersion: opts.loaderVersion,
      browserOnly: opts.browserOnly,
      // Use development build for fastest response
      mode: "development",
      i18nKeyScheme: opts.i18nKeyScheme,
      i18nTagPrefix: opts.i18nTagPrefix,
      skipHead: opts.skipHead,
    }
  );
}

async function genLoaderCodeBundleForProjectVersions(
  dbMgr: DbMgr,
  projectVersions: Record<string, VersionToSync>,
  pool: PlasmicWorkerPool,
  opts: {
    platform?: string;
    platformOptions: ExportPlatformOptions;
    mode: "production" | "development";
    loaderVersion: number;
    browserOnly: boolean;
    i18nKeyScheme?: LocalizationKeyScheme;
    i18nTagPrefix: string | undefined;
    skipHead?: boolean;
  }
) {
  const exportOpts = makeExportOpts(opts);

  const codegenProject = async (
    projectId: string,
    version: string | undefined,
    indirect: boolean
  ) => {
    const res = await pool.exec("codegen", [
      {
        scheme: "blackbox",
        connectionOptions: getConnection().options,
        projectId,
        exportOpts: exportOpts,
        maybeVersionOrTag: version,
        indirect,
        skipChecksums: true,
      },
    ]);

    return tuple(res.output, res.componentDeps, res.componentRefs);
  };

  const [outputBundles, componentDeps, componentRefs] = unzip3(
    await withSpan(
      "loader-codegen",
      async () =>
        await Promise.all(
          Object.entries(projectVersions).map(async ([projectId, v]) => {
            const branches = await dbMgr.listBranchesForProject(
              projectId as ProjectId
            );
            const maybeBranch = branches.find(
              (branch) => branch.name === v.version
            );

            // If version is a branch name, we want to get the latest of that branch
            if (v.version === "latest" || maybeBranch) {
              // If no explicit version, then we cannot cache; just perform the codegen
              const { result, spentTime } = await withTimeSpent(() =>
                codegenProject(projectId, v.version, v.indirect)
              );
              logger().info("loader-codegen-project", {
                project_id: projectId,
                project_version: v.version,
                indirect: v.indirect,
                duration_ms: spentTime,
              });
              return result;
            } else {
              return await upsertS3CacheEntry<
                [
                  CachedCodegenOutputBundle,
                  Record<string, string[]>,
                  ComponentReference[]
                ]
              >({
                bucket: LOADER_ASSETS_BUCKET,
                key: makeCodegenBucketPath({
                  projectId,
                  version: v.version,
                  indirect: v.indirect,
                  exportOpts,
                }),
                compute: async () => {
                  const { result, spentTime } = await withTimeSpent(() =>
                    codegenProject(projectId, v.version, v.indirect)
                  );
                  logger().info("loader-codegen-project", {
                    project_id: projectId,
                    project_version: v.version,
                    indirect: v.indirect,
                    duration_ms: spentTime,
                  });
                  return result;
                },
                serialize: (obj) => JSON.stringify(obj),
                deserialize: (str) => JSON.parse(str),
              });
            }
          })
        ),
      undefined,
      {
        platform: opts.platform,
        loader_version: opts.loaderVersion,
        browser_only: opts.browserOnly,
        project_count: Object.keys(projectVersions).length,
        project_versions: JSON.stringify(projectVersions),
      }
    )
  );

  const mergedComponentDeps: Record<string, string[]> = Object.assign(
    {},
    ...componentDeps
  );

  const bundleProjects = async () => {
    return await pool.exec("loader-assets", [
      outputBundles,
      mergedComponentDeps,
      componentRefs.flat(),
      exportOpts.platform,
      {
        mode: opts.mode,
        loaderVersion: opts.loaderVersion,
        browserOnly: opts.browserOnly,
      },
    ]);
  };

  const result = await withSpan(
    "loader-bundle",
    async () => {
      if (
        opts.mode === "production" &&
        (
          await Promise.all(
            Object.entries(projectVersions).map(async ([p, v]) => {
              const branches = await dbMgr.listBranchesForProject(
                p as ProjectId
              );
              const versionIsBranchName = !!branches.find(
                (branch) => branch.name === v.version
              );
              return v.version !== "latest" && !versionIsBranchName;
            })
          )
        ).every((x) => x)
      ) {
        const bundleKey = makeBundleBucketPath({
          projectVersions,
          platform: exportOpts.platform,
          loaderVersion: opts.loaderVersion,
          browserOnly: opts.browserOnly,
          exportOpts,
        });
        const bundle = await upsertS3CacheEntry({
          bucket: LOADER_ASSETS_BUCKET,
          key: bundleKey,
          compute: bundleProjects,
          serialize: (obj) => JSON.stringify(obj),
          deserialize: (str) => JSON.parse(str),
        });
        bundle.bundleKey = bundleKey;
        return bundle;
      } else {
        return await bundleProjects();
      }
    },
    undefined,
    {
      platform: opts.platform,
      loader_version: opts.loaderVersion,
      browser_only: opts.browserOnly,
      mode: opts.mode,
      project_count: Object.keys(projectVersions).length,
      project_ids: Object.keys(projectVersions),
      projects: Object.entries(projectVersions).map(
        ([id, v]) => `${id}@${v.version}`
      ),
    }
  );
  return result;
}

export function extractBundleKeyProjectIds(bundleKey: string): ProjectId[] {
  const ps = bundleKey.split("/ps=")[1].split("/")[0];
  return ps.split(",").map(extractProjectId);
}

export const _testonly = {
  makeBundleBucketPath,
};
