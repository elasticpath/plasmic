/**
 * Elastic Path additions to S3 cache utilities.
 *
 * Kept in a separate module so upstream changes to s3-util.ts can be applied
 * with minimal merge conflicts.
 */

import { logger } from "@/wab/server/observability";
import { withTiming } from "@/wab/server/util/server-timing";
import { ensureInstance } from "@/wab/shared/common";
import S3 from "aws-sdk/clients/s3";

// Lazily-created singleton — avoids re-instantiating the S3 client on every
// cache call. Reset via _testonly.resetS3Client in tests.
let _s3: S3 | undefined;
export function getS3Client(): S3 {
  return (_s3 ??= new S3({ endpoint: process.env.S3_ENDPOINT }));
}

/**
 * Returns the cached value from S3, or null if not found or on any error.
 * Does not compute or store anything — purely a read-only probe used for
 * fast-path cache checks before doing heavier work.
 */
export async function tryGetS3CacheEntry<T>(opts: {
  bucket: string;
  key: string;
  deserialize: (str: string) => T;
}): Promise<T | null> {
  const { bucket, key, deserialize } = opts;
  const s3 = getS3Client();
  const shortKey = key.split("/").slice(-1)[0].slice(0, 24);
  try {
    const obj = await withTiming(`s3-early-get-${shortKey}`, () =>
      s3.getObject({ Bucket: bucket, Key: key }).promise()
    );
    const serialized = ensureInstance(obj.Body, Buffer).toString("utf8");
    logger().info(`S3 early cache hit for ${bucket} ${key}`, {
      s3CacheResult: "hit",
      bucket,
      key,
    });
    return deserialize(serialized);
  } catch (err) {
    if (err.code === "TimeoutError") {
      throw err;
    }
    return null;
  }
}

export const _testonly = {
  resetS3Client: () => {
    _s3 = undefined;
  },
};
