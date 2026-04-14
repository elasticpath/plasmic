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
import { captureException } from "@/wab/server/observability/datadog";
import {
  makeGenPublishedLoaderCodeBundleOpts,
  makeCacheableVersionedLoaderQuery,
} from "@/wab/server/routes/loader";
import { withSpan, withTimeSpent } from "@/wab/server/util/apm-util";
import { PlasmicWorkerPool } from "@/wab/server/workers/pool";
import { ensureDevFlags } from "@/wab/server/workers/worker-utils";
import { getCodegenPublicUrl } from "@/wab/shared/urls";
import { uniqBy } from "lodash";

// Reuse a single client instance across publishes — the AWS SDK client is
// designed to be long-lived and credential resolution is done once at init.
let cloudfrontClient: CloudFrontClient | undefined;

/** @internal Reset the cached client — test-only. */
export function _resetCloudfrontClientForTest() {
  cloudfrontClient = undefined;
}

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

  return withSpan(
    "loader-prefill-cloudfront",
    async () => {
      logger().info("loader-prefill-start", {
        project_id: projectId,
        pkg_version: pkgVersion.version,
        pkg_version_id: pkgVersionId,
        variant_count: loaderPublishments.length,
        variants: loaderPublishments.map((p) => ({
          platform: p.platform,
          loader_version: p.loaderVersion,
          project_ids: p.projectIds,
          browser_only: p.browserOnly ?? false,
          i18n_key_scheme: p.i18nKeyScheme ?? null,
          i18n_tag_prefix: p.i18nTagPrefix ?? null,
          app_dir: p.appDir ?? null,
        })),
      });

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
      let bundleSuccesses = 0;
      let bundleFailures = 0;
      for (const { publishment, resolvedProjectIdSpecs } of warmingData) {
        try {
          await withSpan(
            "loader-prefill-bundle",
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
              project_id: projectId,
              platform: publishment.platform,
              loader_version: publishment.loaderVersion,
              browser_only: publishment.browserOnly ?? false,
              app_dir: publishment.appDir ?? false,
              i18n_key_scheme: publishment.i18nKeyScheme ?? null,
              i18n_tag_prefix: publishment.i18nTagPrefix ?? null,
              project_count: publishment.projectIds.length,
              pkg_version_id: pkgVersionId,
            }
          );
          bundleSuccesses++;
        } catch (err) {
          // Even if there was an error, we set isPrefilled to true, else it'll
          // never be pre-filled.
          bundleFailures++;
          captureException(err, {
            project_id: projectId,
            platform: publishment.platform,
            pkg_version_id: pkgVersionId,
          });
        }
      }

      // Phase 3: warm CloudFront's versioned cache by GETting each versioned
      // URL through the CDN. This must happen before invalidating the published
      // cache so that when clients follow the published→versioned redirect they
      // get a cache hit. Warming works without isPrefilled being set because the
      // versioned endpoint serves directly from S3 by projectId@version.
      if (warmingData.length > 0) {
        const baseUrl =
          process.env.CODEGEN_CLOUDFRONT_URL ?? getCodegenPublicUrl();
        await withSpan(
          "loader-prefill-warming",
          async () => {
            const warmingResults = await Promise.allSettled(
              warmingData.map(async ({ publishment, resolvedProjectIdSpecs }) => {
                // Use the same query builder as buildPublishedLoaderAssets so
                // the warming URL is identical to the versioned redirect URL
                // clients follow, producing the same CloudFront cache key.
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
                const { result, spentTime } = await withTimeSpent(() =>
                  fetch(`${baseUrl}/api/v1/loader/code/versioned?${query}`, {
                    signal: controller.signal,
                  }).finally(() => clearTimeout(timeoutId))
                );
                logger().info("loader-prefill-warming-url", {
                  project_id: projectId,
                  platform: publishment.platform,
                  loader_version: publishment.loaderVersion,
                  browser_only: publishment.browserOnly ?? false,
                  app_dir: publishment.appDir ?? false,
                  duration_ms: spentTime,
                  ok: result.ok,
                  status: result.status,
                });
                return result;
              })
            );

            const warmingSucceeded = warmingResults.filter(
              (r) => r.status === "fulfilled" && r.value.ok
            ).length;
            const warmingFailed = warmingResults.length - warmingSucceeded;
            logger().info("loader-prefill-warming-summary", {
              project_id: projectId,
              total: warmingResults.length,
              succeeded: warmingSucceeded,
              failed: warmingFailed,
            });
            if (warmingFailed > 0) {
              logger().warn(
                `CloudFront versioned cache warming had ${warmingFailed}/${warmingResults.length} failures for ${projectId} — invalidation will proceed but some clients may hit origin`
              );
            }
          },
          undefined,
          { project_id: projectId, variant_count: warmingData.length }
        );
      }

      // Mark as prefilled immediately before invalidation. Setting it here
      // (after warming, before invalidation) ensures:
      //   1. The versioned cache is already hot for any cache miss on the
      //      published redirect.
      //   2. The window between "status = ready" and "published cache
      //      invalidated" is minimised to just the invalidation API call
      //      (~100ms), rather than the full warming duration (up to 30s × N).
      await mgr.updatePkgVersion(
        pkgVersion.pkgId,
        pkgVersion.version,
        pkgVersion.branchId,
        { isPrefilled: true }
      );

      // Phase 4: invalidate published CDN paths so clients are redirected to
      // the now-warmed versioned entries.
      //
      // code/published paths are keyed by sorted project IDs embedded in the
      // URL path by the CloudFront Function (e.g. /published/aaa,zzz*). One
      // path per unique project-ID combination covers all platform/loaderVersion
      // variants.
      //
      // repr/html published paths already have :projectId in the route, so we
      // can scope invalidation to just the published project.
      const distributionId = process.env.CLOUDFRONT_DISTRIBUTION_ID;
      if (distributionId) {
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
        try {
          await withSpan(
            "loader-prefill-invalidation",
            async () => {
              // CloudFront is a global service; us-east-1 is correct for all CF API calls
              cloudfrontClient ??= new CloudFrontClient({ region: "us-east-1" });
              await cloudfrontClient.send(
                new CreateInvalidationCommand({
                  DistributionId: distributionId,
                  InvalidationBatch: {
                    // Append timestamp so retries of the same pkgVersionId get a
                    // fresh CallerReference — CF rejects reuse of an in-progress one.
                    CallerReference: `${pkgVersionId}-${Date.now()}`,
                    Paths: {
                      Quantity: invalidationPaths.length,
                      Items: invalidationPaths,
                    },
                  },
                })
              );
              logger().info("loader-prefill-invalidation-success", {
                project_id: projectId,
                distribution_id: distributionId,
                path_count: invalidationPaths.length,
                paths: invalidationPaths,
              });
            },
            undefined,
            {
              project_id: projectId,
              distribution_id: distributionId,
              path_count: invalidationPaths.length,
            }
          );
        } catch (err) {
          captureException(err, {
            project_id: projectId,
            distribution_id: distributionId,
            pkg_version_id: pkgVersionId,
          });
        }
      }

      logger().info("loader-prefill-complete", {
        project_id: projectId,
        pkg_version: pkgVersion.version,
        pkg_version_id: pkgVersionId,
        variant_count: loaderPublishments.length,
        bundle_successes: bundleSuccesses,
        bundle_failures: bundleFailures,
        warming_variant_count: warmingData.length,
        invalidation_enabled: !!process.env.CLOUDFRONT_DISTRIBUTION_ID,
      });
    },
    undefined,
    {
      project_id: projectId,
      pkg_version: pkgVersion.version,
      pkg_version_id: pkgVersionId,
      variant_count: loaderPublishments.length,
    }
  );
}
