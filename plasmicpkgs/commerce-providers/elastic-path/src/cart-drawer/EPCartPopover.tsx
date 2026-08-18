import {
  DataProvider,
  usePlasmicCanvasContext,
} from "@plasmicapp/host";
import registerComponent, {
  CodeComponentMeta,
} from "@plasmicapp/host/registerComponent";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useEpCart } from "../cart-provider/use-ep-cart";
import { useEpCommerce } from "../shopper-context/EpCommerceContext";
import { Registerable } from "../registerable";
import { MOCK_CART_DATA, MOCK_EMPTY_CART_DATA } from "../utils/design-time-data";
import {
  getPopoverPositionStyles,
  PopoverPlacement,
} from "../utils/popover-position";
import {
  OverlayEditorOpenProps,
  useOverlayEditorOpen,
} from "./use-overlay-editor-open";

type PreviewState = "auto" | "withItems" | "empty" | "loading" | "error";

interface EPCartPopoverProps extends OverlayEditorOpenProps {
  trigger?: React.ReactNode;
  children?: React.ReactNode;
  emptyContent?: React.ReactNode;
  loadingContent?: React.ReactNode;
  errorContent?: React.ReactNode;
  className?: string;
  isOpen?: boolean;
  onOpenChange?: (isOpen: boolean) => void;
  placement?: PopoverPlacement;
  offset?: number;
  closeOnOutsideClick?: boolean;
  closeOnEscape?: boolean;
  previewState?: PreviewState;
}

