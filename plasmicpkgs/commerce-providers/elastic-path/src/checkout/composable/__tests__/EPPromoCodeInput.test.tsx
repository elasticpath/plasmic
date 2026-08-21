/** @jest-environment jsdom */
import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

// The cart the input reads its already-applied promotion from.
let mockCart: any = null;
jest.mock("../../../cart-provider/use-ep-cart", () => ({
  useEpCart: () => ({
    cart: mockCart,
    isLoading: false,
    error: null,
    refresh: jest.fn(),
  }),
}));

// Required after the mock above: jest.mock does not hoist under this project's
// esbuild transform, so a static import would bind the real module.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { EPPromoCodeInput } =
  require("../EPPromoCodeInput") as typeof import("../EPPromoCodeInput");

// ---------------------------------------------------------------------------
// jest.mock doesn't hoist with this project's esbuild transform.
// Mock global.fetch directly (matching existing test patterns).
// useShopperFetch() internally calls global.fetch, so this tests the full
// server-route path end-to-end.
// ---------------------------------------------------------------------------

const mockFetch = jest.fn();
(global as any).fetch = mockFetch;

function mockFetchSuccess(data: any = {}) {
  mockFetch.mockResolvedValue({
    ok: true,
    json: () => Promise.resolve(data),
    text: () => Promise.resolve(JSON.stringify(data)),
  });
}

function mockFetchFailure(message: string) {
  mockFetch.mockResolvedValue({
    ok: false,
    status: 400,
    json: () => Promise.resolve({ error: message }),
    text: () => Promise.resolve(message),
  });
}

beforeEach(() => {
  mockFetch.mockReset();
  mockCart = null;
});

describe("EPPromoCodeInput — a promotion the cart already carries", () => {
  it("shows it as applied without any interaction", () => {
    // The applied state lived only in local useState, so any navigation lost
    // the chip while the discount stayed live on the cart.
    mockCart = {
      id: "cart-1",
      items: [],
      promotions: [{ id: "promo-1", type: "promotion_item", name: "TEST1" }],
      itemCount: 1,
    };

    const { container } = render(<EPPromoCodeInput useServerRoutes />);

    expect(container.querySelector("[data-ep-promo-applied]")).toBeTruthy();
    expect(container.textContent).toContain("TEST1");
  });

  it("offers the input when the cart carries no promotion", () => {
    mockCart = { id: "cart-1", items: [], promotions: [], itemCount: 1 };

    const { container } = render(<EPPromoCodeInput useServerRoutes />);

    expect(container.querySelector("[data-ep-promo-applied]")).toBeNull();
    expect(screen.getByPlaceholderText("Promo code")).toBeTruthy();
  });
});

describe("EPPromoCodeInput (useServerRoutes)", () => {
  it("renders input and apply button", () => {
    mockFetchSuccess();
    render(<EPPromoCodeInput useServerRoutes />);
    expect(screen.getByPlaceholderText("Promo code")).toBeTruthy();
    expect(screen.getByText("Apply")).toBeTruthy();
  });

  it("calls POST /api/cart/promo on apply", async () => {
    mockFetchSuccess();
    render(<EPPromoCodeInput useServerRoutes />);

    const input = screen.getByPlaceholderText("Promo code");
    fireEvent.change(input, { target: { value: "SAVE10" } });
    fireEvent.click(screen.getByText("Apply"));

    await waitFor(() => {
      const postCall = mockFetch.mock.calls.find(
        ([url, init]: [string, RequestInit]) =>
          url === "/api/cart/promo" && init?.method === "POST"
      );
      expect(postCall).toBeDefined();

      const body = JSON.parse(postCall![1].body as string);
      expect(body.code).toBe("SAVE10");
    });
  });

  it("shows applied state and remove button after successful apply", async () => {
    mockFetchSuccess();
    render(<EPPromoCodeInput useServerRoutes />);

    const input = screen.getByPlaceholderText("Promo code");
    fireEvent.change(input, { target: { value: "SAVE10" } });
    fireEvent.click(screen.getByText("Apply"));

    await waitFor(() => {
      expect(screen.getByText("SAVE10")).toBeTruthy();
      expect(screen.getByText("Remove")).toBeTruthy();
    });
  });

  it("calls DELETE /api/cart/promo on remove", async () => {
    mockFetchSuccess();
    render(<EPPromoCodeInput useServerRoutes />);

    // Apply first
    const input = screen.getByPlaceholderText("Promo code");
    fireEvent.change(input, { target: { value: "SAVE10" } });
    fireEvent.click(screen.getByText("Apply"));

    await waitFor(() => {
      expect(screen.getByText("SAVE10")).toBeTruthy();
    });

    // Now remove
    mockFetch.mockClear();
    mockFetchSuccess();
    fireEvent.click(screen.getByText("Remove"));

    await waitFor(() => {
      const deleteCall = mockFetch.mock.calls.find(
        ([url, init]: [string, RequestInit]) =>
          url === "/api/cart/promo" && init?.method === "DELETE"
      );
      expect(deleteCall).toBeDefined();

      const body = JSON.parse(deleteCall![1].body as string);
      expect(body.promoCode).toBe("SAVE10");
    });
  });

  it("shows error state on fetch failure", async () => {
    mockFetchFailure("Invalid promo code");
    render(<EPPromoCodeInput useServerRoutes />);

    const input = screen.getByPlaceholderText("Promo code");
    fireEvent.change(input, { target: { value: "BAD" } });
    fireEvent.click(screen.getByText("Apply"));

    await waitFor(() => {
      expect(screen.getByRole("alert")).toBeTruthy();
      expect(screen.getByText("Invalid promo code")).toBeTruthy();
    });
  });

  it("does not submit empty promo code", () => {
    mockFetchSuccess();
    render(<EPPromoCodeInput useServerRoutes />);

    const button = screen.getByText("Apply");
    expect(button).toHaveProperty("disabled", true);
  });
});
