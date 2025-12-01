// Set up environment variables before importing anything
process.env.SITE_ASSETS_BUCKET = "test-bucket";
process.env.SITE_ASSETS_BASE_URL = "https://test-assets.example.com/";
process.env.S3_ENDPOINT = "https://s3.amazonaws.com";

import { BadRequestError, NotFoundError } from "@/wab/shared/ApiErrors/errors";
import { Request, Response } from "express-serve-static-core";
import * as sharp from "sharp";
import { optimizeImageHandler, optimizeImageStaticHandler } from "./img-optimizer";

// Mock dependencies
jest.mock("@/wab/server/util/hash");
jest.mock("@/wab/shared/svg-utils");
jest.mock("aws-sdk/clients/s3");
jest.mock("sharp");

import { md5 } from "@/wab/server/util/hash";
import { isSVG } from "@/wab/shared/svg-utils";
import S3 from "aws-sdk/clients/s3";

const mockHash = { md5: md5 as jest.MockedFunction<typeof md5> };
const mockSvgUtils = { isSVG: isSVG as jest.MockedFunction<typeof isSVG> };
const mockS3 = S3 as jest.MockedClass<typeof S3>;
const mockSharp = sharp as jest.MockedFunction<typeof sharp>;

describe("img-optimizer routes", () => {
  let mockReq: Partial<Request>;
  let mockRes: Partial<Response>;
  let s3Instance: any;
  let mockSharpInstance: any;

  afterAll(() => {
    // Clean up environment variables
    delete process.env.SITE_ASSETS_BUCKET;
    delete process.env.SITE_ASSETS_BASE_URL;
    delete process.env.S3_ENDPOINT;
  });

  beforeEach(() => {
    // Reset all mocks
    jest.clearAllMocks();

    // Mock S3 instance
    s3Instance = {
      headObject: jest.fn(),
      getObject: jest.fn(),
      upload: jest.fn(),
    };
    mockS3.mockImplementation(() => s3Instance);

    // Mock Sharp instance
    mockSharpInstance = {
      metadata: jest.fn().mockResolvedValue({ width: 1000, format: "jpeg" }),
      resize: jest.fn().mockReturnThis(),
      jpeg: jest.fn().mockReturnThis(),
      png: jest.fn().mockReturnThis(),
      webp: jest.fn().mockReturnThis(),
      toBuffer: jest.fn().mockResolvedValue(Buffer.from("optimized-image"))
    };

    // Mock hash function
    (mockHash.md5 as jest.Mock).mockImplementation((input: string) => `hash_${input.length}`);

    // Mock SVG utils
    (mockSvgUtils.isSVG as jest.Mock).mockReturnValue(false);

    // Set up Sharp mock to return the instance
    mockSharp.mockReturnValue(mockSharpInstance);

    // Mock Express request and response
    mockReq = {
      query: {},
      params: {},
    };

    mockRes = {
      redirect: jest.fn(),
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    };
  });

  describe("validateParams", () => {
    it("should validate required src parameter", async () => {
      mockReq.query = {};

      await expect(optimizeImageHandler(mockReq as Request, mockRes as Response))
        .rejects.toThrow(BadRequestError);
    });

    it("should validate URL format", async () => {
      mockReq.query = { src: "invalid-url" };

      await expect(optimizeImageHandler(mockReq as Request, mockRes as Response))
        .rejects.toThrow(BadRequestError);
    });

    it("should validate width parameter", async () => {
      mockReq.query = { 
        src: "https://test-assets.example.com/abc123.jpg",
        w: "5000" // Over MAX_WIDTH (4096)
      };

      await expect(optimizeImageHandler(mockReq as Request, mockRes as Response))
        .rejects.toThrow(BadRequestError);
    });

    it("should validate quality parameter", async () => {
      mockReq.query = { 
        src: "https://test-assets.example.com/abc123.jpg",
        q: "150" // Over 100
      };

      await expect(optimizeImageHandler(mockReq as Request, mockRes as Response))
        .rejects.toThrow(BadRequestError);
    });

    it("should accept valid parameters", async () => {
      mockReq.query = { 
        src: "https://test-assets.example.com/abcdef0123456789abcdef0123456789.jpg",
        w: "300",
        q: "80",
        f: "webp"
      };

      // Mock S3 head operation to return cache miss
      s3Instance.headObject.mockReturnValue({
        promise: () => Promise.reject(new Error("NotFound"))
      });

      // Mock S3 get operation for original image
      s3Instance.getObject.mockReturnValue({
        promise: () => Promise.resolve({
          Body: Buffer.from("fake-image-data"),
          ContentType: "image/jpeg"
        })
      });

      // Mock image optimization
      mockSharpInstance.metadata.mockResolvedValue({ width: 1000, format: "jpeg" });
      mockSharpInstance.toBuffer.mockResolvedValue(Buffer.from("optimized-image"));
      (mockSvgUtils.isSVG as jest.Mock).mockReturnValue(false);

      // Mock S3 upload
      s3Instance.upload.mockReturnValue({
        promise: () => Promise.resolve({
          Location: "https://test-assets.example.com/optimized-image-url"
        })
      });

      await optimizeImageHandler(mockReq as Request, mockRes as Response);

      expect(mockRes.redirect).toHaveBeenCalledWith(301, "https://test-assets.example.com/optimized-image-url");
    });
  });

  describe("extractS3Key", () => {
    it("should extract key from base URL", async () => {
      mockReq.query = { 
        src: "https://test-assets.example.com/abcdef0123456789abcdef0123456789.jpg"
      };

      // Mock cache miss
      s3Instance.headObject.mockReturnValue({
        promise: () => Promise.reject(new Error("NotFound"))
      });

      // Mock S3 get operation
      s3Instance.getObject.mockReturnValue({
        promise: () => Promise.resolve({
          Body: Buffer.from("image-data"),
          ContentType: "image/jpeg"
        })
      });

      // Mock image processing
      mockSharpInstance.metadata.mockResolvedValue({ width: 1000, format: "jpeg" });
      mockSharpInstance.resize.mockReturnThis();
      mockSharpInstance.jpeg.mockReturnThis();
      mockSharpInstance.toBuffer.mockResolvedValue(Buffer.from("optimized"));
      mockSharp.mockReturnValue(mockSharpInstance as any);
      (mockSvgUtils.isSVG as jest.Mock).mockReturnValue(false);

      s3Instance.upload.mockReturnValue({
        promise: () => Promise.resolve({
          Location: "https://optimized-url"
        })
      });

      await optimizeImageHandler(mockReq as Request, mockRes as Response);

      // Verify S3 getObject was called with correct key
      expect(s3Instance.getObject).toHaveBeenCalledWith({
        Bucket: "test-bucket",
        Key: "abcdef0123456789abcdef0123456789.jpg"
      });
    });

    it("should extract key from S3 URL pattern", async () => {
      mockReq.query = { 
        src: "https://bucket.s3.amazonaws.com/path/abcdef0123456789abcdef0123456789.png"
      };

      s3Instance.headObject.mockReturnValue({
        promise: () => Promise.reject(new Error("NotFound"))
      });

      s3Instance.getObject.mockReturnValue({
        promise: () => Promise.resolve({
          Body: Buffer.from("image-data"),
          ContentType: "image/png"
        })
      });

      mockSharpInstance.metadata.mockResolvedValue({ width: 800, format: "png" });
      mockSharpInstance.resize.mockReturnThis();
      mockSharpInstance.png.mockReturnThis();
      mockSharpInstance.toBuffer.mockResolvedValue(Buffer.from("optimized"));
      mockSharp.mockReturnValue(mockSharpInstance as any);
      (mockSvgUtils.isSVG as jest.Mock).mockReturnValue(false);

      s3Instance.upload.mockReturnValue({
        promise: () => Promise.resolve({
          Location: "https://optimized-url"
        })
      });

      await optimizeImageHandler(mockReq as Request, mockRes as Response);

      expect(s3Instance.getObject).toHaveBeenCalledWith({
        Bucket: "test-bucket",
        Key: "abcdef0123456789abcdef0123456789.png"
      });
    });

    it("should reject invalid URLs", async () => {
      mockReq.query = { 
        src: "https://external-site.com/random-image.jpg"
      };

      await expect(optimizeImageHandler(mockReq as Request, mockRes as Response))
        .rejects.toThrow(BadRequestError);
    });
  });

  describe("caching behavior", () => {
    it("should return cached image if available", async () => {
      mockReq.query = { 
        src: "https://test-assets.example.com/abcdef0123456789abcdef0123456789.jpg",
        w: "300"
      };

      // Mock cache hit
      s3Instance.headObject.mockReturnValue({
        promise: () => Promise.resolve({})
      });

      await optimizeImageHandler(mockReq as Request, mockRes as Response);

      expect(mockRes.redirect).toHaveBeenCalledWith(301, expect.stringContaining("hash_"));
      expect(s3Instance.getObject).not.toHaveBeenCalled();
    });

    it("should process and cache image if not cached", async () => {
      mockReq.query = { 
        src: "https://test-assets.example.com/abcdef0123456789abcdef0123456789.jpg"
      };

      // Mock cache miss
      s3Instance.headObject.mockReturnValue({
        promise: () => Promise.reject(new Error("NotFound"))
      });

      s3Instance.getObject.mockReturnValue({
        promise: () => Promise.resolve({
          Body: Buffer.from("original-image"),
          ContentType: "image/jpeg"
        })
      });

      mockSharpInstance.metadata.mockResolvedValue({ width: 1000, format: "jpeg" });
      mockSharpInstance.jpeg.mockReturnThis();
      mockSharpInstance.toBuffer.mockResolvedValue(Buffer.from("optimized"));
      mockSharp.mockReturnValue(mockSharpInstance as any);
      (mockSvgUtils.isSVG as jest.Mock).mockReturnValue(false);

      s3Instance.upload.mockReturnValue({
        promise: () => Promise.resolve({
          Location: "https://cached-url"
        })
      });

      await optimizeImageHandler(mockReq as Request, mockRes as Response);

      expect(s3Instance.upload).toHaveBeenCalledWith(expect.objectContaining({
        Bucket: "test-bucket",
        ContentType: "image/jpeg",
        CacheControl: "public, max-age=7776000" // 90 days
      }));
    });
  });

  describe("image processing", () => {
    it("should handle SVG images without processing", async () => {
      mockReq.query = { 
        src: "https://test-assets.example.com/abcdef0123456789abcdef0123456789.svg"
      };

      s3Instance.headObject.mockReturnValue({
        promise: () => Promise.reject(new Error("NotFound"))
      });

      const svgBuffer = Buffer.from("<svg>test</svg>");
      s3Instance.getObject.mockReturnValue({
        promise: () => Promise.resolve({
          Body: svgBuffer,
          ContentType: "image/svg+xml"
        })
      });

      (mockSvgUtils.isSVG as jest.Mock).mockReturnValue(true);

      s3Instance.upload.mockReturnValue({
        promise: () => Promise.resolve({
          Location: "https://svg-url"
        })
      });

      await optimizeImageHandler(mockReq as Request, mockRes as Response);

      expect(mockSharp).not.toHaveBeenCalled();
      expect(s3Instance.upload).toHaveBeenCalledWith(expect.objectContaining({
        Body: svgBuffer,
        ContentType: "image/svg+xml"
      }));
    });

    it("should resize large images", async () => {
      mockReq.query = { 
        src: "https://test-assets.example.com/abcdef0123456789abcdef0123456789.jpg",
        w: "300"
      };

      s3Instance.headObject.mockReturnValue({
        promise: () => Promise.reject(new Error("NotFound"))
      });

      s3Instance.getObject.mockReturnValue({
        promise: () => Promise.resolve({
          Body: Buffer.from("large-image"),
          ContentType: "image/jpeg"
        })
      });

      mockSharpInstance.metadata.mockResolvedValue({ width: 1000, format: "jpeg" });
      mockSharpInstance.resize.mockReturnThis();
      mockSharpInstance.jpeg.mockReturnThis();
      mockSharpInstance.toBuffer.mockResolvedValue(Buffer.from("resized"));
      mockSharp.mockReturnValue(mockSharpInstance as any);
      (mockSvgUtils.isSVG as jest.Mock).mockReturnValue(false);

      s3Instance.upload.mockReturnValue({
        promise: () => Promise.resolve({
          Location: "https://resized-url"
        })
      });

      await optimizeImageHandler(mockReq as Request, mockRes as Response);

      expect(mockSharpInstance.resize).toHaveBeenCalledWith(300, null, {
        fit: "inside",
        withoutEnlargement: true
      });
    });

    it("should not resize smaller images", async () => {
      mockReq.query = { 
        src: "https://test-assets.example.com/abcdef0123456789abcdef0123456789.jpg",
        w: "300"
      };

      s3Instance.headObject.mockReturnValue({
        promise: () => Promise.reject(new Error("NotFound"))
      });

      s3Instance.getObject.mockReturnValue({
        promise: () => Promise.resolve({
          Body: Buffer.from("small-image"),
          ContentType: "image/jpeg"
        })
      });

      mockSharpInstance.metadata.mockResolvedValue({ width: 200, format: "jpeg" });
      mockSharpInstance.jpeg.mockReturnThis();
      mockSharpInstance.toBuffer.mockResolvedValue(Buffer.from("unchanged"));
      mockSharp.mockReturnValue(mockSharpInstance as any);
      (mockSvgUtils.isSVG as jest.Mock).mockReturnValue(false);

      s3Instance.upload.mockReturnValue({
        promise: () => Promise.resolve({
          Location: "https://unchanged-url"
        })
      });

      await optimizeImageHandler(mockReq as Request, mockRes as Response);

      expect(mockSharpInstance.resize).not.toHaveBeenCalled();
    });

    it("should convert to WebP when requested", async () => {
      mockReq.query = { 
        src: "https://test-assets.example.com/abcdef0123456789abcdef0123456789.jpg",
        f: "webp",
        q: "80"
      };

      s3Instance.headObject.mockReturnValue({
        promise: () => Promise.reject(new Error("NotFound"))
      });

      s3Instance.getObject.mockReturnValue({
        promise: () => Promise.resolve({
          Body: Buffer.from("jpeg-image"),
          ContentType: "image/jpeg"
        })
      });

      mockSharpInstance.metadata.mockResolvedValue({ width: 500, format: "jpeg" });
      mockSharpInstance.webp.mockReturnThis();
      mockSharpInstance.toBuffer.mockResolvedValue(Buffer.from("webp-image"));
      mockSharp.mockReturnValue(mockSharpInstance as any);
      (mockSvgUtils.isSVG as jest.Mock).mockReturnValue(false);

      s3Instance.upload.mockReturnValue({
        promise: () => Promise.resolve({
          Location: "https://webp-url"
        })
      });

      await optimizeImageHandler(mockReq as Request, mockRes as Response);

      expect(mockSharpInstance.webp).toHaveBeenCalledWith({ quality: 80 });
      expect(s3Instance.upload).toHaveBeenCalledWith(expect.objectContaining({
        ContentType: "image/webp"
      }));
    });
  });

  describe("error handling", () => {
    it("should handle image not found", async () => {
      mockReq.query = { 
        src: "https://test-assets.example.com/abcdef0123456789abcdef0123456789.jpg"
      };

      s3Instance.headObject.mockReturnValue({
        promise: () => Promise.reject(new Error("NotFound"))
      });

      s3Instance.getObject.mockReturnValue({
        promise: () => Promise.reject({ code: "NoSuchKey" })
      });

      await expect(optimizeImageHandler(mockReq as Request, mockRes as Response))
        .rejects.toThrow(NotFoundError);
    });

    it("should handle non-image content", async () => {
      mockReq.query = { 
        src: "https://test-assets.example.com/abcdef0123456789abcdef0123456789.txt"
      };

      s3Instance.headObject.mockReturnValue({
        promise: () => Promise.reject(new Error("NotFound"))
      });

      s3Instance.getObject.mockReturnValue({
        promise: () => Promise.resolve({
          Body: Buffer.from("not-an-image"),
          ContentType: "text/plain"
        })
      });

      await expect(optimizeImageHandler(mockReq as Request, mockRes as Response))
        .rejects.toThrow(BadRequestError);
    });

    it("should redirect to original image on processing errors", async () => {
      mockReq.query = { 
        src: "https://test-assets.example.com/abcdef0123456789abcdef0123456789.jpg"
      };

      s3Instance.headObject.mockReturnValue({
        promise: () => Promise.reject(new Error("NotFound"))
      });

      s3Instance.getObject.mockReturnValue({
        promise: () => Promise.resolve({
          Body: Buffer.from("corrupt-image"),
          ContentType: "image/jpeg"
        })
      });

      (mockSvgUtils.isSVG as jest.Mock).mockReturnValue(false);
      mockSharp.mockImplementation(() => {
        throw new Error("Sharp processing failed");
      });

      await optimizeImageHandler(mockReq as Request, mockRes as Response);

      expect(mockRes.redirect).toHaveBeenCalledWith(302, "https://test-assets.example.com/abcdef0123456789abcdef0123456789.jpg");
    });
  });

  describe("optimizeImageStaticHandler", () => {
    it("should redirect to main handler", async () => {
      mockReq.params = { imageId: "abcdef0123456789abcdef0123456789.jpg" };
      mockReq.query = { w: "300", q: "80" };

      await optimizeImageStaticHandler(mockReq as Request, mockRes as Response);

      expect(mockRes.redirect).toHaveBeenCalledWith(
        // cspell:disable-next-line
        "/img-optimizer/v1/img?src=https%3A%2F%2Fimg.plasmic.app%2Fabcdef0123456789abcdef0123456789.jpg&w=300&q=80"
      );
    });

    it("should handle missing imageId", async () => {
      mockReq.params = {};

      await expect(optimizeImageStaticHandler(mockReq as Request, mockRes as Response))
        .rejects.toThrow(BadRequestError);
    });
  });
});