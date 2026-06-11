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
  /** Optional company / organization name (maps to EP `company_name`). */
  company?: string;
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
  /**
   * Whether this checkout collects a shipping address + rate. Defaults to
   * `true` (the multi-step shipping flow). Single-page / digital checkouts
   * (e.g. downloadable products) set this `false`: the /pay handler then
   * neither requires `shippingAddress`/`selectedShippingRateId` nor a
   * shipping step, and the checkout body defaults shipping to billing.
   */
  requiresShipping?: boolean;
  /**
   * Arbitrary extra checkout fields and consent flags collected by the
   * store's form (e.g. industry, VAT number, marketing opt-in). Persisted
   * to the cart's `custom_attributes` immediately before `checkoutApi` so
   * they travel with the order context. Reserved order fields
   * (customer/billing/shipping) are NOT carried here.
   */
  customAttributes?: Record<string, string | number | boolean>;
  expiresAt: number; // epoch ms
}

/**
 * Allow-list of customAttribute keys a checkout may accept from the client.
 * Either an explicit list of permitted keys, or the `"*"` sentinel to accept
 * any key. Omitting it entirely fails closed (no custom attributes persist) —
 * permissive behaviour must be opted into deliberately via `"*"`. See
 * `filterAllowedCustomAttributes`.
 */
export type CustomAttributeAllowList = readonly string[] | "*";

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
  apiBaseUrl: string;
}

export interface SessionHandlerContext {
  epCredentials: EPCredentials;
  adapterRegistry: AdapterRegistry;
  sessionStore: SessionStore;
  /** Session TTL in seconds (default 1800 = 30 min). */
  sessionTtlSeconds?: number;
  /**
   * Shopper-scoped access token for read operations. Resolved per-request
   * by the host app's checkout-context factory from the better-auth session.
   */
  shopperAccessToken?: string;
  /**
   * Request-scoped admin token resolver for EP operations that require
   * `client_credentials` grant (createCartPaymentIntent, checkoutApi,
   * confirmOrder, cart cleanup). Memoized within the request via closure.
   * Never cached across requests.
   */
  getClientCredentialsToken?: () => Promise<string>;
  /**
   * Server-side allow-list of customAttribute keys this checkout may accept
   * from the client (the non-reserved form fields + consent flags). EP
   * persists any order-flow slug its flow defines, so without this gate a
   * client could forge/overwrite ANY defined slug — including consent/audit
   * fields the form never exposes — simply by sending it.
   *
   * Fail closed: when omitted, NO custom attributes are persisted. A consumer
   * that intends to accept arbitrary keys must opt in explicitly with the
   * `"*"` sentinel, so permissive behaviour is a deliberate, greppable choice.
   * Reserved customer/billing/shipping fields travel a separate path and are
   * unaffected.
   */
  allowedCustomAttributeKeys?: CustomAttributeAllowList;
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
  /** Optional — see CheckoutSession.requiresShipping. Defaults to true. */
  requiresShipping?: boolean;
}

export interface UpdateSessionRequest {
  customerInfo?: SessionCustomerInfo;
  shippingAddress?: SessionAddress;
  billingAddress?: SessionAddress;
  selectedShippingRateId?: string;
  requiresShipping?: boolean;
  customAttributes?: Record<string, string | number | boolean>;
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
