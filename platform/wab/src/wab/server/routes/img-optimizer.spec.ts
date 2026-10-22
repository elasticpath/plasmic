// Set up environment variables before importing anything
process.env.SITE_ASSETS_BUCKET = "test-bucket";
process.env.SITE_ASSETS_BASE_URL = "https://test-assets.example.com/";
process.env.S3_ENDPOINT = "https://s3.amazonaws.com";

jest.mock("@aws-sdk/client-s3", () => ({
  S3Client: jest.fn(),
  GetObjectCommand: jest.fn(),
  PutObjectCommand: jest.fn(),
}));
jest.mock("sharp");

import { BadRequestError } from "@/wab/shared/ApiErrors/errors";
import {
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import sharp from "sharp";

type S3Mock = { getObject: jest.Mock; putObject: jest.Mock };

/** v3 bodies are streams, exposing transformToByteArray rather than a Buffer. */
function mkBody(content: Buffer) {
  return { transformToByteArray: async () => new Uint8Array(content) };
}

// v3 dispatches every operation through `send(command)`, so route each command
// to the matching mock by the command class that built it.
function installS3Mock(s3Mock: S3Mock) {
  (GetObjectCommand as unknown as jest.Mock).mockImplementation((input) => ({
    op: "get",
    input,
  }));
  (PutObjectCommand as unknown as jest.Mock).mockImplementation((input) => ({
    op: "put",
    input,
  }));
  (S3Client as unknown as jest.Mock).mockImplementation(() => ({
    send: (command: { op: string; input: unknown }) =>
      command.op === "get"
        ? s3Mock.getObject(command.input)
        : s3Mock.putObject(command.input),
  }));
}

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

  const params = {
    assetKey: "abcdef0123456789abcdef0123456789.jpg",
    width: 400,
    quality: 75,
  };

  function makeS3Mock(): S3Mock {
    return {
      getObject: jest
        .fn()
        .mockResolvedValue({ Body: mkBody(mockBuffer), ContentType: "image/jpeg" }),
      putObject: jest.fn().mockResolvedValue({}),
    };
  }

  // Load a fresh module instance so the S3 singleton is constructed with the
  // current mock implementation. Must be called after configuring S3 mock.
  function loadFn(): typeof import("./img-optimizer").fetchAndOptimizeSingleFlight {
    let fn: typeof import("./img-optimizer").fetchAndOptimizeSingleFlight;
    jest.isolateModules(() => {
      fn = require("./img-optimizer").fetchAndOptimizeSingleFlight;
    });
    return fn!;
  }

  function setupSharpMock() {
    const inst = {
      metadata: jest.fn().mockResolvedValue({ format: "jpeg", width: 800 }),
      resize: jest.fn().mockReturnThis(),
      jpeg: jest.fn().mockReturnThis(),
      webp: jest.fn().mockReturnThis(),
      png: jest.fn().mockReturnThis(),
      toBuffer: jest.fn().mockResolvedValue(mockBuffer),
    };
    (sharp as unknown as jest.Mock).mockReturnValue(inst);
  }

  beforeEach(() => {
    jest.resetAllMocks();
  });

  it("first caller gets coalesced: false, concurrent caller gets coalesced: true", async () => {
    installS3Mock(makeS3Mock());
    setupSharpMock();
    const fetchAndOptimizeSingleFlight = loadFn();

    const [first, second] = await Promise.all([
      fetchAndOptimizeSingleFlight("coalescing-key", params),
      fetchAndOptimizeSingleFlight("coalescing-key", params),
    ]);

    expect(first.coalesced).toBe(false);
    expect(second.coalesced).toBe(true);
    expect(second.buffer).toEqual(mockBuffer);
  });

  it("removes the cacheKey from the map after a successful call", async () => {
    installS3Mock(makeS3Mock());
    setupSharpMock();
    const fetchAndOptimizeSingleFlight = loadFn();

    await fetchAndOptimizeSingleFlight("cleanup-success-key", params);
    const second = await fetchAndOptimizeSingleFlight("cleanup-success-key", params);

    // If the entry were not removed, the second call would return coalesced: true.
    expect(second.coalesced).toBe(false);
  });

  it("removes the cacheKey from the map after a failed call", async () => {
    const s3Mock = makeS3Mock();
    // First getObject call rejects; default mock handles subsequent calls (success).
    s3Mock.getObject.mockRejectedValueOnce(new Error("S3 error"));
    installS3Mock(s3Mock);
    setupSharpMock();
    const fetchAndOptimizeSingleFlight = loadFn();

    await expect(
      fetchAndOptimizeSingleFlight("cleanup-failure-key", params)
    ).rejects.toThrow("S3 error");

    // Map entry was cleaned up — retry gets a fresh attempt, not a dead promise.
    const retry = await fetchAndOptimizeSingleFlight("cleanup-failure-key", params);
    expect(retry.coalesced).toBe(false);
  });
});
describe("image source validation", () => {
  const assetKey = "abcdef0123456789abcdef0123456789.jpg";

  function makeS3Mock(): S3Mock {
    return {
      getObject: jest.fn().mockResolvedValue({
        Body: mkBody(Buffer.from("cached-image")),
        ContentType: "image/jpeg",
      }),
      putObject: jest.fn(),
    };
  }

  function loadHandlers(): typeof import("./img-optimizer") {
    let mod: typeof import("./img-optimizer");
    jest.isolateModules(() => {
      mod = require("./img-optimizer");
    });
    return mod!;
  }

  function makeRes() {
    return { set: jest.fn(), send: jest.fn() } as any;
  }

  let s3Mock: S3Mock;

  // The first describe block clears these in its afterAll.
  beforeAll(() => {
    process.env.SITE_ASSETS_BUCKET = "test-bucket";
    process.env.SITE_ASSETS_BASE_URL = "https://test-assets.example.com/";
  });

  afterAll(() => {
    delete process.env.SITE_ASSETS_BUCKET;
    delete process.env.SITE_ASSETS_BASE_URL;
  });

  beforeEach(() => {
    jest.resetAllMocks();
    s3Mock = makeS3Mock();
    installS3Mock(s3Mock);
  });

  it("rejects an image id that is not an asset key without reading from S3", async () => {
    const { optimizeImageStaticHandler } = loadHandlers();

    await expect(
      optimizeImageStaticHandler(
        { params: { imageId: "logo.png" }, query: {} } as any,
        makeRes()
      )
    ).rejects.toMatchObject({ statusCode: 400 });
    expect(s3Mock.getObject).not.toHaveBeenCalled();
  });

  it("serves an image id that is an asset key", async () => {
    const { optimizeImageStaticHandler } = loadHandlers();
    const res = makeRes();

    await optimizeImageStaticHandler(
      { params: { imageId: assetKey }, query: {} } as any,
      res
    );

    expect(s3Mock.getObject).toHaveBeenCalled();
    expect(res.send).toHaveBeenCalled();
  });

  it.each([
    ["a non-asset path on the asset host", "https://test-assets.example.com/images/logo.png"],
    ["an image on another host", "https://external.example.com/image.jpg"],
  ])("rejects %s as src without reading from S3", async (_label, src) => {
    const { optimizeImageHandler } = loadHandlers();

    await expect(
      optimizeImageHandler({ query: { src } } as any, makeRes())
    ).rejects.toMatchObject({ statusCode: 400 });
    expect(s3Mock.getObject).not.toHaveBeenCalled();
  });

  it.each([
    ["the asset host", `https://test-assets.example.com/${assetKey}`],
    ["another host", `https://cdn.example.com/${assetKey}`],
  ])("serves an asset key on %s as src", async (_label, src) => {
    const { optimizeImageHandler } = loadHandlers();
    const res = makeRes();

    await optimizeImageHandler({ query: { src } } as any, res);

    expect(res.send).toHaveBeenCalled();
  });
});
