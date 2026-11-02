/** EPAccountOrderList — repeats children for each order in the history. */

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
import type { EpAccountOrder } from "../identity/operations";
import { Registerable } from "../registerable";
import { MOCK_ACCOUNT_ORDERS } from "../utils/design-time-data";
import type { AccountOrderHistoryContext } from "./types";

interface EPAccountOrderListProps {
  children?: React.ReactNode;
  className?: string;
}

export const epAccountOrderListMeta: CodeComponentMeta<EPAccountOrderListProps> =
  {
    name: "plasmic-commerce-ep-account-order-list",
    displayName: "EP Account Order List",
    description:
      "Repeats children for each order. Each row provides currentAccountOrder and currentAccountOrderIndex. Bind a Text element to $ctx.currentAccountOrder.id, status, payment, shipping, order_number, meta.timestamps.created_at, or meta.display_price.with_tax.formatted. Renders no rows while orders are loading, empty, or failed. Place inside an EP Account Orders Provider.",
    props: {
      children: {
        type: "slot",
        defaultValue: {
          type: "text",
          value: "Order",
        },
      },
    },
    importPath: "@elasticpath/plasmic-ep-commerce-elastic-path",
    importName: "EPAccountOrderList",
    parentComponentName: "plasmic-commerce-ep-account-orders-provider",
    providesData: true,
  };

export function EPAccountOrderList(props: EPAccountOrderListProps) {
  const { children, className } = props;
  const history = useSelector("accountOrders") as
    | AccountOrderHistoryContext
    | undefined;
  const inEditor = !!usePlasmicCanvasContext();
  const orders: EpAccountOrder[] =
    history?.status === "ready"
      ? history.orders
      : !history && inEditor
        ? MOCK_ACCOUNT_ORDERS
        : [];

  if (orders.length === 0) return null;

  return (
    <div className={className} role="list" aria-label="Order history">
      {orders.map((order, i) => (
        <div key={order.id} role="listitem">
          <DataProvider name="currentAccountOrder" data={order}>
            <DataProvider name="currentAccountOrderIndex" data={i}>
              {repeatedElement(i, children)}
            </DataProvider>
          </DataProvider>
        </div>
      ))}
    </div>
  );
}

export function registerEPAccountOrderList(
  loader?: Registerable,
  customMeta?: CodeComponentMeta<EPAccountOrderListProps>
) {
  const doRegisterComponent: typeof registerComponent = (...args) =>
    loader ? loader.registerComponent(...args) : registerComponent(...args);
  doRegisterComponent(EPAccountOrderList, customMeta ?? epAccountOrderListMeta);
}
