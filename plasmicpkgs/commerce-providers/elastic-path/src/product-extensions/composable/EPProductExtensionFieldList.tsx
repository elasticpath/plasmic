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
import { MOCK_EXTENSION_TEMPLATES } from "../../utils/extensions-mock";
import type { ExtensionField, ExtensionTemplate } from "../../types/extensions";

type PreviewState = "auto" | "withData";

interface EPProductExtensionFieldListProps {
  children?: React.ReactNode;
  className?: string;
  previewState?: PreviewState;
}

export const epProductExtensionFieldListMeta: CodeComponentMeta<EPProductExtensionFieldListProps> =
  {
    name: "plasmic-commerce-ep-product-extension-field-list",
    displayName: "EP Product Extension Field List",
    description:
      "Iterates over fields in the current extension template. Provides currentExtensionField and currentExtensionFieldIndex to children. Must be inside an EP Product Extension Template List.",
    props: {
      children: {
        type: "slot",
        defaultValue: [
          {
            type: "hbox",
            children: [
              {
                type: "component",
                name: "plasmic-commerce-ep-product-extension-field",
                props: { field: "label" },
              },
              {
                type: "component",
                name: "plasmic-commerce-ep-product-extension-field",
                props: { field: "displayValue" },
              },
            ],
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
    importName: "EPProductExtensionFieldList",
    parentComponentName: "plasmic-commerce-ep-product-extension-template-list",
    providesData: true,
  };

export function EPProductExtensionFieldList(
  props: EPProductExtensionFieldListProps,
) {
  const { children, className, previewState = "auto" } = props;
  const template = useSelector("currentExtensionTemplate") as
    | ExtensionTemplate
    | undefined;
  const inEditor = !!usePlasmicCanvasContext();

  const useMock = previewState === "withData" || (!template && inEditor);
  const source = useMock ? MOCK_EXTENSION_TEMPLATES[0] : template;
  const fields: ExtensionField[] = source?.fields ?? [];

  if (fields.length === 0) return null;

  return (
    <div className={className} role="list" aria-label="Extension fields">
      {fields.map((fieldData, i) => (
        <div key={fieldData.key || i} role="listitem">
          <DataProvider name="currentExtensionField" data={fieldData}>
            <DataProvider name="currentExtensionFieldIndex" data={i}>
              {repeatedElement(i, children)}
            </DataProvider>
          </DataProvider>
        </div>
      ))}
    </div>
  );
}

export function registerEPProductExtensionFieldList(
  loader?: Registerable,
  customMeta?: CodeComponentMeta<EPProductExtensionFieldListProps>,
) {
  const doRegisterComponent: typeof registerComponent = (...args) =>
    loader ? loader.registerComponent(...args) : registerComponent(...args);
  doRegisterComponent(
    EPProductExtensionFieldList,
    customMeta ?? epProductExtensionFieldListMeta,
  );
}
