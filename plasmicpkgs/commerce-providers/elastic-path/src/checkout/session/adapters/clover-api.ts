/**
 * Server-side Clover API helpers — framework-agnostic charge and finalize.
 *
 * WHY: These are the raw Clover REST API calls needed by the clover-adapter.
 * Ported from storefront's lib/clover-api.ts but parameterized: apiKey and
 * apiBase are required arguments (no env var fallback) so the package stays
 * framework-agnostic.
 */
import type { CloverChargeResponse } from "./clover-types";

// ---------------------------------------------------------------------------
// Idempotency key
// ---------------------------------------------------------------------------

export function deriveIdempotencyKey(orderId: string): string {
  return `clover-charge-${orderId}`;
}

// ---------------------------------------------------------------------------
// Clover Charge
// ---------------------------------------------------------------------------

export async function chargeClover(
  cloverToken: string,
  amount: number,
  currency: string,
  orderId: string,
  idempotencyKey: string,
  apiKey: string,
  apiBase: string
): Promise<CloverChargeResponse> {
  const res = await fetch(`${apiBase}/v1/charges`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "Idempotency-Key": idempotencyKey,
    },
    body: JSON.stringify({
      source: cloverToken,
      amount,
      currency,
      description: `Online order #${orderId}`,
    }),
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const errorMessage =
      (body as Record<string, unknown>).message ||
      (body as { error?: { message?: string } }).error?.message ||
      "Payment failed";

    if (res.status === 402) {
      throw Object.assign(new Error(String(errorMessage)), {
        code: "card_declined",
      });
    }

    throw new Error(`Clover charge failed (${res.status}): ${errorMessage}`);
  }

  return res.json();
}

// ---------------------------------------------------------------------------
// Clover 3DS Finalize Payment
// ---------------------------------------------------------------------------

export async function finalizeCloverPayment(
  chargeId: string,
  flowStatus: string,
  apiKey: string,
  apiBase: string
): Promise<CloverChargeResponse> {
  const res = await fetch(`${apiBase}/v1/charges/finalize_payment`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      charge_id: chargeId,
      threeds: {
        source: "CLOVER",
        flow_status: flowStatus,
      },
    }),
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const errorMessage =
      (body as Record<string, unknown>).message ||
      (body as { error?: { message?: string } }).error?.message ||
      "Payment finalization failed";

    throw new Error(
      `Clover finalize_payment failed (${res.status}): ${errorMessage}`
    );
  }

  return res.json();
}
