/**
 * Payment-sequence guards and EPCC TransactionResponse mapping.
 *
 * Sequences are explicit: cart_payment_intent vs order_first.
 * LegacyPaymentAdapter is not a sequence — only a Clover compatibility shape.
 */
import type {
  CartPaymentIntentAdapter,
  LegacyPaymentAdapter,
  OrderFirstAdapter,
  PaymentAdapter,
  PaymentAdapterResult,
} from "./types";

export function isCartPaymentIntentAdapter(
  adapter: PaymentAdapter
): adapter is CartPaymentIntentAdapter {
  return (
    "paymentSequence" in adapter &&
    adapter.paymentSequence === "cart_payment_intent"
  );
}

export function isOrderFirstAdapter(
  adapter: PaymentAdapter
): adapter is OrderFirstAdapter {
  return (
    "paymentSequence" in adapter && adapter.paymentSequence === "order_first"
  );
}

export function isLegacyPaymentAdapter(
  adapter: PaymentAdapter
): adapter is LegacyPaymentAdapter {
  return (
    !("paymentSequence" in adapter) &&
    "initializePayment" in adapter &&
    "confirmPayment" in adapter
  );
}

/** EPCC TransactionResponse.status — not order.payment and not Stripe PI. */
const SUCCEEDED_STATUSES = new Set(["complete", "completed"]);

const FAILED_STATUSES = new Set([
  "failed",
  "cancelled",
  "canceled",
  "declined",
]);

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object"
    ? (value as Record<string, unknown>)
    : null;
}

function unwrapTransaction(payload: unknown): Record<string, unknown> | null {
  const root = asRecord(payload);
  if (!root) return null;
  const data = asRecord(root.data);
  const inner = data ? asRecord(data.data) : null;
  return inner ?? data ?? (root.id || root.status ? root : null);
}

/**
 * Map an EPCC paymentSetup / TransactionResponse payload to a common result.
 * Uses documented EPCC fields only — no gateway-name branches.
 */
export function mapTransactionResponse(
  payload: unknown,
  thrown?: unknown
): PaymentAdapterResult {
  if (thrown) {
    const message =
      thrown instanceof Error ? thrown.message : String(thrown);
    return { status: "failed", errorMessage: message };
  }

  const root = asRecord(payload);
  const epError = root?.error;
  if (epError) {
    const err = asRecord(epError);
    const message =
      (typeof err?.message === "string" && err.message) ||
      "Payment setup failed";
    return { status: "failed", errorMessage: message };
  }

  const txn = unwrapTransaction(payload);
  if (!txn) {
    return { status: "failed", errorMessage: "Payment setup returned no transaction" };
  }

  const id = typeof txn.id === "string" ? txn.id : undefined;
  const status = typeof txn.status === "string" ? txn.status.toLowerCase() : "";
  const transactionType =
    typeof txn.transaction_type === "string" ? txn.transaction_type : undefined;
  const clientParameters = txn.client_parameters;
  const nextActions = txn.next_actions;
  const hasCustomerAction =
    clientParameters != null ||
    (Array.isArray(nextActions) ? nextActions.length > 0 : nextActions != null);

  const gatewayMetadata: Record<string, unknown> = {
    ...(id ? { transactionId: id } : {}),
    ...(transactionType ? { transaction_type: transactionType } : {}),
    ...(status ? { status } : {}),
  };

  const actionData: Record<string, unknown> = {
    ...(clientParameters != null ? { client_parameters: clientParameters } : {}),
    ...(nextActions != null ? { next_actions: nextActions } : {}),
  };

  if (FAILED_STATUSES.has(status)) {
    return {
      status: "failed",
      errorMessage: `status: ${status}`,
      gatewayOrderId: id,
      gatewayMetadata,
    };
  }

  if (SUCCEEDED_STATUSES.has(status)) {
    return {
      status: "succeeded",
      gatewayOrderId: id,
      gatewayMetadata,
    };
  }

  if (hasCustomerAction) {
    return {
      status: "requires_action",
      gatewayOrderId: id,
      gatewayMetadata,
      actionData,
    };
  }

  return {
    status: "failed",
    errorMessage: status ? `status: ${status}` : "Unrecognized transaction status",
    gatewayOrderId: id,
    gatewayMetadata,
  };
}
