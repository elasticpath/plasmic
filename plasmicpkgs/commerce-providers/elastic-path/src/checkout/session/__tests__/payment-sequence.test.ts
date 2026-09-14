/**
 * Payment-sequence guards and EPCC TransactionResponse mapping.
 */
import {
  isCartPaymentIntentAdapter,
  isLegacyPaymentAdapter,
  isOrderFirstAdapter,
  mapTransactionResponse,
} from "../payment-sequence";
import type { PaymentAdapter } from "../types";

describe("payment-sequence guards", () => {
  it("identifies cart_payment_intent only when the sequence is explicit", () => {
    const adapter: PaymentAdapter = {
      paymentSequence: "cart_payment_intent",
      initializePayment: jest.fn(),
    };
    expect(isCartPaymentIntentAdapter(adapter)).toBe(true);
    expect(isOrderFirstAdapter(adapter)).toBe(false);
    expect(isLegacyPaymentAdapter(adapter)).toBe(false);
  });

  it("identifies order_first only when the sequence is explicit", () => {
    const adapter: PaymentAdapter = {
      paymentSequence: "order_first",
      buildPaymentSetup: jest.fn(),
    };
    expect(isOrderFirstAdapter(adapter)).toBe(true);
    expect(isCartPaymentIntentAdapter(adapter)).toBe(false);
    expect(isLegacyPaymentAdapter(adapter)).toBe(false);
  });

  it("identifies legacy adapters that have no paymentSequence", () => {
    const adapter: PaymentAdapter = {
      initializePayment: jest.fn(),
      confirmPayment: jest.fn(),
    };
    expect(isLegacyPaymentAdapter(adapter)).toBe(true);
    expect(isCartPaymentIntentAdapter(adapter)).toBe(false);
    expect(isOrderFirstAdapter(adapter)).toBe(false);
  });
});

describe("mapTransactionResponse", () => {
  it("maps paid/complete/authorized to succeeded with transaction id", () => {
    for (const status of ["paid", "complete", "authorized"]) {
      const result = mapTransactionResponse({
        data: {
          data: {
            id: "txn-1",
            status,
            transaction_type: "purchase",
          },
        },
      });
      expect(result.status).toBe("succeeded");
      expect(result.gatewayOrderId).toBe("txn-1");
      expect(result.gatewayMetadata).toMatchObject({
        transactionId: "txn-1",
        transaction_type: "purchase",
      });
    }
  });

  it("maps failed/cancelled to failed", () => {
    const result = mapTransactionResponse({
      data: { data: { id: "txn-2", status: "failed" } },
    });
    expect(result.status).toBe("failed");
    expect(result.errorMessage).toMatch(/failed/);
  });

  it("maps incomplete + client_parameters/next_actions to requires_action", () => {
    const result = mapTransactionResponse({
      data: {
        data: {
          id: "txn-3",
          status: "incomplete",
          client_parameters: { redirect_url: "https://paypal.example/approve" },
          next_actions: [{ type: "redirect" }],
        },
      },
    });
    expect(result.status).toBe("requires_action");
    expect(result.actionData).toEqual({
      client_parameters: { redirect_url: "https://paypal.example/approve" },
      next_actions: [{ type: "redirect" }],
    });
  });

  it("does not use Stripe PaymentIntent statuses", () => {
    const result = mapTransactionResponse({
      data: { data: { id: "txn-4", status: "requires_action" } },
    });
    expect(result.status).toBe("failed");
    expect(result.errorMessage).toMatch(/requires_action/);
  });

  it("maps a thrown error to failed", () => {
    const result = mapTransactionResponse(undefined, new Error("EP 500"));
    expect(result.status).toBe("failed");
    expect(result.errorMessage).toBe("EP 500");
  });
});
