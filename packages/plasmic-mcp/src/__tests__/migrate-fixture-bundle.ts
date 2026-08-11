/**
 * Brings a raw upstream bundle fixture up to the current model.
 *
 * The integration tests mock `fetch` and serve `platform/wab/playwright/bundles/*.json`
 * as if it were a project-load response. A real server never returns a raw bundle —
 * `getMigratedBundle` runs the migration chain first — so without this the fixture is
 * whatever model version upstream last committed it at (currently
 * `252-add-animations`) and unbundling fails as soon as a migration adds a required
 * field. Migration 258 adding `CodeComponentMeta.subtreePrefetchingConfig` is what
 * first exposed this.
 *
 * We can't reuse `BundleMigrator.getAllMigrations()`: it enumerates with
 * `fs.readdir` + a dynamic `require()` of `.ts` files, which Vite cannot resolve.
 * Enumeration is re-done here; the migration functions themselves are upstream's,
 * imported and run unmodified.
 *
 * Enumeration deliberately reads the directory rather than using
 * `import.meta.glob` — a glob puts all 258 migrations in Vite's module graph, and
 * ten of the older ones import `server/entities/Entities`, which the integration
 * config's stub rules don't cover (they only stub relative escapes out of
 * `wab/shared/` and `wab/commons/`, not within `wab/server/`). Importing only the
 * handful of pending migrations keeps those out of the graph entirely.
 *
 * Only `bundled` migrations are applied. Per BundleMigrator's own contract, those are
 * the migrations that may change the model, while `unbundled` ones "should not update
 * the model" — they rewrite data and need a `MigrationDbMgr` plus a real
 * `PkgVersion`/`ProjectRevision` entity. Model compatibility is all a fixture needs.
 */

import { readFileSync, readdirSync } from "fs";
import { join, resolve } from "path";

type BundledMigrate = (bundle: any, entity: unknown) => Promise<void>;

interface MigrationModule {
  migrate: BundledMigrate;
  MIGRATION_TYPE?: string;
}

const MIGRATIONS_DIR = resolve(
  __dirname,
  "../../../../platform/wab/src/wab/server/bundle-migrations"
);

// Same ordering BundleMigrator uses, so "the next migration" means the same thing here.
const migrationSorter = new Intl.Collator(undefined, {
  numeric: true,
  sensitivity: "base",
});

/**
 * Reads the declared `MIGRATION_TYPE` without importing the module. Unbundled
 * migrations are skipped anyway, and importing them is not free: EP's
 * `255-fix-ep-addtocart-import-path` pulls in `unbundleSite`, whose transitive
 * graph reaches `server/entities/Entities.ts`, which does a CJS `require()` of a
 * `.ts` file that Vite leaves untouched and Node cannot resolve.
 */
function declaredMigrationType(file: string): string | undefined {
  const src = readFileSync(join(MIGRATIONS_DIR, file), "utf-8");
  return /MIGRATION_TYPE[^=]*=\s*["'](\w+)["']/.exec(src)?.[1];
}

function orderedMigrations(): Array<{
  name: string;
  type: string | undefined;
  load: () => Promise<MigrationModule>;
}> {
  return readdirSync(MIGRATIONS_DIR)
    .filter((file) => file.endsWith(".ts") && !file.endsWith(".spec.ts"))
    .sort(migrationSorter.compare)
    .map((file) => ({
      name: file.replace(/\..*$/, ""),
      type: declaredMigrationType(file),
      load: () => import(join(MIGRATIONS_DIR, file)) as Promise<MigrationModule>,
    }));
}

export function latestBundleVersion(): string {
  const all = orderedMigrations();
  return all[all.length - 1].name;
}

/**
 * Mutates `bundle` in place and returns it, so callers can wrap an existing
 * `JSON.parse(...)` without restructuring their setup.
 */
export async function migrateFixtureBundle(bundle: any): Promise<any> {
  const all = orderedMigrations();
  const currentIdx = all.findIndex((m) => m.name === bundle.version);
  if (currentIdx === -1) {
    throw new Error(
      `Fixture bundle declares version "${bundle.version}", which matches no ` +
        `migration in platform/wab/src/wab/server/bundle-migrations/. The fixture ` +
        `is probably older than the oldest migration still in the tree.`
    );
  }

  for (const { type, load } of all.slice(currentIdx + 1)) {
    if (type !== "bundled") {
      continue;
    }
    const mod = await load();
    await mod.migrate(bundle, undefined);
  }

  // Skipped unbundled migrations don't change the model, so the bundle is
  // model-current even though we didn't run every migration in the range.
  bundle.version = all[all.length - 1].name;
  return bundle;
}

/**
 * Migrates one entry of the `[[projectId, bundle], ...]` fixture format,
 * preserving whether it was stored as a JSON string or an object — the tests
 * feed these straight into mocked API responses, which are shape-sensitive.
 */
export async function migrateFixtureEntry<T>(entry: T): Promise<T> {
  if (typeof entry === "string") {
    const migrated = await migrateFixtureBundle(JSON.parse(entry));
    return JSON.stringify(migrated) as unknown as T;
  }
  return (await migrateFixtureBundle(entry)) as T;
}
