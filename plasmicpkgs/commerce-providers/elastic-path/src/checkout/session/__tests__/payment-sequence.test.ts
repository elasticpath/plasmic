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
  it("maps complete and completed to succeeded with transaction id", () => {
    for (const status of ["complete", "completed"]) {
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

  it("preserves transaction_type authorize without treating authorized as success", () => {
    const result = mapTransactionResponse({
      data: {
        data: {
          id: "txn-auth",
          status: "complete",
          transaction_type: "authorize",
        },
      },
    });
    expect(result.status).toBe("succeeded");
    expect(result.gatewayMetadata).toMatchObject({
      transactionId: "txn-auth",
      transaction_type: "authorize",
    });
  });

  it("does not treat order.payment or Stripe PI statuses as transaction success", () => {
    for (const status of ["paid", "authorized", "captured", "succeeded"]) {
      const result = mapTransactionResponse({
        data: { data: { id: "txn-x", status, transaction_type: "purchase" } },
      });
      expect(result.status).toBe("failed");
      expect(result.errorMessage).toMatch(new RegExp(status));
      expect(result.gatewayMetadata).toMatchObject({
        transactionId: "txn-x",
        transaction_type: "purchase",
      });
    }
  });

  it("does not succeed on a transaction id with no status", () => {
    const result = mapTransactionResponse({
      data: { data: { id: "txn-bare" } },
    });
    expect(result.status).toBe("failed");
    expect(result.errorMessage).toMatch(/Unrecognized/);
  });

  it("maps failed/cancelled/canceled/declined to failed", () => {
    for (const status of ["failed", "cancelled", "canceled", "declined"]) {
      const result = mapTransactionResponse({
        data: { data: { id: "txn-2", status } },
      });
      expect(result.status).toBe("failed");
      expect(result.errorMessage).toMatch(new RegExp(status));
    }
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

  it("does not complete checkout for pending/incomplete without customer action", () => {
    for (const status of ["pending", "incomplete"]) {
      const result = mapTransactionResponse({
        data: { data: { id: "txn-pend", status } },
      });
      expect(result.status).toBe("failed");
      expect(result.errorMessage).toMatch(new RegExp(status));
    }
  });

  it("does not use Stripe PaymentIntent statuses", () => {
    const result = mapTransactionResponse({
      data: { data: { id: "txn-4", status: "requires_action" } },
    });
    expect(result.status).toBe("failed");
    expect(result.errorMessage).toMatch(/requires_action/);
  });

  it("fails closed on an unknown status", () => {
    const result = mapTransactionResponse({
      data: { data: { id: "txn-u", status: "processing" } },
    });
    expect(result.status).toBe("failed");
    expect(result.errorMessage).toMatch(/processing/);
  });

  it("maps a thrown error to failed", () => {
    const result = mapTransactionResponse(undefined, new Error("EP 500"));
    expect(result.status).toBe("failed");
    expect(result.errorMessage).toBe("EP 500");
  });
});
