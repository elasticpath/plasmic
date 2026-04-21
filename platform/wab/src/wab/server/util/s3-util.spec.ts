import { _testonly, tryGetS3CacheEntry } from "@/wab/server/util/s3-util";

jest.mock("aws-sdk/clients/s3");
jest.mock("@/wab/server/observability", () => ({
  logger: () => ({ info: jest.fn(), error: jest.fn() }),
}));

import S3 from "aws-sdk/clients/s3";

describe("tryGetS3CacheEntry", () => {
  const s3Instance = {
    getObject: jest.fn(),
  };

  beforeEach(() => {
    // resetMocks:true wipes mock implementations before each test; re-establish
    // the S3 constructor mock and reset the singleton so getS3Client() creates
    // a fresh instance using the current mock.
    _testonly.resetS3Client();
    (S3 as unknown as jest.Mock).mockImplementation(() => s3Instance);
  });

  it("returns deserialized value on cache hit", async () => {
    s3Instance.getObject.mockReturnValue({
      promise: () =>
        Promise.resolve({ Body: Buffer.from(JSON.stringify({ result: 42 })) }),
    });

    const result = await tryGetS3CacheEntry({
      bucket: "my-bucket",
      key: "some/key",
      deserialize: (str) => JSON.parse(str),
    });

    expect(result).toEqual({ result: 42 });
    expect(s3Instance.getObject).toHaveBeenCalledWith({
      Bucket: "my-bucket",
      Key: "some/key",
    });
  });

  it("returns null on NoSuchKey", async () => {
    const err = Object.assign(new Error("NoSuchKey"), { code: "NoSuchKey" });
    s3Instance.getObject.mockReturnValue({
      promise: () => Promise.reject(err),
    });

    const result = await tryGetS3CacheEntry({
      bucket: "my-bucket",
      key: "some/key",
      deserialize: (str) => JSON.parse(str),
    });

    expect(result).toBeNull();
  });

  it("returns null on unexpected S3 errors rather than throwing", async () => {
    s3Instance.getObject.mockReturnValue({
      promise: () => Promise.reject(new Error("connection refused")),
    });

    const result = await tryGetS3CacheEntry({
      bucket: "my-bucket",
      key: "some/key",
      deserialize: (str) => JSON.parse(str),
    });

    expect(result).toBeNull();
  });

  it("re-throws TimeoutError rather than returning null", async () => {
    const err = Object.assign(new Error("Request timed out"), {
      code: "TimeoutError",
    });
    s3Instance.getObject.mockReturnValue({
      promise: () => Promise.reject(err),
    });

    await expect(
      tryGetS3CacheEntry({
        bucket: "my-bucket",
        key: "some/key",
        deserialize: (str) => JSON.parse(str),
      })
    ).rejects.toThrow("Request timed out");
  });
});
