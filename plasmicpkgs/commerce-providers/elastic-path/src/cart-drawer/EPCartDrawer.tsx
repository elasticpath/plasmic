import {
  DataProvider,
  usePlasmicCanvasContext,
} from "@plasmicapp/host";
import registerComponent, {
  ComponentMeta,
} from "@plasmicapp/host/registerComponent";
import React, { useCallback, useEffect, useMemo, useRef } from "react";
import ReactDOM from "react-dom";
import useCart from "../cart/use-cart";
import { Registerable } from "../registerable";
import { createLogger } from "../utils/logger";
import { MOCK_CART_DATA } from "../utils/design-time-data";
import { useDrawerOpen, setDrawerOpen } from "./CartDrawerContext";

const log = createLogger("EPCartDrawer");

type PreviewState = "auto" | "withItems" | "empty" | "loading" | "error";

interface EPCartDrawerProps {
  children?: React.ReactNode;
  emptyContent?: React.ReactNode;
  loadingContent?: React.ReactNode;
  errorContent?: React.ReactNode;
  backdrop?: React.ReactNode;
  className?: string;
  isOpen?: boolean;
  onOpenChange?: (isOpen: boolean) => void;
  side?: "right" | "left";
  closeOnBackdropClick?: boolean;
  closeOnEscape?: boolean;
  trapFocus?: boolean;
  previewState?: PreviewState;
}

export const epCartDrawerMeta: ComponentMeta<EPCartDrawerProps> = {
  name: "plasmic-commerce-ep-cart-drawer",
  displayName: "EP Cart Drawer",
  description:
    "Slide-in cart drawer that displays cart contents. Fetches cart data and provides it to child components. Renders via portal to overlay the page.",
  defaultStyles: {
    width: "380px",
    maxWidth: "100%",
    minHeight: "200px",
    padding: "16px",
    backgroundColor: "#ffffff",
  },
  props: {
    children: {
      type: "slot",
      defaultValue: [
        {
          type: "component",
          name: "plasmic-commerce-ep-cart-item-list",
        },
        {
          type: "component",
          name: "plasmic-commerce-ep-cart-field",
          props: { field: "formattedTotal" },
        },
      ],
    },
    emptyContent: {
      type: "slot",
      displayName: "Empty Content",
      defaultValue: { type: "text", value: "Your cart is empty" },
    },
    loadingContent: {
      type: "slot",
      displayName: "Loading Content",
      defaultValue: { type: "text", value: "Loading cart..." },
    },
    errorContent: {
      type: "slot",
      displayName: "Error Content",
      defaultValue: { type: "text", value: "Failed to load cart" },
    },
    backdrop: {
      type: "slot",
      displayName: "Backdrop",
      hidePlaceholder: true,
    },
    isOpen: {
      type: "boolean",
      defaultValue: false,
      displayName: "Open",
      description:
        "Controls whether the drawer is open. Bind to a Plasmic state variable for two-way control.",
    },
    onOpenChange: {
      type: "eventHandler" as const,
      argTypes: [{ name: "isOpen", type: "boolean" }],
    },
    side: {
      type: "choice",
      options: ["right", "left"],
      defaultValue: "right",
      displayName: "Side",
    },
    closeOnBackdropClick: {
      type: "boolean",
      defaultValue: true,
      displayName: "Close on Backdrop Click",
      advanced: true,
    },
    closeOnEscape: {
      type: "boolean",
      defaultValue: true,
      displayName: "Close on Escape",
      advanced: true,
    },
    trapFocus: {
      type: "boolean",
      defaultValue: true,
      displayName: "Trap Focus",
      advanced: true,
    },
    previewState: {
      type: "choice",
      options: ["auto", "withItems", "empty", "loading", "error"],
      defaultValue: "auto",
      displayName: "Preview State",
      description:
        "Force a preview state with sample data for design-time editing",
      advanced: true,
    },
  },
  importPath: "@elasticpath/plasmic-ep-commerce-elastic-path",
  importName: "EPCartDrawer",
  providesData: true,
  states: {
    isOpen: {
      type: "writable",
      variableType: "boolean",
      valueProp: "isOpen",
      onChangeProp: "onOpenChange",
    },
  },
};

