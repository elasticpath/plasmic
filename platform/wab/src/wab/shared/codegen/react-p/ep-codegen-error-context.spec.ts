import { ProjectId } from "@/wab/shared/ApiSchema";
import { mkVariantSetting } from "@/wab/shared/Variants";
import { exportProjectConfig } from "@/wab/shared/codegen/react-p";
import { withCodegenErrorContext } from "@/wab/shared/codegen/react-p/ep-codegen-error-context";
import { exportSiteComponents } from "@/wab/shared/codegen/react-p/gen-site-bundle";
import {
  mkCustomCodeOp,
  mkServerQuery,
} from "@/wab/shared/codegen/react-p/server-queries/test-utils";
import { ExportOpts } from "@/wab/shared/codegen/types";
import { jsonClone } from "@/wab/shared/common";
import {
  ComponentType,
  mkComponent,
  mkPageMeta,
} from "@/wab/shared/core/components";
import { createSite } from "@/wab/shared/core/sites";
import { initBuiltinActions } from "@/wab/shared/core/states";
import { deepTrackComponents, mkTplTagX } from "@/wab/shared/core/tpls";
import { DEVFLAGS } from "@/wab/shared/devflags";

const projectId = "testProject" as ProjectId;

const exportOpts: ExportOpts = {
  lang: "ts",
  platform: "nextjs",
  platformOptions: { nextjs: { appDir: true } },
  relPathFromImplToManagedDir: ".",
  relPathFromManagedToImplDir: ".",
  forceAllProps: false,
  forceRootDisabled: false,
  imageOpts: { scheme: "inlined" },
  stylesOpts: { scheme: "css-modules" },
  codeOpts: { reactRuntime: "classic" },
  fontOpts: { scheme: "import" },
  codeComponentStubs: false,
  skinnyReactWeb: false,
  skinny: false,
  importHostFromReactWeb: true,
  hostLessComponentsConfig: "package",
  useComponentSubstitutionApi: false,
  useGlobalVariantsSubstitutionApi: false,
  useCodeComponentHelpersRegistry: false,
  useCustomFunctionsStub: false,
  targetEnv: "loader",
};

function exportSiteWithBrokenServerQuery() {
  const site = createSite();
  const page = mkComponent({
    name: "BrokenPage",
    type: ComponentType.Page,
    tplTree: (baseVariant) =>
      mkTplTagX("div", {
        variants: [mkVariantSetting({ variants: [baseVariant] })],
      }),
    pageMeta: mkPageMeta({ path: "/broken" }),
  });
  page.serverQueries = [
    mkServerQuery("broken", mkCustomCodeOp("const x = {\n  a: 1,\n")),
  ];
  site.components.push(page);
  deepTrackComponents(site);

  initBuiltinActions({
    projectId,
    platform: exportOpts.platform,
    projectFlags: jsonClone(DEVFLAGS),
    inStudio: false,
  });
  const projectConfig = exportProjectConfig(
    site,
    "Project",
    projectId,
    1,
    "1",
    "latest",
    exportOpts,
    false,
    "blackbox"
  );

  let thrown: unknown;
  try {
    exportSiteComponents(site, {
      scheme: "blackbox",
      projectConfig,
      componentExportOpts: exportOpts,
      s3ImageLinks: {},
      imagesToFilter: new Set(),
      includePages: true,
      isPlasmicHosted: true,
      forceAllCsr: false,
    });
  } catch (err) {
    thrown = err;
  }
  return { page, thrown };
}

describe("withCodegenErrorContext", () => {
  it("names the project and component in the error when a component fails", () => {
    const { page, thrown } = exportSiteWithBrokenServerQuery();

    expect(thrown).toBeInstanceOf(Error);
    expect((thrown as Error).message).toMatch(
      `Codegen failed for component "BrokenPage" (${page.uuid}) in project testProject: `
    );
  });

  it("rethrows a thrown value that is not an Error unchanged", () => {
    let thrown: unknown;
    try {
      withCodegenErrorContext("p1", { name: "Card", uuid: "c1" }, () => {
        throw "not an error";
      });
    } catch (err) {
      thrown = err;
    }

    expect(thrown).toBe("not an error");
  });
});
