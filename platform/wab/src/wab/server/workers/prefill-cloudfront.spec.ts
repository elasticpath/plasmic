import * as genCodeBundleMod from "@/wab/server/loader/gen-code-bundle";
import * as resolveProjectsMod from "@/wab/server/loader/resolve-projects";
import { withDb } from "@/wab/server/test/backend-util";
import { prefillCloudfront } from "@/wab/server/workers/prefill-cloudfront";

const mockSend = jest.fn();
jest.mock("@aws-sdk/client-cloudfront", () => ({
  CloudFrontClient: jest.fn(() => ({ send: mockSend })),
  CreateInvalidationCommand: jest.fn((input) => input),
}));

describe("Prefill cloudfront", () => {
  describe("upsertLoaderPublishmentEntities", () => {
    it("should insert loader publishment for each project id", async () => {
      await withDb(async (sudo) => {
        const publishment = {
          platform: "react",
          projectIds: ["p1", "p2", "p3"],
        };
        // doing it twice, it should be upserted
        // TODO: mock Date
        await sudo.upsertLoaderPublishmentEntities({
          projectIds: publishment.projectIds,
          platform: publishment.platform,
          loaderVersion: 1,
          browserOnly: false,
          i18nKeyScheme: undefined,
          i18nTagPrefix: undefined,
          appDir: undefined,
        });
        await sudo.upsertLoaderPublishmentEntities({
          projectIds: publishment.projectIds,
          platform: publishment.platform,
          loaderVersion: 1,
          browserOnly: false,
          i18nKeyScheme: undefined,
          i18nTagPrefix: undefined,
          appDir: undefined,
        });
        for (const proj of ["p1", "p2", "p3"]) {
          const recentLoaderPublishments =
            await sudo.getRecentLoaderPublishments(proj);
          expect(recentLoaderPublishments.length).toBe(1);
          expect(recentLoaderPublishments[0]).toMatchObject({
            projectId: proj,
            ...publishment,
          });
        }
      });
    });
  });

  describe("prefillCloudfront", () => {
    const CODEGEN_HOST = "http://cghost";
    const PROJECT_ID = "P1";
    const PKG_ID = "p1-pkgId-1";
    const PKG_VERSION = "0.0.1";
    const PKG_VERSION_ID = "pkg-version-1";

    beforeEach(() => {
      jest.resetAllMocks();
      global.fetch = jest.fn().mockResolvedValue({ ok: true } as Response);
    });

    afterEach(() => {
      delete process.env.CODEGEN_HOST;
      delete process.env.CLOUDFRONT_DISTRIBUTION_ID;
    });

    function setupMocks(sudo: any) {
      sudo.getPkgById = jest
        .fn()
        .mockImplementation(() => ({ projectId: PROJECT_ID }));

      jest.mock("@/wab/server/loader/resolve-projects");
      const getResolvedProjectVersions = jest
        .fn()
        .mockImplementation((_mgr, projectIds) => {
          if (projectIds.length === 3) {
            return ["p1@0.0.1", "p2@0.0.2", "p3@0.0.3"];
          } else {
            return ["p1@0.0.1"];
          }
        });
      (resolveProjectsMod as any).getResolvedProjectVersions =
        getResolvedProjectVersions;

      jest.mock("@/wab/server/loader/gen-code-bundle");
      const genPublishedLoaderCodeBundle = ((
        genCodeBundleMod as any
      ).genPublishedLoaderCodeBundle = jest.fn());

      sudo.getRecentLoaderPublishments = jest
        .fn()
        .mockImplementation((projectId) => [
          {
            projectId,
            platform: "react",
            projectIds: ["p1", "p2", "p3"],
            loaderVersion: 8,
            browserOnly: false,
          },
          {
            projectId,
            platform: "nextjs",
            projectIds: ["p1", "p2", "p3"],
            loaderVersion: 8,
            browserOnly: false,
            i18nKeyScheme: "hash",
            i18nTagPrefix: "n",
            appDir: true,
          },
          {
            projectId,
            platform: "react",
            projectIds: ["p1"],
            loaderVersion: 8,
            browserOnly: true,
          },
          {
            projectId,
            platform: "react",
            projectIds: ["p1"],
            browserOnly: true,
            loaderVersion: 1,
          },
        ]);

      sudo.getPkgByProjectId = jest.fn().mockImplementation(() => ({
        id: PKG_ID,
        projectId: PROJECT_ID,
      }));

      sudo.getPkgVersionById = jest.fn().mockImplementation(() => ({
        pkgId: PKG_ID,
        id: PKG_VERSION_ID,
        version: PKG_VERSION,
      }));

      sudo.updatePkgVersion = jest.fn();

      return { getResolvedProjectVersions, genPublishedLoaderCodeBundle };
    }

    it("should trigger request for each publishment", async () => {
      await withDb(async (sudo) => {
        const { getResolvedProjectVersions, genPublishedLoaderCodeBundle } =
          setupMocks(sudo);

        const pool: any = {};

        await prefillCloudfront(sudo, pool, PKG_VERSION_ID);

        expect(getResolvedProjectVersions).toHaveBeenNthCalledWith(1, sudo, [
          "p1",
          "p2",
          "p3",
        ]);
        expect(getResolvedProjectVersions).toHaveBeenNthCalledWith(2, sudo, [
          "p1",
          "p2",
          "p3",
        ]);
        expect(getResolvedProjectVersions).toHaveBeenNthCalledWith(3, sudo, [
          "p1",
        ]);
        expect(sudo.getRecentLoaderPublishments).toBeCalledWith(PROJECT_ID);
        expect(genPublishedLoaderCodeBundle).toHaveBeenNthCalledWith(
          1,
          sudo,
          pool,
          {
            platform: "react",
            platformOptions: {
              nextjs: {
                appDir: false,
              },
            },
            loaderVersion: 8,
            projectVersions: {
              p1: { version: "0.0.1", indirect: false },
              p2: { version: "0.0.2", indirect: false },
              p3: { version: "0.0.3", indirect: false },
            },
            browserOnly: false,
          }
        );
        expect(genPublishedLoaderCodeBundle).toHaveBeenNthCalledWith(
          2,
          sudo,
          pool,
          {
            platform: "nextjs",
            platformOptions: {
              nextjs: {
                appDir: true,
              },
            },
            loaderVersion: 8,
            projectVersions: {
              p1: { version: "0.0.1", indirect: false },
              p2: { version: "0.0.2", indirect: false },
              p3: { version: "0.0.3", indirect: false },
            },
            browserOnly: false,
            i18nKeyScheme: "hash",
            i18nTagPrefix: "n",
          }
        );
        expect(genPublishedLoaderCodeBundle).toHaveBeenNthCalledWith(
          3,
          sudo,
          pool,
          {
            platform: "react",
            platformOptions: {
              nextjs: {
                appDir: false,
              },
            },
            loaderVersion: 8,
            projectVersions: {
              p1: { version: "0.0.1", indirect: false },
            },
            browserOnly: true,
          }
        );

        expect(sudo.updatePkgVersion).toBeCalledWith(
          PKG_ID,
          PKG_VERSION,
          undefined,
          {
            isPrefilled: true,
          }
        );
      });
    });

    it("should warm CloudFront versioned cache after setting isPrefilled", async () => {
      await withDb(async (sudo) => {
        setupMocks(sudo);
        process.env.CODEGEN_HOST = CODEGEN_HOST;

        const pool: any = {};
        const updatePkgVersionMock = sudo.updatePkgVersion as jest.Mock;

        await prefillCloudfront(sudo, pool, PKG_VERSION_ID);

        // isPrefilled must be set before any warming fetch is called
        const updateCallOrder = updatePkgVersionMock.mock.invocationCallOrder[0];
        const firstFetchCallOrder = (global.fetch as jest.Mock).mock
          .invocationCallOrder[0];
        expect(updateCallOrder).toBeLessThan(firstFetchCallOrder);

        // One warming GET per unique publishment (4 publishments, but 2 share
        // the same dedup key so expect 3 unique fetches)
        expect(global.fetch).toHaveBeenCalledTimes(3);

        // Verify URL construction for a known publishment
        const fetchedUrls = (global.fetch as jest.Mock).mock.calls.map(
          (c: any[]) => c[0]
        );
        expect(
          fetchedUrls.some((url: string) =>
            url.includes("/api/v1/loader/code/versioned") &&
            url.includes("platform=react") &&
            url.includes("loaderVersion=8") &&
            url.includes("projectId=p1%400.0.1") &&
            url.includes("projectId=p2%400.0.2") &&
            url.includes("projectId=p3%400.0.3") &&
            !url.includes("browserOnly")
          )
        ).toBe(true);

        expect(
          fetchedUrls.some((url: string) =>
            url.includes("platform=nextjs") &&
            url.includes("nextjsAppDir=true") &&
            url.includes("i18nKeyScheme=hash") &&
            url.includes("i18nTagPrefix=n")
          )
        ).toBe(true);

        expect(
          fetchedUrls.some((url: string) =>
            url.includes("platform=react") &&
            url.includes("browserOnly=true") &&
            url.includes("projectId=p1%400.0.1") &&
            !url.includes("projectId=p2")
          )
        ).toBe(true);
      });
    });

    it("should invalidate published CloudFront paths after warming", async () => {
      await withDb(async (sudo) => {
        setupMocks(sudo);
        process.env.CODEGEN_HOST = CODEGEN_HOST;
        process.env.CLOUDFRONT_DISTRIBUTION_ID = "EDFDVBD6EXAMPLE";

        const pool: any = {};

        await prefillCloudfront(sudo, pool, PKG_VERSION_ID);

        // Warming must happen before invalidation
        const firstFetchOrder = (global.fetch as jest.Mock).mock
          .invocationCallOrder[0];
        const invalidationOrder = mockSend.mock.invocationCallOrder[0];
        expect(firstFetchOrder).toBeLessThan(invalidationOrder);

        expect(mockSend).toHaveBeenCalledTimes(1);
        expect(mockSend).toHaveBeenCalledWith(
          expect.objectContaining({
            DistributionId: "EDFDVBD6EXAMPLE",
            InvalidationBatch: expect.objectContaining({
              CallerReference: PKG_VERSION_ID,
              Paths: expect.objectContaining({
                Quantity: 4,
                Items: expect.arrayContaining([
                  "/api/v1/loader/code/published*",
                  "/api/v1/loader/repr-v2/published*",
                  "/api/v1/loader/repr-v3/published*",
                  "/api/v1/loader/html/published*",
                ]),
              }),
            }),
          })
        );
      });
    });

    it("should skip invalidation when CLOUDFRONT_DISTRIBUTION_ID is not set", async () => {
      await withDb(async (sudo) => {
        setupMocks(sudo);
        delete process.env.CLOUDFRONT_DISTRIBUTION_ID;

        const pool: any = {};

        await prefillCloudfront(sudo, pool, PKG_VERSION_ID);

        expect(mockSend).not.toHaveBeenCalled();
      });
    });

    it("should not fail the publish flow if invalidation throws", async () => {
      await withDb(async (sudo) => {
        setupMocks(sudo);
        process.env.CLOUDFRONT_DISTRIBUTION_ID = "EDFDVBD6EXAMPLE";
        mockSend.mockRejectedValueOnce(new Error("CloudFront API error"));

        const pool: any = {};

        await expect(
          prefillCloudfront(sudo, pool, PKG_VERSION_ID)
        ).resolves.not.toThrow();

        expect(sudo.updatePkgVersion).toHaveBeenCalledWith(
          PKG_ID,
          PKG_VERSION,
          undefined,
          { isPrefilled: true }
        );
      });
    });
  });
});
