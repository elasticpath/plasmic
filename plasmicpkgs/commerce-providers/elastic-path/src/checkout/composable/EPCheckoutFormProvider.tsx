/**
 * EPCheckoutFormProvider — single-page checkout form collector + order placer.
 *
 * A lightweight alternative to the 4-step EPCheckoutProvider for stores
 * whose checkout is one page (no step orchestration, optionally no
 * shipping). It owns a shared form store that the self-contained field
 * primitives (EPFormField / EPSelectField / EPConsentCheckbox) register
 * into and write to, and a `placeOrder` action that pushes the collected
 * values into the checkout session of an ancestor EP Checkout Session
 * Provider and pays through it. Without one it shows a setup error.
 *
 * Why self-contained primitives + a context (rather than headless
 * providers wired by Plasmic interactions): the primitives glue themselves
 * together through this React context, so a designer only drops them in —
 * no per-field onChange interaction wiring is required.
 *
 * Field-name convention (reserved names map to the order; everything else
 * becomes cart custom attributes):
 *   firstName, lastName        → customer.name + billing first/last name
 *   email                      → customer.email
 *   company                    → billing.company_name
 *   address                    → billing.line_1
 *   line2                      → billing.line_2
 *   city                       → billing.city
 *   county                     → billing.county
 *   postal                     → billing.postcode
 *   country                    → billing.country
 *   shippingFirstName          → session.shippingAddress.firstName
 *   shippingLastName           → session.shippingAddress.lastName
 *   shippingCompany            → session.shippingAddress.company
 *   shippingAddress            → session.shippingAddress.line1
 *   shippingLine2              → session.shippingAddress.line2
 *   shippingCity               → session.shippingAddress.city
 *   shippingCounty             → session.shippingAddress.county
 *   shippingPostal             → session.shippingAddress.postcode
 *   shippingCountry            → session.shippingAddress.country
 *   <any other field / checkbox> → cart custom_attributes
 * Override the billing mapping with the `fieldMapping` prop. Shipping names
 * are fixed (not overridable) so they stay reserved.
 *
 * Provides `checkoutFormData` for designer binding and exposes
 * `placeOrder` / `validate` / `reset` refActions.
 */
import {
  DataProvider,
  useDataEnv,
  usePlasmicCanvasContext,
} from "@plasmicapp/host";
import registerComponent, {
  CodeComponentMeta,
} from "@plasmicapp/host/registerComponent";
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import debounce from "debounce";
import { Registerable } from "../../registerable";
import { DEFAULT_DEBOUNCE_MS } from "../../const";
import { createLogger } from "../../utils/logger";
import { sessionAddressesEquivalent } from "../session/address-utils";
import type { SessionAddress } from "../session/types";
import {
  SHIPPING_FORM_FIELD_NAMES,
  SHIPPING_FORM_TO_SESSION,
  formHasShippingFields,
  isShippingAddressCompleteEnough,
  mapShippingFormValuesToSessionAddress,
} from "./shipping-form-fields";

const log = createLogger("EPCheckoutFormProvider");

const SETUP_ERROR =
  'EP Checkout Form Provider places orders through an EP Checkout Session Provider. Put this form inside an EP Checkout Session Provider and set Payment Mode to "auto" or "session".';

class CheckoutRefusal extends Error {
  constructor(message: string, readonly code: string | undefined) {
    super(message);
  }
}

// ---------------------------------------------------------------------------
// Field-name → order mapping
// ---------------------------------------------------------------------------
export interface CheckoutFieldMapping {
  firstName: string;
  lastName: string;
  email: string;
  company: string;
  line1: string;
  line2: string;
  city: string;
  county: string;
  postcode: string;
  country: string;
}

const DEFAULT_MAPPING: CheckoutFieldMapping = {
  firstName: "firstName",
  lastName: "lastName",
  email: "email",
  company: "company",
  line1: "address",
  line2: "line2",
  city: "city",
  county: "county",
  postcode: "postal",
  country: "country",
};

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------
type FieldKind = "text" | "select" | "checkbox";

interface FieldRegistration {
  required: boolean;
  kind: FieldKind;
}

