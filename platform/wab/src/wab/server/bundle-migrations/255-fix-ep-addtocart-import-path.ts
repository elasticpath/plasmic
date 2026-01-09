import { isCodeComponent } from "@/wab/shared/core/components";
import { UnbundledMigrationFn } from "@/wab/server/db/BundleMigrator";
import {
  BundleMigrationType,
  unbundleSite,
} from "@/wab/server/db/bundle-migration-utils";
import { Bundler } from "@/wab/shared/bundler";

export const migrate: UnbundledMigrationFn = async (bundle, db, entity) => {
  const bundler = new Bundler();
  const { site, siteOrProjectDep } = await unbundleSite(
    bundler,
    bundle,
    db,
    entity
  );

  // Fix EPAddToCartButton components that have the wrong importPath
  for (const component of site.components) {
    if (
      isCodeComponent(component) &&
      component.codeComponentMeta.importName === "EPAddToCartButton" &&
      component.codeComponentMeta.importPath === "@plasmicpkgs/commerce"
    ) {
      // Update the importPath to the correct Elastic Path package
      component.codeComponentMeta.importPath = "@elasticpath/plasmic-ep-commerce-elastic-path";
    }
  }

  const newBundle = bundler.bundle(
    siteOrProjectDep,
    entity.id,
    "255-fix-ep-addtocart-import-path"
  );
  Object.assign(bundle, newBundle);
};

export const MIGRATION_TYPE: BundleMigrationType = "unbundled";