import { useSelector, usePlasmicCanvasContext } from "@plasmicapp/host";
import registerComponent, {
  ComponentMeta,
} from "@plasmicapp/host/registerComponent";
import React from "react";
import { Registerable } from "../../registerable";
import { MOCK_BUNDLE_DATA } from "./design-time-data";
import { formatPriceDisplay } from "../utils/priceCalculation";

type PreviewState = "auto" | "withData";

interface EPBundlePriceFieldProps {
  className?: string;
  previewState?: PreviewState;
}

export const epBundlePriceFieldMeta: ComponentMeta<EPBundlePriceFieldProps> = {
  name: "plasmic-commerce-ep-bundle-price-field",
  displayName: "EP Bundle Price Field",
  description:
    "Displays the current bundle price. Updates after each successful configuration API call. Must be inside an EP Bundle Provider.",
  props: {
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
  importName: "EPBundlePriceField",
  parentComponentName: "plasmic-commerce-ep-bundle-provider",
};

export function EPBundlePriceField(props: EPBundlePriceFieldProps) {
  const { className, previewState = "auto" } = props;

  const bundleData = useSelector("bundleData") as
    | {
        currentPrice?: string;
        isConfiguring?: boolean;
        pricingType?: string;
      }
    | undefined;
  const inEditor = !!usePlasmicCanvasContext();

  const useMock =
    previewState === "withData" || (!bundleData && inEditor);

  const data = useMock ? MOCK_BUNDLE_DATA : bundleData;
  if (!data) return null;

  const isFixedPrice = data.pricingType === "fixed";
  const displayText = formatPriceDisplay(
    data.currentPrice,
    data.isConfiguring ?? false,
    isFixedPrice
  );

  return (
    <span className={className} data-configuring={data.isConfiguring || undefined}>
      {displayText}
    </span>
  );
}

export function registerEPBundlePriceField(
  loader?: Registerable,
  customMeta?: ComponentMeta<EPBundlePriceFieldProps>
) {
  const doRegisterComponent: typeof registerComponent = (...args) =>
    loader ? loader.registerComponent(...args) : registerComponent(...args);
  doRegisterComponent(EPBundlePriceField, customMeta ?? epBundlePriceFieldMeta);
}
