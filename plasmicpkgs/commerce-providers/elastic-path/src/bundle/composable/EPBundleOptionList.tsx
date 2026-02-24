import {
  DataProvider,
  repeatedElement,
  useSelector,
  usePlasmicCanvasContext,
} from "@plasmicapp/host";
import registerComponent, {
  ComponentMeta,
} from "@plasmicapp/host/registerComponent";
import React from "react";
import { Registerable } from "../../registerable";
import {
  MOCK_BUNDLE_COMPONENTS,
  MockBundleOption,
} from "./design-time-data";

type PreviewState = "auto" | "withData";

interface EPBundleOptionListProps {
  children?: React.ReactNode;
  className?: string;
  previewState?: PreviewState;
}

export const epBundleOptionListMeta: ComponentMeta<EPBundleOptionListProps> = {
  name: "plasmic-commerce-ep-bundle-option-list",
  displayName: "EP Bundle Option List",
  description:
    "Iterates over options within the current bundle component. Provides currentBundleOption and currentBundleOptionIndex to children. Must be inside an EP Bundle Component List.",
  props: {
    children: {
      type: "slot",
      defaultValue: [
        {
          type: "component",
          name: "plasmic-commerce-ep-bundle-option-trigger",
        },
      ],
    },
    previewState: {
      type: "choice",
      options: ["auto", "withData"],
      defaultValue: "auto",
      displayName: "Preview State",
      description:
        "Force a preview state with sample data for design-time editing",
      advanced: true,
    },
  },
  importPath: "@elasticpath/plasmic-ep-commerce-elastic-path",
  importName: "EPBundleOptionList",
  providesData: true,
};

export function EPBundleOptionList(props: EPBundleOptionListProps) {
  const { children, className, previewState = "auto" } = props;

  const currentComponent = useSelector("currentBundleComponent") as
    | { options?: MockBundleOption[]; key?: string }
    | undefined;
  const inEditor = !!usePlasmicCanvasContext();

  const useMock =
    previewState === "withData" || (!currentComponent && inEditor);

  const options: MockBundleOption[] = useMock
    ? MOCK_BUNDLE_COMPONENTS[0].options
    : currentComponent?.options ?? [];

  if (options.length === 0) return null;

  return (
    <div className={className} role="list" aria-label="Bundle options">
      {options.map((option, i) => (
        <div key={option.id} role="listitem">
          <DataProvider name="currentBundleOption" data={option}>
            <DataProvider name="currentBundleOptionIndex" data={i}>
              {repeatedElement(i, children)}
            </DataProvider>
          </DataProvider>
        </div>
      ))}
    </div>
  );
}

export function registerEPBundleOptionList(
  loader?: Registerable,
  customMeta?: ComponentMeta<EPBundleOptionListProps>
) {
  const doRegisterComponent: typeof registerComponent = (...args) =>
    loader ? loader.registerComponent(...args) : registerComponent(...args);
  doRegisterComponent(
    EPBundleOptionList,
    customMeta ?? epBundleOptionListMeta
  );
}
