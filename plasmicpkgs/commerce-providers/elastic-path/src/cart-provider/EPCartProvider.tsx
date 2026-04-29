import React from "react";
import { DataProvider } from "@plasmicapp/host";
import registerComponent, {
  CodeComponentMeta,
} from "@plasmicapp/host/registerComponent";
import type { Cart, LineItem } from "../types/cart";
import { Registerable } from "../registerable";
import { useEpCart } from "./use-ep-cart";

interface EPCartProviderProps {
  children?: React.ReactNode;
  className?: string;
}

interface CartContextShape {
  cart: Cart | null;
  items: LineItem[];
  itemCount: number;
  totals: {
    subtotal: number;
    total: number;
    currency: string;
  };
  isLoading: boolean;
  isEmpty: boolean;
  error: Error | null;
}

function deriveCartContext(
  cart: Cart | null,
  isLoading: boolean,
  error: Error | null
): CartContextShape {
  const items = cart?.lineItems ?? [];
  const itemCount = items.reduce((sum, i) => sum + (i.quantity ?? 0), 0);
  const totals = {
    subtotal: cart?.subtotalPrice ?? 0,
    total: cart?.totalPrice ?? 0,
    currency: cart?.currency?.code ?? "USD",
  };
  return {
    cart,
    items,
    itemCount,
    totals,
    isLoading,
    isEmpty: items.length === 0,
    error,
  };
}

export function EPCartProvider(props: EPCartProviderProps) {
  const { children, className } = props;
  const { cart, isLoading, error } = useEpCart();
  const data = deriveCartContext(cart, isLoading, error);

  return (
    <DataProvider name="cart" data={data}>
      <div className={className}>{children}</div>
    </DataProvider>
  );
}

export const epCartProviderMeta: CodeComponentMeta<EPCartProviderProps> = {
  name: "plasmic-commerce-ep-cart-provider",
  displayName: "EP Cart Provider",
  description:
    "Exposes the current shopper's cart as $ctx.cart to all descendants. Wrap a header, mini-cart, or any tree that needs cart data.",
  props: {
    children: {
      type: "slot",
      defaultValue: [],
    },
  },
  importPath: "@elasticpath/plasmic-ep-commerce-elastic-path",
  importName: "EPCartProvider",
  providesData: true,
};

export function registerEPCartProvider(
  loader?: Registerable,
  customMeta?: CodeComponentMeta<EPCartProviderProps>
) {
  const doRegister: typeof registerComponent = (...args) =>
    loader ? loader.registerComponent(...args) : registerComponent(...args);
  doRegister(EPCartProvider, customMeta ?? epCartProviderMeta);
}

// Exported for tests.
export { deriveCartContext };
