// TEMPORARY diagnostic script. Not wired into DbCustomScripts.ts on purpose --
// run directly via `npm run run-ts -- src/wab/server/db/custom-scripts/diagnose-commerce-elastic-path.ts`.
// Read-only: reproduces updateHostlessPackage() against the real unbundled site,
// but stops before saveProjectRev/publishProject, so nothing is written back.
import { updateHostlessPackage } from "@/wab/server/code-components/code-components";
import { DEFAULT_DATABASE_URI } from "@/wab/server/config";
import { getMigratedBundle } from "@/wab/server/db/BundleMigrator";
import {
  ensureDbConnections,
  getDefaultConnection,
} from "@/wab/server/db/DbCon";
import { DbMgr, SUPER_USER } from "@/wab/server/db/DbMgr";
import { unbundleSite } from "@/wab/server/db/bundle-migration-utils";
import { logger } from "@/wab/server/observability";
import { isBuiltinCodeComponent } from "@/wab/shared/code-components/builtin-code-components";
import { Bundler } from "@/wab/shared/bundler";
import { ensure, spawn } from "@/wab/shared/common";
import { isCodeComponent } from "@/wab/shared/core/components";
import { ensureKnownProjectDependency } from "@/wab/shared/model/classes";
import { EntityManager } from "typeorm";

const { Command } = require("commander");

const COMMERCE_ELASTIC_PATH_PROJECT_ID = "3JZRbA6LvhK83ns6Hqj5TS";

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

async function diagnose(em: EntityManager) {
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

  const before = new Map(
    site.components
      .filter((c) => !isBuiltinCodeComponent(c))
      .map((c) => [
        c.uuid,
        { name: c.name, isCode: isCodeComponent(c) },
      ] as const)
  );

  logger().info(
    `Loaded site for ${project.name}. ${before.size} non-builtin components before update.`
  );
  logger().info(
    `Existing component names: ${[...before.values()]
      .map((v) => v.name)
      .join(",")}`
  );

  try {
    await updateHostlessPackage(site, project.name, plumeSite);
    logger().info(
      "updateHostlessPackage completed WITHOUT throwing. No assertion error reproduced."
    );
  } catch (err: any) {
    logger().info(`CAUGHT ${err?.name}: ${err?.message}`);
    const m = /uuid ([0-9a-fA-F-]+) has been removed/.exec(err?.message ?? "");
    if (m) {
      const uuid = m[1];
      const info = before.get(uuid);
      logger().info(
        `Offending component -> uuid=${uuid} name=${
          info?.name ?? "<not found in before-snapshot>"
        } isCode=${info?.isCode}`
      );
    } else {
      logger().info(
        "Error did not match the 'has been removed' uuid pattern -- see raw message above."
      );
    }
  }
}

async function main() {
  logger().info("Start diagnose-commerce-elastic-path script...");
  const opts = new Command("custom-script")
    .option("-db, --dburi <dburi>", "Database uri", DEFAULT_DATABASE_URI)
    .parse(process.argv)
    .opts();
  await ensureDbConnections(opts.dburi);
  const con = await getDefaultConnection();

  await con.transaction(async (em) => {
    await diagnose(em);
  });
}

if (require.main === module) {
  spawn(
    main().catch((err) => {
      logger().error(err);
      process.exit(1);
    })
  );
}
