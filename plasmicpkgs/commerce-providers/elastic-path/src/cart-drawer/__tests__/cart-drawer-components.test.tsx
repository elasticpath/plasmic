/**
 * @jest-environment jsdom
 *
 * Tests for cart drawer components: CartDrawerContext, EPCartDrawer,
 * EPCartDrawerTrigger, EPCartField, EPCartItemField, EPCartItemImage,
 * EPCartItemList, EPCartItemQuantityControl, EPCartItemQuantityButton,
 * and EPCartItemRemoveButton.
 *
 * Components that consume hooks are loaded via `require()` after
 * `jest.mock()` calls so esbuild-hoisted imports see mocked modules.
 *
 * Why these tests matter: The cart drawer is the primary purchase UI —
 * users interact with it on every transaction. Untested components risk
 * silent regressions in quantity updates, item removal, price display,
 * and accessibility (ARIA roles, keyboard navigation, focus trap).
 */

// --- Mocks (hoisted by Jest before any other code) ---

const mockUseCart = jest.fn();
jest.mock("../../cart/use-cart", () => ({
  __esModule: true,
  default: mockUseCart,
}));

const mockUseUpdateItem = jest.fn();
jest.mock("../../cart/use-update-item", () => ({
  __esModule: true,
  default: mockUseUpdateItem,
}));

const mockUseRemoveItem = jest.fn();
jest.mock("../../cart/use-remove-item", () => ({
  __esModule: true,
  default: mockUseRemoveItem,
}));

const mockUseLocations = jest.fn();
jest.mock("../../inventory/use-locations", () => ({
  useLocations: mockUseLocations,
}));

const mockUseStock = jest.fn();
jest.mock("../../inventory/use-stock", () => ({
  useStock: mockUseStock,
}));

jest.mock("../../utils/getLocationSlug", () => ({
  getLocationSlug: jest.fn(
    (loc: any) => loc?.attributes?.slug || loc?.id || ""
  ),
}));

// Mock @plasmicapp/host — DataProvider passes through, useSelector/repeatedElement
// are controllable per-test via mockUseSelector and mockRepeatedElement.
const mockUseSelector = jest.fn();
const mockUsePlasmicCanvasContext = jest.fn();
const mockUsePlasmicCanvasComponentInfo = jest.fn();
const mockRepeatedElement = jest.fn(
  (_idx: number, children: React.ReactNode) => children
);

jest.mock("@plasmicapp/host", () => ({
  DataProvider: ({
    children,
  }: {
    children: React.ReactNode;
    name: string;
    data: any;
  }) => children,
  useSelector: (...args: any[]) => mockUseSelector(...args),
  usePlasmicCanvasContext: () => mockUsePlasmicCanvasContext(),
  usePlasmicCanvasComponentInfo: (...args: any[]) =>
    mockUsePlasmicCanvasComponentInfo(...args),
  repeatedElement: (...args: any[]) => mockRepeatedElement(...args),
}));

jest.mock("../../utils/logger", () => ({
  createLogger: () => ({
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  }),
}));

// Mock ReactDOM.createPortal to render inline in tests
jest.mock("react-dom", () => ({
  ...jest.requireActual("react-dom"),
  createPortal: (node: React.ReactNode) => node,
}));

// --- Imports (safe — not mocked modules) ---
import React from "react";
import { render, screen, fireEvent, act } from "@testing-library/react";

// --- Load hooked components via require (after jest.mock takes effect) ---
const {
  setDrawerOpen,
  getDrawerOpen,
  toggleDrawer,
  subscribeDrawerState,
  useDrawerOpen,
  CartItemQuantityContext,
  useCartItemQuantity,
} = require("../CartDrawerContext");

const { EPCartDrawer } = require("../EPCartDrawer");
const { EPCartDrawerTrigger } = require("../EPCartDrawerTrigger");
const { EPCartField } = require("../EPCartField");
const { EPCartItemField } = require("../EPCartItemField");
const { EPCartItemImage } = require("../EPCartItemImage");
const { EPCartItemList } = require("../EPCartItemList");
const { EPCartItemQuantityControl } = require("../EPCartItemQuantityControl");
const { EPCartItemQuantityButton } = require("../EPCartItemQuantityButton");
const { EPCartItemRemoveButton } = require("../EPCartItemRemoveButton");

const {
  MOCK_CART_DATA,
  MOCK_CART_LINE_ITEMS,
} = require("../../utils/design-time-data");

// --- Test helpers ---

function resetDrawerState() {
  // Reset the module-level singleton between tests
  setDrawerOpen(false);
}

// Helper to render a hook in isolation
function HookReader({ hook, onResult }: { hook: () => any; onResult: (v: any) => void }) {
  const result = hook();
  onResult(result);
  return null;
}

// --- Shared setup ---

beforeEach(() => {
  jest.clearAllMocks();
  resetDrawerState();

  // Defaults: runtime mode (not editor), no cart data
  mockUsePlasmicCanvasContext.mockReturnValue(null);
  mockUseCart.mockReturnValue({ data: null, error: null });
  mockUseUpdateItem.mockReturnValue(jest.fn());
  mockUseRemoveItem.mockReturnValue(jest.fn());
  mockUseLocations.mockReturnValue({ locations: [], loading: false });
  mockUseStock.mockReturnValue({ productStock: {}, loading: false });
  mockUseSelector.mockReturnValue(undefined);
  mockRepeatedElement.mockImplementation(
    (_idx: number, children: React.ReactNode) => children
  );
});

afterEach(() => {
  // Restore body overflow in case a test locked it
  document.body.style.overflow = "";
});

// ---------------------------------------------------------------------------
// CartDrawerContext — module-level singleton tests
// ---------------------------------------------------------------------------

