import { logger } from "@/wab/server/observability";
import {
  getS3Client,
  _testonly,
  tryGetS3CacheEntry,
} from "@/wab/server/util/ep-s3-cache";
import { withTiming } from "@/wab/server/util/server-timing";
import { withSpan } from "@/wab/server/util/apm-util";
import { ensureInstance } from "@/wab/shared/common";
import S3 from "aws-sdk/clients/s3";
import path from "path";

<<<<<<< HEAD
export { tryGetS3CacheEntry, _testonly };
=======
/**
 * Reads a cache entry, returning null when it is absent (or unreadable for any
 * reason other than a timeout, which callers must not paper over).
 */
export async function tryGetS3CacheEntry<T>(opts: {
  bucket: string;
  key: string;
  deserialize: (str: string) => T;
}): Promise<T | null> {
  const { bucket, key, deserialize } = opts;
  const s3 = new S3({ endpoint: process.env.S3_ENDPOINT });
  try {
    const obj = await s3.getObject({ Bucket: bucket, Key: key }).promise();
    const serialized = ensureInstance(obj.Body, Buffer).toString("utf8");
    logger().info(`S3 cache hit for ${bucket} ${key}`);
    return deserialize(serialized);
  } catch (err) {
    if (err.code === "TimeoutError") {
      throw err;
    }
    return null;
  }
}
>>>>>>> upstream/master

export async function upsertS3CacheEntry<T>(opts: {
  bucket: string;
  key: string;
  compute: () => Promise<T>;
  serialize: (obj: T) => string;
  deserialize: (str: string) => T;
}): Promise<{ data: T; cacheHit: boolean }> {
  const { bucket, key, compute: f, serialize, deserialize } = opts;
<<<<<<< HEAD
  const s3 = getS3Client();
  const shortKey = key.split("/").slice(-1)[0].slice(0, 24);
=======
>>>>>>> upstream/master

  const cached = await tryGetS3CacheEntry({ bucket, key, deserialize });
  if (cached !== null) {
    return { data: cached, cacheHit: true };
  }

  logger().info(`S3 cache miss for ${bucket} ${key}; computing`);
  const content = await withSpan("s3-cache-compute", async () => await f());
  const serialized = serialize(content);
  const s3 = new S3({ endpoint: process.env.S3_ENDPOINT });
  try {
<<<<<<< HEAD
    const obj = await withTiming(`s3-get-${shortKey}`, () =>
      s3.getObject({ Bucket: bucket, Key: key }).promise()
    );
    const serialized = ensureInstance(obj.Body, Buffer).toString("utf8");
    logger().info(`S3 cache hit for ${bucket} ${key}`, {
      s3CacheResult: "hit",
      bucket,
      key,
    });
    const data = await withTiming(`s3-deserialize-${shortKey}`, async () =>
      deserialize(serialized)
    );
    return { data, cacheHit: true };
  } catch (err) {
    if (err.code === "TimeoutError") {
      throw err;
    }
    logger().info(`S3 cache miss for ${bucket} ${key}; computing`, {
      s3CacheResult: "miss",
      bucket,
      key,
    });
    const content = await withSpan("s3-cache-compute", async () => {
      return await withTiming(`s3-compute-${shortKey}`, f);
    });
    const serialized = serialize(content);
    try {
      await withTiming(`s3-put-${shortKey}`, () =>
        s3.putObject({ Bucket: bucket, Key: key, Body: serialized }).promise()
      );
    } catch (e) {
      if (process.env.NODE_ENV === "production") {
        throw e;
      }
      logger().error("Unable to add content to S3", e as any);
    }
    return { data: content, cacheHit: false };
=======
    await s3
      .putObject({
        Bucket: bucket,
        Key: key,
        Body: serialized,
      })
      .promise();
  } catch (e) {
    if (process.env.NODE_ENV === "production") {
      throw e;
    }
    logger().error("Unable to add content to S3", e as any);
>>>>>>> upstream/master
  }
  return { data: content, cacheHit: false };
}

export async function uploadFilesToS3(opts: {
  bucket: string;
  key: string;
  files: Record<string, string>;
}) {
  const { bucket, key, files } = opts;
  const s3 = getS3Client();
  await Promise.all(
    Object.entries(files).map(async ([file, content]) => {
      await s3
        .putObject({
          Bucket: bucket,
          Key: path.join(key, file),
          Body: content,
        })
        .promise();
    })
  );
}
