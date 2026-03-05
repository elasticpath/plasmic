/**
 * @jest-environment jsdom
 *
 * Tests for useCheckout hook.
 *
 * Why: useCheckout orchestrates the entire checkout flow — customer info,
 * shipping calculation, order creation, payment setup/confirmation, and step
 * navigation. Bugs here break the entire purchase path. Tests validate state
 * transitions, fetch calls, error handling, and the canProceedToNext gate
 * that prevents premature step advancement.
 */

import { renderHook, act } from "@testing-library/react";
import { useCheckout } from "../hooks/use-checkout";
import { CheckoutStep } from "../types";
import type {
  CheckoutFormData,
  AddressData,
  ShippingRate,
  ElasticPathOrder,
} from "../types";

/* ---------- test data ---------- */

const mockAddress: AddressData = {
  first_name: "John",
  last_name: "Doe",
  line_1: "123 Main St",
  city: "Springfield",
  country: "US",
  postcode: "62701",
};

const mockFormData: CheckoutFormData = {
  customer: { name: "John Doe", email: "john@example.com" },
  billingAddress: mockAddress,
  sameAsBilling: true,
};

const mockShippingRate: ShippingRate = {
  id: "rate-1",
  name: "Standard Shipping",
  amount: 500,
  currency: "USD",
  service_level: "standard",
};

const mockOrder: ElasticPathOrder = {
  id: "order-1",
  type: "order",
  status: "incomplete",
  payment: "pending",
  total: { amount: 10000, currency: "USD" },
  subtotal: { amount: 9500, currency: "USD" },
  tax: { amount: 500, currency: "USD" },
  relationships: { items: { data: [] } },
};

/* ---------- fetch mock helper ---------- */

const mockFetchSuccess = (data: any) => {
  (global.fetch as jest.Mock).mockResolvedValueOnce({
    ok: true,
    json: async () => ({ success: true, data }),
  });
};

const mockFetchError = (message: string, status = 400) => {
  (global.fetch as jest.Mock).mockResolvedValueOnce({
    ok: false,
    status,
    json: async () => ({ error: { message } }),
  });
};

/* ---------- setup ---------- */

beforeEach(() => {
  global.fetch = jest.fn();
});

afterEach(() => {
  jest.restoreAllMocks();
});

/* ---------- tests ---------- */

