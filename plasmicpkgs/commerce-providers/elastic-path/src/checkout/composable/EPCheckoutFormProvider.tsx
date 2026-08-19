/**
 * EPCheckoutFormProvider — single-page checkout form collector + order placer.
 *
 * A lightweight alternative to the 4-step EPCheckoutProvider for stores
 * whose checkout is one page (no step orchestration, optionally no
 * shipping). It owns a shared form store that the self-contained field
 * primitives (EPFormField / EPSelectField / EPConsentCheckbox) register
 * into and write to, and a `placeOrder` action that maps the collected
 * values onto an EP order and calls the consumer's `/api/ep/proxy/placeOrder`.
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
import { callEpProxy } from "../../ep-server-functions/proxy-fetch";
import type { EpPlaceOrderResult } from "../../ep-server-functions/place-order";
import { DEFAULT_DEBOUNCE_MS } from "../../const";
import { createLogger } from "../../utils/logger";
import { sessionAddressesEquivalent } from "../session/address-utils";
import type { SessionAddress } from "../session/types";
import {
  SHIPPING_FORM_FIELD_NAMES,
  formHasShippingFields,
  isShippingAddressCompleteEnough,
  mapShippingFormValuesToSessionAddress,
} from "./shipping-form-fields";

const log = createLogger("EPCheckoutFormProvider");

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
  /** Payment gateway override (default "manual" — completes free orders). */
  paymentGateway?: string;
  paymentMethod?: string;
  /**
   * How placeOrder takes payment:
   *   - "auto" (default): drive the checkout session (Stripe / gateway) when
   *     an EPCheckoutSessionProvider is an ancestor; otherwise fall back to
   *     the direct proxy `placeOrder` (manual, no card).
   *   - "session": always drive the session (errors if none is present).
   *   - "proxy": always use the direct proxy placeOrder.
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
}

/** Shape of the `checkoutSession` value EPCheckoutSessionProvider publishes. */
interface SessionBridge {
  session?: {
    status?: string;
    order?: { id?: string } | null;
    totals?: { total?: number } | null;
  } | null;
  updateSession?: (data: Record<string, unknown>) => Promise<unknown>;
  calculateShipping?: () => Promise<unknown>;
  placeOrder?: () => Promise<
    | {
        success?: boolean;
        data?: { session?: SessionBridge["session"] };
        error?: { message?: string };
        paymentError?: string;
      }
    | undefined
  >;
}

interface DebouncedShippingSync {
  (address: SessionAddress): void;
  clear(): void;
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
    paymentGateway,
    paymentMethod,
    paymentMode = "auto",
    requiresShipping = false,
    onPlaced,
    onError,
    confirmationUrl,
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

  // Bridge to an ancestor EPCheckoutSessionProvider, when present. In session
  // mode placeOrder pushes the collected fields into the server session and
  // delegates payment to the registered gateway (Stripe) — keeping the form
  // primitives self-wiring (no designer interactions required).
  const dataEnv = useDataEnv?.();
  const sessionBridge = (dataEnv as any)?.checkoutSession as
    | SessionBridge
    | undefined;
  const useSession =
    paymentMode === "session" ||
    (paymentMode === "auto" && typeof sessionBridge?.placeOrder === "function");

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

  const lastSyncedShippingRef = useRef<SessionAddress | null>(null);
  const shippingSyncRef = useRef<DebouncedShippingSync | null>(null);

