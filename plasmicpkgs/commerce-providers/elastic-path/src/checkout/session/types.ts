/**
 * Checkout session types — server-authoritative session model.
 *
 * The session is an encrypted JSON cookie (~300-400 bytes) that coordinates
 * checkout state between the client and server. EP data is reconstructed
 * on-demand from the session's cartId / orderId rather than duplicated.
 */

// ---------------------------------------------------------------------------
// Session status
// ---------------------------------------------------------------------------

export type CheckoutSessionStatus =
  | "open"
  | "processing"
  | "complete"
  | "expired";

export type PaymentStatus =
  | "idle"
  | "pending"
  | "requires_action"
  | "succeeded"
  | "failed";

// ---------------------------------------------------------------------------
// Session address (camelCase — translated to EP snake_case by address-utils)
// ---------------------------------------------------------------------------

export interface SessionAddress {
  firstName: string;
  lastName: string;
  line1: string;
  line2?: string;
  city: string;
  county?: string;
  country: string;
  postcode: string;
}

export interface SessionCustomerInfo {
  name: string;
  email: string;
}

// ---------------------------------------------------------------------------
// Shipping
// ---------------------------------------------------------------------------

export interface SessionShippingRate {
  id: string;
  name: string;
  description?: string;
  amount: number;
  currency: string;
  deliveryTime?: string;
  serviceLevel: string;
  carrier?: string;
}

// ---------------------------------------------------------------------------
// Totals
// ---------------------------------------------------------------------------

export interface SessionTotals {
  subtotal: number;
  tax: number;
  shipping: number;
  total: number;
  currency: string;
}

// ---------------------------------------------------------------------------
// Payment
// ---------------------------------------------------------------------------

export interface SessionPayment {
  gateway: string | null;
  status: PaymentStatus;
  /** Client-side token (e.g. Stripe PaymentIntent client_secret). */
  clientToken: string | null;
  gatewayMetadata: {
    epTransactionId?: string;
    [key: string]: unknown;
  };
  /** Data the client needs to complete a gateway action (e.g. 3DS). */
  actionData: Record<string, unknown> | null;
}

// ---------------------------------------------------------------------------
// Order (set after EP checkout)
// ---------------------------------------------------------------------------

export interface SessionOrder {
  id: string;
  /** EP transaction ID used for capture. */
  transactionId?: string;
}

// ---------------------------------------------------------------------------
// CheckoutSession — the core model
// ---------------------------------------------------------------------------

export interface CheckoutSession {
  id: string;
  status: CheckoutSessionStatus;
  cartId: string;
  cartHash: string;
  customerInfo: SessionCustomerInfo | null;
  shippingAddress: SessionAddress | null;
  billingAddress: SessionAddress | null;
  selectedShippingRateId: string | null;
  availableShippingRates: SessionShippingRate[];
  totals: SessionTotals | null;
  payment: SessionPayment;
  order: SessionOrder | null;
  expiresAt: number; // epoch ms
}

// ---------------------------------------------------------------------------
// PaymentAdapter — implemented per gateway (Clover, Stripe)
// ---------------------------------------------------------------------------

export type PaymentAdapterResultStatus =
  | "ready"
  | "requires_action"
  | "succeeded"
  | "failed";

export interface PaymentAdapterResult {
  status: PaymentAdapterResultStatus;
  clientToken?: string;
  gatewayMetadata?: Record<string, unknown>;
  gatewayOrderId?: string;
  actionData?: Record<string, unknown>;
  errorMessage?: string;
}

export interface PaymentAdapter {
  initializePayment(
    session: CheckoutSession,
    gatewayData: Record<string, unknown>
  ): Promise<PaymentAdapterResult>;

  confirmPayment(
    session: CheckoutSession,
    confirmData: Record<string, unknown>
  ): Promise<PaymentAdapterResult>;
}

// ---------------------------------------------------------------------------
// SessionStore — persistence layer (cookie, KV, etc.)
// ---------------------------------------------------------------------------

export interface SessionStore {
  get(
    id: string,
    req: SessionRequest
  ): Promise<CheckoutSession | null>;

  set(
    id: string,
    session: CheckoutSession,
    ttl: number,
    req: SessionRequest
  ): Promise<SessionSetResult>;

  delete(
    id: string,
    req: SessionRequest
  ): Promise<SessionSetResult>;
}

/** Result of set/delete — carries Set-Cookie headers for the consumer route. */
export interface SessionSetResult {
  headers: Record<string, string>;
}

// ---------------------------------------------------------------------------
// Framework-agnostic request/response (SG-6)
// ---------------------------------------------------------------------------

export interface SessionRequest {
  body: Record<string, unknown>;
  headers: Record<string, string>;
  cookies: Record<string, string>;
}

export interface SessionResponse {
  status: number;
  body: unknown;
  headers?: Record<string, string>;
}

// ---------------------------------------------------------------------------
// SessionHandlerContext — wired by consumer route files
// ---------------------------------------------------------------------------

export interface EPCredentials {
  clientId: string;
  clientSecret: string;
  apiBaseUrl: string;
}

export interface SessionHandlerContext {
  epCredentials: EPCredentials;
  adapterRegistry: AdapterRegistry;
  sessionStore: SessionStore;
  /** Session TTL in seconds (default 1800 = 30 min). */
  sessionTtlSeconds?: number;
}

// ---------------------------------------------------------------------------
// AdapterRegistry interface (implemented in adapter-registry.ts)
// ---------------------------------------------------------------------------

export interface AdapterRegistry {
  register(name: string, adapter: PaymentAdapter): void;
  getAdapter(name: string): PaymentAdapter | undefined;
}

// ---------------------------------------------------------------------------
// Handler request/response types
// ---------------------------------------------------------------------------

export interface CreateSessionRequest {
  cartId: string;
}

export interface UpdateSessionRequest {
  customerInfo?: SessionCustomerInfo;
  shippingAddress?: SessionAddress;
  billingAddress?: SessionAddress;
  selectedShippingRateId?: string;
}

export interface PayRequest {
  gateway: string;
  [key: string]: unknown;
}

export interface ConfirmRequest {
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// Client-visible session (excludes server-only fields)
// ---------------------------------------------------------------------------

export type ClientCheckoutSession = Omit<
  CheckoutSession,
  "cartHash"
>;
