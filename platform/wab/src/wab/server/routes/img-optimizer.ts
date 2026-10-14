import { logger } from "@/wab/server/observability";
import { md5 } from "@/wab/server/util/hash";
import { makeS3Client } from "@/wab/server/util/s3-util";
import { BadRequestError, NotFoundError } from "@/wab/shared/ApiErrors/errors";
import { isSVG } from "@/wab/shared/svg-utils";
import { GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { Request, Response } from "express-serve-static-core";
import sharp from "sharp";
import { URL } from "url";

const MAX_WIDTH = 4096;
const MAX_HEIGHT = 4096;
const DEFAULT_QUALITY = 75;

const siteAssetsBucket = process.env.SITE_ASSETS_BUCKET as string;
const siteAssetsBaseUrl = process.env.SITE_ASSETS_BASE_URL as string;

// Site assets are uploaded under `{md5}.{ext}` (see cdn/images.ts).
const ASSET_KEY_PATTERN = /^[a-f0-9]{32}\.[a-zA-Z0-9]+$/;

// Per-process single-flight map: prevents concurrent requests for the same
// cache key from each spawning independent S3 fetches and Sharp jobs.
const inFlightRequests = new Map<string, Promise<{ buffer: Buffer; contentType: string }>>();

function generateCacheKey(params: OptimizeParams): string {
  const keyData = {
    assetKey: params.assetKey,
    width: params.width,
    height: params.height,
    quality: params.quality,
    format: params.format,
  };
  const keyString = JSON.stringify(keyData);
  return `img-opt/${md5(keyString)}`;
}

async function getCachedImage(cacheKey: string): Promise<{ buffer: Buffer; contentType: string } | null> {
  try {
    const response = await makeS3Client().send(
      new GetObjectCommand({
        Bucket: siteAssetsBucket,
        Key: cacheKey,
      })
    );

    if (response.Body) {
      return {
        buffer: Buffer.from(await response.Body.transformToByteArray()),
        contentType: response.ContentType || "image/jpeg",
      };
    }
    return null;
  } catch (error) {
    if (error.name !== "NoSuchKey" && error.name !== "NotFound") {
      logger().error("[IMG-OPTIMIZER] S3 cache lookup failed", { err: error });
    }
    return null;
  }
}

async function uploadOptimizedImage(
  cacheKey: string,
  buffer: Buffer,
  contentType: string
): Promise<void> {
  await makeS3Client().send(
    new PutObjectCommand({
      Bucket: siteAssetsBucket,
      Key: cacheKey,
      Body: buffer,
      ContentType: contentType,
      // Set cache headers for the S3 object
      CacheControl: "public, max-age=7776000", // 90 days
      // Set expiration for automatic cleanup
      Expires: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000), // 90 days
    })
  );
}

interface OptimizeParams {
  assetKey: string;
  width?: number;
  height?: number;
  quality?: number;
  format?: "webp";
}

function validateParams(query: any): OptimizeParams {
  const { src, w, h, q, f } = query;

  if (!src) {
    throw new BadRequestError("Missing required parameter: src");
  }

  // Validate URL
  try {
    new URL(src);
  } catch {
    throw new BadRequestError("Invalid URL in src parameter");
  }

  const assetKey = extractS3Key(src);
  if (!assetKey) {
    throw new BadRequestError("Invalid image URL format");
  }

  const width = w ? parseInt(w, 10) : undefined;
  if (width && (isNaN(width) || width <= 0 || width > MAX_WIDTH)) {
    throw new BadRequestError(
      `Invalid width. Must be between 1 and ${MAX_WIDTH}`
    );
  }

  const height = h ? parseInt(h, 10) : undefined;
  if (height && (isNaN(height) || height <= 0 || height > MAX_HEIGHT)) {
    throw new BadRequestError(
      `Invalid height. Must be between 1 and ${MAX_HEIGHT}`
    );
  }

  const quality = q ? parseInt(q, 10) : DEFAULT_QUALITY;
  if (isNaN(quality) || quality < 1 || quality > 100) {
    throw new BadRequestError("Invalid quality. Must be between 1 and 100");
  }

  const format = f === "webp" ? "webp" : undefined;

  return { assetKey, width, height, quality, format };
}

function extractS3Key(url: string): string | null {
  try {
    // Extract the S3 key from the URL
    // URLs can be either:
    // 1. https://site-assets.plasmic.app/{key}
    // 2. Direct S3 URLs
    // 3. Just the key itself

    if (siteAssetsBaseUrl && url.startsWith(siteAssetsBaseUrl)) {
      const key = url.substring(siteAssetsBaseUrl.length);
      return ASSET_KEY_PATTERN.test(key) ? key : null;
    }

    // Check if it's a direct S3 URL pattern
    const s3UrlMatch = url.match(/\/([a-f0-9]{32}\.[a-zA-Z0-9]+)$/);
    if (s3UrlMatch) {
      return s3UrlMatch[1];
    }

    // Check if it's just the key itself (32-char hex + extension)
    if (ASSET_KEY_PATTERN.test(url)) {
      return url;
    }

    return null;
  } catch {
    return null;
  }
}

