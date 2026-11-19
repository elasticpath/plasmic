import { logger } from "@/wab/server/observability";
import {
  getS3ObjectString,
  makeS3Client,
  _testonly,
  tryGetS3CacheEntry,
} from "@/wab/server/util/ep-s3-cache";
import { withTiming } from "@/wab/server/util/server-timing";
import { withSpan } from "@/wab/server/util/apm-util";
import { PutObjectCommand } from "@aws-sdk/client-s3";
import path from "path";

export { makeS3Client, tryGetS3CacheEntry, _testonly };

export async function upsertS3CacheEntry<T>(opts: {
  bucket: string;
  key: string;
  compute: () => Promise<T>;
  serialize: (obj: T) => string;
  deserialize: (str: string) => T;
}): Promise<{ data: T; cacheHit: boolean }> {
  const { bucket, key, compute: f, serialize, deserialize } = opts;
  const s3 = makeS3Client();
  const shortKey = key.split("/").slice(-1)[0].slice(0, 24);

  try {
    const serialized = await withTiming(`s3-get-${shortKey}`, () =>
      getS3ObjectString(bucket, key)
    );
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
    if (err.name === "TimeoutError") {
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
        s3.send(
          new PutObjectCommand({ Bucket: bucket, Key: key, Body: serialized })
        )
      );
    } catch (e) {
      if (process.env.NODE_ENV === "production") {
        throw e;
      }
      logger().error("Unable to add content to S3", e as any);
    }
    return { data: content, cacheHit: false };
  }
}

export async function uploadFilesToS3(opts: {
  bucket: string;
  key: string;
  files: Record<string, string>;
}) {
  const { bucket, key, files } = opts;
  const s3 = makeS3Client();
  await Promise.all(
    Object.entries(files).map(async ([file, content]) => {
      await s3.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: path.join(key, file),
          Body: content,
        })
      );
    })
  );
}
