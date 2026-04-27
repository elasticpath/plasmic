import {
  DataProvider,
  repeatedElement,
  useSelector,
  usePlasmicCanvasContext,
} from "@plasmicapp/host";
import registerComponent, {
  CodeComponentMeta,
} from "@plasmicapp/host/registerComponent";
import React from "react";
import { Registerable } from "../../registerable";
import { MOCK_BUNDLE_DATA_WITH_ERRORS } from "./design-time-data";

type PreviewState = "auto" | "withData";

interface EPBundleValidationErrorsProps {
  children?: React.ReactNode;
  className?: string;
  previewState?: PreviewState;
}

export const epBundleValidationErrorsMeta: CodeComponentMeta<EPBundleValidationErrorsProps> =
  {
    name: "plasmic-commerce-ep-bundle-validation-errors",
    displayName: "EP Bundle Validation Errors",
    description:
      "Iterates over current bundle validation errors. Each error is exposed via DataProvider so the designer can fully customize the error item layout. Renders nothing when there are no errors. Must be inside an EP Bundle Provider.",
    props: {
      children: {
        type: "slot",
        defaultValue: [
          {
            type: "text",
            value: "Error message",
          },
        ],
      },
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
    parentComponentName: "plasmic-commerce-ep-bundle-provider",
    providesData: true,
  };

export function EPBundleValidationErrors(
  props: EPBundleValidationErrorsProps
) {
  const { children, className, previewState = "auto" } = props;

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
        <DataProvider key={i} name="currentBundleError" data={{ message: error, index: i }}>
          {repeatedElement(i, children)}
        </DataProvider>
      ))}
    </div>
  );
}

export function registerEPBundleValidationErrors(
  loader?: Registerable,
  customMeta?: CodeComponentMeta<EPBundleValidationErrorsProps>
) {
  const doRegisterComponent: typeof registerComponent = (...args) =>
    loader ? loader.registerComponent(...args) : registerComponent(...args);
  doRegisterComponent(
    EPBundleValidationErrors,
    customMeta ?? epBundleValidationErrorsMeta
  );
}
