import React from "react";
import { DataProvider } from "@plasmicapp/host";
import registerComponent, {
  CodeComponentMeta,
} from "@plasmicapp/host/registerComponent";
import type { Cart } from "../types/cart";
import { Registerable } from "../registerable";
import { useEpCart } from "./use-ep-cart";

type CartState = "loading" | "error" | "empty" | "ready";

interface EPCartProviderProps {
  children?: React.ReactNode;
  className?: string;
  loadingContent?: React.ReactNode;
  errorContent?: React.ReactNode;
  emptyContent?: React.ReactNode;
  previewState?: "auto" | CartState;
}

/**
 * Which slot a cart tree should render.
 *
 * An empty cart and a cart that has not loaded are different things — telling
 * them apart is what stops an empty cart rendering "Loading cart…".
 */
export function resolveCartState(
  cart: Cart | null,
  isLoading: boolean,
  error: Error | null
): CartState {
  if (error) return "error";
  if (isLoading || !cart) return "loading";
  return cart.itemCount === 0 ? "empty" : "ready";
}

export function EPCartProvider(props: EPCartProviderProps) {
  const {
    children,
    className,
    loadingContent,
    errorContent,
    emptyContent,
    previewState = "auto",
  } = props;
  const { cart, isLoading, error } = useEpCart();

  const state =
    previewState === "auto"
      ? resolveCartState(cart, isLoading, error)
      : previewState;

  // Each slot falls through to `children` when the designer left it empty, so
  // a mini-cart badge still renders while the cart is loading or empty.
  const slot = { loading: loadingContent, error: errorContent, empty: emptyContent, ready: undefined }[
    state
  ];

  return (
    <DataProvider name="cart" data={cart ?? undefined}>
      <div className={className}>{slot ?? children}</div>
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
    loadingContent: {
      type: "slot",
      displayName: "Loading",
      description: "Rendered while the cart is being fetched.",
    },
    errorContent: {
      type: "slot",
      displayName: "Error",
      description: "Rendered when the cart could not be fetched.",
    },
    emptyContent: {
      type: "slot",
      displayName: "Empty",
      description: "Rendered when the cart has no items.",
    },
    previewState: {
      type: "choice",
      displayName: "Preview State",
      description: "Force a state in the editor so every slot can be styled.",
      options: ["auto", "loading", "error", "empty", "ready"],
      defaultValue: "auto",
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
