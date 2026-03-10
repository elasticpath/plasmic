/**
 * Adapter registry — exports adapter factories for consumer route setup.
 *
 * Consumer route files import these to register adapters:
 *   import { createCloverAdapter } from "@elasticpath/.../adapters";
 *   registry.register("clover", createCloverAdapter({ apiKey, apiBase }));
 */

// Clover adapter
export { createCloverAdapter } from "./clover-adapter";
export type { CloverAdapterConfig } from "./clover-adapter";

// Clover API helpers (for advanced usage)
export { chargeClover, finalizeCloverPayment, deriveIdempotencyKey } from "./clover-api";

// Clover types
export type {
  CloverChargeRequest,
  CloverChargeResponse,
  Clover3DSMethodData,
  Clover3DSChallengeData,
  CloverFinalizeRequest,
  CloverTokenResult,
  CloverFieldType,
  CloverFieldInstance,
  CloverElementsInstance,
  CloverSdkInstance,
  CloverConstructor,
  Clover3DSUtil,
} from "./clover-types";

// Stripe adapter
export { createStripeAdapter } from "./stripe-adapter";
export type { StripeAdapterConfig } from "./stripe-adapter";
