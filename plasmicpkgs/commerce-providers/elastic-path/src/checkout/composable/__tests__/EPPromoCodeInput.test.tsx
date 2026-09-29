/** @jest-environment jsdom */
import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

// The cart the input reads its applied promotion from — the only source of
// truth for the applied state, since the discount lives on the EP cart.
let mockCart: any = null;
jest.mock("../../../cart-provider/use-ep-cart", () => ({
  useEpCart: () => ({
    cart: mockCart,
    isLoading: false,
    error: null,
    refresh: jest.fn(),
  }),
}));

// Mocked at the transport, not at the operation: the real `epApplyPromoCode` /
// `epRemovePromoCode` run, so what reaches Elastic Path is what these tests
// assert on.
const mockCallEpProxy = jest.fn();
jest.mock("../../../ep-server-functions/proxy-fetch", () => ({
  __esModule: true,
  // `epProxyErrorCode` is pure — exercise the real one.
  ...jest.requireActual("../../../ep-server-functions/proxy-fetch"),
  callEpProxy: (...args: unknown[]) => mockCallEpProxy(...args),
}));

const mockSwrMutate = jest.fn();
jest.mock("swr", () => ({
  __esModule: true,
  mutate: (...args: unknown[]) => mockSwrMutate(...args),
}));

// Required after the mocks above: jest.mock does not hoist under this
// project's esbuild transform, so a static import would bind the real modules.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { EPPromoCodeInput } =
  require("../EPPromoCodeInput") as typeof import("../EPPromoCodeInput");

const CART_WITHOUT_PROMOTION = {
  id: "cart-1",
  items: [],
  promotions: [],
  itemCount: 1,
};

const CART_WITH_PROMOTION = {
  id: "cart-1",
  items: [],
  promotions: [
    {
      id: "promo-1",
      type: "promotion_item",
      name: "Five off",
      code: "SAVE5",
      meta: {
        display_price: {
          without_tax: {
            value: { amount: -500, currency: "USD", formatted: "-$5.00" },
          },
        },
      },
    },
  ],
  itemCount: 1,
};

/** An error as the proxy route reports it in production: message withheld. */
function sanitizedProxyError(code: string): Error {
  const err = new Error("dispatch_failed") as Error & { code?: string };
  err.code = code;
  return err;
}

function applyCode(value: string) {
  fireEvent.change(screen.getByPlaceholderText("Promo code"), {
    target: { value },
  });
  fireEvent.click(screen.getByText("Apply"));
}

beforeEach(() => {
  mockCallEpProxy.mockReset();
  mockSwrMutate.mockReset();
  mockCart = CART_WITHOUT_PROMOTION;
});

describe("EPPromoCodeInput — the promotion the cart carries", () => {
  it("shows it as applied without any interaction", () => {
    mockCart = CART_WITH_PROMOTION;

    const { container } = render(<EPPromoCodeInput />);

    expect(container.querySelector("[data-ep-promo-applied]")).toBeTruthy();
    expect(container.textContent).toContain("SAVE5");
  });

  it("shows the discount Elastic Path computed, not a placeholder", () => {
    mockCart = CART_WITH_PROMOTION;

    const { container } = render(<EPPromoCodeInput />);

    expect(container.textContent).toContain("-$5.00");
  });

  it("falls back to the promotion name when EP returns no code", () => {
    mockCart = {
      ...CART_WITHOUT_PROMOTION,
      promotions: [{ id: "promo-1", type: "promotion_item", name: "TEST1" }],
    };

    const { container } = render(<EPPromoCodeInput />);

    expect(container.querySelector("[data-ep-promo-applied]")).toBeTruthy();
    expect(container.textContent).toContain("TEST1");
  });

  it("offers the input when the cart carries no promotion", () => {
    const { container } = render(<EPPromoCodeInput />);

    expect(container.querySelector("[data-ep-promo-applied]")).toBeNull();
    expect(screen.getByPlaceholderText("Promo code")).toBeTruthy();
  });
});

