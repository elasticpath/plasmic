import {
  DataProvider,
  useSelector,
  usePlasmicCanvasContext,
} from "@plasmicapp/host";
import registerComponent, {
  CodeComponentMeta,
} from "@plasmicapp/host/registerComponent";
import React, { createContext, useContext, useMemo } from "react";
import { Registerable } from "../../registerable";
import { Product } from "../../types/product";
import {
  MOCK_EXTENSIONS_DATA,
  MOCK_EXTENSION_TEMPLATES,
} from "./design-time-data";
import { extractRawExtensions, normalizeExtensions } from "./format";
import type { ExtensionTemplate, ExtensionsData } from "./types";

type PreviewState = "auto" | "withData" | "empty";

interface EPProductExtensionsProviderProps {
  children?: React.ReactNode;
  className?: string;
  /**
   * Override the default "no extensions" behaviour. When the current product
   * has no `attributes.extensions`, the provider renders this slot instead
   * of its children. Leave empty to render nothing (self-gate).
   */
  notExtensionsContent?: React.ReactNode;
  previewState?: PreviewState;
}

/**
 * Internal React context for child components to read the resolved templates
 * without going through a DataProvider lookup for the heavy array. Mirrors
 * the BundleFormContext pattern.
 */
interface ExtensionsContextValue {
  templates: ExtensionTemplate[];
}
const ExtensionsContext = createContext<ExtensionsContextValue | undefined>(
  undefined,
);
export function useProductExtensionsContext(): ExtensionsContextValue | undefined {
  return useContext(ExtensionsContext);
}

export const epProductExtensionsProviderMeta: CodeComponentMeta<EPProductExtensionsProviderProps> =
  {
    name: "plasmic-commerce-ep-product-extensions-provider",
    displayName: "EP Product Extensions Provider",
    description:
      "Reads `attributes.extensions` from the current product and exposes the normalized templates to descendants. Self-gates when the product has no extensions. Must be inside an EP Product Provider.",
    props: {
      children: {
        type: "slot",
        defaultValue: [
          {
            type: "component",
            name: "plasmic-commerce-ep-product-extension-template-list",
          },
        ],
      },
      notExtensionsContent: {
        type: "slot",
        displayName: "No Extensions Content",
        description:
          "Rendered when the product has no extensions. Leave empty to render nothing.",
        hidePlaceholder: true,
      },
      previewState: {
        type: "choice",
        options: ["auto", "withData", "empty"],
        defaultValue: "auto",
        displayName: "Preview State",
        description:
          "Force a preview state with sample data for design-time editing",
        advanced: true,
      },
    },
    importPath: "@elasticpath/plasmic-ep-commerce-elastic-path",
    importName: "EPProductExtensionsProvider",
    providesData: true,
  };

export function EPProductExtensionsProvider(
  props: EPProductExtensionsProviderProps,
) {
  const {
    children,
    className,
    notExtensionsContent,
    previewState = "auto",
  } = props;

  const product = useSelector("currentProduct") as Product | undefined;
  const inEditor = !!usePlasmicCanvasContext();

  const liveTemplates = useMemo(
    () => normalizeExtensions(extractRawExtensions(product)),
    [product],
  );

  // Decide between live and mock data.
  const useMock =
    previewState === "withData" ||
    (previewState === "auto" && inEditor && liveTemplates.length === 0);

  const useEmpty = previewState === "empty";

  const templates = useEmpty
    ? []
    : useMock
      ? MOCK_EXTENSION_TEMPLATES
      : liveTemplates;

  const extensionsData: ExtensionsData = useMemo(
    () => ({
      templateCount: templates.length,
      isEmpty: templates.length === 0,
    }),
    [templates],
  );

  // Self-gate: when there are no templates, render the override slot
  // (or nothing) — same pattern as EPBundleProvider.notBundleContent.
  if (templates.length === 0) {
    if (notExtensionsContent) {
      return (
        <div className={className} data-ep-product-extensions-provider="">
          {notExtensionsContent}
        </div>
      );
    }
    return null;
  }

  return (
    <DataProvider name="extensionsData" data={extensionsData}>
      <ExtensionsContext.Provider value={{ templates }}>
        <div className={className} data-ep-product-extensions-provider="">
          {children}
        </div>
      </ExtensionsContext.Provider>
    </DataProvider>
  );
}

/**
 * Convenience hook for design-time preview defaults — exported so the
 * mock data is also accessible to anyone testing field rendering.
 */
export function getMockExtensionsData(): ExtensionsData {
  return MOCK_EXTENSIONS_DATA;
}

export function registerEPProductExtensionsProvider(
  loader?: Registerable,
  customMeta?: CodeComponentMeta<EPProductExtensionsProviderProps>,
) {
  const doRegisterComponent: typeof registerComponent = (...args) =>
    loader ? loader.registerComponent(...args) : registerComponent(...args);
  doRegisterComponent(
    EPProductExtensionsProvider,
    customMeta ?? epProductExtensionsProviderMeta,
  );
}
