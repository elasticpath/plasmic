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

function generateCacheKey(params: OptimizeParams): string {
  // Create a deterministic cache key from optimization parameters
  const keyData = {
    src: params.src,
    width: params.width,
    quality: params.quality,
    format: params.format,
  };
  const keyString = JSON.stringify(keyData);
  return `img-opt/${md5(keyString)}`;
}

async function getCachedImageUrl(cacheKey: string): Promise<string | null> {
  try {
    const s3 = new S3({
      endpoint: process.env.S3_ENDPOINT,
    });

    // Check if the optimized image already exists in S3
    await s3
      .headObject({
        Bucket: siteAssetsBucket,
        Key: cacheKey,
      })
      .promise();

    // If we get here, the object exists
    return `${siteAssetsBaseUrl}${cacheKey}`;
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
  const s3 = new S3({
    endpoint: process.env.S3_ENDPOINT,
  });

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
  quality?: number;
  format?: "webp";
}

function validateParams(query: any): OptimizeParams {
  const { src, w, q, f } = query;

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

  const quality = q ? parseInt(q, 10) : DEFAULT_QUALITY;
  if (isNaN(quality) || quality < 1 || quality > 100) {
    throw new BadRequestError("Invalid quality. Must be between 1 and 100");
  }

  const format = f === "webp" ? "webp" : undefined;

  return { src, width, quality, format };
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
    const s3 = new S3({
      endpoint: process.env.S3_ENDPOINT,
    });

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
  { width, quality, format }: Omit<OptimizeParams, "src">
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

  // Apply width transformation
  if (width && metadata.width && width < metadata.width) {
    sharpInstance = sharpInstance.resize(width, null, {
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
    const cachedUrl = await getCachedImageUrl(cacheKey);
    if (cachedUrl) {
      // Redirect to the cached version
      res.redirect(301, cachedUrl);
      return;
    }

    // Fetch the original image
    const imageBuffer = await fetchImageBuffer(params.src);

    // Optimize the image
    const { buffer, contentType } = await optimizeImage(imageBuffer, params);

    // Upload optimized image to S3 for caching
    const optimizedUrl = await uploadOptimizedImage(
      cacheKey,
      buffer,
      contentType
    );

    // Redirect to the cached version
    res.redirect(301, optimizedUrl);
  } catch (error) {
    if (error instanceof BadRequestError || error instanceof NotFoundError) {
      throw error;
    }

    // For other errors, try to redirect to original image
    const { src } = req.query;
    if (src) {
      res.redirect(302, src as string);
    } else {
      throw new BadRequestError("Image processing failed");
    }
  }
}

// Handler for static image optimization (/{imageId} format)
export async function optimizeImageStaticHandler(req: Request, res: Response) {
  const { imageId } = req.params;
  const { w, q, f } = req.query;

  if (!imageId) {
    throw new BadRequestError("Missing image ID");
  }

  // Construct the full URL based on your image storage pattern
  // This assumes images are stored with the pattern used in the existing system
  const baseUrl = process.env.IMG_BASE_URL || "https://img.plasmic.app";
  const src = `${baseUrl}/${imageId}`;

  // Redirect to the main optimization handler
  const queryString = new URLSearchParams({
    src,
    ...(w && { w: w as string }),
    ...(q && { q: q as string }),
    ...(f && { f: f as string }),
  }).toString();

  res.redirect(`/img-optimizer/v1/img?${queryString}`);
}
