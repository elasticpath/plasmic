/** @jest-environment node */
process.env.SITE_ASSETS_BUCKET = "test-bucket";
process.env.SITE_ASSETS_BASE_URL = "https://test-assets.example.com/";
process.env.S3_ENDPOINT = "https://s3.amazonaws.com";

// Plain classes, not jest.fn(), so resetMocks leaves the client working. v3
// sends every operation through `send(command)`, routed here by command class.
jest.mock("@aws-sdk/client-s3", () => {
  class GetObjectCommand {
    constructor(readonly input: unknown) {}
  }
  class PutObjectCommand {
    constructor(readonly input: unknown) {}
  }
  class S3Client {
    send(command: GetObjectCommand | PutObjectCommand) {
      return command instanceof GetObjectCommand
        ? mockS3.getObject(command.input)
        : mockS3.putObject(command.input);
    }
  }
  return { GetObjectCommand, PutObjectCommand, S3Client };
});
jest.mock("sharp");

import { Config } from "@/wab/server/config";
import { closeDbConnections, ensureDbConnections } from "@/wab/server/db/DbCon";
import { ExpressSession } from "@/wab/server/entities/Entities";
import { PinoLogger } from "@/wab/server/observability/PinoLogger";
import http from "http";
import { AddressInfo } from "net";
import { Client } from "pg";
import { register } from "prom-client";
import sharp from "sharp";
import { getConnection } from "typeorm";

const ASSET_KEY = "abcdef0123456789abcdef0123456789.jpg";
const ORIGINAL_BYTES = Buffer.from("original-image");
const OPTIMIZED_BYTES = Buffer.from("optimized-image");
const SVG_KEY = "0123456789abcdef0123456789abcdef.svg";
const PNG_KEY = "fedcba9876543210fedcba9876543210.png";
const SVG_BYTES = Buffer.from(
  '<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"></svg>'
);
const SVG_AFTER_LONG_PREAMBLE = Buffer.concat([
  Buffer.from(`<!--${" ".repeat(12 * 1024)}-->`),
  SVG_BYTES,
]);

type S3Object = { Body: Buffer; ContentType: string };

const mockS3 = { getObject: jest.fn(), putObject: jest.fn() };

function stubGetObject(objects: Map<string, S3Object>) {
  mockS3.getObject.mockImplementation(async ({ Key }: { Key: string }) => {
    const object = objects.get(Key);
    if (!object) {
      throw Object.assign(new Error("NoSuchKey"), { name: "NoSuchKey" });
    }
    // v3 bodies are streams, exposing transformToByteArray rather than a Buffer.
    return {
      Body: { transformToByteArray: async () => new Uint8Array(object.Body) },
      ContentType: object.ContentType,
    };
  });
}

function stubS3AndSharp() {
  const objects = new Map<string, S3Object>([
    [ASSET_KEY, { Body: ORIGINAL_BYTES, ContentType: "image/jpeg" }],
  ]);
  stubGetObject(objects);
  mockS3.putObject.mockImplementation(
    async ({
      Key,
      Body,
      ContentType,
    }: {
      Key: string;
      Body: Buffer;
      ContentType: string;
    }) => {
      objects.set(Key, { Body, ContentType });
      return {};
    }
  );
  (sharp as unknown as jest.Mock).mockImplementation(() => {
    const inst = {
      metadata: jest.fn().mockResolvedValue({ format: "jpeg", width: 800 }),
      resize: jest.fn(() => inst),
      jpeg: jest.fn(() => inst),
      webp: jest.fn(() => inst),
      png: jest.fn(() => inst),
      toBuffer: jest.fn().mockResolvedValue(OPTIMIZED_BYTES),
    };
    return inst;
  });
}

async function waitForUploads(count: number) {
  for (let i = 0; i < 100 && mockS3.putObject.mock.calls.length < count; i++) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  expect(mockS3.putObject).toHaveBeenCalledTimes(count);
}

