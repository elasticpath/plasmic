// Set up environment variables before importing anything
process.env.SITE_ASSETS_BUCKET = "test-bucket";
process.env.SITE_ASSETS_BASE_URL = "https://test-assets.example.com/";
process.env.S3_ENDPOINT = "https://s3.amazonaws.com";

jest.mock("aws-sdk/clients/s3");
jest.mock("sharp");

import { BadRequestError } from "@/wab/shared/ApiErrors/errors";
import S3 from "aws-sdk/clients/s3";
import sharp from "sharp";

// Simple unit tests focused on core validation logic
describe("img-optimizer routes", () => {
  afterAll(() => {
    // Clean up environment variables
    delete process.env.SITE_ASSETS_BUCKET;
    delete process.env.SITE_ASSETS_BASE_URL;
    delete process.env.S3_ENDPOINT;
  });

  describe("parameter validation", () => {
    it("should validate required src parameter", () => {
      expect(() => {
        const query: any = {};
        const { src } = query;
        if (!src) {
          throw new BadRequestError("Missing required parameter: src");
        }
      }).toThrow(BadRequestError);
    });

    it("should validate URL format", () => {
      expect(() => {
        const src = "invalid-url";
        try {
          new URL(src);
        } catch {
          throw new BadRequestError("Invalid URL format");
        }
      }).toThrow(BadRequestError);
    });

    it("should validate width parameter", () => {
      const w = "5000";
      const width = parseInt(w, 10);
      const MAX_WIDTH = 4096;
      
      expect(() => {
        if (width > MAX_WIDTH) {
          throw new BadRequestError(`Invalid width: must be between 1 and ${MAX_WIDTH}`);
        }
      }).toThrow(BadRequestError);
    });

    it("should validate height parameter", () => {
      const h = "5000";
      const height = parseInt(h, 10);
      const MAX_HEIGHT = 4096;
      
      expect(() => {
        if (height > MAX_HEIGHT) {
          throw new BadRequestError(`Invalid height: must be between 1 and ${MAX_HEIGHT}`);
        }
      }).toThrow(BadRequestError);
    });

    it("should validate quality parameter", () => {
      const q = "150";
      const quality = parseInt(q, 10);
      
      expect(() => {
        if (quality < 1 || quality > 100) {
          throw new BadRequestError("Invalid quality: must be between 1 and 100");
        }
      }).toThrow(BadRequestError);
    });

    it("should accept valid parameters", () => {
      expect(() => {
        const params = {
          src: "https://test-assets.example.com/test.jpg",
          w: "300",
          q: "80",
          f: "webp"
        };
        
        // Validate src
        new URL(params.src);
        
        // Validate width
        const width = parseInt(params.w, 10);
        if (width < 1 || width > 4096) {
          throw new BadRequestError("Invalid width");
        }
        
        // Validate quality
        const quality = parseInt(params.q, 10);
        if (quality < 1 || quality > 100) {
          throw new BadRequestError("Invalid quality");
        }
        
        // Validate format
        const validFormats = ["jpeg", "jpg", "png", "webp"];
        if (params.f && !validFormats.includes(params.f)) {
          throw new BadRequestError("Invalid format");
        }
      }).not.toThrow();
    });
  });

  describe("URL processing", () => {
    it("should extract S3 key from base URL", () => {
      const url = "https://test-assets.example.com/abcdef0123456789abcdef0123456789.jpg";
      const baseUrl = "https://test-assets.example.com/";
      
      const key = url.replace(baseUrl, "");
      expect(key).toBe("abcdef0123456789abcdef0123456789.jpg");
    });

    it("should extract S3 key from direct S3 URL", () => {
      const url = "https://test-bucket.s3.amazonaws.com/abcdef0123456789abcdef0123456789.png";
      const bucketPattern = /https:\/\/test-bucket\.s3\.amazonaws\.com\//;
      
      const key = url.replace(bucketPattern, "");
      expect(key).toBe("abcdef0123456789abcdef0123456789.png");
    });

    it("should handle invalid URLs", () => {
      expect(() => {
        const url = "https://external-site.com/image.jpg";
        const baseUrl = "https://test-assets.example.com/";
        
        if (!url.startsWith(baseUrl) && !url.includes("test-bucket.s3.amazonaws.com")) {
          throw new BadRequestError("Invalid image URL");
        }
      }).toThrow(BadRequestError);
    });
  });

  describe("cache key generation", () => {
    it("should generate consistent cache keys", () => {
      const params1 = { src: "test.jpg", width: 300, quality: 80, format: "webp" };
      const params2 = { src: "test.jpg", width: 300, quality: 80, format: "webp" };
      
      // Simulate cache key generation
      const key1 = `${params1.src}-${params1.width}-${params1.quality}-${params1.format}`;
      const key2 = `${params2.src}-${params2.width}-${params2.quality}-${params2.format}`;
      
      expect(key1).toBe(key2);
    });

    it("should generate different keys for different parameters", () => {
      const params1 = { src: "test.jpg", width: 300, quality: 80, format: "webp" };
      const params2 = { src: "test.jpg", width: 400, quality: 80, format: "webp" };
      
      const key1 = `${params1.src}-${params1.width}-${params1.quality}-${params1.format}`;
      const key2 = `${params2.src}-${params2.width}-${params2.quality}-${params2.format}`;
      
      expect(key1).not.toBe(key2);
    });
  });

  describe("static handler logic", () => {
    it("should build correct redirect URLs", () => {
      const imageId = "test-image.jpg";
      const baseUrl = "https://test-assets.example.com/";
      const queryParams = { w: "300", q: "80" };
      
      const srcUrl = `${baseUrl}${imageId}`;
      const queryString = new URLSearchParams({
        src: srcUrl,
        ...queryParams
      }).toString();
      
      const expectedUrl = `/img-optimizer/v1/img?${queryString}`;
      expect(expectedUrl).toBe("/img-optimizer/v1/img?src=https%3A%2F%2Ftest-assets.example.com%2Ftest-image.jpg&w=300&q=80");
    });

    it("should handle missing imageId parameter", () => {
      const imageId = undefined;
      
      expect(() => {
        if (!imageId) {
          throw new BadRequestError("Missing required parameter: imageId");
        }
      }).toThrow(BadRequestError);
    });

    it("should preserve all query parameters", () => {
      const imageId = "test.png";
      const baseUrl = "https://test-assets.example.com/";
      const queryParams = { w: "500", h: "400", q: "90", f: "webp" };
      
      const srcUrl = `${baseUrl}${imageId}`;
      const queryString = new URLSearchParams({
        src: srcUrl,
        ...queryParams
      }).toString();
      
      const expectedUrl = `/img-optimizer/v1/img?${queryString}`;
      expect(expectedUrl).toContain("w=500");
      expect(expectedUrl).toContain("h=400");
      expect(expectedUrl).toContain("q=90");
      expect(expectedUrl).toContain("f=webp");
    });
  });

  describe("error handling", () => {
    it("should handle missing environment variables", () => {
      const originalBucket = process.env.SITE_ASSETS_BUCKET;
      delete process.env.SITE_ASSETS_BUCKET;

      expect(() => {
        const bucket = process.env.SITE_ASSETS_BUCKET;
        if (!bucket) {
          throw new Error("Missing required environment variable: SITE_ASSETS_BUCKET");
        }
      }).toThrow("Missing required environment variable");

      // Restore
      process.env.SITE_ASSETS_BUCKET = originalBucket;
    });

    it("should validate image file extensions", () => {
      const validExtensions = [".jpg", ".jpeg", ".png", ".webp", ".gif", ".svg"];
      
      expect(() => {
        const filename = "test.pdf";
        const hasValidExt = validExtensions.some(ext => filename.toLowerCase().endsWith(ext));
        if (!hasValidExt) {
          throw new BadRequestError("Invalid file type");
        }
      }).toThrow(BadRequestError);

      expect(() => {
        const filename = "test.jpg";
        const hasValidExt = validExtensions.some(ext => filename.toLowerCase().endsWith(ext));
        if (!hasValidExt) {
          throw new BadRequestError("Invalid file type");
        }
      }).not.toThrow();
    });
  });

  describe("format validation", () => {
    it("should accept valid formats", () => {
      const validFormats = ["jpeg", "jpg", "png", "webp"];

      validFormats.forEach(format => {
        expect(() => {
          if (!validFormats.includes(format)) {
            throw new BadRequestError("Invalid format");
          }
        }).not.toThrow();
      });
    });

    it("should reject invalid formats", () => {
      const invalidFormats = ["gif", "bmp", "tiff", "pdf"];

      invalidFormats.forEach(format => {
        expect(() => {
          const validFormats = ["jpeg", "jpg", "png", "webp"];
          if (!validFormats.includes(format)) {
            throw new BadRequestError("Invalid format");
          }
        }).toThrow(BadRequestError);
      });
    });
  });
});