export interface CheckoutFormContextValue {
  values: Record<string, string>;
  booleans: Record<string, boolean>;
  errors: Record<string, string | null>;
  status: "idle" | "placing" | "placed" | "error";
  error: string | null;
  orderId: string | null;
  isFree: boolean;
  /**
   * True while the session's card check (3DS) is open: its order is already
   * held, so field edits cannot change it. Fields show read-only.
   */
  locked: boolean;
  setField(name: string, value: string): void;
  setBoolean(name: string, checked: boolean): void;
  registerField(
    name: string,
    opts: { required?: boolean; kind?: FieldKind; initialValue?: string; initialChecked?: boolean }
  ): void;
  unregisterField(name: string): void;
  validateAll(): boolean;
  placeOrder(): Promise<void>;
  reset(): void;
}

const NOOP_CTX: CheckoutFormContextValue = {
  values: {},
  booleans: {},
  errors: {},
  status: "idle",
  error: null,
  orderId: null,
  isFree: false,
  locked: false,
  setField: () => {},
  setBoolean: () => {},
  registerField: () => {},
  unregisterField: () => {},
  validateAll: () => true,
  placeOrder: async () => {},
  reset: () => {},
};

export const CheckoutFormContext =
  createContext<CheckoutFormContextValue>(NOOP_CTX);

/** Field primitives call this to read + write the shared checkout form. */
export function useCheckoutForm(): CheckoutFormContextValue {
  return useContext(CheckoutFormContext);
}

// ---------------------------------------------------------------------------
// Props / actions
// ---------------------------------------------------------------------------
interface EPCheckoutFormProviderActions {
  placeOrder(): Promise<void>;
  validate(): boolean;
  reset(): void;
}

interface EPCheckoutFormProviderProps {
  children?: React.ReactNode;
  className?: string;
  fieldMapping?: Partial<CheckoutFieldMapping>;
  /** Unused. Kept so saved pages still load. */
  paymentGateway?: string;
  /** Unused. Kept so saved pages still load. */
  paymentMethod?: string;
  /**
   * "auto" and "session" both pay through the ancestor EP Checkout Session
   * Provider. "proxy" is no longer offered; a page that stored it shows the
   * setup error.
   */
  paymentMode?: "auto" | "session" | "proxy";
  /**
   * Whether this checkout collects shipping. Default false — this single-page
   * form collects no shipping fields. Forwarded to the session so /pay doesn't
   * require a shipping address for digital / shipping-less orders.
   */
  requiresShipping?: boolean;
  /** Fired after a successful order. */
  onPlaced?: (data: { orderId: string; isFree: boolean }) => void;
  onError?: (data: { message: string }) => void;
  /**
   * Optional URL to navigate to after a successful order — the standard
   * post-purchase confirmation-page redirect. Supports an `{orderId}`
   * placeholder (e.g. `/checkout/confirmation?order={orderId}`). Left empty,
   * the form stays on the page (consumers can instead bind `onPlaced` /
   * `checkoutFormData`). A full-page navigation is used so it works in any host
   * without a router dependency.
   */
  confirmationUrl?: string;
  /**
   * Show why the order could not be placed (or checkout could not start)
   * below the form. Default true.
   */
  showError?: boolean;
}

/** Shown while a card check (3DS) is open and the form cannot change. */
const LOCKED_MESSAGE =
  "Your card check is still open. Place the order to finish or cancel it; changes to these details are not saved until then.";

interface SessionBridge {
  session?: {
    id?: string;
    status?: string;
    order?: { id?: string } | null;
    totals?: { total?: number } | null;
    payment?: { status?: string; gateway?: string | null } | null;
    customerInfo?: { name?: string; email?: string } | null;
    billingAddress?: Partial<SessionAddress> | null;
    shippingAddress?: Partial<SessionAddress> | null;
    customAttributes?: Record<string, string | number | boolean> | null;
  } | null;
  /** Why checkout could not start (with `errorCode`), else a session read error. */
  error?: string | null;
  errorCode?: string | null;
  updateSession?: (data: Record<string, unknown>) => Promise<unknown>;
  calculateShipping?: () => Promise<unknown>;
  placeOrder?: () => Promise<
    | {
        success?: boolean;
        data?: { session?: SessionBridge["session"] };
        error?: { message?: string; code?: string };
        paymentError?: string;
      }
    | undefined
  >;
}

