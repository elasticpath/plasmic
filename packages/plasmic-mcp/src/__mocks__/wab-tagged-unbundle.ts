/**
 * Mock for @/wab/shared/core/tagged-unbundle
 *
 * Provides mockable stub for unbundleProjectDependency, which deserializes
 * a PkgVersion bundle into a ProjectDependency model object. The package
 * management feature uses this to materialize downloaded packages.
 */

import { vi } from "vitest";

export const mockUnbundleProjectDependency = vi.fn(
  (_bundler: any, pkgInfo: any, _depPkgInfos: any[]) => ({
    projectDependency: {
      _type: "ProjectDependency",
      pkgId: pkgInfo?.pkgId ?? "mock-pkg-id",
      version: pkgInfo?.version ?? "0.0.1",
      projectId: pkgInfo?.pkg?.projectId ?? "mock-project-id",
      name: pkgInfo?.pkg?.name ?? "Mock Package",
      site: { components: [], projectDependencies: [], globalContexts: [], defaultComponents: {} },
    },
    depPkgs: [],
  })
);

export const unbundleProjectDependency = (...args: any[]) =>
  mockUnbundleProjectDependency(...args);
