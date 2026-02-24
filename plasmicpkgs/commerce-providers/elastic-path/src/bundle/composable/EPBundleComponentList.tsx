import {
  DataProvider,
  repeatedElement,
  useSelector,
  usePlasmicCanvasContext,
} from "@plasmicapp/host";
import registerComponent, {
  ComponentMeta,
} from "@plasmicapp/host/registerComponent";
import React, { useMemo } from "react";
import { Registerable } from "../../registerable";
import { sortByOrder } from "../utils/bundleSelectionUtils";
import { useBundleFormContext } from "./BundleContext";
import {
  MOCK_BUNDLE_COMPONENTS,
  MockBundleComponent,
} from "./design-time-data";

type PreviewState = "auto" | "withData";

interface EPBundleComponentListProps {
  children?: React.ReactNode;
  className?: string;
  previewState?: PreviewState;
}

export const epBundleComponentListMeta: ComponentMeta<EPBundleComponentListProps> =
  {
    name: "plasmic-commerce-ep-bundle-component-list",
    displayName: "EP Bundle Component List",
    description:
      "Iterates over bundle components sorted by sort_order. Provides currentBundleComponent and currentBundleComponentIndex to children. Must be inside an EP Bundle Provider.",
    props: {
      children: {
        type: "slot",
        defaultValue: [
          {
            type: "vbox",
            children: [
              {
                type: "component",
                name: "plasmic-commerce-ep-bundle-component-field",
                props: { field: "name" },
              },
              {
                type: "component",
                name: "plasmic-commerce-ep-bundle-option-list",
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
    importName: "EPBundleComponentList",
    providesData: true,
  };

export function EPBundleComponentList(props: EPBundleComponentListProps) {
  const { children, className, previewState = "auto" } = props;

  const bundleData = useSelector("bundleData") as
    | { componentCount?: number }
    | undefined;
  const formCtx = useBundleFormContext();
  const inEditor = !!usePlasmicCanvasContext();

  const useMock =
    previewState === "withData" || (!bundleData && inEditor);

  // Build enriched component list from form context
  const componentList: MockBundleComponent[] = useMemo(() => {
    if (useMock) return MOCK_BUNDLE_COMPONENTS;
    if (!formCtx) return [];

    const { components, selectedOptions, optionProducts, parentProducts } =
      formCtx;

    return Object.entries(components).map(([componentKey, component]) => {
      const selections = selectedOptions[componentKey] || {};
      const selectedCount = Object.values(selections).reduce(
        (sum, qty) => sum + qty,
        0
      );

      const min = component.min ?? 0;
      const max = component.max ?? Number.MAX_SAFE_INTEGER;
      const isValid = selectedCount >= min && selectedCount <= max;

      const options =
        component.options?.map((option) => {
          const optionId = option.id || "";
          // Check if any selection key starts with this optionId (handles parent:child keys)
          const selectionEntry = Object.entries(selections).find(
            ([key]) => key === optionId || key.startsWith(`${optionId}:`)
          );
          const quantity = selectionEntry ? selectionEntry[1] : 0;
          const isSelected = quantity > 0;

          // Look up product metadata
          const productInfo = optionProducts[optionId] || {};
          const parentInfo = parentProducts[optionId];
          const isParentProduct = parentInfo?.isParent ?? false;

          const sortOrd = option.sort_order ?? 0;
          return {
            id: optionId,
            name: productInfo.name ?? optionId,
            quantity,
            minQty: option.min ?? null,
            maxQty: option.max ?? null,
            isSelected,
            isParentProduct,
            price: productInfo.price ?? "",
            imageUrl: productInfo.image ?? "",
            sortOrder: sortOrd,
            sort_order: sortOrd,
            isDefault: option.default ?? false,
            sku: productInfo.sku ?? "",
            description: productInfo.description ?? "",
          };
        }) ?? [];

      const compSortOrd = component.sort_order ?? 0;
      return {
        name: component.name ?? componentKey,
        key: componentKey,
        min,
        max,
        selectedCount,
        isValid,
        sortOrder: compSortOrd,
        sort_order: compSortOrd,
        options: sortByOrder(options),
      } as MockBundleComponent;
    });
  }, [useMock, formCtx]);

  if (componentList.length === 0) return null;

  const sorted = sortByOrder(componentList);

  return (
    <div className={className} role="list" aria-label="Bundle components">
      {sorted.map((component, i) => (
        <div key={component.key} role="listitem">
          <DataProvider name="currentBundleComponent" data={component}>
            <DataProvider name="currentBundleComponentIndex" data={i}>
              {repeatedElement(i, children)}
            </DataProvider>
          </DataProvider>
        </div>
      ))}
    </div>
  );
}

export function registerEPBundleComponentList(
  loader?: Registerable,
  customMeta?: ComponentMeta<EPBundleComponentListProps>
) {
  const doRegisterComponent: typeof registerComponent = (...args) =>
    loader ? loader.registerComponent(...args) : registerComponent(...args);
  doRegisterComponent(
    EPBundleComponentList,
    customMeta ?? epBundleComponentListMeta
  );
}
