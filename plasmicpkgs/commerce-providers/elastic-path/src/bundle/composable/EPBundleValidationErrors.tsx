import { useSelector, usePlasmicCanvasContext } from "@plasmicapp/host";
import registerComponent, {
  ComponentMeta,
} from "@plasmicapp/host/registerComponent";
import React from "react";
import { Registerable } from "../../registerable";
import { MOCK_BUNDLE_DATA_WITH_ERRORS } from "./design-time-data";

type PreviewState = "auto" | "withData";

interface EPBundleValidationErrorsProps {
  className?: string;
  previewState?: PreviewState;
}

export const epBundleValidationErrorsMeta: ComponentMeta<EPBundleValidationErrorsProps> =
  {
    name: "plasmic-commerce-ep-bundle-validation-errors",
    displayName: "EP Bundle Validation Errors",
    description:
      "Renders current bundle validation errors. Errors come from Zod schema validation of component min/max and option constraints. Must be inside an EP Bundle Provider.",
    props: {
      previewState: {
        type: "choice",
        options: ["auto", "withData"],
        defaultValue: "auto",
        displayName: "Preview State",
        description:
          "Force a preview state with sample error data for design-time editing",
        advanced: true,
      },
    },
    importPath: "@elasticpath/plasmic-ep-commerce-elastic-path",
    importName: "EPBundleValidationErrors",
  };

export function EPBundleValidationErrors(
  props: EPBundleValidationErrorsProps
) {
  const { className, previewState = "auto" } = props;

  const bundleData = useSelector("bundleData") as
    | { errors?: string[]; isValid?: boolean }
    | undefined;
  const inEditor = !!usePlasmicCanvasContext();

  const useMock =
    previewState === "withData" || (!bundleData && inEditor);

  const data = useMock ? MOCK_BUNDLE_DATA_WITH_ERRORS : bundleData;

  const errors = data?.errors ?? [];
  if (errors.length === 0) return null;

  return (
    <div
      className={className}
      role="alert"
      aria-live="polite"
      data-ep-bundle-errors=""
    >
      {errors.map((error, i) => (
        <div key={i}>{error}</div>
      ))}
    </div>
  );
}

export function registerEPBundleValidationErrors(
  loader?: Registerable,
  customMeta?: ComponentMeta<EPBundleValidationErrorsProps>
) {
  const doRegisterComponent: typeof registerComponent = (...args) =>
    loader ? loader.registerComponent(...args) : registerComponent(...args);
  doRegisterComponent(
    EPBundleValidationErrors,
    customMeta ?? epBundleValidationErrorsMeta
  );
}
