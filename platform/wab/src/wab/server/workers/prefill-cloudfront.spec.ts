import * as genCodeBundleMod from "@/wab/server/loader/gen-code-bundle";
import * as resolveProjectsMod from "@/wab/server/loader/resolve-projects";
import { withDb } from "@/wab/server/test/backend-util";
import {
  prefillCloudfront,
  _resetCloudfrontClientForTest,
} from "@/wab/server/workers/prefill-cloudfront";

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
    const PROJECT_ID = "P1";
    const PKG_ID = "p1-pkgId-1";
    const PKG_VERSION = "0.0.1";
    const PKG_VERSION_ID = "pkg-version-1";

    beforeEach(() => {
      jest.restoreAllMocks();
      _resetCloudfrontClientForTest();
      // Re-establish mock implementations (restoreAllMocks clears them)
      const cf = require("@aws-sdk/client-cloudfront");
      (cf.CloudFrontClient as jest.Mock).mockImplementation(() => ({
        send: mockSend,
      }));
      (cf.CreateInvalidationCommand as jest.Mock).mockImplementation(
        (input: any) => input
      );
    });

    afterEach(() => {
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

        expect(getResolvedProjectVersions).toHaveBeenCalledTimes(4);
        expect(genPublishedLoaderCodeBundle).toHaveBeenCalledTimes(4);

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

    it("should invalidate published CloudFront paths after bundle generation", async () => {
      await withDb(async (sudo) => {
        setupMocks(sudo);
        process.env.CLOUDFRONT_DISTRIBUTION_ID = "EDFDVBD6EXAMPLE";

        const pool: any = {};

        await prefillCloudfront(sudo, pool, PKG_VERSION_ID);

        // codePaths deduplicates on sorted projectId strings (not on all
        // platform/loaderVersion fields), so publishments sharing the same
        // projectId set collapse to one invalidation path. Here [p1,p2,p3]
        // appears in 2 publishments and [p1] in 2 others → 2 unique code paths.
        expect(mockSend).toHaveBeenCalledTimes(1);
        expect(mockSend).toHaveBeenCalledWith(
          expect.objectContaining({
            DistributionId: "EDFDVBD6EXAMPLE",
            InvalidationBatch: expect.objectContaining({
              CallerReference: expect.stringContaining(PKG_VERSION_ID),
              Paths: expect.objectContaining({
                // 2 unique code paths + 3 repr/html paths = 5
                Quantity: 5,
                Items: expect.arrayContaining([
                  "/api/v1/loader/code/published/p1,p2,p3*",
                  "/api/v1/loader/code/published/p1*",
                  "/api/v1/loader/repr-v2/published/P1*",
                  "/api/v1/loader/repr-v3/published/P1*",
                  "/api/v1/loader/html/published/P1*",
                ]),
              }),
            }),
          })
        );
      });
    });

    it("should continue generating remaining variants if one bundle fails", async () => {
      await withDb(async (sudo) => {
        const { genPublishedLoaderCodeBundle } = setupMocks(sudo);
        process.env.CLOUDFRONT_DISTRIBUTION_ID = "EDFDVBD6EXAMPLE";

        // Fail only the second variant
        (genPublishedLoaderCodeBundle as jest.Mock).mockResolvedValueOnce(undefined);
        (genPublishedLoaderCodeBundle as jest.Mock).mockRejectedValueOnce(
          new Error("esbuild OOM")
        );

        const pool: any = {};

        // Should not throw — per-variant errors are non-fatal
        await expect(prefillCloudfront(sudo, pool, PKG_VERSION_ID)).resolves.not.toThrow();

        // Invalidation still proceeds despite one bundle failure
        expect(mockSend).toHaveBeenCalledTimes(1);
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
