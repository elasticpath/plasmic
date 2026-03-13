import { DbMgr } from "@/wab/server/db/DbMgr";
import { genPublishedLoaderCodeBundle } from "@/wab/server/loader/gen-code-bundle";
import {
  getResolvedProjectVersions,
  mkVersionToSync,
} from "@/wab/server/loader/resolve-projects";
import { logger } from "@/wab/server/observability";
import { makeGenPublishedLoaderCodeBundleOpts } from "@/wab/server/routes/loader";
import { withSpan } from "@/wab/server/util/apm-util";
import { PlasmicWorkerPool } from "@/wab/server/workers/pool";
import { ensureDevFlags } from "@/wab/server/workers/worker-utils";
import { uniqBy } from "lodash";

export async function prefillCloudfront(
  mgr: DbMgr,
  pool: PlasmicWorkerPool,
  pkgVersionId: string
) {
  await ensureDevFlags(mgr);
  const pkgVersion = await mgr.getPkgVersionById(pkgVersionId);
  const pkg = await mgr.getPkgById(pkgVersion.pkgId);
  const projectId = pkg.projectId;
  const loaderPublishmentsRaw = await mgr.getRecentLoaderPublishments(
    projectId
  );
  const loaderPublishments = uniqBy(loaderPublishmentsRaw, (publishment) =>
    [
      publishment.platform,
      publishment.loaderVersion,
      publishment.browserOnly ?? false,
      publishment.i18nKeyScheme,
      publishment.i18nTagPrefix,
      publishment.appDir,
      ...publishment.projectIds,
    ].join(",")
  );

  logger().info(
    `Pre-filling ${projectId}@${
      pkgVersion.version
    } for combinations ${JSON.stringify(
      loaderPublishments.map((p) => ({
        platform: p.platform,
        loaderVersion: p.loaderVersion,
        projectIds: p.projectIds,
        browserOnly: p.browserOnly ?? false,
        i18nKeyScheme: p.i18nKeyScheme ?? null,
        i18nTagPrefix: p.i18nTagPrefix ?? null,
        appDir: p.appDir ?? null,
      }))
    )}`
  );

  try {
    await Promise.all(
      // Prefill both browser + server and browserOnly builds
      loaderPublishments.map(async (publishment) => {
        const resolvedProjectIdSpecs = await getResolvedProjectVersions(
          mgr,
          publishment.projectIds
        );

        await withSpan(
          "loader-prefill",
          async () => {
            await genPublishedLoaderCodeBundle(
              mgr,
              pool,
              makeGenPublishedLoaderCodeBundleOpts({
                projectVersions: Object.fromEntries(
                  resolvedProjectIdSpecs.map((spec) => {
                    const [pid, version] = spec.split("@");
                    return [pid, mkVersionToSync(version, false)];
                  })
                ),
                platform: publishment.platform,
                appDir: publishment.appDir ?? false,
                loaderVersion: publishment.loaderVersion,
                browserOnly: publishment.browserOnly,
                i18n: {
                  keyScheme: publishment.i18nKeyScheme ?? undefined,
                  tagPrefix: publishment.i18nTagPrefix ?? undefined,
                },
              })
            );
          },
          undefined,
          {
            platform: publishment.platform,
            loader_version: publishment.loaderVersion,
            browser_only: publishment.browserOnly,
            app_dir: publishment.appDir,
            i18n_key_scheme: publishment.i18nKeyScheme,
            i18n_tag_prefix: publishment.i18nTagPrefix,
            pkg_version_id: pkgVersionId,
            project_ids: publishment.projectIds,
            projects: resolvedProjectIdSpecs,
          }
        );
      })
    );
  } catch (err) {
    // Even if there was an error, we set isPrefilled to true, else it'll
    // never be pre-filled.
  }
  await mgr.updatePkgVersion(
    pkgVersion.pkgId,
    pkgVersion.version,
    pkgVersion.branchId,
    {
      isPrefilled: true,
    }
  );
  logger().info(`Done prefilling cloudfront for ${projectId}`);
}