function formatCurrency(amount: number, currencyCode: string): string {
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: currencyCode,
    }).format(amount);
  } catch {
    return `$${amount.toFixed(2)}`;
  }
}

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

// Structural styles for the runtime portal — only positioning, not visual.
// Visual styles (width, background, padding, etc.) come from Plasmic's
// className via defaultStyles so the designer can override them.
const BACKDROP_STYLES: React.CSSProperties = {
  position: "fixed",
  top: 0,
  left: 0,
  right: 0,
  bottom: 0,
  zIndex: 9998,
  background: "rgba(0, 0, 0, 0.4)",
};

function getDrawerPositionStyles(
  side: "right" | "left"
): React.CSSProperties {
  return {
    position: "fixed",
    top: 0,
    bottom: 0,
    [side]: 0,
    zIndex: 9999,
    overflowY: "auto",
  };
}

export function EPCartDrawer(props: EPCartDrawerProps) {
  const {
    children,
    emptyContent,
    loadingContent,
    errorContent,
    backdrop,
    className,
    isOpen: isOpenProp = false,
    onOpenChange,
    side = "right",
    closeOnBackdropClick = true,
    closeOnEscape = true,
    trapFocus = true,
    previewState = "auto",
  } = props;

  const { data: cart, error: cartError } = useCart();
  const inEditor = !!usePlasmicCanvasContext();
  const [drawerOpen] = useDrawerOpen();
  const drawerRef = useRef<HTMLDivElement>(null);
  const previousFocusRef = useRef<Element | null>(null);
  const prevOverflowRef = useRef<string>("");

  // Effective open state: controlled prop OR module-level store
  const isOpen = isOpenProp || drawerOpen;

  // Close handler syncs both module-level store and Plasmic state
  const close = useCallback(() => {
    setDrawerOpen(false);
    onOpenChange?.(false);
  }, [onOpenChange]);

  // Escape key handler
  useEffect(() => {
    if (!isOpen || !closeOnEscape || inEditor) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        close();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, closeOnEscape, close, inEditor]);

  // Body scroll lock
  useEffect(() => {
    if (!isOpen || inEditor) return;
    prevOverflowRef.current = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prevOverflowRef.current;
    };
  }, [isOpen, inEditor]);

  // Focus trap
  useEffect(() => {
    if (!isOpen || !trapFocus || inEditor) return;

    previousFocusRef.current = document.activeElement;

    // Focus the drawer itself on open
    const timer = setTimeout(() => {
      drawerRef.current?.focus();
    }, 50);

    const handleTab = (e: KeyboardEvent) => {
      if (e.key !== "Tab" || !drawerRef.current) return;
      const focusable = Array.from(
        drawerRef.current.querySelectorAll(FOCUSABLE_SELECTOR)
      ) as HTMLElement[];
      if (focusable.length === 0) return;

      const first = focusable[0];
      const last = focusable[focusable.length - 1];

      if (e.shiftKey) {
        if (document.activeElement === first || document.activeElement === drawerRef.current) {
          e.preventDefault();
          last.focus();
        }
      } else {
        if (document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };

    document.addEventListener("keydown", handleTab);

    return () => {
      clearTimeout(timer);
      document.removeEventListener("keydown", handleTab);
      // Restore focus to the element that opened the drawer
      if (previousFocusRef.current instanceof HTMLElement) {
        previousFocusRef.current.focus();
      }
    };
  }, [isOpen, trapFocus, inEditor]);

  // Build enriched cart data for DataProvider
  const cartData = useMemo(() => {
    if (!cart) return null;
    const currencyCode = cart.currency?.code ?? "USD";
    return {
      id: cart.id,
      lineItems: cart.lineItems,
      itemCount: cart.lineItems.reduce(
        (sum, item) => sum + (item.quantity ?? 1),
        0
      ),
      isEmpty: cart.lineItems.length === 0,
      subtotalPrice: cart.subtotalPrice,
      totalPrice: cart.totalPrice,
      formattedSubtotal: formatCurrency(cart.subtotalPrice, currencyCode),
      formattedTotal: formatCurrency(cart.totalPrice, currencyCode),
      currencyCode,
    };
  }, [cart]);

  // --- Preview state handling ---

  const useMock =
    previewState === "withItems" ||
    (previewState === "auto" && !cart && inEditor);

  const effectiveCartData = useMock ? MOCK_CART_DATA : cartData;

  // -----------------------------------------------------------------------
  // Design-time: render inline so designer can see, select, and style.
  // The defaultStyles on the meta give the drawer its initial dimensions,
  // background, and padding — the designer can override via Plasmic Studio.
  // -----------------------------------------------------------------------
  if (inEditor) {
    if (previewState === "loading") {
      return (
        <div className={className} data-ep-cart-drawer="" data-side={side}>
          {loadingContent}
        </div>
      );
    }
    if (previewState === "error") {
      return (
        <div className={className} data-ep-cart-drawer="" data-side={side}>
          {errorContent}
        </div>
      );
    }
    if (previewState === "empty") {
      return (
        <DataProvider
          name="cartData"
          data={{ ...MOCK_CART_DATA, lineItems: [], itemCount: 0, isEmpty: true }}
        >
          <div
            className={className}
            role="dialog"
            aria-label="Shopping cart"
            data-ep-cart-drawer=""
            data-side={side}
          >
            {emptyContent}
          </div>
        </DataProvider>
      );
    }

    return (
      <DataProvider name="cartData" data={effectiveCartData}>
        <div
          className={className}
          role="dialog"
          aria-label="Shopping cart"
          data-ep-cart-drawer=""
          data-side={side}
        >
          {effectiveCartData?.isEmpty ? emptyContent : children}
        </div>
      </DataProvider>
    );
  }

  // -----------------------------------------------------------------------
  // Runtime: render via portal so the drawer overlays the page.
  // -----------------------------------------------------------------------

  // When closed, render nothing (cart data still fetches in background)
  if (!isOpen) return null;

  const handleBackdropClick = () => {
    if (closeOnBackdropClick) close();
  };

  const isEmpty = effectiveCartData?.isEmpty ?? true;

  // Determine which content to show inside the drawer panel
  let drawerContent: React.ReactNode;
  if (!cart && !cartError && !useMock) {
    drawerContent = loadingContent;
  } else if (cartError) {
    drawerContent = errorContent;
  } else {
    drawerContent = isEmpty ? emptyContent : children;
  }

  return ReactDOM.createPortal(
    <>
      {/* Backdrop — click to dismiss */}
      <div
        onClick={handleBackdropClick}
        aria-hidden="true"
        data-ep-cart-backdrop=""
        style={BACKDROP_STYLES}
      >
        {backdrop}
      </div>

      {/* Drawer panel */}
      <DataProvider name="cartData" data={effectiveCartData}>
        <div
          ref={drawerRef}
          className={className}
          role="dialog"
          aria-modal="true"
          aria-label="Shopping cart"
          tabIndex={-1}
          data-side={side}
          data-open={isOpen || undefined}
          data-ep-cart-drawer=""
          style={getDrawerPositionStyles(side)}
        >
          {drawerContent}
        </div>
      </DataProvider>
    </>,
    document.body
  );
}

export function registerEPCartDrawer(
  loader?: Registerable,
  customMeta?: ComponentMeta<EPCartDrawerProps>
) {
  const doRegisterComponent: typeof registerComponent = (...args) =>
    loader ? loader.registerComponent(...args) : registerComponent(...args);
  doRegisterComponent(EPCartDrawer, customMeta ?? epCartDrawerMeta);
}