function uploadedKeys(): string[] {
  return mockS3.putObject.mock.calls.map(([{ Key }]) => Key);
}

function cacheLookupKeys(): string[] {
  return mockS3.getObject.mock.calls
    .map(([{ Key }]) => Key)
    .filter((key) => key.startsWith("img-opt/"));
}

function querySrc(host: string, key = ASSET_KEY) {
  return encodeURIComponent(`${host}/${key}`);
}

const pgQuery = jest.spyOn(Client.prototype, "query");

async function countQueries(send: () => Promise<Response>) {
  pgQuery.mockClear();
  const res = await send();
  const body = Buffer.from(await res.arrayBuffer());
  return { res, body, queries: pgQuery.mock.calls.length };
}

const servers: http.Server[] = [];
let cleanupDatabase: () => Promise<void>;
let startApp: (
  overrides?: Partial<Config>,
  opts?: { socketAddress?: string }
) => Promise<string>;

beforeAll(async () => {
  // Required here, not imported, so the env above is set before they load.
  const { createDatabase, testConfig } =
    require("@/wab/server/test/backend-util") as typeof import("@/wab/server/test/backend-util");
  const { createImgOptimizerApp } =
    require("@/wab/server/img-optimizer-backend-real") as typeof import("@/wab/server/img-optimizer-backend-real");

  const db = await createDatabase("img_optimizer_test");
  cleanupDatabase = db.cleanup;
  await ensureDbConnections(db.dburi);

  startApp = async (overrides = {}, { socketAddress } = {}) => {
    const app = await createImgOptimizerApp({
      ...testConfig(db.dburi, "http://localhost"),
      ...overrides,
    });
    const server = await new Promise<http.Server>((resolve) => {
      const s = app.listen(0, () => resolve(s));
    });
    if (socketAddress) {
      // Stands in for the proxy the app sees as its peer.
      server.on("connection", (socket) => {
        Object.defineProperty(socket, "remoteAddress", { value: socketAddress });
      });
    }
    servers.push(server);
    return `http://localhost:${(server.address() as AddressInfo).port}`;
  };
});

beforeEach(() => {
  stubS3AndSharp();
});

afterAll(async () => {
  for (const server of servers) {
    await new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve()))
    );
  }
  pgQuery.mockRestore();
  await closeDbConnections();
  register.clear();
  await cleanupDatabase?.();
});

