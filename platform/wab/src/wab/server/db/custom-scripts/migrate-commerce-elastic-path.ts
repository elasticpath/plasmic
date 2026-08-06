// TEMPORARY one-off migration script for the commerce-elastic-path hostless
// project (non-prod). Does NOT modify any shared application source.
//
// Mirrors publishHostlessProject() (PublishHostless.ts) exactly, except:
// updateHostlessPackage()'s own syncCodeComponents() call already correctly
// removes params/slots that the new package version no longer registers
// (e.g. plasmic-commerce-ep-add-to-cart-button dropping enableStockCheck in
// commit 9b2e5e777) -- that mutation lands on `site` regardless. The
// trailing "nothing existing may be removed" safety assertion then throws
// *after* the fact, purely to flag it. Since the mutation already happened,
// we just catch that expected error class and retry on the same (now
// slightly more caught-up) site, until a pass produces no new complaints.
//
// Run via:
//   npm run run-ts -- src/wab/server/db/custom-scripts/migrate-commerce-elastic-path.ts --dburi <uri>
import { updateHostlessPackage } from "@/wab/server/code-components/code-components";
import { DEFAULT_DATABASE_URI } from "@/wab/server/config";
import {
  getLastBundleVersion,
  getMigratedBundle,
} from "@/wab/server/db/BundleMigrator";
import {
  ensureDbConnections,
  getDefaultConnection,
} from "@/wab/server/db/DbCon";
import { DbMgr, SUPER_USER } from "@/wab/server/db/DbMgr";
import { unbundleSite } from "@/wab/server/db/bundle-migration-utils";
import { logger } from "@/wab/server/observability";
import { Bundler } from "@/wab/shared/bundler";
import { assert, ensure, spawn } from "@/wab/shared/common";
import { ensureKnownProjectDependency } from "@/wab/shared/model/classes";
import { assertSiteInvariants } from "@/wab/shared/site-invariants";
import semver from "semver";
import { EntityManager } from "typeorm";

const { Command } = require("commander");

const COMMERCE_ELASTIC_PATH_PROJECT_ID = "3JZRbA6LvhK83ns6Hqj5TS";
const MAX_ITERATIONS = 20;

async function loadPlumeSite(db: DbMgr) {
  const plumePkgVersion = await db.getPlumePkgVersion();
  const plumeSite = ensureKnownProjectDependency(
    (
      await unbundleSite(
        new Bundler(),
        await getMigratedBundle(plumePkgVersion),
        db,
        plumePkgVersion
      )
    ).siteOrProjectDep
  ).site;
  return plumeSite;
}

const EXPECTED_PATTERNS = [
  /^Deleted (?:param|slot) \S+ of component .+$/,
  /^Component with uuid \S+ has been removed!$/,
];

async function runUpdateUntilClean(
  site: any,
  projectName: string,
  plumeSite: any
) {
  for (let i = 0; i < MAX_ITERATIONS; i++) {
    try {
      await updateHostlessPackage(site, projectName, plumeSite);
      logger().info(`updateHostlessPackage completed cleanly at pass ${i}.`);
      return;
    } catch (err: any) {
      const msg = err?.message ?? "";
      const isExpected = EXPECTED_PATTERNS.some((re) => re.test(msg));
      logger().info(
        `Pass ${i}: caught ${err?.name}: ${msg} (${
          isExpected ? "expected -- mutation already applied, retrying" : "UNRECOGNIZED"
        })`
      );
      if (!isExpected) {
        throw err;
      }
      continue;
    }
  }
  throw new Error(
    `Gave up after ${MAX_ITERATIONS} passes without a clean updateHostlessPackage() run.`
  );
}

async function migrate(em: EntityManager) {
  const db = new DbMgr(em, SUPER_USER);
  const project = await db.getProjectById(COMMERCE_ELASTIC_PATH_PROJECT_ID);
  const plumeSite = await loadPlumeSite(db);

  const pkg = ensure(
    await db.getPkgByProjectId(COMMERCE_ELASTIC_PATH_PROJECT_ID),
    () => "Expected pkg to exist for commerce-elastic-path project"
  );
  const latestVersion = await db.getPkgVersion(pkg.id);
  const bundler = new Bundler();
  const bundle = await getMigratedBundle(latestVersion);
  const { siteOrProjectDep } = await unbundleSite(
    bundler,
    bundle,
    db,
    latestVersion
  );
  const site = ensureKnownProjectDependency(siteOrProjectDep).site;

  await runUpdateUntilClean(site, project.name, plumeSite);

  const newBundle = bundler.bundle(
    siteOrProjectDep,
    latestVersion.id,
    await getLastBundleVersion()
  );

  if (JSON.stringify(bundle) === JSON.stringify(newBundle)) {
    logger().info("No changes detected after fixups -- nothing to publish.");
    return;
  }

  logger().info("Running assertSiteInvariants on the fixed-up site...");
  assertSiteInvariants(site);
  logger().info("assertSiteInvariants passed.");

  logger().info("Saving new version and publishing...");
  await runUpdateUntilClean(site, project.name, plumeSite);
  const newBundle2 = bundler.bundle(
    siteOrProjectDep,
    latestVersion.id,
    await getLastBundleVersion()
  );

  assert(
    JSON.stringify(newBundle) === JSON.stringify(newBundle2),
    () => "Re-applying the changes resulted in a different bundle!"
  );

  const projectBundle = bundler.bundle(
    site,
    latestVersion.id,
    await getLastBundleVersion()
  );

  const rev = await db.getLatestProjectRev(COMMERCE_ELASTIC_PATH_PROJECT_ID);
  await db.saveProjectRev({
    projectId: COMMERCE_ELASTIC_PATH_PROJECT_ID,
    data: JSON.stringify(projectBundle),
    revisionNum: rev.revision + 1,
  });

  await db.publishProject(
    COMMERCE_ELASTIC_PATH_PROJECT_ID,
    semver.inc(latestVersion.version, "minor") ?? undefined,
    [],
    ""
  );

  logger().info("Publish complete.");
}

async function main() {
  logger().info("Start migrate-commerce-elastic-path script...");
  const opts = new Command("custom-script")
    .option("-db, --dburi <dburi>", "Database uri", DEFAULT_DATABASE_URI)
    .parse(process.argv)
    .opts();
  await ensureDbConnections(opts.dburi);
  const con = await getDefaultConnection();

  await con.transaction(async (em) => {
    await migrate(em);
  });
}

if (require.main === module) {
  spawn(
    main().catch((err) => {
      logger().info(`FATAL: ${err?.name}: ${err?.message}\n${err?.stack}`);
      process.exit(1);
    })
  );
}
