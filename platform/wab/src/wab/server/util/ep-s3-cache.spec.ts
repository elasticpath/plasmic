import { _testonly, tryGetS3CacheEntry } from "@/wab/server/util/ep-s3-cache";

jest.mock("@aws-sdk/client-s3", () => ({
  S3Client: jest.fn(),
  GetObjectCommand: jest.fn(),
}));
jest.mock("@/wab/server/observability", () => ({
  logger: () => ({ info: jest.fn(), error: jest.fn() }),
}));
jest.mock("@/wab/server/util/server-timing", () => ({
  withTiming: (_name: string, fn: () => unknown) => fn(),
}));

import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";

/** v3 bodies are streams, exposing transformToString rather than a Buffer. */
function mkBody(content: string) {
  return { transformToString: async () => content };
}

describe("tryGetS3CacheEntry", () => {
  const s3Instance = {
    send: jest.fn(),
  };

  beforeEach(() => {
    // resetMocks:true wipes mock implementations before each test; re-establish
    // the S3 constructor mock and reset the singleton so makeS3Client() creates
    // a fresh instance using the current mock.
    _testonly.resetS3Client();
    (S3Client as unknown as jest.Mock).mockImplementation(() => s3Instance);
  });

  it("returns deserialized value on cache hit", async () => {
    s3Instance.send.mockResolvedValue({
      Body: mkBody(JSON.stringify({ result: 42 })),
    });

    const result = await tryGetS3CacheEntry({
      bucket: "my-bucket",
      key: "some/key",
      deserialize: (str) => JSON.parse(str),
    });

    expect(result).toEqual({ result: 42 });
    expect(GetObjectCommand).toHaveBeenCalledWith({
      Bucket: "my-bucket",
      Key: "some/key",
    });
  });

  it("returns null on NoSuchKey", async () => {
    const err = Object.assign(new Error("NoSuchKey"), { name: "NoSuchKey" });
    s3Instance.send.mockRejectedValue(err);

    const result = await tryGetS3CacheEntry({
      bucket: "my-bucket",
      key: "some/key",
      deserialize: (str) => JSON.parse(str),
    });

    expect(result).toBeNull();
  });

  it("returns null on unexpected S3 errors rather than throwing", async () => {
    s3Instance.send.mockRejectedValue(new Error("connection refused"));

    const result = await tryGetS3CacheEntry({
      bucket: "my-bucket",
      key: "some/key",
      deserialize: (str) => JSON.parse(str),
    });

    expect(result).toBeNull();
  });

  it("returns null when deserialization throws", async () => {
    s3Instance.send.mockResolvedValue({ Body: mkBody("not valid json {") });

    const result = await tryGetS3CacheEntry({
      bucket: "my-bucket",
      key: "some/key",
      deserialize: (str) => JSON.parse(str),
    });

    expect(result).toBeNull();
  });

  it("re-throws TimeoutError rather than returning null", async () => {
    const err = Object.assign(new Error("Request timed out"), {
      name: "TimeoutError",
    });
    s3Instance.send.mockRejectedValue(err);

    await expect(
      tryGetS3CacheEntry({
        bucket: "my-bucket",
        key: "some/key",
        deserialize: (str) => JSON.parse(str),
      })
    ).rejects.toThrow("Request timed out");
  });
});