describe("image optimizer HTTP boundary", () => {
  let baseUrl: string;

  beforeAll(async () => {
    baseUrl = await startApp();
  });

  it("serves a valid asset key on the static route", async () => {
    const res = await fetch(
      `${baseUrl}/img-optimizer/v1/img/${ASSET_KEY}?w=400`
    );

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/^image\//);
    expect(Buffer.from(await res.arrayBuffer())).toEqual(OPTIMIZED_BYTES);
  });

  it("serves a valid asset url on the query route", async () => {
    const src = querySrc("https://test-assets.example.com");
    const res = await fetch(`${baseUrl}/img-optimizer/v1/img?src=${src}&w=400`);

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/^image\//);
    expect(Buffer.from(await res.arrayBuffer())).toEqual(OPTIMIZED_BYTES);
  });

  it("sets no cookie on a request without one", async () => {
    const res = await fetch(
      `${baseUrl}/img-optimizer/v1/img/${ASSET_KEY}?w=400`
    );

    expect(res.status).toBe(200);
    expect(res.headers.get("set-cookie")).toBeNull();
  });

  it("writes no session row for a request without a cookie", async () => {
    const sessions = getConnection().getRepository(ExpressSession);
    const before = await sessions.count();

    const res = await fetch(
      `${baseUrl}/img-optimizer/v1/img/${ASSET_KEY}?w=400`
    );
    await res.arrayBuffer();

    expect(res.status).toBe(200);
    expect(await sessions.count()).toBe(before);
  });

  it("ignores a CM auth cookie", async () => {
    const res = await fetch(
      `${baseUrl}/img-optimizer/v1/img/${ASSET_KEY}?w=400`,
      {
        headers: { cookie: "cms_auth_token=not-a-valid-jwt" },
        signal: AbortSignal.timeout(5000),
      }
    );

    expect(res.status).toBe(200);
    expect(res.headers.get("set-cookie")).toBeNull();
    expect(Buffer.from(await res.arrayBuffer())).toEqual(OPTIMIZED_BYTES);
  });

  describe("cache key", () => {
    it("shares one cache entry for the same asset under two src hosts", async () => {
      const first = await fetch(
        `${baseUrl}/img-optimizer/v1/img?src=${querySrc(
          "https://test-assets.example.com"
        )}&w=640`
      );
      expect(first.status).toBe(200);
      expect(first.headers.get("x-cache")).toBe("MISS");
      await waitForUploads(1);

      const second = await fetch(
        `${baseUrl}/img-optimizer/v1/img?src=${querySrc(
          "https://other-cdn.example.net/assets"
        )}&w=640`
      );

      expect(second.status).toBe(200);
      expect(second.headers.get("x-cache")).toBe("HIT");
      expect(Buffer.from(await second.arrayBuffer())).toEqual(OPTIMIZED_BYTES);
      const [cacheKey] = uploadedKeys();
      expect(cacheLookupKeys()).toEqual([cacheKey, cacheKey]);
    });

    it("uses different cache keys for different widths", async () => {
      await fetch(`${baseUrl}/img-optimizer/v1/img/${ASSET_KEY}?w=320`);
      await fetch(`${baseUrl}/img-optimizer/v1/img/${ASSET_KEY}?w=321`);
      await waitForUploads(2);

      const [narrow, wide] = uploadedKeys();
      expect(narrow).not.toEqual(wide);
    });

    it("shares one cache key between the static and query routes", async () => {
      await fetch(`${baseUrl}/img-optimizer/v1/img/${ASSET_KEY}?w=480&q=60`);
      await waitForUploads(1);

      const res = await fetch(
        `${baseUrl}/img-optimizer/v1/img?src=${querySrc(
          "https://other-cdn.example.net"
        )}&w=480&q=60`
      );

      expect(res.headers.get("x-cache")).toBe("HIT");
      const [cacheKey] = uploadedKeys();
      expect(cacheLookupKeys()).toEqual([cacheKey, cacheKey]);
    });

    it("prefixes cache keys with img-opt/", async () => {
      await fetch(`${baseUrl}/img-optimizer/v1/img/${ASSET_KEY}?w=200`);
      await waitForUploads(1);

      expect(uploadedKeys()[0]).toMatch(/^img-opt\/[a-f0-9]{32}$/);
    });
  });

  describe("svg sources", () => {
    it("serves a png asset", async () => {
      stubGetObject(
        new Map([
          [
            PNG_KEY,
            { Body: Buffer.from("png-image"), ContentType: "image/png" },
          ],
        ])
      );

      const res = await fetch(
        `${baseUrl}/img-optimizer/v1/img/${PNG_KEY}?w=400`
      );

      expect(res.status).toBe(200);
      expect(Buffer.from(await res.arrayBuffer())).toEqual(OPTIMIZED_BYTES);
    });

    it("rejects an svg asset with 400 and caches nothing", async () => {
      stubGetObject(
        new Map([[SVG_KEY, { Body: SVG_BYTES, ContentType: "image/svg+xml" }]])
      );

      const res = await fetch(
        `${baseUrl}/img-optimizer/v1/img/${SVG_KEY}?w=400`
      );

      expect(res.status).toBe(400);
      expect(await res.text()).toMatch(/SVG images are not supported/);
      expect(mockS3.putObject).not.toHaveBeenCalled();
    });

    it.each([
      ["stored as image/svg+xml", PNG_KEY, "image/svg+xml"],
      ["stored under an svg key", SVG_KEY, "image/png"],
    ])(
      "rejects an svg past the content sniff window when %s",
      async (_label, key, contentType) => {
        stubGetObject(
          new Map([
            [key, { Body: SVG_AFTER_LONG_PREAMBLE, ContentType: contentType }],
          ])
        );

        const res = await fetch(`${baseUrl}/img-optimizer/v1/img/${key}?w=400`);

        expect(res.status).toBe(400);
        expect(mockS3.putObject).not.toHaveBeenCalled();
      }
    );

    it("rejects svg content stored under a png key", async () => {
      stubGetObject(
        new Map([[PNG_KEY, { Body: SVG_BYTES, ContentType: "image/png" }]])
      );
      const src = querySrc("https://test-assets.example.com", PNG_KEY);

      const res = await fetch(
        `${baseUrl}/img-optimizer/v1/img?src=${src}&w=400`
      );

      expect(res.status).toBe(400);
      expect(await res.text()).toMatch(/SVG images are not supported/);
      expect(mockS3.putObject).not.toHaveBeenCalled();
    });

    it("does not serve svg bytes from the error fallback", async () => {
      const objects = new Map<string, S3Object>([
        [PNG_KEY, { Body: Buffer.from("png-image"), ContentType: "image/png" }],
      ]);
      stubGetObject(objects);
      (sharp as unknown as jest.Mock).mockImplementation(() => {
        objects.set(PNG_KEY, { Body: SVG_BYTES, ContentType: "image/svg+xml" });
        throw new Error("sharp exploded");
      });

      const res = await fetch(
        `${baseUrl}/img-optimizer/v1/img/${PNG_KEY}?w=400`
      );
      const body = Buffer.from(await res.arrayBuffer());

      expect(res.status).toBe(400);
      expect(body.includes(SVG_BYTES)).toBe(false);
      expect(mockS3.putObject).not.toHaveBeenCalled();
      expect(
        mockS3.getObject.mock.calls.filter(([{ Key }]) => Key === PNG_KEY)
      ).toHaveLength(2);
    });
  });

  describe("database", () => {
    it.each<{
      label: string;
      key: string;
      headers: Record<string, string>;
      status: number;
      body?: unknown;
    }>([
      {
        label: "a served image",
        key: ASSET_KEY,
        headers: {},
        status: 200,
      },
      {
        label: "a request with API token headers",
        key: ASSET_KEY,
        headers: {
          "x-plasmic-api-user": "someone@example.com",
          "x-plasmic-api-token": "not-a-real-token",
        },
        status: 200,
      },
      {
        label: "an svg rejected with 400",
        key: SVG_KEY,
        headers: {},
        status: 400,
        body: {
          error: {
            name: "BadRequestError",
            statusCode: 400,
            message: "SVG images are not supported by the image optimizer",
          },
        },
      },
      {
        label: "a missing asset",
        key: "ffffffffffffffffffffffffffffffff.jpg",
        headers: {},
        status: 404,
        body: {
          error: {
            name: "NotFoundError",
            statusCode: 404,
            message: "Image not found in storage",
          },
        },
      },
    ])("runs no query for $label", async ({ key, headers, status, body }) => {
      stubGetObject(
        new Map([
          [ASSET_KEY, { Body: ORIGINAL_BYTES, ContentType: "image/jpeg" }],
          [SVG_KEY, { Body: SVG_BYTES, ContentType: "image/svg+xml" }],
        ])
      );

      const result = await countQueries(() =>
        fetch(`${baseUrl}/img-optimizer/v1/img/${key}?w=400`, { headers })
      );

      expect(result.res.status).toBe(status);
      if (body) {
        expect(JSON.parse(result.body.toString())).toEqual(body);
      } else {
        expect(result.body).toEqual(OPTIMIZED_BYTES);
      }
      expect(result.queries).toBe(0);
    });
  });
});