async function fetchSourceImage(assetKey: string): Promise<Buffer> {
  try {
    const result = await makeS3Client().send(
      new GetObjectCommand({
        Bucket: siteAssetsBucket,
        Key: assetKey,
      })
    );
    // Read the body before validating: an unread body holds its socket open.
    const body = result.Body
      ? Buffer.from(await result.Body.transformToByteArray())
      : undefined;

    if (!body || !result.ContentType?.startsWith("image/")) {
      throw new BadRequestError("Object is not a valid image");
    }

    if (
      result.ContentType.startsWith("image/svg") ||
      assetKey.toLowerCase().endsWith(".svg") ||
      isSVG(body)
    ) {
      throw new BadRequestError(
        "SVG images are not supported by the image optimizer"
      );
    }

    return body;
  } catch (error) {
    if (error.name === "NoSuchKey" || error.name === "NotFound") {
      throw new NotFoundError("Image not found in storage");
    }
    throw error;
  }
}

async function optimizeImage(
  buffer: Buffer,
  { width, height, quality, format }: Omit<OptimizeParams, "assetKey">
): Promise<{ buffer: Buffer; contentType: string }> {
  let sharpInstance = sharp(buffer);

  // Get original metadata
  const metadata = await sharpInstance.metadata();

  // Apply resize transformation
  if ((width && metadata.width && width < metadata.width) ||
      (height && metadata.height && height < metadata.height) ||
      (width && height)) {

    // Determine resize dimensions
    let resizeWidth = width;
    let resizeHeight = height;

    // If only one dimension is provided, set the other to null for aspect ratio preservation
    if (width && !height) {
      resizeHeight = null;
    } else if (height && !width) {
      resizeWidth = null;
    }

    sharpInstance = sharpInstance.resize(resizeWidth, resizeHeight, {
      fit: "inside",
      withoutEnlargement: true,
    });
  }

  // Apply format transformation
  let contentType = "image/jpeg";

  if (format === "webp") {
    contentType = "image/webp";
    sharpInstance = sharpInstance.webp({ quality });
  } else if (metadata.format === "png") {
    contentType = "image/png";
    sharpInstance = sharpInstance.png({ quality, progressive: true });
  } else {
    // Default to JPEG
    sharpInstance = sharpInstance.jpeg({
      quality,
      progressive: true,
      mozjpeg: true,
    });
  }

  const optimizedBuffer = await sharpInstance.toBuffer();

  return {
    buffer: optimizedBuffer,
    contentType,
  };
}

export async function fetchAndOptimizeSingleFlight(
  cacheKey: string,
  params: OptimizeParams
): Promise<{ buffer: Buffer; contentType: string; coalesced: boolean }> {
  if (inFlightRequests.has(cacheKey)) {
    const result = await inFlightRequests.get(cacheKey)!;
    return { ...result, coalesced: true };
  }

  const processingPromise = (async () => {
    const imageBuffer = await fetchSourceImage(params.assetKey);
    return optimizeImage(imageBuffer, params);
  })();

  inFlightRequests.set(cacheKey, processingPromise);

  try {
    const result = await processingPromise;
    uploadOptimizedImage(cacheKey, result.buffer, result.contentType).catch((error) => {
      logger().error("[IMG-OPTIMIZER] Failed to cache image", { err: error });
    });
    return { ...result, coalesced: false };
  } finally {
    inFlightRequests.delete(cacheKey);
  }
}

export async function optimizeImageHandler(req: Request, res: Response) {
  const params = validateParams(req.query);
  try {
    const cacheKey = generateCacheKey(params);

    const cachedImage = await getCachedImage(cacheKey);
    if (cachedImage) {
      res.set({
        "Content-Type": cachedImage.contentType,
        "Cache-Control": "public, max-age=31536000, immutable",
        "X-Cache": "HIT",
      });
      res.send(cachedImage.buffer);
      return;
    }

    const { buffer, contentType, coalesced } = await fetchAndOptimizeSingleFlight(cacheKey, params);
    res.set({
      "Content-Type": contentType,
      "Cache-Control": "public, max-age=31536000, immutable",
      "X-Cache": coalesced ? "COALESCED" : "MISS",
    });
    res.send(buffer);
  } catch (error) {
    if (error instanceof BadRequestError || error instanceof NotFoundError) {
      throw error;
    }

    // For other errors, try to serve the original image
    try {
      const originalBuffer = await fetchSourceImage(params.assetKey);
      const assetKey = params.assetKey.toLowerCase();
      const contentType = assetKey.endsWith(".png") ? "image/png"
        : assetKey.endsWith(".webp") ? "image/webp"
        : "image/jpeg";

      res.set({
        "Content-Type": contentType,
        "Cache-Control": "public, max-age=300", // 5 minutes for errors
        "X-Cache": "ERROR",
      });
      res.send(originalBuffer);
    } catch (fetchError) {
      throw new BadRequestError("Image processing failed");
    }
  }
}

// Handler for static image optimization (/{imageId} format)
export async function optimizeImageStaticHandler(req: Request, res: Response) {
  const { imageId } = req.params;
  const { w, h, q, f } = req.query;

  if (!imageId) {
    throw new BadRequestError("Missing image ID");
  }

  // For S3-based images, the imageId is the S3 key
  // Construct the S3 URL using the base URL
  const src = `${siteAssetsBaseUrl}${imageId}`;

  // Create a fake request object to reuse the main handler logic
  const fakeReq = {
    query: {
      src,
      ...(w && { w }),
      ...(h && { h }),
      ...(q && { q }),
      ...(f && { f }),
    },
  } as Request;

  // Call the main handler directly
  return optimizeImageHandler(fakeReq, res);
}
