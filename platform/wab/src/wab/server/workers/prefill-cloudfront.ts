import {
  CloudFrontClient,
  CreateInvalidationCommand,
} from "@aws-sdk/client-cloudfront";
import { DbMgr } from "@/wab/server/db/DbMgr";
import {
  genPublishedLoaderCodeBundle,
  LOADER_CACHE_BUST,
} from "@/wab/server/loader/gen-code-bundle";
import {
  getResolvedProjectVersions,
  mkVersionToSync,
} from "@/wab/server/loader/resolve-projects";
import { logger } from "@/wab/server/observability";
import { makeGenPublishedLoaderCodeBundleOpts } from "@/wab/server/routes/loader";
import { withSpan } from "@/wab/server/util/apm-util";
import { PlasmicWorkerPool } from "@/wab/server/workers/pool";
import { ensureDevFlags } from "@/wab/server/workers/worker-utils";
import { getCodegenPublicUrl } from "@/wab/shared/urls";
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

  // Collect resolved specs alongside bundle generation so we can reuse them
  // for CDN warming without a second DB query.
  const warmingData: Array<{
    publishment: (typeof loaderPublishments)[0];
    resolvedProjectIdSpecs: string[];
  }> = [];

  try {
    await Promise.all(
      // Prefill both browser + server and browserOnly builds
      loaderPublishments.map(async (publishment) => {
        const resolvedProjectIdSpecs = await getResolvedProjectVersions(
          mgr,
          publishment.projectIds
        );

        warmingData.push({ publishment, resolvedProjectIdSpecs });

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

  // isPrefilled must be set before warming so that origin can serve
  // pre-computed bundles on any CloudFront cache miss during the warm requests.
  await mgr.updatePkgVersion(
    pkgVersion.pkgId,
    pkgVersion.version,
    pkgVersion.branchId,
    {
      isPrefilled: true,
    }
  );

  // Warm CloudFront's versioned cache by GETting each versioned URL through
  // the CDN. This must happen before invalidating the published cache so that
  // when clients follow the published→versioned redirect they get a cache hit.
  if (warmingData.length > 0) {
    const baseUrl = getCodegenPublicUrl();
    const warmingResults = await Promise.allSettled(
      warmingData.map(({ publishment, resolvedProjectIdSpecs }) => {
        const params = new URLSearchParams();
        params.set("cb", LOADER_CACHE_BUST);
        params.set("platform", publishment.platform);
        if (publishment.loaderVersion != null) {
          params.set("loaderVersion", String(publishment.loaderVersion));
        }
        for (const spec of resolvedProjectIdSpecs) {
          params.append("projectId", spec);
        }
        if (publishment.browserOnly) {
          params.set("browserOnly", "true");
        }
        if (publishment.i18nKeyScheme) {
          params.set("i18nKeyScheme", publishment.i18nKeyScheme);
        }
        if (publishment.i18nTagPrefix) {
          params.set("i18nTagPrefix", publishment.i18nTagPrefix);
        }
        if (publishment.appDir) {
          params.set("nextjsAppDir", "true");
        }
        return fetch(
          `${baseUrl}/api/v1/loader/code/versioned?${params.toString()}`
        );
      })
    );
    const warmingFailures = warmingResults.filter(
      (r) => r.status === "rejected" || (r.status === "fulfilled" && !r.value.ok)
    );
    if (warmingFailures.length > 0) {
      logger().warn(
        `CloudFront versioned cache warming had ${warmingFailures.length}/${warmingResults.length} failures for ${projectId} — invalidation will proceed but some clients may hit origin`
      );
    } else {
      logger().info(`Warmed CloudFront versioned cache for ${projectId}`);
    }
  }

  // Invalidate published CDN paths so clients are redirected to the
  // now-warmed versioned entries.
  //
  // code/published paths are keyed by sorted project IDs embedded in the URL
  // path by the CloudFront Function (e.g. /published/aaa,zzz*). One path per
  // unique project-ID combination covers all platform/loaderVersion variants.
  //
  // repr/html published paths already have :projectId in the route, so we
  // can scope invalidation to just the published project.
  const distributionId = process.env.CLOUDFRONT_DISTRIBUTION_ID;
  if (distributionId) {
    try {
      const codePaths = [
        ...new Set(
          warmingData.map(
            ({ publishment }) =>
              `/api/v1/loader/code/published/${[...publishment.projectIds]
                .sort()
                .join(",")}*`
          )
        ),
      ];
      const invalidationPaths = [
        ...codePaths,
        `/api/v1/loader/repr-v2/published/${projectId}*`,
        `/api/v1/loader/repr-v3/published/${projectId}*`,
        `/api/v1/loader/html/published/${projectId}*`,
      ];
      const cloudfront = new CloudFrontClient({});
      await cloudfront.send(
        new CreateInvalidationCommand({
          DistributionId: distributionId,
          InvalidationBatch: {
            CallerReference: pkgVersionId,
            Paths: {
              Quantity: invalidationPaths.length,
              Items: invalidationPaths,
            },
          },
        })
      );
      logger().info(`CloudFront invalidation triggered for ${projectId}`);
    } catch (err) {
      logger().warn(
        `CloudFront invalidation failed for ${projectId}: ${err}`
      );
    }
  }

  logger().info(`Done prefilling cloudfront for ${projectId}`);
}