describe("image optimizer rate limit", () => {
  let baseUrl: string;

  beforeAll(async () => {
    baseUrl = await startApp();
  });

  it("answers over the limit with 429 before any other work", async () => {
    for (let i = 0; i < 60; i++) {
      await (await fetch(`${baseUrl}/img-optimizer/v1/img`)).arrayBuffer();
    }
    mockS3.getObject.mockClear();

    const result = await countQueries(() =>
      fetch(`${baseUrl}/img-optimizer/v1/img/${ASSET_KEY}?w=400`)
    );

    expect(result.res.status).toBe(429);
    expect(result.body.toString()).toBe(
      "Too many requests, please try again later."
    );
    expect(result.res.headers.get("retry-after")).toBe("60");
    expect(result.res.headers.get("cache-control")).toBe(
      "no-store, no-cache, must-revalidate, private"
    );
    expect(result.res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(result.queries).toBe(0);
    expect(mockS3.getObject).not.toHaveBeenCalled();
  });
});

describe("image optimizer client IP behind two proxies in production", () => {
  const VIEWER = "198.51.100.3";
  const OTHER_VIEWER = "198.51.100.4";
  const CDN_EDGE = "192.0.2.10";

  describe.each([
    { label: "a load balancer address", socketAddress: "10.0.12.34" },
    { label: "127.0.0.1", socketAddress: "127.0.0.1" },
  ])("with the socket at $label", ({ socketAddress }) => {
    let baseUrl: string;

    beforeAll(async () => {
      baseUrl = await startApp({ production: true }, { socketAddress });
    });

    async function send(forwardedFor: string) {
      const res = await fetch(`${baseUrl}/img-optimizer/v1/img`, {
        headers: { "x-forwarded-for": forwardedFor },
      });
      await res.arrayBuffer();
      return res.status;
    }

    it("counts a forged X-Forwarded-For against the real client only", async () => {
      for (let i = 0; i < 60; i++) {
        await send(`203.0.113.${i}, ${VIEWER}, ${CDN_EDGE}`);
      }

      expect(await send(`203.0.113.200, ${VIEWER}, ${CDN_EDGE}`)).toBe(429);
      expect(await send(`${VIEWER}, ${CDN_EDGE}`)).toBe(429);
      expect(await send(`${OTHER_VIEWER}, ${CDN_EDGE}`)).not.toBe(429);
    });
  });
});

describe("image optimizer client IP outside production", () => {
  it("keys on the socket and reports the unexpected header", async () => {
    const baseUrl = await startApp({}, { socketAddress: "10.0.12.34" });
    const info = jest.spyOn(PinoLogger.prototype, "info");
    const consoleError = jest
      .spyOn(console, "error")
      .mockImplementation(() => {});
    try {
      const res = await fetch(
        `${baseUrl}/img-optimizer/v1/img/${ASSET_KEY}?w=400`,
        {
          headers: {
            "x-forwarded-for": "203.0.113.7, 198.51.100.2, 192.0.2.10",
            "x-request-id": "req-xff-dev",
          },
        }
      );
      await res.arrayBuffer();

      const accessLog = info.mock.calls
        .map(([, payload]) => payload)
        .find((payload) => payload?.x_request_id === "req-xff-dev");
      expect(accessLog).toEqual(
        expect.objectContaining({ remoteAddr: "10.0.12.34" })
      );
      expect(consoleError).toHaveBeenCalledWith(
        expect.objectContaining({ code: "ERR_ERL_UNEXPECTED_X_FORWARDED_FOR" })
      );
    } finally {
      info.mockRestore();
      consoleError.mockRestore();
    }
  });
});

describe("image optimizer in production", () => {
  let baseUrl: string;

  beforeAll(async () => {
    baseUrl = await startApp({ production: true });
  });

  function headerNames(res: Response) {
    return [...res.headers.keys()].sort();
  }

  it("sends a fixed set of response headers", async () => {
    stubGetObject(
      new Map([
        [ASSET_KEY, { Body: ORIGINAL_BYTES, ContentType: "image/jpeg" }],
        [SVG_KEY, { Body: SVG_BYTES, ContentType: "image/svg+xml" }],
      ])
    );
    const rateLimitHeaders = [
      "ratelimit-limit",
      "ratelimit-policy",
      "ratelimit-remaining",
      "ratelimit-reset",
    ];
    const common = [
      "cache-control",
      "connection",
      "content-length",
      "content-type",
      "date",
      "etag",
      "keep-alive",
      "x-content-type-options",
      "x-frame-options",
    ];

    const image = await fetch(
      `${baseUrl}/img-optimizer/v1/img/${ASSET_KEY}?w=400`
    );
    const svg = await fetch(`${baseUrl}/img-optimizer/v1/img/${SVG_KEY}?w=400`);
    const unknownRoute = await fetch(`${baseUrl}/nope`);

    expect(headerNames(image)).toEqual(
      [...common, ...rateLimitHeaders, "x-cache"].sort()
    );
    expect(headerNames(svg)).toEqual([...common, ...rateLimitHeaders].sort());
    expect(headerNames(unknownRoute)).toEqual([...common].sort());
    for (const res of [image, svg, unknownRoute]) {
      expect(res.headers.get("x-content-type-options")).toBe("nosniff");
      expect(res.headers.get("x-frame-options")).toBe("DENY");
    }
    expect(image.headers.get("cache-control")).toBe(
      "public, max-age=31536000, immutable"
    );
    expect(svg.headers.get("cache-control")).toBe(
      "no-store, no-cache, must-revalidate, private"
    );
    expect(unknownRoute.status).toBe(404);
    expect(await unknownRoute.json()).toEqual({
      error: { name: "NotFoundError", statusCode: 404, message: "Not Found" },
    });
  });

  it("logs the viewer the CDN added as the client, not a forged one", async () => {
    const info = jest.spyOn(PinoLogger.prototype, "info");
    try {
      const res = await fetch(
        `${baseUrl}/img-optimizer/v1/img/${ASSET_KEY}?w=400`,
        {
          headers: {
            "x-forwarded-for": "203.0.113.7, 198.51.100.2, 192.0.2.10",
            "x-request-id": "req-xff",
          },
        }
      );
      await res.arrayBuffer();

      expect(res.status).toBe(200);
      const accessLog = info.mock.calls
        .map(([, payload]) => payload)
        .find((payload) => payload?.x_request_id === "req-xff");
      expect(accessLog).toEqual(
        expect.objectContaining({
          requestStatusCode: 200,
          requestOriginalUrl: `/img-optimizer/v1/img/${ASSET_KEY}?w=400`,
          remoteAddr: "198.51.100.2",
          forwardedFor: "203.0.113.7, 198.51.100.2, 192.0.2.10",
          socketRemoteAddr: expect.stringMatching(
            /^(::1|::ffff:127\.0\.0\.1|127\.0\.0\.1)$/
          ),
          requestHost: expect.stringMatching(/^localhost:\d+$/),
          userAgent: expect.any(String),
          duration: expect.any(Number),
        })
      );
    } finally {
      info.mockRestore();
    }
  });
});

describe("image optimizer metrics", () => {
  let baseUrl: string;

  beforeAll(async () => {
    baseUrl = await startApp();
  });

  it("serves images but no /metrics endpoint", async () => {
    const image = await fetch(
      `${baseUrl}/img-optimizer/v1/img/${ASSET_KEY}?w=400`
    );
    const metrics = await fetch(`${baseUrl}/metrics`);

    expect(image.status).toBe(200);
    expect(Buffer.from(await image.arrayBuffer())).toEqual(OPTIMIZED_BYTES);
    expect(metrics.status).toBe(404);
    expect(await metrics.json()).toEqual({
      error: { name: "NotFoundError", statusCode: 404, message: "Not Found" },
    });
  });
});