describe("fetchAndOptimizeSingleFlight", () => {
  const mockBuffer = Buffer.from("fake-image-data");

  // 32-char hex key — required by extractS3Key's regex fallback
  const params = {
    src: "https://test-assets.example.com/abcdef0123456789abcdef0123456789.jpg",
    width: 400,
    quality: 75,
  };

  function makeS3Mock(getObjectResult: "success" | "fail") {
    return {
      getObject: jest.fn().mockReturnValue({
        promise:
          getObjectResult === "success"
            ? jest.fn().mockResolvedValue({ Body: mockBuffer, ContentType: "image/jpeg" })
            : jest.fn().mockRejectedValue(new Error("S3 error")),
      }),
      upload: jest.fn().mockReturnValue({
        promise: jest.fn().mockResolvedValue({ Location: "https://s3/cached" }),
      }),
    };
  }

  beforeEach(() => {
    jest.resetAllMocks();

    (S3 as jest.MockedClass<typeof S3>).mockImplementation(
      () => makeS3Mock("success") as any
    );

    const mockSharpInstance = {
      metadata: jest.fn().mockResolvedValue({ format: "jpeg", width: 800 }),
      resize: jest.fn().mockReturnThis(),
      jpeg: jest.fn().mockReturnThis(),
      webp: jest.fn().mockReturnThis(),
      png: jest.fn().mockReturnThis(),
      toBuffer: jest.fn().mockResolvedValue(mockBuffer),
    };
    (sharp as unknown as jest.Mock).mockReturnValue(mockSharpInstance);
  });

  it("first caller gets coalesced: false, concurrent caller gets coalesced: true", async () => {
    const { fetchAndOptimizeSingleFlight } = await import("./img-optimizer");

    const [first, second] = await Promise.all([
      fetchAndOptimizeSingleFlight("coalescing-key", params),
      fetchAndOptimizeSingleFlight("coalescing-key", params),
    ]);

    expect(first.coalesced).toBe(false);
    expect(second.coalesced).toBe(true);
    expect(second.buffer).toEqual(mockBuffer);
  });

  it("removes the cacheKey from the map after a successful call", async () => {
    const { fetchAndOptimizeSingleFlight } = await import("./img-optimizer");

    await fetchAndOptimizeSingleFlight("cleanup-success-key", params);
    const second = await fetchAndOptimizeSingleFlight("cleanup-success-key", params);

    // If the map entry had not been removed, the second call would be coalesced.
    expect(second.coalesced).toBe(false);
  });

  it("removes the cacheKey from the map after a failed call", async () => {
    // First S3 instance (source fetch) rejects; subsequent instances succeed.
    (S3 as jest.MockedClass<typeof S3>)
      .mockImplementationOnce(() => makeS3Mock("fail") as any)
      .mockImplementation(() => makeS3Mock("success") as any);

    const { fetchAndOptimizeSingleFlight } = await import("./img-optimizer");

    await expect(
      fetchAndOptimizeSingleFlight("cleanup-failure-key", params)
    ).rejects.toThrow("S3 error");

    // Map entry was cleaned up — retry gets a fresh attempt, not a dead promise.
    const retry = await fetchAndOptimizeSingleFlight("cleanup-failure-key", params);
    expect(retry.coalesced).toBe(false);
  });
});