export const epCartPopoverMeta: CodeComponentMeta<EPCartPopoverProps> = {
  name: "plasmic-commerce-ep-cart-popover",
  displayName: "EP Cart Popover",
  description:
    "Anchored cart popover. A trigger button toggles a panel that displays cart contents, positioned relative to the trigger. Fetches cart data and provides it to child components — no portal needed.",
  defaultStyles: {
    width: "360px",
    maxWidth: "90vw",
    padding: "8px",
    backgroundColor: "#ffffff",
    borderRadius: "8px",
    boxShadow: "0 8px 24px rgba(0, 0, 0, 0.2)",
    overflow: "hidden",
  },
  props: {
    trigger: {
      type: "slot",
      displayName: "Trigger",
      defaultValue: [{ type: "text", value: "Cart (0)" }],
    },
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
    isOpen: {
      type: "boolean",
      displayName: "Open",
      description:
        "Controls whether the popover is open. Bind to a Plasmic state variable for two-way control; leave unbound to let the trigger manage it.",
    },
    onOpenChange: {
      type: "eventHandler" as const,
      argTypes: [{ name: "isOpen", type: "boolean" }],
    },
    placement: {
      type: "choice",
      options: ["bottom-end", "bottom-start", "top-end", "top-start"],
      defaultValue: "bottom-end",
      displayName: "Placement",
      description: "Where the panel anchors relative to the trigger",
    },
    offset: {
      type: "number",
      defaultValue: 8,
      displayName: "Offset",
      description: "Gap (px) between the trigger and the panel",
      advanced: true,
    },
    closeOnOutsideClick: {
      type: "boolean",
      defaultValue: true,
      displayName: "Close on Outside Click",
      advanced: true,
    },
    closeOnEscape: {
      type: "boolean",
      defaultValue: true,
      displayName: "Close on Escape",
      advanced: true,
    },
    previewState: {
      type: "choice",
      options: ["auto", "withItems", "empty", "loading", "error"],
      defaultValue: "auto",
      displayName: "Preview State",
      description:
        "Force the panel open with sample data for design-time editing",
      advanced: true,
    },
  },
  importPath: "@elasticpath/plasmic-ep-commerce-elastic-path",
  importName: "EPCartPopover",
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

// Structural styles for the wrapper — only positioning, so the panel can be
// absolutely anchored to the trigger. Visual styles for the panel come from
// Plasmic's className via defaultStyles so the designer can override them.
const WRAPPER_STYLES: React.CSSProperties = {
  position: "relative",
  display: "inline-block",
};

export function EPCartPopover(props: EPCartPopoverProps) {
  const {
    trigger,
    children,
    emptyContent,
    loadingContent,
    errorContent,
    className,
    isOpen: isOpenProp,
    onOpenChange,
    placement = "bottom-end",
    offset = 8,
    closeOnOutsideClick = true,
    closeOnEscape = true,
    previewState = "auto",
  } = props;

  const { cart, error: cartError } = useEpCart();
  const commerce = useEpCommerce();
  const currencyDisplay = commerce?.currencyDisplay ?? "symbol";
  const inEditor = !!usePlasmicCanvasContext();
  // Open the panel in the Studio canvas when this component (or a descendant)
  // is selected in the outline — unless the trigger slot itself is selected.
  const autoOpenForEditing = useOverlayEditorOpen(props, {
    triggerSlotName: "trigger",
  });
  const wrapperRef = useRef<HTMLDivElement>(null);

  // Open state: controlled when `isOpen` is bound, otherwise component-local.
  const isControlled = isOpenProp !== undefined;
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  const isOpen = isControlled ? !!isOpenProp : uncontrolledOpen;

  const setOpen = useCallback(
    (next: boolean) => {
      if (!isControlled) setUncontrolledOpen(next);
      onOpenChange?.(next);
    },
    [isControlled, onOpenChange]
  );

  const toggle = useCallback(() => setOpen(!isOpen), [setOpen, isOpen]);
  const close = useCallback(() => setOpen(false), [setOpen]);

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

  // Outside-click handler — close when a click lands outside the wrapper.
  useEffect(() => {
    if (!isOpen || !closeOnOutsideClick || inEditor) return;
    const handlePointerDown = (e: MouseEvent) => {
      if (
        wrapperRef.current &&
        !wrapperRef.current.contains(e.target as Node)
      ) {
        close();
      }
    };
    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, [isOpen, closeOnOutsideClick, close, inEditor]);

  // Build enriched cart data for DataProvider — formatted money honours the
  // provider's currencyDisplay preference (symbol vs. ISO code prefix).

  // --- Preview state handling ---

  const useMock =
    previewState === "withItems" ||
    (previewState === "auto" && !cart && inEditor);

  const effectiveCartData = useMock ? MOCK_CART_DATA : cart;

  // In the editor the panel opens when this node is selected in the outline
  // (autoOpenForEditing) or when a previewState is explicitly chosen, so the
  // designer can see, select, and style it. previewState then selects which
  // content branch to render.
  const panelOpen = inEditor
    ? previewState !== "auto" || autoOpenForEditing || isOpen
    : isOpen;

  const positionStyles = getPopoverPositionStyles(placement, offset);

  // Resolve which content to show inside the panel.
  let panelContent: React.ReactNode = null;
  if (panelOpen) {
    if (inEditor && previewState === "loading") {
      panelContent = loadingContent;
    } else if (inEditor && previewState === "error") {
      panelContent = errorContent;
    } else if (inEditor && previewState === "empty") {
      panelContent = emptyContent;
    } else if (!cart && !cartError && !useMock) {
      panelContent = loadingContent;
    } else if (cartError) {
      panelContent = errorContent;
    } else {
      panelContent = (effectiveCartData?.itemCount ?? 0) === 0 ? emptyContent : children;
    }
  }

  // DataProvider for the empty editor branch needs an emptied mock so child
  // components render against a zero-item cart.
  const providedData =
    inEditor && previewState === "empty"
      ? MOCK_EMPTY_CART_DATA
      : effectiveCartData;

  return (
    <div ref={wrapperRef} style={WRAPPER_STYLES} data-ep-cart-popover-wrapper="">
      <div
        onClick={toggle}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            toggle();
          }
        }}
        role="button"
        tabIndex={0}
        data-ep-cart-popover-trigger=""
        aria-haspopup="dialog"
        aria-expanded={isOpen}
      >
        {trigger}
      </div>

      {panelOpen && (
        <DataProvider name="cart" data={providedData}>
          <div
            className={className}
            role="dialog"
            aria-label="Shopping cart"
            data-ep-cart-popover=""
            data-placement={placement}
            data-open={isOpen || undefined}
            style={positionStyles}
          >
            {panelContent}
          </div>
        </DataProvider>
      )}
    </div>
  );
}

export function registerEPCartPopover(
  loader?: Registerable,
  customMeta?: CodeComponentMeta<EPCartPopoverProps>
) {
  const doRegisterComponent: typeof registerComponent = (...args) =>
    loader ? loader.registerComponent(...args) : registerComponent(...args);
  doRegisterComponent(EPCartPopover, customMeta ?? epCartPopoverMeta);
}
