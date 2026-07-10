import {
  DataProvider,
  usePlasmicCanvasContext,
} from "@plasmicapp/host";
import registerComponent, {
  CodeComponentMeta,
} from "@plasmicapp/host/registerComponent";
import React from "react";
import { useEpCart } from "../cart-provider/use-ep-cart";
import { Registerable } from "../registerable";
import { MOCK_CART_LINE_ITEMS } from "../utils/design-time-data";
import { useDrawerOpen, setDrawerOpen } from "./CartDrawerContext";

type PreviewState = "auto" | "withItems" | "empty";

interface EPCartDrawerTriggerProps {
  children?: React.ReactNode;
  className?: string;
  action?: "toggle" | "open" | "close";
  previewState?: PreviewState;
}

export const epCartDrawerTriggerMeta: CodeComponentMeta<EPCartDrawerTriggerProps> = {
  name: "plasmic-commerce-ep-cart-drawer-trigger",
  displayName: "EP Cart Drawer Trigger",
  description:
    "Button that opens/closes the cart drawer. Can be placed anywhere on the page (e.g. site header). Exposes cart item count via data context.",
  props: {
    children: {
      type: "slot",
      defaultValue: [{ type: "text", value: "Cart (0)" }],
    },
    action: {
      type: "choice",
      options: [
        { label: "Toggle", value: "toggle" },
        { label: "Open", value: "open" },
        { label: "Close", value: "close" },
      ],
      defaultValue: "toggle",
      displayName: "Action",
    },
    previewState: {
      type: "choice",
      options: ["auto", "withItems", "empty"],
      defaultValue: "auto",
      displayName: "Preview State",
      description:
        "Force a preview state with sample data for design-time editing",
      advanced: true,
    },
  },
  importPath: "@elasticpath/plasmic-ep-commerce-elastic-path",
  importName: "EPCartDrawerTrigger",
  providesData: true,
};

export function EPCartDrawerTrigger(props: EPCartDrawerTriggerProps) {
  const {
    children,
    className,
    action = "toggle",
    previewState = "auto",
  } = props;

  const { cart } = useEpCart();
  const inEditor = !!usePlasmicCanvasContext();
  const [isOpen] = useDrawerOpen();

  const useMock =
    previewState !== "auto" || (!cart && inEditor);

  const itemCount = useMock
    ? previewState === "empty"
      ? 0
      : MOCK_CART_LINE_ITEMS.reduce((sum, item) => sum + item.quantity, 0)
    : cart?.lineItems.reduce(
        (sum: number, item: any) => sum + (item.quantity ?? 1),
        0
      ) ?? 0;

  const isEmpty = itemCount === 0;

  const handleClick = () => {
    if (inEditor && useMock) return;
    switch (action) {
      case "open":
        setDrawerOpen(true);
        break;
      case "close":
        setDrawerOpen(false);
        break;
      default:
        setDrawerOpen(!isOpen);
        break;
    }
  };

  return (
    <DataProvider
      name="cartTriggerData"
      data={{ itemCount, isEmpty, isOpen }}
    >
      <div
        className={className}
        onClick={handleClick}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            handleClick();
          }
        }}
        aria-label={`Shopping cart, ${itemCount} ${itemCount === 1 ? "item" : "items"}`}
        aria-expanded={isOpen}
      >
        {children}
      </div>
    </DataProvider>
  );
}

export function registerEPCartDrawerTrigger(
  loader?: Registerable,
  customMeta?: CodeComponentMeta<EPCartDrawerTriggerProps>
) {
  const doRegisterComponent: typeof registerComponent = (...args) =>
    loader ? loader.registerComponent(...args) : registerComponent(...args);
  doRegisterComponent(
    EPCartDrawerTrigger,
    customMeta ?? epCartDrawerTriggerMeta
  );
}
