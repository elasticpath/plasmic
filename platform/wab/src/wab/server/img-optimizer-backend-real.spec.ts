/** @jest-environment node */
process.env.SITE_ASSETS_BUCKET = "test-bucket";
process.env.SITE_ASSETS_BASE_URL = "https://test-assets.example.com/";
process.env.S3_ENDPOINT = "https://s3.amazonaws.com";

jest.mock("aws-sdk/clients/s3");
jest.mock("sharp");

import { closeDbConnections } from "@/wab/server/db/DbCon";
import S3 from "aws-sdk/clients/s3";
import http from "http";
import { AddressInfo } from "net";
import { register } from "prom-client";
import sharp from "sharp";

const ASSET_KEY = "abcdef0123456789abcdef0123456789.jpg";
const ORIGINAL_BYTES = Buffer.from("original-image");
const OPTIMIZED_BYTES = Buffer.from("optimized-image");

const s3 = { getObject: jest.fn(), upload: jest.fn() };

function stubS3AndSharp() {
  s3.getObject.mockImplementation(({ Key }: { Key: string }) => ({
    promise: () =>
      Key === ASSET_KEY
        ? Promise.resolve({ Body: ORIGINAL_BYTES, ContentType: "image/jpeg" })
        : Promise.reject(
            Object.assign(new Error("NoSuchKey"), { code: "NoSuchKey" })
          ),
  }));
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
});
