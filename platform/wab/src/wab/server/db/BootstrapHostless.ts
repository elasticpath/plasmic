/**
 * BootstrapHostless.ts
 *
 * Bootstraps a fresh Plasmic database for a new production environment.
 * Creates admin users, feature tiers, Plume/Plexus packages, a hostless
 * workspace with all hostless projects, and DevFlagOverrides.
 *
 * Usage:
 *   ADMIN_PASSWORD=<password> yarn bootstrap:prod \
 *     --devflags /path/to/devflags-template.json \
 *     --dburi postgresql://wab:pass@host:5432/wab
 *
 * After this script completes, run the "Publish Hostless Packages" GitHub
 * Actions workflow to update all hostless packages to their latest versions.
 */
import { createSiteForHostlessProject } from "@/wab/server/code-components/code-components";
import { DEFAULT_DATABASE_URI } from "@/wab/server/config";
import {
  ensureDbConnections,
  getDefaultConnection,
  maybeMigrateDatabase,
} from "@/wab/server/db/DbCon";
import { DbMgr, normalActor, SUPER_USER } from "@/wab/server/db/DbMgr";
import { remapDevFlagOverrides } from "@/wab/server/db/seed/devflags-remap";
import { seedProdFeatureTiers } from "@/wab/server/db/seed/feature-tier-prod";
import {
  getDeps,
  getNpmPkg,
  getOrderedPackageNames,
} from "@/wab/server/db/seed/hostless-metadata";
import { logger } from "@/wab/server/observability";
import { PkgMgr } from "@/wab/server/pkg-mgr";
import { Bundler } from "@/wab/shared/bundler";
import { spawn } from "@/wab/shared/common";
import {
  InsertableId,
  PLEXUS_INSERTABLE_ID,
  PLUME_INSERTABLE_ID,
} from "@/wab/shared/insertables";
import { HostLessPackageInfo } from "@/wab/shared/model/classes";
import fs from "fs";
import path from "path";
import { EntityManager } from "typeorm";

const { Command } = require("commander");

const ADMIN_EMAILS = [
  "robert.field+plasmicadmin@elasticpath.com",
  "it@elasticpath.com",
];

// ---------------------------------------------------------------------------
// Step 1: Create admin users
// ---------------------------------------------------------------------------
async function createAdminUsers(em: EntityManager, password: string) {
  const db = new DbMgr(em, SUPER_USER);
  const users = [];

  for (const email of ADMIN_EMAILS) {
    const user = await db.createUser({
      email,
      password,
      firstName: email.split("@")[0].replace(/\+/g, " "),
      lastName: "Admin",
      needsIntroSplash: false,
      needsSurvey: false,
      needsTeamCreationPrompt: false,
    });
    await db.markEmailAsVerified(user);
    logger().info(`Created admin user: ${email} (id=${user.id})`);
    users.push(user);
  }

  return users;
}

// ---------------------------------------------------------------------------
// Step 2: Create feature tiers + admin team
// ---------------------------------------------------------------------------
async function createFeatureTiersAndAdminTeam(
  em: EntityManager,
  adminUserId: string
) {
  const { starterFt, enterpriseFt } = await seedProdFeatureTiers(em);
  logger().info(
    `Created feature tiers: Starter (id=${starterFt.id}), Enterprise (id=${enterpriseFt.id})`
  );

  // Create an admin team with Enterprise tier
  const userDb = new DbMgr(em, normalActor(adminUserId));
  const adminTeam = await userDb.createTeam("Elastic Path Admin");

  const superDb = new DbMgr(em, SUPER_USER);
  await superDb.sudoUpdateTeam({
    id: adminTeam.id,
    featureTierId: enterpriseFt.id,
  });
  logger().info(
    `Created admin team: ${adminTeam.name} (id=${adminTeam.id}) with Enterprise tier`
  );

  return { starterFt, enterpriseFt, adminTeam };
}

// ---------------------------------------------------------------------------
// Step 3: Seed Plume + Plexus
// ---------------------------------------------------------------------------
async function seedSystemPackages(em: EntityManager) {
  const db = new DbMgr(em, SUPER_USER);
  const sysnames: InsertableId[] = [PLUME_INSERTABLE_ID, PLEXUS_INSERTABLE_ID];
  for (const sysname of sysnames) {
    await new PkgMgr(db, sysname).seedPkg();
    logger().info(`Seeded system package: ${sysname}`);
  }
}

// ---------------------------------------------------------------------------
// Step 4: Create hostless workspace
// ---------------------------------------------------------------------------
async function createHostlessWorkspace(
  em: EntityManager,
  adminUserId: string
) {
  const userDb = new DbMgr(em, normalActor(adminUserId));
  const team = await userDb.createTeam("Hostless Packages");
  logger().info(`Created hostless team: ${team.name} (id=${team.id})`);

  const workspace = await userDb.createWorkspace({
    name: "Hostless Packages",
    description: "Workspace for hostless code component packages",
    teamId: team.id,
  });
  logger().info(
    `Created hostless workspace: ${workspace.name} (id=${workspace.id})`
  );

  return { team, workspace };
}

