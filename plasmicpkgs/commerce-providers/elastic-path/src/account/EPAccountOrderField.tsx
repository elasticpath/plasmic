/** EPAccountOrderField — displays one summary value of the current order. */

import { usePlasmicCanvasContext, useSelector } from "@plasmicapp/host";
import registerComponent, {
  CodeComponentMeta,
} from "@plasmicapp/host/registerComponent";
import React from "react";
import type { EpAccountOrder } from "../identity/operations";
import { Registerable } from "../registerable";
import { MOCK_ACCOUNT_ORDERS } from "../utils/design-time-data";
import type { AccountOrderFieldName } from "./types";

interface EPAccountOrderFieldProps {
  field?: AccountOrderFieldName;
  className?: string;
}

export const epAccountOrderFieldMeta: CodeComponentMeta<EPAccountOrderFieldProps> =
  {
    name: "plasmic-commerce-ep-account-order-field",
    displayName: "EP Account Order Field",
    description:
      "Displays one summary field of the current order. Place inside an EP Account Orders Provider. A missing value is blank. `id` shows the order id unchanged. `$ctx.currentAccountOrder.id` stays available for links. `total` shows the formatted price.",
    props: {
      field: {
        type: "choice",
        options: [
          { label: "Order ID", value: "id" },
          { label: "Order number", value: "order_number" },
          { label: "Status", value: "status" },
          { label: "Payment", value: "payment" },
          { label: "Shipping", value: "shipping" },
          { label: "Created", value: "created_at" },
          { label: "Total", value: "total" },
        ],
        defaultValue: "id",
        displayName: "Field",
      },
    },
    importPath: "@elasticpath/plasmic-ep-commerce-elastic-path",
    importName: "EPAccountOrderField",
    parentComponentName: "plasmic-commerce-ep-account-orders-provider",
  };

function orderFieldValue(
  order: EpAccountOrder,
  field: AccountOrderFieldName
): string {
  if (field === "total") return order.total?.formatted ?? "";
  const value = order[field];
  return typeof value === "string" ? value : "";
}

export function EPAccountOrderField(props: EPAccountOrderFieldProps) {
  const { field = "id", className } = props;
  const current = useSelector("currentAccountOrder") as
    | EpAccountOrder
    | undefined;
  const inEditor = !!usePlasmicCanvasContext();
  const order = current ?? (inEditor ? MOCK_ACCOUNT_ORDERS[0] : undefined);

  if (!order) return null;

  return (
    <span className={className} data-ep-account-order-field="">
      {orderFieldValue(order, field)}
    </span>
  );
}

export function registerEPAccountOrderField(
  loader?: Registerable,
  customMeta?: CodeComponentMeta<EPAccountOrderFieldProps>
) {
  const doRegisterComponent: typeof registerComponent = (...args) =>
    loader ? loader.registerComponent(...args) : registerComponent(...args);
  doRegisterComponent(
    EPAccountOrderField,
    customMeta ?? epAccountOrderFieldMeta
  );
}
