/** EPAccountOrderItemList — repeats children for each line of the ready order. */

import {
  DataProvider,
  repeatedElement,
  usePlasmicCanvasContext,
  useSelector,
} from "@plasmicapp/host";
import registerComponent, {
  CodeComponentMeta,
} from "@plasmicapp/host/registerComponent";
import React from "react";
import type { EpAccountOrderDetail, EpAccountOrderItem } from "../identity/operations";
import { Registerable } from "../registerable";
import { MOCK_ACCOUNT_ORDER_DETAIL } from "../utils/design-time-data";
import type { AccountOrderDetailData } from "./types";

interface EPAccountOrderItemListProps {
  children?: React.ReactNode;
  className?: string;
}

export const epAccountOrderItemListMeta: CodeComponentMeta<EPAccountOrderItemListProps> =
  {
    name: "plasmic-commerce-ep-account-order-item-list",
    displayName: "EP Account Order Item List",
    description:
      "Repeats children for each line of the ready order. Each row provides currentAccountOrderItem and currentAccountOrderItemIndex. Bind a Text element to $ctx.currentAccountOrderItem.name, sku, quantity, product_id, meta.display_price.with_tax.unit.formatted, or meta.display_price.with_tax.value.formatted. Renders no rows while the order is loading, missing, failed, or has no lines. Place inside an EP Account Order Detail Provider.",
    props: {
      children: {
        type: "slot",
        defaultValue: {
          type: "text",
          value: "Item",
        },
      },
    },
    importPath: "@elasticpath/plasmic-ep-commerce-elastic-path",
    importName: "EPAccountOrderItemList",
    parentComponentName: "plasmic-commerce-ep-account-order-detail-provider",
    providesData: true,
  };

export function EPAccountOrderItemList(props: EPAccountOrderItemListProps) {
  const { children, className } = props;
  const detail = useSelector("accountOrderDetailData") as
    | AccountOrderDetailData
    | undefined;
  const order = useSelector("currentAccountOrder") as
    | EpAccountOrderDetail
    | null
    | undefined;
  const inEditor = !!usePlasmicCanvasContext();
  const items: EpAccountOrderItem[] =
    detail?.status === "ready" && order && Array.isArray(order.items)
      ? order.items
      : !detail && inEditor
        ? MOCK_ACCOUNT_ORDER_DETAIL.items
        : [];

  if (items.length === 0) return null;

  return (
    <div className={className} role="list" aria-label="Order items">
      {items.map((item, i) => (
        <div key={`${item.id}:${i}`} role="listitem">
          <DataProvider name="currentAccountOrderItem" data={item}>
            <DataProvider name="currentAccountOrderItemIndex" data={i}>
              {repeatedElement(i, children)}
            </DataProvider>
          </DataProvider>
        </div>
      ))}
    </div>
  );
}

export function registerEPAccountOrderItemList(
  loader?: Registerable,
  customMeta?: CodeComponentMeta<EPAccountOrderItemListProps>
) {
  const doRegisterComponent: typeof registerComponent = (...args) =>
    loader ? loader.registerComponent(...args) : registerComponent(...args);
  doRegisterComponent(
    EPAccountOrderItemList,
    customMeta ?? epAccountOrderItemListMeta
  );
}
