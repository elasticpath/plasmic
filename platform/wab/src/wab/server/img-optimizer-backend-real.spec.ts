/** @jest-environment node */
process.env.SITE_ASSETS_BUCKET = "test-bucket";
process.env.SITE_ASSETS_BASE_URL = "https://test-assets.example.com/";
process.env.S3_ENDPOINT = "https://s3.amazonaws.com";

jest.mock("aws-sdk/clients/s3");
jest.mock("sharp");

import { closeDbConnections } from "@/wab/server/db/DbCon";
import { ExpressSession } from "@/wab/server/entities/Entities";
import S3 from "aws-sdk/clients/s3";
import http from "http";
import { AddressInfo } from "net";
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

const s3 = { getObject: jest.fn(), upload: jest.fn() };

function stubGetObject(objects: Map<string, S3Object>) {
  s3.getObject.mockImplementation(({ Key }: { Key: string }) => ({
    promise: () =>
      objects.has(Key)
        ? Promise.resolve(objects.get(Key))
        : Promise.reject(
            Object.assign(new Error("NoSuchKey"), { code: "NoSuchKey" })
          ),
  }));
}

function stubS3AndSharp() {
  stubGetObject(
    new Map([[ASSET_KEY, { Body: ORIGINAL_BYTES, ContentType: "image/jpeg" }]])
  );
  s3.upload.mockImplementation(() => ({
    promise: () => Promise.resolve({ Location: "https://s3/cached" }),
  }));
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

describe("image optimizer HTTP boundary", () => {
  let server: http.Server;
  let baseUrl: string;
  let cleanupDatabase: () => Promise<void>;

  beforeAll(async () => {
    (S3 as jest.MockedClass<typeof S3>).mockImplementation(() => s3 as any);

    // Required here, not imported: img-optimizer builds its S3 client on load.
    const { createDatabase, testConfig } =
      require("@/wab/server/test/backend-util") as typeof import("@/wab/server/test/backend-util");
    const { createImgOptimizerApp } =
      require("@/wab/server/img-optimizer-backend-real") as typeof import("@/wab/server/img-optimizer-backend-real");

    const db = await createDatabase("img_optimizer_test");
    cleanupDatabase = db.cleanup;

    const app = await createImgOptimizerApp(
      testConfig(db.dburi, "http://localhost")
    );
    server = await new Promise<http.Server>((resolve) => {
      const s = app.listen(0, () => resolve(s));
    });
    baseUrl = `http://localhost:${(server.address() as AddressInfo).port}`;
  });

  beforeEach(() => {
    stubS3AndSharp();
  });

  afterAll(async () => {
    if (server) {
      await new Promise<void>((resolve, reject) =>
        server.close((err) => (err ? reject(err) : resolve()))
      );
    }
    await closeDbConnections();
    register.clear();
    await cleanupDatabase?.();
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
    const src = encodeURIComponent(
      `https://test-assets.example.com/${ASSET_KEY}`
    );
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

  describe("svg sources", () => {
    it("serves a png asset", async () => {
      stubGetObject(
        new Map([
          [PNG_KEY, { Body: Buffer.from("png-image"), ContentType: "image/png" }],
        ])
      );

      const res = await fetch(`${baseUrl}/img-optimizer/v1/img/${PNG_KEY}?w=400`);

      expect(res.status).toBe(200);
      expect(Buffer.from(await res.arrayBuffer())).toEqual(OPTIMIZED_BYTES);
    });

    it("rejects an svg asset with 400 and caches nothing", async () => {
      stubGetObject(
        new Map([[SVG_KEY, { Body: SVG_BYTES, ContentType: "image/svg+xml" }]])
      );

      const res = await fetch(`${baseUrl}/img-optimizer/v1/img/${SVG_KEY}?w=400`);

      expect(res.status).toBe(400);
      expect(await res.text()).toMatch(/SVG images are not supported/);
      expect(s3.upload).not.toHaveBeenCalled();
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
        expect(s3.upload).not.toHaveBeenCalled();
      }
    );

    it("rejects svg content stored under a png key", async () => {
      stubGetObject(
        new Map([[PNG_KEY, { Body: SVG_BYTES, ContentType: "image/png" }]])
      );
      const src = encodeURIComponent(`https://test-assets.example.com/${PNG_KEY}`);

      const res = await fetch(`${baseUrl}/img-optimizer/v1/img?src=${src}&w=400`);

      expect(res.status).toBe(400);
      expect(await res.text()).toMatch(/SVG images are not supported/);
      expect(s3.upload).not.toHaveBeenCalled();
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

      const res = await fetch(`${baseUrl}/img-optimizer/v1/img/${PNG_KEY}?w=400`);
      const body = Buffer.from(await res.arrayBuffer());

      expect(res.status).toBe(400);
      expect(body.includes(SVG_BYTES)).toBe(false);
      expect(s3.upload).not.toHaveBeenCalled();
      expect(
        s3.getObject.mock.calls.filter(([{ Key }]) => Key === PNG_KEY)
      ).toHaveLength(2);
    });
  });
});