describe("EPPromoCodeInput — applying a code", () => {
  it("sends the code and nothing else", async () => {
    mockCallEpProxy.mockResolvedValue(CART_WITH_PROMOTION);
    render(<EPPromoCodeInput />);

    applyCode("SAVE5");

    await waitFor(() => {
      expect(mockCallEpProxy).toHaveBeenCalledWith("applyPromoCode", {
        code: "SAVE5",
      });
    });
    // No request originating in the browser states a discount amount.
    const [, args] = mockCallEpProxy.mock.calls[0];
    expect(Object.keys(args)).toEqual(["code"]);
  });

  it("re-prices every cart surface from the cart EP returned", async () => {
    mockCallEpProxy.mockResolvedValue(CART_WITH_PROMOTION);
    render(<EPPromoCodeInput />);

    applyCode("SAVE5");

    await waitFor(() => {
      expect(mockSwrMutate).toHaveBeenCalledWith(
        "ep-cart",
        CART_WITH_PROMOTION,
        { revalidate: false }
      );
    });
  });

  it("calls onApply with the code", async () => {
    mockCallEpProxy.mockResolvedValue(CART_WITH_PROMOTION);
    const onApply = jest.fn();
    render(<EPPromoCodeInput onApply={onApply} />);

    applyCode("SAVE5");

    await waitFor(() => expect(onApply).toHaveBeenCalledWith("SAVE5"));
  });

  it("reaches the same operation whether or not useServerRoutes is set", async () => {
    // The prop survives only so existing projects load; it is not the
    // mechanism and never was.
    mockCallEpProxy.mockResolvedValue(CART_WITH_PROMOTION);
    render(<EPPromoCodeInput useServerRoutes />);

    applyCode("SAVE5");

    await waitFor(() => {
      expect(mockCallEpProxy).toHaveBeenCalledWith("applyPromoCode", {
        code: "SAVE5",
      });
    });
  });

  it("does not submit an empty code", () => {
    render(<EPPromoCodeInput />);

    expect(screen.getByText("Apply")).toHaveProperty("disabled", true);
    expect(mockCallEpProxy).not.toHaveBeenCalled();
  });
});

describe("EPPromoCodeInput — a code EP will not honour", () => {
  it("tells the shopper and leaves the basket alone", async () => {
    mockCallEpProxy.mockRejectedValue(
      sanitizedProxyError("invalid_promo_code")
    );
    const onError = jest.fn();
    const { container } = render(<EPPromoCodeInput onError={onError} />);

    applyCode("EXPIRED");

    await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy());
    // The cart is never written to, so nothing invalidates or reseeds it.
    expect(mockSwrMutate).not.toHaveBeenCalled();
    expect(container.querySelector("[data-ep-promo-applied]")).toBeNull();
    expect(onError).toHaveBeenCalled();
  });

  it("maps the sanitized production failure to copy a shopper can act on", async () => {
    // Production withholds `message`, so rendering it verbatim would show
    // "dispatch_failed".
    mockCallEpProxy.mockRejectedValue(
      sanitizedProxyError("invalid_promo_code")
    );
    render(<EPPromoCodeInput />);

    applyCode("EXPIRED");

    await waitFor(() => {
      expect(screen.getByRole("alert").textContent).toMatch(/isn't valid/i);
    });
    expect(screen.queryByText(/dispatch_failed/)).toBeNull();
  });

  it("clears the message as soon as the shopper edits the code", async () => {
    mockCallEpProxy.mockRejectedValue(
      sanitizedProxyError("invalid_promo_code")
    );
    render(<EPPromoCodeInput />);

    applyCode("EXPIRED");
    await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy());

    fireEvent.change(screen.getByPlaceholderText("Promo code"), {
      target: { value: "EXPIRED2" },
    });

    expect(screen.queryByRole("alert")).toBeNull();
  });
});

describe("EPPromoCodeInput — removing a code", () => {
  it("removes by the code the cart carries", async () => {
    mockCart = CART_WITH_PROMOTION;
    mockCallEpProxy.mockResolvedValue(CART_WITHOUT_PROMOTION);
    const onRemove = jest.fn();
    render(<EPPromoCodeInput onRemove={onRemove} />);

    fireEvent.click(screen.getByText("Remove"));

    await waitFor(() => {
      expect(mockCallEpProxy).toHaveBeenCalledWith("removePromoCode", {
        code: "SAVE5",
      });
    });
    expect(onRemove).toHaveBeenCalled();
  });

  it("keeps the chip when the removal fails, since the discount is still live", async () => {
    mockCart = CART_WITH_PROMOTION;
    mockCallEpProxy.mockRejectedValue(
      sanitizedProxyError("invalid_promo_code")
    );
    const { container } = render(<EPPromoCodeInput />);

    fireEvent.click(screen.getByText("Remove"));

    await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy());
    expect(container.querySelector("[data-ep-promo-applied]")).toBeTruthy();
  });

  it("cannot be clicked when EP returned no code to remove", () => {
    mockCart = {
      ...CART_WITHOUT_PROMOTION,
      promotions: [{ id: "promo-1", type: "promotion_item", name: "TEST1" }],
    };

    render(<EPPromoCodeInput />);

    expect(screen.getByText("Remove")).toHaveProperty("disabled", true);
  });
});
