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
import { MOCK_CHECKOUT_CART_ITEMS } from "../../utils/design-time-data";
import { createLogger } from "../../utils/logger";

const log = createLogger("EPCheckoutCartItemList");

type PreviewState = "auto" | "withItems";

interface EPCheckoutCartItemListProps {
  children?: React.ReactNode;
  className?: string;
  previewState?: PreviewState;
}

export const epCheckoutCartItemListMeta: ComponentMeta<EPCheckoutCartItemListProps> =
  {
    name: "plasmic-commerce-ep-checkout-cart-item-list",
    displayName: "EP Checkout Cart Item List",
    description:
      "Repeats children for each line item in the checkout cart. Must be inside an EP Checkout Cart Summary.",
    props: {
      children: {
        type: "slot",
        defaultValue: [
          {
            type: "hbox",
            children: [
              {
                type: "component",
                name: "plasmic-commerce-ep-checkout-cart-field",
                props: { field: "imageUrl" },
              },
              {
                type: "vbox",
                children: [
                  {
                    type: "component",
                    name: "plasmic-commerce-ep-checkout-cart-field",
                    props: { field: "name" },
                  },
                  {
                    type: "component",
                    name: "plasmic-commerce-ep-checkout-cart-field",
                    props: { field: "formattedPrice" },
                  },
                ],
              },
            ],
          },
        ],
      },
      previewState: {
        type: "choice",
        options: ["auto", "withItems"],
        defaultValue: "auto",
        displayName: "Preview State",
        description:
          "Force a preview state with sample data for design-time editing",
        advanced: true,
      },
    },
    importPath: "@elasticpath/plasmic-ep-commerce-elastic-path",
    importName: "EPCheckoutCartItemList",
    providesData: true,
  };

export function EPCheckoutCartItemList(props: EPCheckoutCartItemListProps) {
  const { children, className, previewState = "auto" } = props;

  const cartData = useSelector("checkoutCartData") as
    | { items?: any[] }
    | undefined;
  const inEditor = !!usePlasmicCanvasContext();

  const useMock =
    previewState === "withItems" ||
    (previewState === "auto" && !cartData?.items?.length && inEditor);

  if (useMock) {
    log.debug("Using mock checkout items for design-time preview");
  }

  const items = useMock
    ? MOCK_CHECKOUT_CART_ITEMS
    : cartData?.items ?? [];

  if (items.length === 0) return null;

  return (
    <div className={className} role="list" aria-label="Order items">
      {items.map((item, i) => (
        <div key={item.id} role="listitem">
          <DataProvider name="currentCheckoutItem" data={item}>
            <DataProvider name="currentCheckoutItemIndex" data={i}>
              {repeatedElement(i, children)}
            </DataProvider>
          </DataProvider>
        </div>
      ))}
    </div>
  );
}

export function registerEPCheckoutCartItemList(
  loader?: Registerable,
  customMeta?: ComponentMeta<EPCheckoutCartItemListProps>
) {
  const doRegisterComponent: typeof registerComponent = (...args) =>
    loader ? loader.registerComponent(...args) : registerComponent(...args);
  doRegisterComponent(
    EPCheckoutCartItemList,
    customMeta ?? epCheckoutCartItemListMeta
  );
}
