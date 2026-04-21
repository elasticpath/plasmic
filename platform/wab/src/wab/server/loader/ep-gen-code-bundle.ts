/**
 * Elastic Path additions for loader bundle caching.
 *
 * Kept in a separate module so upstream changes to gen-code-bundle.ts can be
 * applied with minimal merge conflicts.
 */

import {
  LOADER_CODEGEN_OPTS_DEFAULTS,
  makeExportOpts,
} from "@/wab/server/loader/ep-loader-export-opts";
import { VersionToSync } from "@/wab/server/loader/resolve-projects";
import { tryGetS3CacheEntry } from "@/wab/server/util/ep-s3-cache";
import { ExportOpts, ExportPlatformOptions } from "@/wab/shared/codegen/types";
import { LocalizationKeyScheme } from "@/wab/shared/localization";
import { createHash } from "crypto";

/**
 * This is used for busting codegen caches.  You should increment this number if
 * any of our cached codegen responses should be considered _invalid_.  You don't
 * need to increment this if new codegen responses have changed but cached ones are
 * still valid.  Mostly this is for when there is a _bug_ in the generated code.
 *
 * This should be part of any cacheable request as `cb={LOADER_CACHE_BUST}` and as
 * part of the key in our S3 loader cache.
 *
 * Note that incrementing this number is EXPENSIVE and will create a huge volume of
 * codegen requests!  Provision codegen cluster appropriately.
 *
 * 17 - bumped for using shortened css class names
 * 18 - started returning list of component refs in codegen response to handle errors
 * 19 - fix css class name generation
 * 20 - style token overrides
 */
export const LOADER_CACHE_BUST = "20";

export const LOADER_ASSETS_BUCKET =
  process.env.LOADER_ASSETS_BUCKET ?? "plasmic-loader-assets-dev";

function makeExportOptsKey(opts: ExportOpts) {
  // We use a hash of the json string to avoid blowing the S3 object
  // key length limit of 1024 chars
  const str = JSON.stringify(opts);
  return createHash("sha256").update(str).digest("hex");
}

export function makeCodegenBucketPath(opts: {
  projectId: string;
  version: string;
  // affects whether page components are included; is not indirect, no page components
  indirect: boolean;
  exportOpts: ExportOpts;
}) {
  return `codegen/cb=${LOADER_CACHE_BUST}/pid=${opts.projectId}/v=${
    opts.version
  }/indirect=${opts.indirect}/opts=${makeExportOptsKey(opts.exportOpts)}`;
}

export function makeBundleBucketPath(opts: {
  projectVersions: Record<string, VersionToSync>;
  platform: string;
  loaderVersion: number;
  browserOnly: boolean;
  exportOpts: ExportOpts;
}) {
  const projectSpecs = Object.entries(opts.projectVersions)
    .filter(([_, v]) => !v.indirect)
    .map(([p, v]) => `${p}@${v.version}`)
    .sort();
  const key = `bundle/cb=${LOADER_CACHE_BUST}/loaderVersion=${
    opts.loaderVersion
  }/ps=${projectSpecs.join(",")}/platform=${
    opts.platform
  }/browserOnly=${!!opts.browserOnly}/opts=${makeExportOptsKey(
    opts.exportOpts
  )}`;
  return key;
}

/**
 * Fast-path cache probe: checks S3 for a pre-built bundle before doing any
 * dep resolution or DB work. Returns the cached bundle (with bundleKey set)
 * on a hit, or null on a miss so the caller can fall through to the full path.
 */
export async function tryGetCachedPublishedBundle(
  projectVersions: Record<string, VersionToSync>,
  opts: {
    platform?: string;
    platformOptions: ExportPlatformOptions;
    loaderVersion: number;
    browserOnly: boolean;
    i18nKeyScheme?: LocalizationKeyScheme;
    i18nTagPrefix: string | undefined;
    skipHead?: boolean;
  }
): Promise<any | null> {
  const earlyExportOpts = makeExportOpts(opts);
  const earlyBundleKey = makeBundleBucketPath({
    projectVersions,
    platform: earlyExportOpts.platform,
    loaderVersion: opts.loaderVersion,
    browserOnly: opts.browserOnly,
    exportOpts: earlyExportOpts,
  });
  const cachedBundle = await tryGetS3CacheEntry({
    bucket: LOADER_ASSETS_BUCKET,
    key: earlyBundleKey,
    deserialize: (str) => JSON.parse(str),
  });
  if (cachedBundle !== null) {
    cachedBundle.bundleKey = earlyBundleKey;
    return cachedBundle;
  }
  return null;
}

export const _testonly = {
  makeBundleBucketPath,
  LOADER_CODEGEN_OPTS_DEFAULTS,
};
