/**
 * Brings a raw upstream bundle fixture up to the current model, the way
 * `getMigratedBundle` would before a real project load returns one.
 *
 * Only `bundled` migrations are applied: those are the ones that may change the
 * model, while `unbundled` ones need a `MigrationDbMgr` and a real entity and by
 * contract leave the model alone.
 *
 * Enumeration is re-done here rather than reusing `BundleMigrator` because that
 * uses a dynamic `require()` of `.ts` files, which Vite cannot resolve. The
 * migration functions themselves are upstream's, run unmodified.
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
 * Read the type without importing: some unbundled migrations reach
 * `server/entities/Entities.ts`, which CJS-`require`s a `.ts` file Vite leaves
 * untouched and Node cannot resolve.
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
