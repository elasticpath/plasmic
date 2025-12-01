import { md5 } from "@/wab/server/util/hash";
import { BadRequestError, NotFoundError } from "@/wab/shared/ApiErrors/errors";
import { isSVG } from "@/wab/shared/svg-utils";
import S3 from "aws-sdk/clients/s3";
import { Request, Response } from "express-serve-static-core";
import sharp from "sharp";
import { URL } from "url";

const MAX_WIDTH = 4096;
const MAX_HEIGHT = 4096;
const DEFAULT_QUALITY = 75;
const SUPPORTED_FORMATS = ["jpeg", "jpg", "png", "webp"] as const;
type SupportedFormat = (typeof SUPPORTED_FORMATS)[number];

const siteAssetsBucket = process.env.SITE_ASSETS_BUCKET as string;
const siteAssetsBaseUrl = process.env.SITE_ASSETS_BASE_URL as string;

function createS3Client() {
  const s3Config: any = {
    endpoint: process.env.S3_ENDPOINT,
  };

  // Use path-style URLs only for LocalStack (when endpoint contains localhost)
  if (process.env.S3_ENDPOINT && process.env.S3_ENDPOINT.includes('localhost')) {
    s3Config.s3ForcePathStyle = true;
  }

  return new S3(s3Config);
}

function generateCacheKey(params: OptimizeParams): string {
  // Create a deterministic cache key from optimization parameters
  const keyData = {
    src: params.src,
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
    const s3 = createS3Client();

    // Try to get the cached optimized image
    const response = await s3
      .getObject({
        Bucket: siteAssetsBucket,
        Key: cacheKey,
      })
      .promise();

    if (response.Body) {
      return {
        buffer: response.Body as Buffer,
        contentType: response.ContentType || "image/jpeg",
      };
    }
    return null;
  } catch (error) {
    // Object doesn't exist or other error - we'll need to create it
    return null;
  }
}

async function uploadOptimizedImage(
  cacheKey: string,
  buffer: Buffer,
  contentType: string
): Promise<string> {
  const s3 = createS3Client();

  const { Location } = await s3
    .upload({
      Bucket: siteAssetsBucket,
      Key: cacheKey,
      Body: buffer,
      ContentType: contentType,
      // Set cache headers for the S3 object
      CacheControl: "public, max-age=7776000", // 90 days
      // Set expiration for automatic cleanup
      Expires: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000), // 90 days
    })
    .promise();

  return Location;
}

interface OptimizeParams {
  src: string;
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

  return { src, width, height, quality, format };
}

function extractS3Key(url: string): string | null {
  try {
    // Extract the S3 key from the URL
    // URLs can be either:
    // 1. https://site-assets.plasmic.app/{key}
    // 2. Direct S3 URLs
    // 3. Just the key itself

    if (siteAssetsBaseUrl && url.startsWith(siteAssetsBaseUrl)) {
      return url.substring(siteAssetsBaseUrl.length);
    }

    // Check if it's a direct S3 URL pattern
    const s3UrlMatch = url.match(/\/([a-f0-9]{32}\.[a-zA-Z0-9]+)$/);
    if (s3UrlMatch) {
      return s3UrlMatch[1];
    }

    // Check if it's just the key itself (32-char hex + extension)
    if (/^[a-f0-9]{32}\.[a-zA-Z0-9]+$/.test(url)) {
      return url;
    }

    return null;
  } catch {
    return null;
  }
}

async function fetchImageBuffer(url: string): Promise<Buffer> {
  const s3Key = extractS3Key(url);

  if (!s3Key) {
    throw new BadRequestError("Invalid image URL format");
  }

  try {
    const s3 = createS3Client();

    const result = await s3
      .getObject({
        Bucket: siteAssetsBucket,
        Key: s3Key,
      })
      .promise();

    if (!result.Body || !result.ContentType?.startsWith("image/")) {
      throw new BadRequestError("Object is not a valid image");
    }

    return result.Body as Buffer;
  } catch (error) {
    if (error.code === "NoSuchKey" || error.code === "NotFound") {
      throw new NotFoundError("Image not found in storage");
    }
    throw error;
  }
}

async function optimizeImage(
  buffer: Buffer,
  { width, height, quality, format }: Omit<OptimizeParams, "src">
): Promise<{ buffer: Buffer; contentType: string }> {
  // Skip processing for SVGs
  if (isSVG(buffer)) {
    return {
      buffer,
      contentType: "image/svg+xml",
    };
  }

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
  let outputFormat: SupportedFormat = "jpeg";
  let contentType = "image/jpeg";

  if (format === "webp") {
    outputFormat = "webp";
    contentType = "image/webp";
    sharpInstance = sharpInstance.webp({ quality });
  } else if (metadata.format === "png") {
    outputFormat = "png";
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

export async function optimizeImageHandler(req: Request, res: Response) {
  try {
    const params = validateParams(req.query);
    const cacheKey = generateCacheKey(params);

    // Check if we already have this optimized image cached in S3
    const cachedImage = await getCachedImage(cacheKey);
    if (cachedImage) {
      // Serve the cached image directly
      res.set({
        "Content-Type": cachedImage.contentType,
        "Cache-Control": "public, max-age=31536000", // 1 year
        "X-Cache": "HIT",
      });
      res.send(cachedImage.buffer);
      return;
    }

    // Fetch the original image
    const imageBuffer = await fetchImageBuffer(params.src);

    // Optimize the image
    const { buffer, contentType } = await optimizeImage(imageBuffer, params);

    // Upload optimized image to S3 for caching (don't wait for it)
    uploadOptimizedImage(cacheKey, buffer, contentType).catch((error) => {
      console.error("[IMG-OPTIMIZER] Failed to cache image:", error);
    });

    // Serve the optimized image directly
    res.set({
      "Content-Type": contentType,
      "Cache-Control": "public, max-age=31536000", // 1 year
      "X-Cache": "MISS",
    });
    res.send(buffer);
  } catch (error) {
    if (error instanceof BadRequestError || error instanceof NotFoundError) {
      throw error;
    }

    // For other errors, try to serve the original image
    const { src } = req.query;
    if (src) {
      try {
        const originalBuffer = await fetchImageBuffer(src as string);
        const contentType = src.toString().toLowerCase().endsWith('.png') ? 'image/png' : 'image/jpeg';

        res.set({
          "Content-Type": contentType,
          "Cache-Control": "public, max-age=300", // 5 minutes for errors
          "X-Cache": "ERROR",
        });
        res.send(originalBuffer);
      } catch (fetchError) {
        throw new BadRequestError("Image processing failed");
      }
    } else {
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
