import { useSelector, usePlasmicCanvasContext } from "@plasmicapp/host";
import registerComponent, {
  ComponentMeta,
} from "@plasmicapp/host/registerComponent";
import React from "react";
import { Registerable } from "../registerable";
import { MOCK_CART_LINE_ITEMS } from "../utils/design-time-data";

type PreviewState = "auto" | "withData";

interface EPCartItemImageProps {
  className?: string;
  width?: number;
  height?: number;
  loading?: "lazy" | "eager";
  previewState?: PreviewState;
}

export const epCartItemImageMeta: ComponentMeta<EPCartItemImageProps> = {
  name: "plasmic-commerce-ep-cart-item-image",
  displayName: "EP Cart Item Image",
  description:
    "Displays the product image for the current cart item. Must be inside an EP Cart Item List.",
  props: {
    width: {
      type: "number",
      defaultValue: 64,
      displayName: "Width",
    },
    height: {
      type: "number",
      defaultValue: 64,
      displayName: "Height",
    },
    loading: {
      type: "choice",
      options: ["lazy", "eager"],
      defaultValue: "lazy",
      displayName: "Loading",
      advanced: true,
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
  importName: "EPCartItemImage",
};

export function EPCartItemImage(props: EPCartItemImageProps) {
  const {
    className,
    width = 64,
    height = 64,
    loading = "lazy",
    previewState = "auto",
  } = props;

  const currentItem = useSelector("currentCartItem") as
    | { imageUrl?: string; imageAlt?: string }
    | undefined;
  const inEditor = !!usePlasmicCanvasContext();

  const useMock =
    previewState === "withData" || (!currentItem && inEditor);

  const effectiveItem = useMock ? MOCK_CART_LINE_ITEMS[0] : currentItem;

  const imageUrl = effectiveItem?.imageUrl;
  const imageAlt = effectiveItem?.imageAlt || "";

  if (!imageUrl) {
    return (
      <div
        className={className}
        role="img"
        aria-label={imageAlt || "No product image"}
        style={{
          width,
          height,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: "#f3f4f6",
          color: "#9ca3af",
          borderRadius: 4,
          flexShrink: 0,
        }}
      >
        <svg
          width={Math.round(width * 0.4)}
          height={Math.round(height * 0.4)}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
          <circle cx="8.5" cy="8.5" r="1.5" />
          <path d="M21 15l-5-5L5 21" />
        </svg>
      </div>
    );
  }

  return (
    <img
      className={className}
      src={imageUrl}
      alt={imageAlt}
      width={width}
      height={height}
      loading={loading}
    />
  );
}

export function registerEPCartItemImage(
  loader?: Registerable,
  customMeta?: ComponentMeta<EPCartItemImageProps>
) {
  const doRegisterComponent: typeof registerComponent = (...args) =>
    loader ? loader.registerComponent(...args) : registerComponent(...args);
  doRegisterComponent(EPCartItemImage, customMeta ?? epCartItemImageMeta);
}
