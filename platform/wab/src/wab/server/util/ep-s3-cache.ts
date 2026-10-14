/**
 * Elastic Path additions to S3 cache utilities.
 *
 * Kept in a separate module so upstream changes to s3-util.ts can be applied
 * with minimal merge conflicts.
 */

import { logger } from "@/wab/server/observability";
import { withTiming } from "@/wab/server/util/server-timing";
import { ensure } from "@/wab/shared/common";
import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";

// Lazily-created singleton — avoids re-instantiating the S3 client on every
// cache call. Reset via _testonly.resetS3Client in tests.
let _s3: S3Client | undefined;
export function makeS3Client(): S3Client {
  return (_s3 ??= new S3Client({
    endpoint: process.env.S3_ENDPOINT,
    region: process.env.AWS_REGION ?? "us-east-1",
    requestChecksumCalculation: process.env.S3_ENDPOINT
      ? "WHEN_REQUIRED"
      : undefined,
    // LocalStack on localhost only serves path-style URLs.
    forcePathStyle: process.env.S3_ENDPOINT?.includes("localhost"),
    // v2 dropped a request after 2 minutes of socket inactivity; v3 never does.
    requestHandler: { socketTimeout: 120_000 },
  }));
}

/** Reads an object's whole body, which v3 returns as a stream. */
export async function getS3ObjectString(
  bucket: string,
  key: string
): Promise<string> {
  const obj = await makeS3Client().send(
    new GetObjectCommand({ Bucket: bucket, Key: key })
  );
  return ensure(obj.Body, "Unexpected empty S3 object body").transformToString(
    "utf8"
  );
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
  const shortKey = key.split("/").slice(-1)[0].slice(0, 24);
  try {
    const serialized = await withTiming(`s3-early-get-${shortKey}`, () =>
      getS3ObjectString(bucket, key)
    );
    logger().info(`S3 early cache hit for ${bucket} ${key}`, {
      s3CacheResult: "hit",
      bucket,
      key,
    });
    return deserialize(serialized);
  } catch (err) {
    if (err.name === "TimeoutError") {
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
