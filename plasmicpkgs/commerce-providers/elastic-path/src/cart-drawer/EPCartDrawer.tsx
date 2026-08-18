import {
  DataProvider,
  usePlasmicCanvasContext,
} from "@plasmicapp/host";
import registerComponent, {
  CodeComponentMeta,
} from "@plasmicapp/host/registerComponent";
import React, { useCallback, useEffect, useMemo, useRef } from "react";
import ReactDOM from "react-dom";
import { useEpCart } from "../cart-provider/use-ep-cart";
import {
  CART_BACKDROP_Z_INDEX,
  CART_OVERLAY_Z_INDEX,
  FOCUS_TRAP_DELAY_MS,
} from "../const";
import { useEpCommerce } from "../shopper-context/EpCommerceContext";
import { Registerable } from "../registerable";
import { createLogger } from "../utils/logger";
import { MOCK_CART_DATA, MOCK_EMPTY_CART_DATA } from "../utils/design-time-data";
import { useDrawerOpen, setDrawerOpen } from "./CartDrawerContext";
import {
  OverlayEditorOpenProps,
  useOverlayEditorOpen,
} from "./use-overlay-editor-open";

const log = createLogger("EPCartDrawer");

type PreviewState = "auto" | "withItems" | "empty" | "loading" | "error";

interface EPCartDrawerProps extends OverlayEditorOpenProps {
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
  inline?: boolean;
}

export const epCartDrawerMeta: CodeComponentMeta<EPCartDrawerProps> = {
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
    inline: {
      type: "boolean",
      displayName: "Inline",
      description:
        "Render inline instead of as a drawer overlay (use on cart pages)",
      defaultValue: false,
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
  zIndex: CART_BACKDROP_Z_INDEX,
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
    zIndex: CART_OVERLAY_Z_INDEX,
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
    inline = false,
  } = props;

  const { cart, error: cartError } = useEpCart();
  const commerce = useEpCommerce();
  const currencyDisplay = commerce?.currencyDisplay ?? "symbol";
  const inEditor = !!usePlasmicCanvasContext();
  // Open the drawer in the Studio canvas when this node (or a descendant) is
  // selected in the outline. The drawer has no trigger slot (its trigger is a
  // separate EPCartDrawerTrigger component), so no slot needs excluding.
  const autoOpenForEditing = useOverlayEditorOpen(props);
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
    if (!isOpen || !closeOnEscape || inEditor || inline) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        close();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, closeOnEscape, close, inEditor, inline]);

  // Body scroll lock
  useEffect(() => {
    if (!isOpen || inEditor || inline) return;
    prevOverflowRef.current = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prevOverflowRef.current;
    };
  }, [isOpen, inEditor, inline]);

  // Focus trap
  useEffect(() => {
    if (!isOpen || !trapFocus || inEditor || inline) return;

    previousFocusRef.current = document.activeElement;

    // Focus the drawer itself on open
    const timer = setTimeout(() => {
      drawerRef.current?.focus();
    }, FOCUS_TRAP_DELAY_MS);

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
  }, [isOpen, trapFocus, inEditor, inline]);

  // Build enriched cart data for DataProvider — formatted money honours the
  // provider's currencyDisplay preference (symbol vs. ISO code prefix).

  // --- Preview state handling ---

  const useMock =
    previewState === "withItems" ||
    (previewState === "auto" && !cart && inEditor);

  const effectiveCartData = useMock ? MOCK_CART_DATA : cart;

  // -----------------------------------------------------------------------
  // Design-time: render inline so designer can see, select, and style.
  // The defaultStyles on the meta give the drawer its initial dimensions,
  // background, and padding — the designer can override via Plasmic Studio.
  //
  // Inline mode (the dedicated cart page) always renders. Drawer mode renders
  // only when "open" for editing — selected in the outline (autoOpenForEditing),
  // an explicit previewState, or a bound isOpen — so it doesn't clutter the
  // canvas the rest of the time.
  // -----------------------------------------------------------------------
  if (inEditor) {
    const editorOpen =
      inline || previewState !== "auto" || autoOpenForEditing || isOpen;
    if (!editorOpen) return null;

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
        <DataProvider name="cart" data={MOCK_EMPTY_CART_DATA}>
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
      <DataProvider name="cart" data={effectiveCartData}>
        <div
          className={className}
          role="dialog"
          aria-label="Shopping cart"
          data-ep-cart-drawer=""
          data-side={side}
        >
          {(effectiveCartData?.itemCount ?? 0) === 0 ? emptyContent : children}
        </div>
      </DataProvider>
    );
  }

  // -----------------------------------------------------------------------
  // Inline mode: render directly on the page (e.g. dedicated cart page).
  // No portal, no backdrop, no open/close logic.
  // -----------------------------------------------------------------------
  if (inline) {
    const isEmpty = (effectiveCartData?.itemCount ?? 0) === 0;
    let content: React.ReactNode;
    if (!cart && !cartError && !useMock) {
      content = loadingContent;
    } else if (cartError) {
      content = errorContent;
    } else {
      content = isEmpty ? emptyContent : children;
    }
    return (
      <DataProvider name="cart" data={effectiveCartData}>
        <div className={className} data-ep-cart-inline="">
          {content}
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

  const isEmpty = (effectiveCartData?.itemCount ?? 0) === 0;

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
      <DataProvider name="cart" data={effectiveCartData}>
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

export const epCartInlineMeta: CodeComponentMeta<EPCartDrawerProps> = {
  name: "plasmic-commerce-ep-cart-inline",
  displayName: "EP Cart (Inline)",
  description:
    "Inline cart view for dedicated cart pages. Fetches cart data and provides it to child components without the drawer overlay.",
  defaultStyles: {
    width: "stretch",
    minHeight: "200px",
    padding: "16px",
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
    previewState: {
      type: "choice",
      options: ["auto", "withItems", "empty", "loading", "error"],
      defaultValue: "auto",
      displayName: "Preview State",
      description:
        "Force a preview state with sample data for design-time editing",
      advanced: true,
    },
    inline: {
      type: "boolean",
      defaultValue: true,
      hidden: () => true,
    },
  },
  importPath: "@elasticpath/plasmic-ep-commerce-elastic-path",
  importName: "EPCartDrawer",
  providesData: true,
  // No states — inline mode doesn't need isOpen
};

export function registerEPCartDrawer(
  loader?: Registerable,
  customMeta?: CodeComponentMeta<EPCartDrawerProps>
) {
  const doRegisterComponent: typeof registerComponent = (...args) =>
    loader ? loader.registerComponent(...args) : registerComponent(...args);
  doRegisterComponent(EPCartDrawer, customMeta ?? epCartDrawerMeta);
}

export function registerEPCartInline(
  loader?: Registerable,
  customMeta?: CodeComponentMeta<EPCartDrawerProps>
) {
  const doRegisterComponent: typeof registerComponent = (...args) =>
    loader ? loader.registerComponent(...args) : registerComponent(...args);
  doRegisterComponent(EPCartDrawer, customMeta ?? epCartInlineMeta);
}