/** The form values a session already holds: what the order it holds was placed with. */
function savedFormValues(
  session: NonNullable<SessionBridge["session"]>,
  mapping: CheckoutFieldMapping
): { values: Record<string, string>; booleans: Record<string, boolean> } {
  const values: Record<string, string> = {};
  const booleans: Record<string, boolean> = {};
  const put = (name: string, value: unknown) => {
    if (typeof value === "string" && value !== "") values[name] = value;
  };
  const billing = session.billingAddress ?? {};
  (Object.keys(mapping) as Array<keyof CheckoutFieldMapping>).forEach((key) => {
    if (key !== "email") put(mapping[key], (billing as Record<string, unknown>)[key]);
  });
  put(mapping.email, session.customerInfo?.email);
  const shipping = session.shippingAddress ?? {};
  SHIPPING_FORM_FIELD_NAMES.forEach((name) =>
    put(name, (shipping as Record<string, unknown>)[SHIPPING_FORM_TO_SESSION[name]])
  );
  Object.entries(session.customAttributes ?? {}).forEach(([name, value]) => {
    if (typeof value === "boolean") booleans[name] = value;
    else put(name, String(value));
  });
  return { values, booleans };
}

interface DebouncedShippingSync {
  (address: SessionAddress, sessionId: string): void;
  clear(): void;
}