describe("CartDrawerContext", () => {
  describe("singleton state", () => {
    it("starts closed", () => {
      expect(getDrawerOpen()).toBe(false);
    });

    it("setDrawerOpen(true) opens, setDrawerOpen(false) closes", () => {
      setDrawerOpen(true);
      expect(getDrawerOpen()).toBe(true);
      setDrawerOpen(false);
      expect(getDrawerOpen()).toBe(false);
    });

    it("setDrawerOpen with same value is a no-op (no listener calls)", () => {
      const listener = jest.fn();
      subscribeDrawerState(listener);
      setDrawerOpen(false); // already false
      expect(listener).not.toHaveBeenCalled();
      subscribeDrawerState(listener)(); // unsubscribe
    });

    it("toggleDrawer flips the state", () => {
      expect(getDrawerOpen()).toBe(false);
      toggleDrawer();
      expect(getDrawerOpen()).toBe(true);
      toggleDrawer();
      expect(getDrawerOpen()).toBe(false);
    });
  });

  describe("subscribeDrawerState", () => {
    it("calls listener on state change", () => {
      const listener = jest.fn();
      const unsub = subscribeDrawerState(listener);
      setDrawerOpen(true);
      expect(listener).toHaveBeenCalledWith(true);
      unsub();
    });

    it("unsubscribe stops further notifications", () => {
      const listener = jest.fn();
      const unsub = subscribeDrawerState(listener);
      unsub();
      setDrawerOpen(true);
      expect(listener).not.toHaveBeenCalled();
    });

    it("multiple listeners all receive updates", () => {
      const l1 = jest.fn();
      const l2 = jest.fn();
      const u1 = subscribeDrawerState(l1);
      const u2 = subscribeDrawerState(l2);
      setDrawerOpen(true);
      expect(l1).toHaveBeenCalledWith(true);
      expect(l2).toHaveBeenCalledWith(true);
      u1();
      u2();
    });
  });

  describe("useDrawerOpen hook", () => {
    it("returns current state and setter", () => {
      let hookResult: any;
      render(
        <HookReader
          hook={useDrawerOpen}
          onResult={(v: any) => { hookResult = v; }}
        />
      );
      expect(hookResult[0]).toBe(false);
      expect(typeof hookResult[1]).toBe("function");
    });

    it("re-renders when drawer state changes", () => {
      const states: boolean[] = [];
      function Tracker() {
        const [isOpen] = useDrawerOpen();
        states.push(isOpen);
        return <div>{String(isOpen)}</div>;
      }
      render(<Tracker />);
      expect(states).toEqual([false]);
      act(() => { setDrawerOpen(true); });
      expect(states).toEqual([false, true]);
    });
  });

  describe("useCartItemQuantity", () => {
    it("returns null outside of provider", () => {
      let result: any;
      render(
        <HookReader
          hook={useCartItemQuantity}
          onResult={(v: any) => { result = v; }}
        />
      );
      expect(result).toBeNull();
    });

    it("returns context value inside provider", () => {
      let result: any;
      const ctxValue = {
        quantity: 3,
        isLoading: false,
        canDecrement: true,
        canIncrement: true,
        increment: jest.fn(),
        decrement: jest.fn(),
      };
      render(
        <CartItemQuantityContext.Provider value={ctxValue}>
          <HookReader
            hook={useCartItemQuantity}
            onResult={(v: any) => { result = v; }}
          />
        </CartItemQuantityContext.Provider>
      );
      expect(result).toBe(ctxValue);
    });
  });
});

// ---------------------------------------------------------------------------
// EPCartDrawer tests
// ---------------------------------------------------------------------------