  useEffect(() => {
    if (inEditor || !useSession) {
      shippingSyncRef.current = null;
      return;
    }
    const updateSession = sessionBridge?.updateSession;
    const calculateShipping = sessionBridge?.calculateShipping;
    if (!updateSession || !calculateShipping) {
      shippingSyncRef.current = null;
      return;
    }

    shippingSyncRef.current = debounce(async (address: SessionAddress) => {
      if (sessionAddressesEquivalent(address, lastSyncedShippingRef.current)) {
        return;
      }
      try {
        const resp = (await updateSession({ shippingAddress: address })) as
          | { success?: boolean }
          | undefined;
        if (resp && resp.success === false) return;
        await calculateShipping();
        lastSyncedShippingRef.current = address;
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

  useEffect(() => {
    if (inEditor || !useSession) return;
    if (!formHasShippingFields(values, registry.current)) return;
    const address = mapShippingFormValuesToSessionAddress(values);
    if (!isShippingAddressCompleteEnough(address)) return;
    shippingSyncRef.current?.(address);
  }, [inEditor, useSession, values]);

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
  }, []);

  const placeOrder = useCallback(async () => {
    if (inEditor) {
      log.debug("placeOrder is a no-op in the Studio canvas");
      return;
    }
    if (!validateAll()) {
      setStatus("error");
      setError("Please complete the required fields.");
      return;
    }
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

    // --- Session mode: push fields into the checkout session, then let the
    // session's registered gateway (Stripe) take payment. ---
    if (useSession && sessionBridge) {
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
        await sessionBridge.updateSession?.(sessionUpdate);
        const resp = await sessionBridge.placeOrder?.();
        const s = resp?.data?.session;
        if (resp?.success && s?.status === "complete") {
          const oid = s.order?.id ?? "";
          const free = (s.totals?.total ?? 0) === 0;
          setOrderId(oid);
          setIsFree(free);
          setStatus("placed");
          onPlaced?.({ orderId: oid, isFree: free });
          redirectToConfirmation(oid);
        } else {
          throw new Error(
            resp?.error?.message ??
              resp?.paymentError ??
              "Payment did not complete. Please check your details and try again."
          );
        }
      } catch (err) {
        const msg =
          err instanceof Error ? err.message : "Order could not be placed.";
        setError(msg);
        setStatus("error");
        onError?.({ message: msg });
        log.error("session placeOrder failed", { error: msg });
      }
      return;
    }

    // --- Proxy mode: single server call (manual gateway, no card). ---
    const customer = {
      name: `${v[mapping.firstName] ?? ""} ${v[mapping.lastName] ?? ""}`.trim(),
      email: v[mapping.email] ?? "",
    };
    const billingAddress = {
      first_name: v[mapping.firstName] ?? "",
      last_name: v[mapping.lastName] ?? "",
      company_name: v[mapping.company] ?? "",
      line_1: v[mapping.line1] ?? "",
      line_2: v[mapping.line2] ?? "",
      city: v[mapping.city] ?? "",
      county: v[mapping.county] ?? "",
      postcode: v[mapping.postcode] ?? "",
      country: v[mapping.country] ?? "",
    };

    try {
      const result = await callEpProxy<EpPlaceOrderResult | null>("placeOrder", {
        customer,
        billingAddress,
        customAttributes,
        ...(paymentGateway ? { paymentGateway } : {}),
        ...(paymentMethod ? { paymentMethod } : {}),
      });
      if (!result || !result.orderId) {
        throw new Error("Order could not be placed. Please try again.");
      }
      setOrderId(result.orderId);
      setIsFree(result.isFree);
      setStatus("placed");
      onPlaced?.({ orderId: result.orderId, isFree: result.isFree });
      redirectToConfirmation(result.orderId);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Order could not be placed.";
      setError(msg);
      setStatus("error");
      onError?.({ message: msg });
      log.error("placeOrder failed", { error: msg });
    }
  }, [
    inEditor,
    validateAll,
    values,
    booleans,
    mapping,
    useSession,
    sessionBridge,
    requiresShipping,
    paymentGateway,
    paymentMethod,
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
      values,
      booleans,
    }),
    [status, error, orderId, isFree, values, booleans]
  );

  return (
    <CheckoutFormContext.Provider value={ctx}>
      <DataProvider name="checkoutFormData" data={checkoutFormData}>
        <div className={className} data-ep-checkout-form-provider="">
          {children}
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
        options: ["auto", "session", "proxy"],
        defaultValue: "auto",
        displayName: "Payment Mode",
        description:
          'How payment is taken. "auto" drives the checkout session (Stripe / gateway) when an EP Checkout Session Provider is an ancestor, else falls back to the direct manual proxy. "session" forces the session path; "proxy" forces the manual proxy.',
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
        description: 'Proxy mode only — EP payment gateway. Default "manual" (completes free / zero-total orders with no card step).',
        advanced: true,
      },
      paymentMethod: {
        type: "string",
        displayName: "Payment Method",
        description: 'Proxy mode only — EP payment method. Default "purchase".',
        advanced: true,
      },
      confirmationUrl: {
        type: "string",
        displayName: "Confirmation URL",
        description:
          "Redirect here after a successful order (post-purchase confirmation page). Supports an {orderId} placeholder, e.g. /checkout/confirmation?order={orderId}. Leave empty to stay on the page.",
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
