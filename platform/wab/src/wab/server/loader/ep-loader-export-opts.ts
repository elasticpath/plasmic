/**
 * Elastic Path additions to loader codegen option helpers.
 *
 * Kept in a separate module so upstream changes to gen-code-bundle.ts can be
 * applied with minimal merge conflicts.
 */

import { ExportOpts, ExportPlatformOptions } from "@/wab/shared/codegen/types";
import { LocalizationKeyScheme } from "@/wab/shared/localization";

export const LOADER_CODEGEN_OPTS_DEFAULTS: ExportOpts = {
  platform: "react",
  lang: "ts",
  relPathFromImplToManagedDir: ".",
  relPathFromManagedToImplDir: ".",
  forceAllProps: false,
  forceRootDisabled: false,
  imageOpts: { scheme: "cdn" },
  stylesOpts: { scheme: "css" },
  codeOpts: { reactRuntime: "classic" },
  fontOpts: { scheme: "none" },
  idFileNames: true,
  codeComponentStubs: true,
  skinnyReactWeb: true,
  importHostFromReactWeb: false,
  skinny: true,
  hostLessComponentsConfig: "package", // Maybe make it configurable
  useComponentSubstitutionApi: false,
  useGlobalVariantsSubstitutionApi: false,
  useCodeComponentHelpersRegistry: false,
  useCustomFunctionsStub: true,
  targetEnv: "loader",
};

export function makeExportOpts(opts: {
  platform?: string;
  platformOptions: ExportPlatformOptions;
  loaderVersion: number;
  i18nKeyScheme?: LocalizationKeyScheme;
  i18nTagPrefix: string | undefined;
  skipHead?: boolean;
}): ExportOpts {
  return {
    ...LOADER_CODEGEN_OPTS_DEFAULTS,
    platform: (opts.platform ??
      LOADER_CODEGEN_OPTS_DEFAULTS.platform) as ExportOpts["platform"],
    platformOptions: opts.platformOptions,
    defaultExportHostLessComponents: opts.loaderVersion > 2 ? false : true,
    useComponentSubstitutionApi: opts.loaderVersion >= 6 ? true : false,
    useGlobalVariantsSubstitutionApi: opts.loaderVersion >= 7 ? true : false,
    useCodeComponentHelpersRegistry: opts.loaderVersion >= 10 ? true : false,
    ...(opts.i18nKeyScheme && {
      localization: {
        keyScheme: opts.i18nKeyScheme ?? "content",
        tagPrefix: opts.i18nTagPrefix,
      },
    }),
    skipHead: opts.skipHead,
  };
}
