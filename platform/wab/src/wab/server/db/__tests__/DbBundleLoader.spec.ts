import { getLastBundleVersion } from "@/wab/server/db/BundleMigrator";
import {
  loadDepPackages,
  unbundleWithDeps,
} from "@/wab/server/db/DbBundleLoader";
import { Bundler } from "@/wab/shared/bundler";
import { createSite } from "@/wab/shared/core/sites";

const migratedIds: string[] = [];

jest.mock("@/wab/server/db/BundleMigrator", () => {
  const actual = jest.requireActual("@/wab/server/db/BundleMigrator");
  return {
    ...actual,
    getMigratedBundle: async (entity: { id: string }) => {
      migratedIds.push(entity.id);
      return actual.getMigratedBundle(entity);
    },
  };
});

async function mkPkgVersion(id: string, depIds: string[]) {
  const bundle = new Bundler().bundle(
    createSite(),
    id,
    await getLastBundleVersion()
  );
  bundle.deps = depIds;
  return { id, model: JSON.stringify(bundle) };
}

async function mkDbMgr() {
  const pkgs = new Map<string, { id: string; model: string }>();
  for (const [id, deps] of [
    ["base", []],
    ["mid", ["base"]],
    ["top", ["mid", "base"]],
  ] as const) {
    pkgs.set(id, await mkPkgVersion(id, [...deps]));
  }
  const fetchedIds: string[] = [];
  const dbMgr: any = {
    getPkgVersionById: async (id: string) => {
      fetchedIds.push(id);
      return pkgs.get(id);
    },
  };
  return { dbMgr, fetchedIds, pkgs };
}

describe("DbBundleLoader", () => {
  beforeEach(() => {
    migratedIds.length = 0;
  });

  it("migrates each dependency once when unbundling with dependencies", async () => {
    const { dbMgr, fetchedIds } = await mkDbMgr();
    const main = JSON.parse((await mkPkgVersion("main", ["top"])).model);

    await unbundleWithDeps(dbMgr, new Bundler(), "main", main);

    expect(fetchedIds.sort()).toEqual(["base", "mid", "top"]);
    expect(migratedIds.sort()).toEqual(["base", "mid", "top"]);
  });

  it("unbundles every dependency into the bundler", async () => {
    const { dbMgr, pkgs } = await mkDbMgr();
    const main = JSON.parse((await mkPkgVersion("main", ["top"])).model);

    const bundler = new Bundler();
    await unbundleWithDeps(dbMgr, bundler, "main", main);

    for (const [id, pkg] of pkgs) {
      const { root } = JSON.parse(pkg.model);
      expect(bundler.objByAddr({ uuid: id, iid: root })).toBeDefined();
    }
  });

  it("returns dependencies in load order", async () => {
    const { dbMgr } = await mkDbMgr();
    const main = JSON.parse((await mkPkgVersion("main", ["top"])).model);

    const loaded = await loadDepPackages(dbMgr, main);

    expect(loaded.map((p) => p.id)).toEqual(["base", "mid", "top"]);
  });
});
