import {
  CloudFrontClient,
  CreateInvalidationCommand,
} from "@aws-sdk/client-cloudfront";
import { DbMgr } from "@/wab/server/db/DbMgr";
import { genPublishedLoaderCodeBundle } from "@/wab/server/loader/gen-code-bundle";
import {
  getResolvedProjectVersions,
  mkVersionToSync,
} from "@/wab/server/loader/resolve-projects";
import { logger } from "@/wab/server/observability";
import {
  makeGenPublishedLoaderCodeBundleOpts,
  makeCacheableVersionedLoaderQuery,
} from "@/wab/server/routes/loader";
import { withSpan } from "@/wab/server/util/apm-util";
import { PlasmicWorkerPool } from "@/wab/server/workers/pool";
import { ensureDevFlags } from "@/wab/server/workers/worker-utils";
import { getCodegenPublicUrl } from "@/wab/shared/urls";
import { uniqBy } from "lodash";

// Reuse a single client instance across publishes — the AWS SDK client is
// designed to be long-lived and credential resolution is done once at init.
let cloudfrontClient: CloudFrontClient | undefined;

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
      publishment.appDir ?? false,
      ...[...publishment.projectIds].sort(),
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

  // Phase 1: resolve all project versions upfront so warmingData is fully
  // populated before bundle generation starts. This ensures CDN warming and
  // invalidation cover all variants even if a later bundle generation fails.
  for (const publishment of loaderPublishments) {
    const resolvedProjectIdSpecs = await getResolvedProjectVersions(
      mgr,
      publishment.projectIds
    );
    warmingData.push({ publishment, resolvedProjectIdSpecs });
  }

  // Phase 2: generate bundles sequentially to bound peak memory usage.
  // Each variant is wrapped independently so a single failure does not abort
  // the remaining variants — all are still warmed and invalidated below.
  for (const { publishment, resolvedProjectIdSpecs } of warmingData) {
    try {
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
              browserOnly: publishment.browserOnly ?? false,
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
    } catch (err) {
      // Even if there was an error, we set isPrefilled to true, else it'll
      // never be pre-filled.
      logger().warn(
        `Bundle generation failed during prefill for ${projectId} (${publishment.platform}): ${err instanceof Error ? err.message : String(err)}`
      );
    }
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
        // Use the same query builder as buildPublishedLoaderAssets so the
        // warming URL is identical to the versioned redirect URL clients follow,
        // producing the same CloudFront cache key.
        const query = makeCacheableVersionedLoaderQuery({
          platform: publishment.platform,
          nextjsAppDir: publishment.appDir ?? false,
          loaderVersion: publishment.loaderVersion,
          resolvedProjectIdSpecs,
          browserOnly: publishment.browserOnly ?? false,
          i18nKeyScheme: publishment.i18nKeyScheme ?? undefined,
          i18nTagPrefix: publishment.i18nTagPrefix ?? undefined,
        });
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 30_000);
        return fetch(
          `${baseUrl}/api/v1/loader/code/versioned?${query}`,
          { signal: controller.signal }
        ).finally(() => clearTimeout(timeoutId));
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
      // CloudFront is a global service; us-east-1 is the correct region for all CF API calls
      cloudfrontClient ??= new CloudFrontClient({ region: "us-east-1" });
      await cloudfrontClient.send(
        new CreateInvalidationCommand({
          DistributionId: distributionId,
          InvalidationBatch: {
            // Append timestamp so retries of the same pkgVersionId get a fresh
            // CallerReference — CloudFront rejects reuse of an in-progress reference.
            CallerReference: `${pkgVersionId}-${Date.now()}`,
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
        `CloudFront invalidation failed for ${projectId}: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  logger().info(`Done prefilling cloudfront for ${projectId}`);
}