interface SyncedShipping {
  sessionId: string;
  address: SessionAddress;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
export const EPCheckoutFormProvider = React.forwardRef<
  EPCheckoutFormProviderActions,
  EPCheckoutFormProviderProps
>(function EPCheckoutFormProvider(props, ref) {
  const {
    children,
    className,
    fieldMapping,
    paymentMode = "auto",
    requiresShipping = false,
    onPlaced,
    onError,
    confirmationUrl,
    showError = true,
  } = props;

  // Standard post-purchase redirect. Full-page nav (no router dependency) so it
  // works in any host; substitutes the {orderId} placeholder.
  const redirectToConfirmation = useCallback(
    (oid: string) => {
      if (!confirmationUrl) return;
      const url = confirmationUrl.replace("{orderId}", encodeURIComponent(oid));
      if (typeof window !== "undefined") window.location.assign(url);
    },
    [confirmationUrl]
  );

  const inEditor = !!usePlasmicCanvasContext();

  // Bridge to an ancestor EPCheckoutSessionProvider. placeOrder pushes the
  // collected fields into the server session and delegates payment to the
  // registered gateway — keeping the form primitives self-wiring (no designer
  // interactions required).
  const dataEnv = useDataEnv?.();
  const sessionBridge = (dataEnv as any)?.checkoutSession as
    | SessionBridge
    | undefined;
  const setupError =
    paymentMode === "proxy" || typeof sessionBridge?.placeOrder !== "function"
      ? SETUP_ERROR
      : null;
  const useSession = setupError === null;
  // An open card check holds the order: edits cannot apply until it ends.
  const locked =
    useSession && sessionBridge?.session?.payment?.status === "requires_action";
  const openSessionId =
    useSession && sessionBridge?.session?.status === "open"
      ? sessionBridge.session.id ?? "open"
      : null;

  const mapping = useMemo<CheckoutFieldMapping>(
    () => ({ ...DEFAULT_MAPPING, ...(fieldMapping ?? {}) }),
    [fieldMapping]
  );

  const [values, setValues] = useState<Record<string, string>>({});
  const [booleans, setBooleans] = useState<Record<string, boolean>>({});
  const [errors, setErrors] = useState<Record<string, string | null>>({});
  const [status, setStatus] = useState<
    "idle" | "placing" | "placed" | "error"
  >("idle");
  const [error, setError] = useState<string | null>(null);
  const [orderId, setOrderId] = useState<string | null>(null);
  const [isFree, setIsFree] = useState(false);
  const placingRef = useRef(false);
  // A Place refused because no checkout session was open: the message goes
  // once a session opens.
  const noSessionErrorRef = useRef<string | null>(null);

  // Registry of mounted fields — drives generic required-validation. Held in
  // a ref so registration doesn't churn render; values/booleans live in state.
  const registry = useRef<Map<string, FieldRegistration>>(new Map());

  const registerField = useCallback(
    (
      name: string,
      opts: {
        required?: boolean;
        kind?: FieldKind;
        initialValue?: string;
        initialChecked?: boolean;
      }
    ) => {
      registry.current.set(name, {
        required: !!opts.required,
        kind: opts.kind ?? "text",
      });
      if (opts.initialValue !== undefined) {
        setValues((prev) =>
          prev[name] === undefined ? { ...prev, [name]: opts.initialValue! } : prev
        );
      }
      if (opts.initialChecked !== undefined) {
        setBooleans((prev) =>
          prev[name] === undefined
            ? { ...prev, [name]: opts.initialChecked! }
            : prev
        );
      }
    },
    []
  );

  const unregisterField = useCallback((name: string) => {
    registry.current.delete(name);
  }, []);

  const setField = useCallback((name: string, value: string) => {
    setValues((prev) => ({ ...prev, [name]: value }));
    setErrors((prev) => (prev[name] ? { ...prev, [name]: null } : prev));
  }, []);

  const setBoolean = useCallback((name: string, checked: boolean) => {
    setBooleans((prev) => ({ ...prev, [name]: checked }));
    setErrors((prev) => (prev[name] ? { ...prev, [name]: null } : prev));
  }, []);

  const lastSyncedShippingRef = useRef<SyncedShipping | null>(null);
  const shippingSyncRef = useRef<DebouncedShippingSync | null>(null);

  // A locked form shows what its held order was placed with, also after a
  // reload, when nothing typed is left in the page.
  const savedSession = locked ? sessionBridge?.session : null;
  useEffect(() => {
    if (!savedSession) return;
    const saved = savedFormValues(savedSession, mapping);
    setValues((prev) => ({ ...prev, ...saved.values }));
    setBooleans((prev) => ({ ...prev, ...saved.booleans }));
    if (savedSession.shippingAddress) {
      lastSyncedShippingRef.current = {
        sessionId: savedSession.id ?? "open",
        address: mapShippingFormValuesToSessionAddress(saved.values),
      };
    }
  }, [savedSession, mapping]);

  useEffect(() => {
    if (inEditor || !useSession) {
      shippingSyncRef.current = null;
      return;
    }
    const updateSession = sessionBridge?.updateSession;
    const calculateShipping = sessionBridge?.calculateShipping;
    if (!updateSession) {
      shippingSyncRef.current = null;
      return;
    }

    shippingSyncRef.current = debounce(async (address: SessionAddress, sessionId: string) => {
      const last = lastSyncedShippingRef.current;
      if (
        last?.sessionId === sessionId &&
        sessionAddressesEquivalent(address, last.address)
      ) {
        return;
      }
      try {
        const resp = (await updateSession({ shippingAddress: address })) as
          | {
              success?: boolean;
              data?: { session?: { availableShippingRates?: unknown[] } };
            }
          | undefined;
        if (resp && resp.success === false) return;
        // An older server clears the rates on an address change without
        // requoting, so ask for them once.
        const rates = resp?.data?.session?.availableShippingRates;
        if (Array.isArray(rates) && rates.length === 0 && calculateShipping) {
          await calculateShipping();
        }
        lastSyncedShippingRef.current = { sessionId, address };
      } catch (err) {
        log.warn("Shipping address sync failed", {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }, DEFAULT_DEBOUNCE_MS) as DebouncedShippingSync;

    return () => {
      shippingSyncRef.current?.clear();
    };
  }, [
    inEditor,
    useSession,
    sessionBridge?.updateSession,
    sessionBridge?.calculateShipping,
  ]);

  // Also when a session opens: an address typed before it (no cart yet) gets
  // its shipping rates without waiting for Place.
  useEffect(() => {
    if (inEditor || !openSessionId) return;
    if (!formHasShippingFields(values, registry.current)) return;
    const address = mapShippingFormValuesToSessionAddress(values);
    if (!isShippingAddressCompleteEnough(address)) return;
    shippingSyncRef.current?.(address, openSessionId);
  }, [inEditor, openSessionId, values]);

  const validateAll = useCallback((): boolean => {
    const nextErrors: Record<string, string | null> = {};
    let valid = true;
    registry.current.forEach((reg, name) => {
      if (!reg.required) return;
      const missing =
        reg.kind === "checkbox"
          ? !booleans[name]
          : !(values[name] ?? "").trim();
      if (missing) {
        valid = false;
        nextErrors[name] =
          reg.kind === "checkbox" ? "Required" : "This field is required";
      }
    });
    setErrors(nextErrors);
    return valid;
  }, [values, booleans]);

  const reset = useCallback(() => {
    setValues({});
    setBooleans({});
    setErrors({});
    setStatus("idle");
    setError(null);
    setOrderId(null);
    setIsFree(false);
    placingRef.current = false;
  }, []);

  const hasSession = !!sessionBridge?.session;
  const failed = useCallback(
    (err: unknown) => {
      const msg = err instanceof Error ? err.message : "Order could not be placed.";
      noSessionErrorRef.current = hasSession ? null : msg;
      if (err instanceof CheckoutRefusal && err.code === "INVALID_EMAIL") {
        setErrors((prev) => ({ ...prev, [mapping.email]: msg }));
      }
      setError(msg);
      setStatus("error");
      onError?.({ message: msg });
      log.error("session placeOrder failed", { error: msg });
    },
    [onError, hasSession, mapping.email]
  );

  useEffect(() => {
    if (!openSessionId || status !== "error") return;
    if (error === null || error !== noSessionErrorRef.current) return;
    noSessionErrorRef.current = null;
    setError(null);
    setStatus("idle");
  }, [openSessionId, status, error]);

  // Session provider.placeOrder awaits Stripe 3DS (handleNextAction +
  // resumePayment) when /pay returns requires_action, so a successful return
  // here is a completed session — not an intermediate open one.
  const takePayment = useCallback(async () => {
    const resp = await sessionBridge?.placeOrder?.();
    const s = resp?.data?.session;
    if (resp?.success && s?.status === "complete") {
      const oid = s.order?.id ?? "";
      const free = (s.totals?.total ?? 0) === 0;
      setOrderId(oid);
      setIsFree(free);
      setStatus("placed");
      onPlaced?.({ orderId: oid, isFree: free });
      redirectToConfirmation(oid);
      return;
    }
    throw new CheckoutRefusal(
      resp?.error?.message ??
        resp?.paymentError ??
        "Payment did not complete. Please check your details and try again.",
      resp?.error?.code
    );
  }, [sessionBridge, onPlaced, redirectToConfirmation]);

  // The order is already held for the open card check: finish (or cancel)
  // that check. Nothing typed into the locked form is sent.
  const finishOpenCardCheck = useCallback(async () => {
    if (placingRef.current) return;
    placingRef.current = true;
    setStatus("placing");
    setError(null);
    try {
      await takePayment();
    } catch (err) {
      failed(err);
    } finally {
      placingRef.current = false;
    }
  }, [takePayment, failed]);

  const placeOrder = useCallback(async () => {
    if (inEditor) {
      log.debug("placeOrder is a no-op in the Studio canvas");
      return;
    }
    if (setupError || !sessionBridge) {
      const message = setupError ?? SETUP_ERROR;
      setStatus("error");
      setError(message);
      onError?.({ message });
      log.error(message);
      return;
    }
    if (locked) {
      await finishOpenCardCheck();
      return;
    }
    if (!validateAll()) {
      setStatus("error");
      setError("Please complete the required fields.");
      return;
    }
    if (placingRef.current) return;
    placingRef.current = true;
    setStatus("placing");
    setError(null);

    const v = values;

    // Everything that isn't a reserved order field becomes a cart custom
    // attribute (extra profile fields + consent flags). Shipping* names are
    // reserved so they map to session.shippingAddress, not custom attributes.
    const reserved = new Set<string>([
      ...Object.values(mapping),
      ...SHIPPING_FORM_FIELD_NAMES,
    ]);
    const customAttributes: Record<string, string | boolean> = {};
    for (const [name, value] of Object.entries(v)) {
      if (reserved.has(name)) continue;
      if (value !== "") customAttributes[name] = value;
    }
    for (const [name, checked] of Object.entries(booleans)) {
      customAttributes[name] = checked;
    }

    // Push fields into the checkout session, then let the session's
    // registered gateway take payment.
    shippingSyncRef.current?.clear();
    const customerInfo = {
      name: `${v[mapping.firstName] ?? ""} ${v[mapping.lastName] ?? ""}`.trim(),
      email: v[mapping.email] ?? "",
    };
    const sessionBilling = {
      firstName: v[mapping.firstName] ?? "",
      lastName: v[mapping.lastName] ?? "",
      company: v[mapping.company] ?? "",
      line1: v[mapping.line1] ?? "",
      line2: v[mapping.line2] ?? "",
      city: v[mapping.city] ?? "",
      county: v[mapping.county] ?? "",
      country: v[mapping.country] ?? "",
      postcode: v[mapping.postcode] ?? "",
    };
    const sessionUpdate: Record<string, unknown> = {
      customerInfo,
      billingAddress: sessionBilling,
      requiresShipping,
      customAttributes,
    };
    if (formHasShippingFields(v, registry.current)) {
      sessionUpdate.shippingAddress =
        mapShippingFormValuesToSessionAddress(v);
    }
    try {
      // A refused update (such as an open card check) must stop the order:
      // the order would not carry what the shopper just entered.
      const updated = (await sessionBridge.updateSession?.(sessionUpdate)) as
        | { success?: boolean; error?: { message?: string; code?: string } }
        | undefined;
      if (updated && updated.success === false) {
        throw new CheckoutRefusal(
          updated.error?.message ?? "Your details could not be saved. Please try again.",
          updated.error?.code
        );
      }
      await takePayment();
    } catch (err) {
      failed(err);
    } finally {
      placingRef.current = false;
    }
  }, [
    locked,
    finishOpenCardCheck,
    takePayment,
    failed,
    inEditor,
    validateAll,
    values,
    booleans,
    mapping,
    setupError,
    sessionBridge,
    requiresShipping,
    onPlaced,
    onError,
    redirectToConfirmation,
  ]);

  useImperativeHandle(
    ref,
    () => ({ placeOrder, validate: validateAll, reset }),
    [placeOrder, validateAll, reset]
  );

  const ctx = useMemo<CheckoutFormContextValue>(
    () => ({
      values,
      booleans,
      errors,
      status,
      error,
      orderId,
      isFree,
      locked,
      setField,
      setBoolean,
      registerField,
      unregisterField,
      validateAll,
      placeOrder,
      reset,
    }),
    [
      values,
      booleans,
      errors,
      status,
      error,
      orderId,
      isFree,
      locked,
      setField,
      setBoolean,
      registerField,
      unregisterField,
      validateAll,
      placeOrder,
      reset,
    ]
  );

  const checkoutFormData = useMemo(
    () => ({
      status,
      error,
      orderId,
      isFree,
      isPlacing: status === "placing",
      isPlaced: status === "placed",
      isLocked: locked,
      lockedMessage: locked ? LOCKED_MESSAGE : null,
      values,
      booleans,
    }),
    [status, error, orderId, isFree, locked, values, booleans]
  );

  const shownError =
    (status === "error" && error !== setupError ? error : null) ??
    (useSession && sessionBridge?.errorCode ? sessionBridge.error : null) ??
    null;

  return (
    <CheckoutFormContext.Provider value={ctx}>
      <DataProvider name="checkoutFormData" data={checkoutFormData}>
        <div className={className} data-ep-checkout-form-provider="">
          {setupError ? (
            <div role="alert" data-ep-checkout-setup-error="">
              {setupError}
            </div>
          ) : null}
          {locked ? (
            <div role="status" data-ep-checkout-locked="">
              {LOCKED_MESSAGE}
            </div>
          ) : null}
          {children}
          {showError && shownError ? (
            <div role="alert" data-ep-checkout-error="">
              {shownError}
            </div>
          ) : null}
        </div>
      </DataProvider>
    </CheckoutFormContext.Provider>
  );
});

// ---------------------------------------------------------------------------
// Registration metadata
// ---------------------------------------------------------------------------
export const epCheckoutFormProviderMeta: CodeComponentMeta<EPCheckoutFormProviderProps> =
  {
    name: "plasmic-commerce-ep-checkout-form-provider",
    displayName: "EP Checkout Form Provider",
    description:
      "Single-page checkout form collector + order placer. Wrap the form fields (EP Form Field / Select Field / Consent Checkbox), EP Checkout Shipping Rates, and the EP Place Order Button. Reserved field names (firstName, lastName, email, company, address, line2, city, county, postal, country, shippingFirstName, shippingLastName, shippingCompany, shippingAddress, shippingLine2, shippingCity, shippingCounty, shippingPostal, shippingCountry) map to the order / session; all other fields and checkboxes are saved as cart custom attributes.",
    props: {
      children: {
        type: "slot",
        defaultValue: [
          { type: "text", value: "Place the EP checkout fields and EP Place Order Button here." },
        ],
      },
      fieldMapping: {
        type: "object",
        displayName: "Field Mapping",
        description:
          "Override which field names map to the order (keys: firstName, lastName, email, company, line1, line2, city, county, postcode, country).",
        advanced: true,
      },
      paymentMode: {
        type: "choice",
        options: ["auto", "session"],
        defaultValue: "auto",
        displayName: "Payment Mode",
        description:
          "Orders are placed through the EP Checkout Session Provider above this form. Without one, the form shows a setup error.",
        advanced: true,
      },
      requiresShipping: {
        type: "boolean",
        defaultValue: false,
        displayName: "Requires Shipping",
        description:
          "Whether this checkout collects a shipping address. Default false (single-page / digital). Forwarded to the session so /pay doesn't require shipping.",
        advanced: true,
      },
      paymentGateway: {
        type: "string",
        displayName: "Payment Gateway",
        description:
          "Deprecated — ignored. The payment component inside the EP Checkout Session Provider selects the gateway.",
        advanced: true,
        hidden: () => true,
      },
      paymentMethod: {
        type: "string",
        displayName: "Payment Method",
        description:
          "Deprecated — ignored. The payment component inside the EP Checkout Session Provider selects the gateway.",
        advanced: true,
        hidden: () => true,
      },
      confirmationUrl: {
        type: "string",
        displayName: "Confirmation URL",
        description:
          "Redirect here after a successful order (post-purchase confirmation page). Supports an {orderId} placeholder, e.g. /checkout/confirmation?order={orderId}. Leave empty to stay on the page.",
      },
      showError: {
        type: "boolean",
        defaultValue: true,
        displayName: "Show Errors",
        description:
          "Show below the form why the order could not be placed (for example a declined card or a failed card check) or why checkout could not start (for example an empty cart). Turn off when the page shows $ctx.checkoutFormData.error itself.",
      },
      onPlaced: {
        type: "eventHandler",
        displayName: "On Order Placed",
        argTypes: [{ name: "data", type: "object" }],
      },
      onError: {
        type: "eventHandler",
        displayName: "On Error",
        argTypes: [{ name: "data", type: "object" }],
      },
    },
    importPath: "@elasticpath/plasmic-ep-commerce-elastic-path",
    importName: "EPCheckoutFormProvider",
    providesData: true,
    refActions: {
      placeOrder: { displayName: "Place Order", argTypes: [] },
      validate: { displayName: "Validate", argTypes: [] },
      reset: { displayName: "Reset", argTypes: [] },
    },
  };

export function registerEPCheckoutFormProvider(
  loader?: Registerable,
  customMeta?: CodeComponentMeta<EPCheckoutFormProviderProps>
) {
  const doRegisterComponent: typeof registerComponent = (...args) =>
    loader ? loader.registerComponent(...args) : registerComponent(...args);
  doRegisterComponent(
    EPCheckoutFormProvider,
    customMeta ?? epCheckoutFormProviderMeta
  );
}
