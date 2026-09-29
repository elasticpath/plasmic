/** @jest-environment jsdom */

import { act, render, screen } from "@testing-library/react";
import React from "react";

// ---------------------------------------------------------------------------
// jest.mock doesn't hoist with this project's esbuild transform, so the code
// under test is require()d after the mocks are registered.
// ---------------------------------------------------------------------------

const mockEpAddCartItem = jest.fn();
const mockEpUpdateCartItem = jest.fn();
const mockEpRemoveCartItem = jest.fn();
jest.mock("../../ep-server-functions/cart-mutations", () => ({
  epAddCartItem: (...a: unknown[]) => mockEpAddCartItem(...a),
  epUpdateCartItem: (...a: unknown[]) => mockEpUpdateCartItem(...a),
  epRemoveCartItem: (...a: unknown[]) => mockEpRemoveCartItem(...a),
}));

const mockSwrMutate = jest.fn();
jest.mock("swr", () => ({
  mutate: (...a: unknown[]) => mockSwrMutate(...a),
}));

let capturedActions: any = null;
jest.mock("@plasmicapp/host", () => ({
  GlobalActionsProvider: ({ actions, children }: any) => {
    capturedActions = actions;
    return <>{children}</>;
  },
}));

const { ServerCartActionsProvider } =
  require("../ServerCartActionsProvider") as typeof import("../ServerCartActionsProvider");

function renderProvider() {
  render(
    <ServerCartActionsProvider globalContextName="test-provider">
      <span>child content</span>
    </ServerCartActionsProvider>
  );
  return capturedActions;
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.useFakeTimers();
  capturedActions = null;
  mockEpAddCartItem.mockResolvedValue({});
  mockEpUpdateCartItem.mockResolvedValue({});
  mockEpRemoveCartItem.mockResolvedValue({});
  mockSwrMutate.mockResolvedValue(undefined);
});

afterEach(() => {
  jest.useRealTimers();
});

describe("ServerCartActionsProvider", () => {
  it("renders children", () => {
    renderProvider();
    expect(screen.getByText("child content")).toBeTruthy();
  });

  it("reads nothing on mount — the actions only write", () => {
    renderProvider();

    expect(mockEpAddCartItem).not.toHaveBeenCalled();
    expect(mockEpUpdateCartItem).not.toHaveBeenCalled();
    expect(mockEpRemoveCartItem).not.toHaveBeenCalled();
  });

  it("adds the chosen variant, not the base product", async () => {
    const actions = renderProvider();

    await act(async () => {
      actions.addItem("base-1", "child-1", 2);
    });

    expect(mockEpAddCartItem).toHaveBeenCalledWith({
      productId: "child-1",
      quantity: 2,
    });
  });

  it("adds the product itself when no variant was chosen", async () => {
    const actions = renderProvider();

    await act(async () => {
      actions.addItem("prod-1", "", 1);
    });

    expect(mockEpAddCartItem).toHaveBeenCalledWith({
      productId: "prod-1",
      quantity: 1,
    });
  });

  it("removes a line by its item id", async () => {
    const actions = renderProvider();

    await act(async () => {
      actions.removeItem("item-9");
    });

    expect(mockEpRemoveCartItem).toHaveBeenCalledWith({ itemId: "item-9" });
  });

  it("collapses rapid quantity changes into one write", async () => {
    const actions = renderProvider();

    act(() => {
      actions.updateItem("item-1", 2);
      actions.updateItem("item-1", 3);
      actions.updateItem("item-1", 4);
    });
    expect(mockEpUpdateCartItem).not.toHaveBeenCalled();

    await act(async () => {
      jest.runAllTimers();
    });

    expect(mockEpUpdateCartItem).toHaveBeenCalledTimes(1);
    expect(mockEpUpdateCartItem).toHaveBeenCalledWith({
      itemId: "item-1",
      quantity: 4,
    });
  });

  it("refreshes both cart caches after a write", async () => {
    const actions = renderProvider();

    await act(async () => {
      actions.addItem("prod-1", "", 1);
    });

    expect(mockSwrMutate).toHaveBeenCalledWith("ep-cart");
    const [matcher] = mockSwrMutate.mock.calls.find(
      ([arg]) => typeof arg === "function"
    )!;
    expect(matcher("cart")).toBe(true);
    expect(matcher(["cart", "cart-123"])).toBe(true);
    expect(matcher("ep-product")).toBe(false);
  });

  it("does not throw when a write fails", async () => {
    mockEpAddCartItem.mockRejectedValue(new Error("no session"));
    const actions = renderProvider();

    await act(async () => {
      actions.addItem("prod-1", "", 1);
    });

    expect(mockSwrMutate).not.toHaveBeenCalled();
  });
});
