import { logger } from "@/wab/server/observability";
import {
  getS3Client,
  _testonly,
  tryGetS3CacheEntry,
} from "@/wab/server/util/ep-s3-cache";
import { withTiming } from "@/wab/server/util/server-timing";
import { ensureInstance } from "@/wab/shared/common";
import S3 from "aws-sdk/clients/s3";
import path from "path";

export { tryGetS3CacheEntry, _testonly };

export async function upsertS3CacheEntry<T>(opts: {
  bucket: string;
  key: string;
  compute: () => Promise<T>;
  serialize: (obj: T) => string;
  deserialize: (str: string) => T;
}) {
  const { bucket, key, compute: f, serialize, deserialize } = opts;
  const s3 = getS3Client();
  const shortKey = key.split("/").slice(-1)[0].slice(0, 24);

  try {
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
    return data;
  } catch (err) {
    if (err.code === "TimeoutError") {
      throw err;
    }
    logger().info(`S3 cache miss for ${bucket} ${key}; computing`, {
      s3CacheResult: "miss",
      bucket,
      key,
    });
    const content = await withTiming(`s3-compute-${shortKey}`, f);
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
    return content;
  }
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
