import {
  DataProvider,
  repeatedElement,
  usePlasmicCanvasContext,
} from "@plasmicapp/host";
import registerComponent, {
  CodeComponentMeta,
} from "@plasmicapp/host/registerComponent";
import React from "react";
import { Registerable } from "../../registerable";
import { useProductExtensionsContext } from "./EPProductExtensionsProvider";
import { MOCK_EXTENSION_TEMPLATES } from "./design-time-data";
import type { ExtensionTemplate } from "./types";

type PreviewState = "auto" | "withData";

interface EPProductExtensionTemplateListProps {
  children?: React.ReactNode;
  className?: string;
  previewState?: PreviewState;
}

export const epProductExtensionTemplateListMeta: CodeComponentMeta<EPProductExtensionTemplateListProps> =
  {
    name: "plasmic-commerce-ep-product-extension-template-list",
    displayName: "EP Product Extension Template List",
    description:
      "Iterates over the product's extension templates. Provides currentExtensionTemplate and currentExtensionTemplateIndex to children. Must be inside an EP Product Extensions Provider.",
    props: {
      children: {
        type: "slot",
        defaultValue: [
          {
            type: "vbox",
            children: [
              {
                type: "component",
                name: "plasmic-commerce-ep-product-extension-template-field",
                props: { field: "label" },
              },
              {
                type: "component",
                name: "plasmic-commerce-ep-product-extension-field-list",
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
    importName: "EPProductExtensionTemplateList",
    parentComponentName: "plasmic-commerce-ep-product-extensions-provider",
    providesData: true,
  };

export function EPProductExtensionTemplateList(
  props: EPProductExtensionTemplateListProps,
) {
  const { children, className, previewState = "auto" } = props;
  const ctx = useProductExtensionsContext();
  const inEditor = !!usePlasmicCanvasContext();

  const useMock =
    previewState === "withData" ||
    (previewState === "auto" && inEditor && (!ctx || ctx.templates.length === 0));

  const templates: ExtensionTemplate[] = useMock
    ? MOCK_EXTENSION_TEMPLATES
    : (ctx?.templates ?? []);

  if (templates.length === 0) return null;

  return (
    <div
      className={className}
      role="list"
      aria-label="Product extension templates"
    >
      {templates.map((template, i) => (
        <div key={template.slug || i} role="listitem">
          <DataProvider name="currentExtensionTemplate" data={template}>
            <DataProvider name="currentExtensionTemplateIndex" data={i}>
              {repeatedElement(i, children)}
            </DataProvider>
          </DataProvider>
        </div>
      ))}
    </div>
  );
}

export function registerEPProductExtensionTemplateList(
  loader?: Registerable,
  customMeta?: CodeComponentMeta<EPProductExtensionTemplateListProps>,
) {
  const doRegisterComponent: typeof registerComponent = (...args) =>
    loader ? loader.registerComponent(...args) : registerComponent(...args);
  doRegisterComponent(
    EPProductExtensionTemplateList,
    customMeta ?? epProductExtensionTemplateListMeta,
  );
}
