/** @jest-environment jsdom */
import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { EPPromoCodeInput } from "../EPPromoCodeInput";

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