describe("EPCartDrawer", () => {
  const mockCart = {
    id: "cart-1",
    lineItems: [
      { id: "item-1", name: "Product A", quantity: 2, price: 25 },
    ],
    subtotalPrice: 50,
    totalPrice: 50,
    currency: { code: "USD" },
  };

  it("renders nothing when closed at runtime", () => {
    const { container } = render(<EPCartDrawer />);
    expect(container.innerHTML).toBe("");
  });

  it("renders drawer content when open via prop", () => {
    mockUseCart.mockReturnValue({ data: mockCart, error: null });
    render(
      <EPCartDrawer isOpen={true}>
        <div>Cart content</div>
      </EPCartDrawer>
    );
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(screen.getByText("Cart content")).toBeTruthy();
  });

  it("renders drawer when opened via singleton state", () => {
    mockUseCart.mockReturnValue({ data: mockCart, error: null });
    act(() => { setDrawerOpen(true); });
    render(
      <EPCartDrawer>
        <div>Singleton content</div>
      </EPCartDrawer>
    );
    expect(screen.getByText("Singleton content")).toBeTruthy();
  });

  it("renders loading content when cart is loading", () => {
    mockUseCart.mockReturnValue({ data: null, error: null });
    render(
      <EPCartDrawer isOpen={true} loadingContent={<div>Loading...</div>}>
        <div>Items</div>
      </EPCartDrawer>
    );
    expect(screen.getByText("Loading...")).toBeTruthy();
  });

  it("renders error content when cart has error", () => {
    mockUseCart.mockReturnValue({
      data: null,
      error: new Error("Cart failed"),
    });
    render(
      <EPCartDrawer isOpen={true} errorContent={<div>Error!</div>}>
        <div>Items</div>
      </EPCartDrawer>
    );
    expect(screen.getByText("Error!")).toBeTruthy();
  });

  it("renders empty content when cart has no items", () => {
    const emptyCart = { ...mockCart, lineItems: [] };
    mockUseCart.mockReturnValue({ data: emptyCart, error: null });
    render(
      <EPCartDrawer isOpen={true} emptyContent={<div>Empty cart</div>}>
        <div>Items</div>
      </EPCartDrawer>
    );
    expect(screen.getByText("Empty cart")).toBeTruthy();
  });

  it("has correct ARIA attributes when open", () => {
    mockUseCart.mockReturnValue({ data: mockCart, error: null });
    render(<EPCartDrawer isOpen={true}><div>Content</div></EPCartDrawer>);
    const dialog = screen.getByRole("dialog");
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(dialog.getAttribute("aria-label")).toBe("Shopping cart");
  });

  it("closes on Escape key", () => {
    const onOpenChange = jest.fn();
    mockUseCart.mockReturnValue({ data: mockCart, error: null });
    render(
      <EPCartDrawer isOpen={true} onOpenChange={onOpenChange}>
        <div>Content</div>
      </EPCartDrawer>
    );
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("does not close on Escape when closeOnEscape=false", () => {
    const onOpenChange = jest.fn();
    mockUseCart.mockReturnValue({ data: mockCart, error: null });
    render(
      <EPCartDrawer
        isOpen={true}
        closeOnEscape={false}
        onOpenChange={onOpenChange}
      >
        <div>Content</div>
      </EPCartDrawer>
    );
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it("locks body scroll when open", () => {
    mockUseCart.mockReturnValue({ data: mockCart, error: null });
    const { unmount } = render(
      <EPCartDrawer isOpen={true}><div>Content</div></EPCartDrawer>
    );
    expect(document.body.style.overflow).toBe("hidden");
    unmount();
    expect(document.body.style.overflow).toBe("");
  });

  it("renders backdrop with click handler", () => {
    const onOpenChange = jest.fn();
    mockUseCart.mockReturnValue({ data: mockCart, error: null });
    render(
      <EPCartDrawer isOpen={true} onOpenChange={onOpenChange}>
        <div>Content</div>
      </EPCartDrawer>
    );
    const backdrop = document.querySelector("[data-ep-cart-backdrop]");
    expect(backdrop).toBeTruthy();
    fireEvent.click(backdrop!);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("does not close on backdrop click when closeOnBackdropClick=false", () => {
    const onOpenChange = jest.fn();
    mockUseCart.mockReturnValue({ data: mockCart, error: null });
    render(
      <EPCartDrawer
        isOpen={true}
        closeOnBackdropClick={false}
        onOpenChange={onOpenChange}
      >
        <div>Content</div>
      </EPCartDrawer>
    );
    const backdrop = document.querySelector("[data-ep-cart-backdrop]");
    fireEvent.click(backdrop!);
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it("applies side prop to data-side attribute", () => {
    mockUseCart.mockReturnValue({ data: mockCart, error: null });
    render(
      <EPCartDrawer isOpen={true} side="left"><div>Content</div></EPCartDrawer>
    );
    const drawer = screen.getByRole("dialog");
    expect(drawer.getAttribute("data-side")).toBe("left");
  });

  describe("editor mode", () => {
    beforeEach(() => {
      mockUsePlasmicCanvasContext.mockReturnValue({});
      // Drawer mode renders in the canvas only when selected in the outline;
      // default editor-mode tests to "selected" so they exercise the open panel.
      mockUsePlasmicCanvasComponentInfo.mockReturnValue({ isSelected: true });
    });

    it("renders inline (no portal) in editor", () => {
      mockUseCart.mockReturnValue({ data: mockCart, error: null });
      render(
        <EPCartDrawer><div>Editor content</div></EPCartDrawer>
      );
      expect(screen.getByText("Editor content")).toBeTruthy();
    });

    it("uses mock data when no cart in editor", () => {
      render(<EPCartDrawer><div>Mock content</div></EPCartDrawer>);
      // Should render children (mock cart is non-empty)
      expect(screen.getByText("Mock content")).toBeTruthy();
    });

    it("stays closed in the canvas until selected in the outline", () => {
      mockUsePlasmicCanvasComponentInfo.mockReturnValue({ isSelected: false });
      mockUseCart.mockReturnValue({ data: mockCart, error: null });
      render(<EPCartDrawer><div>Hidden content</div></EPCartDrawer>);
      // Not selected, no previewState, no isOpen → drawer renders nothing.
      expect(screen.queryByText("Hidden content")).toBeNull();
    });

    it("shows loading preview state", () => {
      render(
        <EPCartDrawer
          previewState="loading"
          loadingContent={<div>Preview loading</div>}
        />
      );
      expect(screen.getByText("Preview loading")).toBeTruthy();
    });

    it("shows error preview state", () => {
      render(
        <EPCartDrawer
          previewState="error"
          errorContent={<div>Preview error</div>}
        />
      );
      expect(screen.getByText("Preview error")).toBeTruthy();
    });

    it("shows empty preview state", () => {
      render(
        <EPCartDrawer
          previewState="empty"
          emptyContent={<div>Preview empty</div>}
        />
      );
      expect(screen.getByText("Preview empty")).toBeTruthy();
    });

    it("does not lock body scroll in editor", () => {
      render(<EPCartDrawer isOpen={true}><div>Content</div></EPCartDrawer>);
      expect(document.body.style.overflow).not.toBe("hidden");
    });
  });
});

// ---------------------------------------------------------------------------
// EPCartDrawerTrigger tests
// ---------------------------------------------------------------------------

describe("EPCartDrawerTrigger", () => {
  it("renders children with button role", () => {
    render(
      <EPCartDrawerTrigger>
        <span>Cart</span>
      </EPCartDrawerTrigger>
    );
    const btn = screen.getByRole("button");
    expect(btn).toBeTruthy();
    expect(screen.getByText("Cart")).toBeTruthy();
  });

  it("toggle action flips drawer state", () => {
    render(
      <EPCartDrawerTrigger action="toggle">
        <span>Toggle</span>
      </EPCartDrawerTrigger>
    );
    fireEvent.click(screen.getByRole("button"));
    expect(getDrawerOpen()).toBe(true);
    fireEvent.click(screen.getByRole("button"));
    expect(getDrawerOpen()).toBe(false);
  });

  it("open action always opens", () => {
    render(
      <EPCartDrawerTrigger action="open">
        <span>Open</span>
      </EPCartDrawerTrigger>
    );
    fireEvent.click(screen.getByRole("button"));
    expect(getDrawerOpen()).toBe(true);
    // Click again — still open
    fireEvent.click(screen.getByRole("button"));
    expect(getDrawerOpen()).toBe(true);
  });

  it("close action always closes", () => {
    act(() => { setDrawerOpen(true); });
    render(
      <EPCartDrawerTrigger action="close">
        <span>Close</span>
      </EPCartDrawerTrigger>
    );
    fireEvent.click(screen.getByRole("button"));
    expect(getDrawerOpen()).toBe(false);
  });

  it("aria-label includes item count (singular)", () => {
    mockUseCart.mockReturnValue({
      data: { lineItems: [{ quantity: 1 }] },
      error: null,
    });
    render(<EPCartDrawerTrigger><span>Cart</span></EPCartDrawerTrigger>);
    const btn = screen.getByRole("button");
    expect(btn.getAttribute("aria-label")).toBe("Shopping cart, 1 item");
  });

  it("aria-label includes item count (plural)", () => {
    mockUseCart.mockReturnValue({
      data: { lineItems: [{ quantity: 2 }, { quantity: 1 }] },
      error: null,
    });
    render(<EPCartDrawerTrigger><span>Cart</span></EPCartDrawerTrigger>);
    const btn = screen.getByRole("button");
    expect(btn.getAttribute("aria-label")).toBe("Shopping cart, 3 items");
  });

  it("aria-expanded reflects drawer state", () => {
    render(<EPCartDrawerTrigger><span>Cart</span></EPCartDrawerTrigger>);
    const btn = screen.getByRole("button");
    expect(btn.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(btn);
    expect(btn.getAttribute("aria-expanded")).toBe("true");
  });

  it("keyboard Enter triggers click", () => {
    render(<EPCartDrawerTrigger><span>Cart</span></EPCartDrawerTrigger>);
    fireEvent.keyDown(screen.getByRole("button"), { key: "Enter" });
    expect(getDrawerOpen()).toBe(true);
  });

  it("keyboard Space triggers click", () => {
    render(<EPCartDrawerTrigger><span>Cart</span></EPCartDrawerTrigger>);
    fireEvent.keyDown(screen.getByRole("button"), { key: " " });
    expect(getDrawerOpen()).toBe(true);
  });

  it("click is no-op in editor with mock data", () => {
    mockUsePlasmicCanvasContext.mockReturnValue({});
    render(<EPCartDrawerTrigger><span>Cart</span></EPCartDrawerTrigger>);
    fireEvent.click(screen.getByRole("button"));
    expect(getDrawerOpen()).toBe(false);
  });

  it("uses mock item count for empty preview state", () => {
    mockUsePlasmicCanvasContext.mockReturnValue({});
    render(
      <EPCartDrawerTrigger previewState="empty">
        <span>Cart</span>
      </EPCartDrawerTrigger>
    );
    const btn = screen.getByRole("button");
    expect(btn.getAttribute("aria-label")).toBe("Shopping cart, 0 items");
  });
});

// ---------------------------------------------------------------------------
// EPCartField tests
// ---------------------------------------------------------------------------

describe("EPCartField", () => {
  it("renders formattedTotal from cartData", () => {
    mockUseSelector.mockReturnValue(MOCK_CART_DATA);
    render(<EPCartField field="formattedTotal" />);
    expect(screen.getByText("$159.96")).toBeTruthy();
  });

  it("renders itemCount from cartData", () => {
    mockUseSelector.mockReturnValue(MOCK_CART_DATA);
    render(<EPCartField field="itemCount" />);
    expect(screen.getByText("4")).toBeTruthy();
  });

  it("renders formattedSubtotal from cartData", () => {
    mockUseSelector.mockReturnValue(MOCK_CART_DATA);
    render(<EPCartField field="formattedSubtotal" />);
    expect(screen.getByText("$159.96")).toBeTruthy();
  });

  it("renders currencyCode from cartData", () => {
    mockUseSelector.mockReturnValue(MOCK_CART_DATA);
    render(<EPCartField field="currencyCode" />);
    expect(screen.getByText("USD")).toBeTruthy();
  });

  it("renders isEmpty as string boolean", () => {
    mockUseSelector.mockReturnValue(MOCK_CART_DATA);
    render(<EPCartField field="isEmpty" />);
    expect(screen.getByText("false")).toBeTruthy();
  });

  it("returns null when no cartData at runtime", () => {
    mockUseSelector.mockReturnValue(undefined);
    const { container } = render(<EPCartField field="formattedTotal" />);
    expect(container.innerHTML).toBe("");
  });

  it("uses mock data in editor when no cartData", () => {
    mockUsePlasmicCanvasContext.mockReturnValue({});
    mockUseSelector.mockReturnValue(undefined);
    render(<EPCartField field="formattedTotal" />);
    expect(screen.getByText("$159.96")).toBeTruthy();
  });

  it("uses mock data when previewState=withData", () => {
    mockUseSelector.mockReturnValue(undefined);
    render(<EPCartField field="itemCount" previewState="withData" />);
    expect(screen.getByText("4")).toBeTruthy();
  });

  it("renders in a span element", () => {
    mockUseSelector.mockReturnValue(MOCK_CART_DATA);
    render(<EPCartField field="formattedTotal" />);
    const el = screen.getByText("$159.96");
    expect(el.tagName).toBe("SPAN");
  });
});

// ---------------------------------------------------------------------------
// EPCartItemField tests
// ---------------------------------------------------------------------------

describe("EPCartItemField", () => {
  const mockItem = MOCK_CART_LINE_ITEMS[0];

  beforeEach(() => {
    mockUseSelector.mockReturnValue(mockItem);
  });

  it("renders name field", () => {
    render(<EPCartItemField field="name" />);
    expect(screen.getByText("Sample Lightweight Jacket")).toBeTruthy();
  });

  it("renders quantity field", () => {
    render(<EPCartItemField field="quantity" />);
    expect(screen.getByText("2")).toBeTruthy();
  });

  it("renders sku field", () => {
    render(<EPCartItemField field="sku" />);
    expect(screen.getByText("SLJ-BLU-M")).toBeTruthy();
  });

  it("renders formattedPrice field", () => {
    render(<EPCartItemField field="formattedPrice" />);
    expect(screen.getByText("$49.99")).toBeTruthy();
  });

  it("renders formattedListPrice field", () => {
    render(<EPCartItemField field="formattedListPrice" />);
    expect(screen.getByText("$59.99")).toBeTruthy();
  });

  it("renders formattedLineTotal field", () => {
    render(<EPCartItemField field="formattedLineTotal" />);
    expect(screen.getByText("$99.98")).toBeTruthy();
  });

  it("renders options as comma-separated name:value pairs", () => {
    render(<EPCartItemField field="options" />);
    expect(
      screen.getByText("Color: Midnight Blue, Size: Medium")
    ).toBeTruthy();
  });

  it("renders empty string for undefined options", () => {
    mockUseSelector.mockReturnValue({ ...mockItem, options: undefined });
    render(<EPCartItemField field="options" />);
    const span = document.querySelector("span");
    expect(span?.textContent).toBe("");
  });

  it("renders productId field", () => {
    render(<EPCartItemField field="productId" />);
    expect(screen.getByText("sample-product-001")).toBeTruthy();
  });

  it("renders locationName field", () => {
    render(<EPCartItemField field="locationName" />);
    expect(screen.getByText("Sample Downtown Store")).toBeTruthy();
  });

  it("renders stockStatus field", () => {
    render(<EPCartItemField field="stockStatus" />);
    expect(screen.getByText("in-stock")).toBeTruthy();
  });

  it("returns null when no item at runtime", () => {
    mockUseSelector.mockReturnValue(undefined);
    const { container } = render(<EPCartItemField field="name" />);
    expect(container.innerHTML).toBe("");
  });

  it("uses mock data in editor when no item", () => {
    mockUsePlasmicCanvasContext.mockReturnValue({});
    mockUseSelector.mockReturnValue(undefined);
    render(<EPCartItemField field="name" />);
    expect(screen.getByText("Sample Lightweight Jacket")).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// EPCartItemImage tests
// ---------------------------------------------------------------------------

describe("EPCartItemImage", () => {
  it("renders img when imageUrl is present", () => {
    mockUseSelector.mockReturnValue({
      imageUrl: "https://example.com/img.png",
      imageAlt: "Product photo",
    });
    render(<EPCartItemImage />);
    const img = document.querySelector("img");
    expect(img).toBeTruthy();
    expect(img?.getAttribute("src")).toBe("https://example.com/img.png");
    expect(img?.getAttribute("alt")).toBe("Product photo");
    expect(img?.getAttribute("width")).toBe("64");
    expect(img?.getAttribute("height")).toBe("64");
    expect(img?.getAttribute("loading")).toBe("lazy");
  });

  it("renders placeholder when no imageUrl", () => {
    mockUseSelector.mockReturnValue({ imageUrl: undefined, imageAlt: "" });
    render(<EPCartItemImage />);
    const placeholder = document.querySelector('[role="img"]');
    expect(placeholder).toBeTruthy();
    expect(placeholder?.getAttribute("aria-label")).toBe("No product image");
  });

  it("uses imageAlt for placeholder aria-label when provided", () => {
    mockUseSelector.mockReturnValue({
      imageUrl: undefined,
      imageAlt: "Missing jacket",
    });
    render(<EPCartItemImage />);
    const placeholder = document.querySelector('[role="img"]');
    expect(placeholder?.getAttribute("aria-label")).toBe("Missing jacket");
  });

  it("respects custom width and height", () => {
    mockUseSelector.mockReturnValue({
      imageUrl: "https://example.com/img.png",
      imageAlt: "Product",
    });
    render(<EPCartItemImage width={100} height={80} />);
    const img = document.querySelector("img");
    expect(img?.getAttribute("width")).toBe("100");
    expect(img?.getAttribute("height")).toBe("80");
  });

  it("placeholder SVG is 40% of dimensions", () => {
    mockUseSelector.mockReturnValue({ imageUrl: undefined });
    render(<EPCartItemImage width={100} height={100} />);
    const svg = document.querySelector("svg");
    expect(svg?.getAttribute("width")).toBe("40");
    expect(svg?.getAttribute("height")).toBe("40");
  });

  it("respects loading prop", () => {
    mockUseSelector.mockReturnValue({
      imageUrl: "https://example.com/img.png",
      imageAlt: "Product",
    });
    render(<EPCartItemImage loading="eager" />);
    const img = document.querySelector("img");
    expect(img?.getAttribute("loading")).toBe("eager");
  });

  it("uses mock data in editor when no item", () => {
    mockUsePlasmicCanvasContext.mockReturnValue({});
    mockUseSelector.mockReturnValue(undefined);
    render(<EPCartItemImage />);
    const img = document.querySelector("img");
    // Mock item has an imageUrl
    expect(img).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// EPCartItemList tests
// ---------------------------------------------------------------------------

describe("EPCartItemList", () => {
  const mockCartData = {
    lineItems: [
      {
        id: "item-1",
        name: "Product A",
        quantity: 2,
        price: 25,
        productId: "prod-1",
        options: [],
      },
      {
        id: "item-2",
        name: "Product B",
        quantity: 1,
        price: 30,
        productId: "prod-2",
        options: [],
      },
    ],
    currencyCode: "USD",
  };

  it("returns null when no items", () => {
    mockUseSelector.mockReturnValue({ lineItems: [], currencyCode: "USD" });
    const { container } = render(
      <EPCartItemList><div>Item</div></EPCartItemList>
    );
    expect(container.innerHTML).toBe("");
  });

  it("renders list with role=list and aria-label", () => {
    mockUseSelector.mockReturnValue(mockCartData);
    render(<EPCartItemList><div>Item</div></EPCartItemList>);
    const list = screen.getByRole("list");
    expect(list.getAttribute("aria-label")).toBe("Cart items");
  });

  it("renders one listitem per cart item", () => {
    mockUseSelector.mockReturnValue(mockCartData);
    render(<EPCartItemList><div>Item</div></EPCartItemList>);
    const items = screen.getAllByRole("listitem");
    expect(items.length).toBe(2);
  });

  it("calls repeatedElement for each item", () => {
    mockUseSelector.mockReturnValue(mockCartData);
    render(<EPCartItemList><div>Item</div></EPCartItemList>);
    expect(mockRepeatedElement).toHaveBeenCalledTimes(2);
    expect(mockRepeatedElement.mock.calls[0][0]).toBe(0);
    expect(mockRepeatedElement.mock.calls[1][0]).toBe(1);
  });

  it("respects maxItems prop", () => {
    mockUseSelector.mockReturnValue(mockCartData);
    render(<EPCartItemList maxItems={1}><div>Item</div></EPCartItemList>);
    const items = screen.getAllByRole("listitem");
    expect(items.length).toBe(1);
  });

  it("does not fetch locations/stock for items without locationSlug", () => {
    mockUseSelector.mockReturnValue(mockCartData);
    render(<EPCartItemList><div>Item</div></EPCartItemList>);
    expect(mockUseLocations).toHaveBeenCalledWith({ enabled: false });
    expect(mockUseStock).toHaveBeenCalledWith(
      expect.objectContaining({ enabled: false })
    );
  });

  it("fetches locations/stock for items with locationSlug", () => {
    const dataWithLocations = {
      ...mockCartData,
      lineItems: [
        { ...mockCartData.lineItems[0], locationSlug: "store-a" },
      ],
    };
    mockUseSelector.mockReturnValue(dataWithLocations);
    render(<EPCartItemList><div>Item</div></EPCartItemList>);
    expect(mockUseLocations).toHaveBeenCalledWith({ enabled: true });
    expect(mockUseStock).toHaveBeenCalledWith(
      expect.objectContaining({
        productIds: ["prod-1"],
        locationIds: ["store-a"],
        enabled: true,
      })
    );
  });

  it("uses mock data in editor when no cart items", () => {
    mockUsePlasmicCanvasContext.mockReturnValue({});
    mockUseSelector.mockReturnValue(undefined);
    render(<EPCartItemList><div>Item</div></EPCartItemList>);
    const items = screen.getAllByRole("listitem");
    expect(items.length).toBe(MOCK_CART_LINE_ITEMS.length);
  });

  it("uses mock data when previewState=withItems", () => {
    mockUseSelector.mockReturnValue(undefined);
    render(
      <EPCartItemList previewState="withItems">
        <div>Item</div>
      </EPCartItemList>
    );
    const items = screen.getAllByRole("listitem");
    expect(items.length).toBe(MOCK_CART_LINE_ITEMS.length);
  });
});

// ---------------------------------------------------------------------------
// EPCartItemQuantityControl tests
// ---------------------------------------------------------------------------

describe("EPCartItemQuantityControl", () => {
  it("provides quantity context to children", () => {
    mockUseSelector.mockReturnValue({ id: "item-1", quantity: 3 });
    let ctxValue: any;
    render(
      <EPCartItemQuantityControl>
        <HookReader
          hook={useCartItemQuantity}
          onResult={(v: any) => { ctxValue = v; }}
        />
      </EPCartItemQuantityControl>
    );
    expect(ctxValue.quantity).toBe(3);
    expect(ctxValue.canDecrement).toBe(true);
    expect(ctxValue.canIncrement).toBe(true);
    expect(ctxValue.isLoading).toBe(false);
  });

  it("canDecrement is false when at minQuantity", () => {
    mockUseSelector.mockReturnValue({ id: "item-1", quantity: 1 });
    let ctxValue: any;
    render(
      <EPCartItemQuantityControl minQuantity={1}>
        <HookReader
          hook={useCartItemQuantity}
          onResult={(v: any) => { ctxValue = v; }}
        />
      </EPCartItemQuantityControl>
    );
    expect(ctxValue.canDecrement).toBe(false);
  });

  it("canIncrement is false when at maxQuantity", () => {
    mockUseSelector.mockReturnValue({ id: "item-1", quantity: 99 });
    let ctxValue: any;
    render(
      <EPCartItemQuantityControl maxQuantity={99}>
        <HookReader
          hook={useCartItemQuantity}
          onResult={(v: any) => { ctxValue = v; }}
        />
      </EPCartItemQuantityControl>
    );
    expect(ctxValue.canIncrement).toBe(false);
  });

  it("increment calls updateItem with new quantity", async () => {
    const mockUpdate = jest.fn().mockResolvedValue(undefined);
    mockUseUpdateItem.mockReturnValue(mockUpdate);
    mockUseSelector.mockReturnValue({ id: "item-1", quantity: 2 });

    let ctxValue: any;
    render(
      <EPCartItemQuantityControl>
        <HookReader
          hook={useCartItemQuantity}
          onResult={(v: any) => { ctxValue = v; }}
        />
      </EPCartItemQuantityControl>
    );
    await act(async () => { ctxValue.increment(); });
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ id: "item-1", quantity: 3 })
    );
  });

  it("decrement calls updateItem with new quantity", async () => {
    const mockUpdate = jest.fn().mockResolvedValue(undefined);
    mockUseUpdateItem.mockReturnValue(mockUpdate);
    mockUseSelector.mockReturnValue({ id: "item-1", quantity: 3 });

    let ctxValue: any;
    render(
      <EPCartItemQuantityControl>
        <HookReader
          hook={useCartItemQuantity}
          onResult={(v: any) => { ctxValue = v; }}
        />
      </EPCartItemQuantityControl>
    );
    await act(async () => { ctxValue.decrement(); });
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ id: "item-1", quantity: 2 })
    );
  });

  it("passes locationSlug in update when present", async () => {
    const mockUpdate = jest.fn().mockResolvedValue(undefined);
    mockUseUpdateItem.mockReturnValue(mockUpdate);
    mockUseSelector.mockReturnValue({
      id: "item-1",
      quantity: 2,
      locationSlug: "store-a",
    });

    let ctxValue: any;
    render(
      <EPCartItemQuantityControl>
        <HookReader
          hook={useCartItemQuantity}
          onResult={(v: any) => { ctxValue = v; }}
        />
      </EPCartItemQuantityControl>
    );
    await act(async () => { ctxValue.increment(); });
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ location: "store-a" })
    );
  });

  it("reverts quantity on update error", async () => {
    const mockUpdate = jest.fn().mockRejectedValue(new Error("Network error"));
    mockUseUpdateItem.mockReturnValue(mockUpdate);
    mockUseSelector.mockReturnValue({ id: "item-1", quantity: 2 });

    let ctxValue: any;
    render(
      <EPCartItemQuantityControl>
        <HookReader
          hook={useCartItemQuantity}
          onResult={(v: any) => { ctxValue = v; }}
        />
      </EPCartItemQuantityControl>
    );
    await act(async () => { ctxValue.increment(); });
    // After error, quantity should revert to server value
    expect(ctxValue.quantity).toBe(2);
  });

  it("uses mock data when previewState=withData", () => {
    mockUseSelector.mockReturnValue(undefined);
    let ctxValue: any;
    render(
      <EPCartItemQuantityControl previewState="withData">
        <HookReader
          hook={useCartItemQuantity}
          onResult={(v: any) => { ctxValue = v; }}
        />
      </EPCartItemQuantityControl>
    );
    expect(ctxValue.quantity).toBe(MOCK_CART_LINE_ITEMS[0].quantity);
  });

  it("shows loading in preview state", () => {
    mockUseSelector.mockReturnValue(undefined);
    let ctxValue: any;
    render(
      <EPCartItemQuantityControl previewState="loading">
        <HookReader
          hook={useCartItemQuantity}
          onResult={(v: any) => { ctxValue = v; }}
        />
      </EPCartItemQuantityControl>
    );
    expect(ctxValue.isLoading).toBe(true);
  });

  it("minReached preview forces canDecrement=false", () => {
    mockUseSelector.mockReturnValue(undefined);
    let ctxValue: any;
    render(
      <EPCartItemQuantityControl previewState="minReached" minQuantity={1}>
        <HookReader
          hook={useCartItemQuantity}
          onResult={(v: any) => { ctxValue = v; }}
        />
      </EPCartItemQuantityControl>
    );
    expect(ctxValue.canDecrement).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// EPCartItemQuantityButton tests
// ---------------------------------------------------------------------------

describe("EPCartItemQuantityButton", () => {
  const mockCtx = {
    quantity: 3,
    isLoading: false,
    canDecrement: true,
    canIncrement: true,
    increment: jest.fn(),
    decrement: jest.fn(),
  };

  function renderButton(
    action: "increment" | "decrement",
    ctx = mockCtx,
    previewState?: string
  ) {
    return render(
      <CartItemQuantityContext.Provider value={ctx}>
        <EPCartItemQuantityButton action={action} previewState={previewState}>
          <span>{action === "increment" ? "+" : "-"}</span>
        </EPCartItemQuantityButton>
      </CartItemQuantityContext.Provider>
    );
  }

  beforeEach(() => {
    mockCtx.increment.mockClear();
    mockCtx.decrement.mockClear();
  });

  it("calls increment on click", () => {
    renderButton("increment");
    fireEvent.click(screen.getByRole("button"));
    expect(mockCtx.increment).toHaveBeenCalledTimes(1);
  });

  it("calls decrement on click", () => {
    renderButton("decrement");
    fireEvent.click(screen.getByRole("button"));
    expect(mockCtx.decrement).toHaveBeenCalledTimes(1);
  });

  it("disabled when canIncrement=false for increment action", () => {
    renderButton("increment", { ...mockCtx, canIncrement: false });
    const btn = screen.getByRole("button");
    expect(btn.getAttribute("aria-disabled")).toBe("true");
    fireEvent.click(btn);
    expect(mockCtx.increment).not.toHaveBeenCalled();
  });

  it("disabled when canDecrement=false for decrement action", () => {
    renderButton("decrement", { ...mockCtx, canDecrement: false });
    const btn = screen.getByRole("button");
    expect(btn.getAttribute("aria-disabled")).toBe("true");
    fireEvent.click(btn);
    expect(mockCtx.decrement).not.toHaveBeenCalled();
  });

  it("previewState=disabled forces disabled", () => {
    renderButton("increment", mockCtx, "disabled");
    const btn = screen.getByRole("button");
    expect(btn.getAttribute("aria-disabled")).toBe("true");
  });

  it("previewState=enabled forces enabled even when context says disabled", () => {
    renderButton("increment", { ...mockCtx, canIncrement: false }, "enabled");
    const btn = screen.getByRole("button");
    expect(btn.getAttribute("aria-disabled")).toBe("false");
  });

  it("aria-label for increment", () => {
    renderButton("increment");
    expect(
      screen.getByRole("button").getAttribute("aria-label")
    ).toBe("Increase quantity");
  });

  it("aria-label for decrement", () => {
    renderButton("decrement");
    expect(
      screen.getByRole("button").getAttribute("aria-label")
    ).toBe("Decrease quantity");
  });

  it("Enter key triggers click", () => {
    renderButton("increment");
    fireEvent.keyDown(screen.getByRole("button"), { key: "Enter" });
    expect(mockCtx.increment).toHaveBeenCalledTimes(1);
  });

  it("Space key triggers click", () => {
    renderButton("decrement");
    fireEvent.keyDown(screen.getByRole("button"), { key: " " });
    expect(mockCtx.decrement).toHaveBeenCalledTimes(1);
  });

  it("does not crash without context", () => {
    render(
      <EPCartItemQuantityButton action="increment">
        <span>+</span>
      </EPCartItemQuantityButton>
    );
    // Should render without error
    fireEvent.click(screen.getByRole("button"));
    // No crash, no call
  });

  it("has data-disabled attribute when disabled", () => {
    renderButton("increment", { ...mockCtx, canIncrement: false });
    const btn = screen.getByRole("button");
    expect(btn.getAttribute("data-disabled")).toBe("true");
  });
});

// ---------------------------------------------------------------------------
// EPCartItemRemoveButton tests
// ---------------------------------------------------------------------------

describe("EPCartItemRemoveButton", () => {
  it("calls removeItem on click", async () => {
    const mockRemove = jest.fn().mockResolvedValue(undefined);
    mockUseRemoveItem.mockReturnValue(mockRemove);
    mockUseSelector.mockReturnValue({ id: "item-1", name: "Product A" });

    render(
      <EPCartItemRemoveButton>
        <span>Remove</span>
      </EPCartItemRemoveButton>
    );
    await act(async () => {
      fireEvent.click(screen.getByRole("button"));
    });
    expect(mockRemove).toHaveBeenCalledWith({ id: "item-1" });
  });

  it("does not call removeItem when no item id", async () => {
    const mockRemove = jest.fn();
    mockUseRemoveItem.mockReturnValue(mockRemove);
    mockUseSelector.mockReturnValue(undefined);

    render(
      <EPCartItemRemoveButton>
        <span>Remove</span>
      </EPCartItemRemoveButton>
    );
    await act(async () => {
      fireEvent.click(screen.getByRole("button"));
    });
    expect(mockRemove).not.toHaveBeenCalled();
  });

  it("clears loading state after error", async () => {
    const mockRemove = jest.fn().mockRejectedValue(new Error("Fail"));
    mockUseRemoveItem.mockReturnValue(mockRemove);
    mockUseSelector.mockReturnValue({ id: "item-1", name: "Product A" });

    render(
      <EPCartItemRemoveButton>
        <span>Remove</span>
      </EPCartItemRemoveButton>
    );
    await act(async () => {
      fireEvent.click(screen.getByRole("button"));
    });
    const btn = screen.getByRole("button");
    // After error, loading should be cleared — aria-disabled should be false
    expect(btn.getAttribute("aria-disabled")).toBe("false");
  });

  it("aria-label includes item name", () => {
    mockUseSelector.mockReturnValue({ id: "item-1", name: "Product A" });
    render(
      <EPCartItemRemoveButton>
        <span>Remove</span>
      </EPCartItemRemoveButton>
    );
    expect(
      screen.getByRole("button").getAttribute("aria-label")
    ).toBe("Remove Product A from cart");
  });

  it("aria-label uses 'item' fallback when no name", () => {
    mockUseSelector.mockReturnValue({ id: "item-1" });
    render(
      <EPCartItemRemoveButton>
        <span>Remove</span>
      </EPCartItemRemoveButton>
    );
    expect(
      screen.getByRole("button").getAttribute("aria-label")
    ).toBe("Remove item from cart");
  });

  it("Enter key triggers remove", async () => {
    const mockRemove = jest.fn().mockResolvedValue(undefined);
    mockUseRemoveItem.mockReturnValue(mockRemove);
    mockUseSelector.mockReturnValue({ id: "item-1", name: "Product A" });

    render(
      <EPCartItemRemoveButton>
        <span>Remove</span>
      </EPCartItemRemoveButton>
    );
    await act(async () => {
      fireEvent.keyDown(screen.getByRole("button"), { key: "Enter" });
    });
    expect(mockRemove).toHaveBeenCalledWith({ id: "item-1" });
  });

  it("Space key triggers remove", async () => {
    const mockRemove = jest.fn().mockResolvedValue(undefined);
    mockUseRemoveItem.mockReturnValue(mockRemove);
    mockUseSelector.mockReturnValue({ id: "item-1", name: "Product A" });

    render(
      <EPCartItemRemoveButton>
        <span>Remove</span>
      </EPCartItemRemoveButton>
    );
    await act(async () => {
      fireEvent.keyDown(screen.getByRole("button"), { key: " " });
    });
    expect(mockRemove).toHaveBeenCalledWith({ id: "item-1" });
  });

  it("previewState=loading shows loading state", () => {
    mockUseSelector.mockReturnValue({ id: "item-1" });
    render(
      <EPCartItemRemoveButton previewState="loading">
        <span>Remove</span>
      </EPCartItemRemoveButton>
    );
    const btn = screen.getByRole("button");
    expect(btn.getAttribute("data-loading")).toBe("true");
  });

  it("previewState prevents actual remove call", async () => {
    const mockRemove = jest.fn();
    mockUseRemoveItem.mockReturnValue(mockRemove);
    mockUseSelector.mockReturnValue({ id: "item-1" });

    render(
      <EPCartItemRemoveButton previewState="enabled">
        <span>Remove</span>
      </EPCartItemRemoveButton>
    );
    await act(async () => {
      fireEvent.click(screen.getByRole("button"));
    });
    expect(mockRemove).not.toHaveBeenCalled();
  });
});