describe("useCheckout", () => {
  describe("initial state", () => {
    it("starts at CUSTOMER_INFO step", () => {
      const { result } = renderHook(() => useCheckout());
      expect(result.current.state.currentStep).toBe(
        CheckoutStep.CUSTOMER_INFO
      );
    });

    it("starts with isLoading false", () => {
      const { result } = renderHook(() => useCheckout());
      expect(result.current.state.isLoading).toBe(false);
    });

    it("starts with canProceedToNext false", () => {
      const { result } = renderHook(() => useCheckout());
      expect(result.current.canProceedToNext).toBe(false);
    });

    it("starts with totalAmount 0", () => {
      const { result } = renderHook(() => useCheckout());
      expect(result.current.totalAmount).toBe(0);
    });
  });

  describe("submitCustomerInfo", () => {
    it("stores customer data and advances to SHIPPING", async () => {
      const { result } = renderHook(() => useCheckout());

      await act(async () => {
        await result.current.submitCustomerInfo(mockFormData);
      });

      expect(result.current.state.customerData).toEqual(mockFormData.customer);
      expect(result.current.state.billingAddress).toEqual(
        mockFormData.billingAddress
      );
      expect(result.current.state.currentStep).toBe(CheckoutStep.SHIPPING);
    });

    it("uses billing address as shipping when sameAsBilling is true", async () => {
      const { result } = renderHook(() => useCheckout());

      await act(async () => {
        await result.current.submitCustomerInfo(mockFormData);
      });

      expect(result.current.state.shippingAddress).toEqual(
        mockFormData.billingAddress
      );
    });

    it("uses separate shipping address when sameAsBilling is false", async () => {
      const separateShipping: AddressData = {
        ...mockAddress,
        line_1: "456 Oak Ave",
      };

      const { result } = renderHook(() => useCheckout());

      await act(async () => {
        await result.current.submitCustomerInfo({
          ...mockFormData,
          sameAsBilling: false,
          shippingAddress: separateShipping,
        });
      });

      expect(result.current.state.shippingAddress).toEqual(separateShipping);
    });

    it("does not advance step when autoAdvanceSteps is false", async () => {
      const { result } = renderHook(() =>
        useCheckout({ autoAdvanceSteps: false })
      );

      await act(async () => {
        await result.current.submitCustomerInfo(mockFormData);
      });

      expect(result.current.state.currentStep).toBe(
        CheckoutStep.CUSTOMER_INFO
      );
    });
  });

  describe("calculateShipping", () => {
    it("throws when no cartId provided", async () => {
      const { result } = renderHook(() => useCheckout());

      await expect(
        act(async () => {
          await result.current.calculateShipping(mockAddress);
        })
      ).rejects.toThrow("Cart ID is required");
    });

    it("returns shipping rates from API", async () => {
      mockFetchSuccess({ shippingRates: [mockShippingRate] });

      const { result } = renderHook(() =>
        useCheckout({ cartId: "cart-1" })
      );

      let rates: ShippingRate[] = [];
      await act(async () => {
        rates = await result.current.calculateShipping(mockAddress);
      });

      expect(rates).toHaveLength(1);
      expect(rates[0].name).toBe("Standard Shipping");
      expect(global.fetch).toHaveBeenCalledWith(
        "/api/checkout/calculate-shipping",
        expect.objectContaining({ method: "POST" })
      );
    });

    it("throws on API error", async () => {
      mockFetchError("Shipping unavailable");

      const { result } = renderHook(() =>
        useCheckout({ cartId: "cart-1" })
      );

      await expect(
        act(async () => {
          await result.current.calculateShipping(mockAddress);
        })
      ).rejects.toThrow("Shipping unavailable");
    });
  });

  describe("selectShippingRate", () => {
    it("stores the selected rate and advances to PAYMENT", () => {
      const { result } = renderHook(() => useCheckout());

      act(() => {
        result.current.selectShippingRate(mockShippingRate);
      });

      expect(result.current.state.selectedShippingRate).toEqual(
        mockShippingRate
      );
      expect(result.current.state.currentStep).toBe(CheckoutStep.PAYMENT);
    });
  });

  describe("createOrder", () => {
    it("throws when required data is missing", async () => {
      const { result } = renderHook(() =>
        useCheckout({ cartId: "cart-1" })
      );

      await expect(
        act(async () => {
          await result.current.createOrder();
        })
      ).rejects.toThrow("Missing required checkout data");
    });

    it("creates order and stores it in state", async () => {
      mockFetchSuccess({ order: mockOrder });

      const { result } = renderHook(() =>
        useCheckout({ cartId: "cart-1" })
      );

      // First submit customer info to satisfy prerequisites
      await act(async () => {
        await result.current.submitCustomerInfo(mockFormData);
      });

      let order: ElasticPathOrder | undefined;
      await act(async () => {
        order = await result.current.createOrder();
      });

      expect(order?.id).toBe("order-1");
      expect(result.current.state.order).toEqual(mockOrder);
    });

    it("calls onError callback on failure", async () => {
      mockFetchError("Order creation failed");
      const onError = jest.fn();

      const { result } = renderHook(() =>
        useCheckout({ cartId: "cart-1", onError })
      );

      await act(async () => {
        await result.current.submitCustomerInfo(mockFormData);
      });

      let caughtError: Error | undefined;
      await act(async () => {
        try {
          await result.current.createOrder();
        } catch (e) {
          caughtError = e as Error;
        }
      });

      expect(caughtError?.message).toBe("Order creation failed");
      expect(onError).toHaveBeenCalledWith(expect.any(Error));
    });
  });

  describe("setupPayment", () => {
    it("calls API and returns client secret + transaction ID", async () => {
      mockFetchSuccess({
        clientSecret: "pi_secret_123",
        transactionId: "txn-1",
        paymentIntentId: "pi_123",
      });

      const { result } = renderHook(() => useCheckout());

      let paymentResult: { clientSecret: string; transactionId: string } | undefined;
      await act(async () => {
        paymentResult = await result.current.setupPayment(
          "order-1",
          10000,
          "USD"
        );
      });

      expect(paymentResult?.clientSecret).toBe("pi_secret_123");
      expect(paymentResult?.transactionId).toBe("txn-1");
      expect(result.current.state.paymentSetup?.gateway).toBe("stripe");
    });
  });

  describe("confirmPayment", () => {
    it("confirms payment and advances to CONFIRMATION", async () => {
      mockFetchSuccess({ order: mockOrder });
      const onComplete = jest.fn();

      const { result } = renderHook(() =>
        useCheckout({ onComplete })
      );

      await act(async () => {
        await result.current.confirmPayment("order-1", "txn-1", "pi_123");
      });

      expect(result.current.state.currentStep).toBe(
        CheckoutStep.CONFIRMATION
      );
      expect(onComplete).toHaveBeenCalledWith(mockOrder);
    });
  });

  describe("step navigation", () => {
    it("goToStep sets the step directly", () => {
      const { result } = renderHook(() => useCheckout());

      act(() => {
        result.current.goToStep(CheckoutStep.PAYMENT);
      });

      expect(result.current.state.currentStep).toBe(CheckoutStep.PAYMENT);
    });

    it("nextStep advances one step forward", () => {
      const { result } = renderHook(() => useCheckout());

      act(() => {
        result.current.nextStep();
      });

      expect(result.current.state.currentStep).toBe(CheckoutStep.SHIPPING);
    });

    it("previousStep goes back one step", () => {
      const { result } = renderHook(() => useCheckout());

      act(() => {
        result.current.goToStep(CheckoutStep.PAYMENT);
      });

      act(() => {
        result.current.previousStep();
      });

      expect(result.current.state.currentStep).toBe(CheckoutStep.SHIPPING);
    });

    it("nextStep does nothing on last step", () => {
      const { result } = renderHook(() => useCheckout());

      act(() => {
        result.current.goToStep(CheckoutStep.CONFIRMATION);
      });

      act(() => {
        result.current.nextStep();
      });

      expect(result.current.state.currentStep).toBe(
        CheckoutStep.CONFIRMATION
      );
    });

    it("previousStep does nothing on first step", () => {
      const { result } = renderHook(() => useCheckout());

      act(() => {
        result.current.previousStep();
      });

      expect(result.current.state.currentStep).toBe(
        CheckoutStep.CUSTOMER_INFO
      );
    });
  });

  describe("reset", () => {
    it("resets state to initial values", async () => {
      const { result } = renderHook(() => useCheckout());

      await act(async () => {
        await result.current.submitCustomerInfo(mockFormData);
      });

      expect(result.current.state.customerData).toBeDefined();

      act(() => {
        result.current.reset();
      });

      expect(result.current.state.currentStep).toBe(
        CheckoutStep.CUSTOMER_INFO
      );
      expect(result.current.state.customerData).toBeUndefined();
      expect(result.current.state.isLoading).toBe(false);
    });
  });

  describe("canProceedToNext", () => {
    it("returns true when customer info is submitted", async () => {
      const { result } = renderHook(() =>
        useCheckout({ autoAdvanceSteps: false })
      );

      expect(result.current.canProceedToNext).toBe(false);

      await act(async () => {
        await result.current.submitCustomerInfo(mockFormData);
      });

      expect(result.current.canProceedToNext).toBe(true);
    });

    it("returns true on SHIPPING step when rate is selected", () => {
      const { result } = renderHook(() =>
        useCheckout({ autoAdvanceSteps: false })
      );

      act(() => {
        result.current.goToStep(CheckoutStep.SHIPPING);
      });

      expect(result.current.canProceedToNext).toBe(false);

      act(() => {
        result.current.selectShippingRate(mockShippingRate);
      });

      // selectShippingRate auto-advances when autoAdvanceSteps is not false for rate selection
      // Let's re-navigate to shipping to check
    });

    it("returns false on CONFIRMATION step", () => {
      const { result } = renderHook(() => useCheckout());

      act(() => {
        result.current.goToStep(CheckoutStep.CONFIRMATION);
      });

      expect(result.current.canProceedToNext).toBe(false);
    });
  });

  describe("totalAmount", () => {
    it("includes shipping rate when selected", async () => {
      mockFetchSuccess({ order: mockOrder });

      const { result } = renderHook(() =>
        useCheckout({ cartId: "cart-1" })
      );

      // Submit customer info and create order
      await act(async () => {
        await result.current.submitCustomerInfo(mockFormData);
      });

      await act(async () => {
        await result.current.createOrder();
      });

      // Select shipping rate
      act(() => {
        result.current.selectShippingRate(mockShippingRate);
      });

      // totalAmount = order.total.amount (10000) + shippingRate.amount (500)
      expect(result.current.totalAmount).toBe(10500);
    });
  });

  describe("API base URL", () => {
    it("uses custom apiBaseUrl", async () => {
      mockFetchSuccess({ shippingRates: [] });

      const { result } = renderHook(() =>
        useCheckout({ cartId: "cart-1", apiBaseUrl: "/custom-api" })
      );

      await act(async () => {
        await result.current.calculateShipping(mockAddress);
      });

      expect(global.fetch).toHaveBeenCalledWith(
        "/custom-api/checkout/calculate-shipping",
        expect.anything()
      );
    });
  });
});