// ---------------------------------------------------------------------------
// Step 5: Create hostless projects
// ---------------------------------------------------------------------------
async function createHostlessProjects(
  em: EntityManager,
  adminUserId: string,
  workspaceId: string
) {
  const hostlessListPath = path.resolve(
    path.join(__dirname, "../../../../../canvas-packages/hostlessList.json")
  );
  const allPackageNames: string[] = JSON.parse(
    fs.readFileSync(hostlessListPath, "utf-8")
  );
  const orderedNames = getOrderedPackageNames(allPackageNames);

  logger().info(
    `Creating ${orderedNames.length} hostless projects in dependency order...`
  );

  const userDb = new DbMgr(em, normalActor(adminUserId));
  const bundler = new Bundler();
  const projectIds: { name: string; projectId: string }[] = [];

  for (const pkgName of orderedNames) {
    logger().info(`  Creating hostless project: ${pkgName}`);

    const hostLessPackageInfo = new HostLessPackageInfo({
      name: pkgName,
      npmPkg: [getNpmPkg(pkgName)],
      cssImport: [],
      deps: getDeps(pkgName),
      registerCalls: [],
      minimumReactVersion: undefined,
    });

    // Replicate createHostLessProject steps to capture project ID
    const site = await createSiteForHostlessProject(hostLessPackageInfo);

    const { project, rev } = await userDb.createProjectAndSaveRev({
      site,
      bundler,
      name: hostLessPackageInfo.name,
    });

    await userDb.publishProject(
      project.id,
      "0.0.1",
      [],
      "",
      rev.revision,
      true
    );

    // Move project to hostless workspace
    await userDb.updateProject({
      id: project.id,
      workspaceId,
    });

    projectIds.push({ name: pkgName, projectId: project.id });
    logger().info(
      `  Created: ${pkgName} (projectId=${project.id})`
    );
  }

  logger().info(`Created ${projectIds.length} hostless projects`);
  return projectIds;
}

// ---------------------------------------------------------------------------
// Step 6: Set DevFlagOverrides (from template file)
// ---------------------------------------------------------------------------
async function setDevFlagOverrides(
  em: EntityManager,
  hostlessWorkspaceId: string,
  hostlessProjects: { name: string; projectId: string }[],
  devflagsTemplatePath: string
) {
  const db = new DbMgr(em, SUPER_USER);

  // Read the devflags template file (exported from an existing environment)
  const templateJson = JSON.parse(
    fs.readFileSync(devflagsTemplatePath, "utf-8")
  );

  // Build project name → ID mapping from the projects we just created
  const projects: Record<string, string> = {};
  for (const { name, projectId } of hostlessProjects) {
    projects[name] = projectId;
  }

  // Remap project IDs for this environment
  const overrides = remapDevFlagOverrides(templateJson, {
    hostlessWorkspaceId,
    projects,
  });

  await db.setDevFlagOverrides(JSON.stringify(overrides, null, 2));
  logger().info("Set DevFlagOverrides from template");
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  const adminPassword = process.env.ADMIN_PASSWORD;
  if (!adminPassword) {
    console.error("ERROR: ADMIN_PASSWORD environment variable is required");
    process.exit(1);
  }

  const opts = new Command("bootstrap-prod")
    .requiredOption(
      "-df, --devflags <path>",
      "Path to devflags JSON template (exported from an existing environment)"
    )
    .option("-db, --dburi <dburi>", "Database URI", DEFAULT_DATABASE_URI)
    .parse(process.argv)
    .opts();

  logger().info("Starting production bootstrap...");
  logger().info(`Database: ${opts.dburi.replace(/:[^:@]*@/, ":***@")}`);
  logger().info(`DevFlags template: ${path.resolve(opts.devflags)}`);

  await ensureDbConnections(opts.dburi, {
    useEnvPassword: true,
  });

  // Run pending migrations (creates tables on a fresh database)
  logger().info("Running database migrations...");
  await maybeMigrateDatabase();

  const con = await getDefaultConnection();

  await con.transaction(async (em) => {
    // Step 1: Create admin users
    logger().info("=== Step 1: Creating admin users ===");
    const users = await createAdminUsers(em, adminPassword);
    const adminUser = users[0];

    // Step 2: Create feature tiers + admin team
    logger().info("=== Step 2: Creating feature tiers ===");
    await createFeatureTiersAndAdminTeam(em, adminUser.id);

    // Step 3: Seed Plume + Plexus
    logger().info("=== Step 3: Seeding Plume + Plexus ===");
    await seedSystemPackages(em);

    // Step 4: Create hostless workspace
    logger().info("=== Step 4: Creating hostless workspace ===");
    const { workspace } = await createHostlessWorkspace(em, adminUser.id);

    // Step 5: Create hostless projects
    logger().info("=== Step 5: Creating hostless projects ===");
    const hostlessProjects = await createHostlessProjects(
      em,
      adminUser.id,
      workspace.id
    );

    // Step 6: Set DevFlagOverrides
    logger().info("=== Step 6: Setting DevFlagOverrides ===");
    await setDevFlagOverrides(
      em,
      workspace.id,
      hostlessProjects,
      path.resolve(opts.devflags)
    );

    logger().info("=== Bootstrap complete ===");
    logger().info(
      `Hostless workspace ID: ${workspace.id}`
    );
    logger().info(
      `Total hostless projects: ${hostlessProjects.length}`
    );
    logger().info(
      "Next: Run 'Publish Hostless Packages' GitHub Actions workflow to update packages"
    );
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
