import {
  _testonly,
  extractBundleKeyProjectIds,
  genPublishedLoaderCodeBundle,
  LOADER_CODEGEN_OPTS_DEFAULTS,
} from "@/wab/server/loader/gen-code-bundle";
import { resolveProjectDeps } from "@/wab/server/loader/resolve-projects";
import { withSpan } from "@/wab/server/util/apm-util";
import { tryGetS3CacheEntry } from "@/wab/server/util/s3-util";

jest.mock("@/wab/server/util/s3-util", () => ({
  tryGetS3CacheEntry: jest.fn(),
  upsertS3CacheEntry: jest.fn(),
}));

jest.mock("@/wab/server/loader/resolve-projects", () => ({
  resolveProjectDeps: jest.fn(),
  // Pure helper used by extractBundleKeyProjectIds — inlined to avoid loading DB deps
  extractProjectId: (spec: string) =>
    spec.includes("@") ? spec.split("@")[0] : spec,
  mkVersionToSync: (version: string, indirect?: boolean) => ({
    version,
    indirect: !!indirect,
  }),
}));

jest.mock("@/wab/server/workers/worker-utils", () => ({
  ensureDevFlags: jest.fn(),
}));

jest.mock("@/wab/server/observability", () => ({
  logger: () => ({ info: jest.fn(), error: jest.fn(), debug: jest.fn() }),
}));

jest.mock("@/wab/server/util/apm-util", () => ({
  withSpan: jest.fn(),
  withTimeSpent: jest.fn(),
}));

jest.mock("typeorm", () => ({
  getConnection: jest.fn(() => ({ options: {} })),
}));

describe("makeBundleBucketPath/extractBundleKeyProjectIds", () => {
  it("should work", () => {
    const bundleKey = _testonly.makeBundleBucketPath({
      projectVersions: {
        p1: { version: "10.0.0", indirect: false },
        p2: { version: "1.2.3", indirect: false },
        p3: { version: "0.0.1", indirect: true },
      },
      platform: "react",
      loaderVersion: 1,
      browserOnly: true,
      exportOpts: LOADER_CODEGEN_OPTS_DEFAULTS,
    });
    expect(bundleKey).toEqual(
      "bundle/cb=20/loaderVersion=1/ps=p1@10.0.0,p2@1.2.3/platform=react/browserOnly=true/opts=22a86211efc9ac67440fb332014652a6010e993f48c3068b936afe2128f03e3c"
    );
    expect(extractBundleKeyProjectIds(bundleKey)).toEqual(["p1", "p2"]);
  });
});

describe("genPublishedLoaderCodeBundle fast-path", () => {
  const mockTryGetS3CacheEntry = tryGetS3CacheEntry as jest.Mock;
  const mockResolveProjectDeps = resolveProjectDeps as jest.Mock;

  const baseOpts = {
    platformOptions: {},
    projectVersions: { proj123: { version: "1.0.0", indirect: false } },
    loaderVersion: 10,
    browserOnly: false,
    i18nKeyScheme: undefined as never,
    i18nTagPrefix: undefined,
  };

  beforeEach(() => {
    // resetMocks:true (jest.config.ts) resets all mock implementations before
    // each test, including the factory-set implementation. Re-establish withSpan
    // so it actually invokes its callback, enabling the full call chain.
    (withSpan as jest.Mock).mockImplementation(
      (_name: string, fn: () => Promise<unknown>) => fn()
    );
  });

  it("returns cached bundle and skips dep resolution on S3 hit", async () => {
    const fakeBundle = { components: [], external: [] };
    mockTryGetS3CacheEntry.mockResolvedValue(fakeBundle);

    const result = await genPublishedLoaderCodeBundle(
      {} as any,
      {} as any,
      baseOpts
    );

    expect(result).toBe(fakeBundle);
    expect(result.bundleKey).toBeDefined();
    expect(mockResolveProjectDeps).not.toHaveBeenCalled();
  });

  it("calls dep resolution on S3 miss", async () => {
    mockTryGetS3CacheEntry.mockResolvedValue(null);
    mockResolveProjectDeps.mockResolvedValue({});

    // Will throw eventually when pool.exec is called on the empty mock object,
    // but we only care that dep resolution was reached (not short-circuited).
    await expect(
      genPublishedLoaderCodeBundle({} as any, {} as any, baseOpts)
    ).rejects.toThrow();

    expect(mockResolveProjectDeps).toHaveBeenCalled();
  });
});
