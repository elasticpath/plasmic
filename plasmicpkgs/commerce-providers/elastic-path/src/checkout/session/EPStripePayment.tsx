/**
 * EPStripePayment — Plasmic component for Stripe payments within the
 * checkout session model.
 *
 * WHY: Enables Plasmic designers to add Stripe payment fields by dropping this
 * component inside EPCheckoutSessionProvider. Handles SDK lazy-loading,
 * Stripe Elements initialization, and client-side payment confirmation.
 * 3DS is handled entirely by Stripe's SDK (no manual 3DS code).
 *
 * Architecture:
 * - Lazy-loads @stripe/stripe-js and @stripe/react-stripe-js
 * - Self-registers gateway "stripe" with EPCheckoutSessionProvider via
 *   PaymentRegistrationContext (confirm handler returns {} since Stripe
 *   doesn't need client-side tokenization before PaymentIntent creation)
 * - Reads session.payment.clientToken after /pay returns a PaymentIntent
 * - Renders Stripe Elements + PaymentElement when clientToken is available
 * - Exposes submitPayment() refAction for client-side stripe.confirmPayment()
 * - After Stripe confirms, calls /confirm via useCheckoutSession hook
 * - DataProvider "stripePaymentData" for UI state binding
 */
import {
  DataProvider,
  usePlasmicCanvasContext,
} from "@plasmicapp/host";
import registerComponent, {
  ComponentMeta,
} from "@plasmicapp/host/registerComponent";
import React, {
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import type { Registerable } from "../../registerable";
import { createLogger } from "../../utils/logger";
import { usePaymentRegistration } from "./payment-registration-context";
import { useCheckoutSession } from "./use-checkout-session";

const log = createLogger("EPStripePayment");

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface EPStripePaymentProps {
  children?: React.ReactNode;
  publishableKey: string;
  appearance?: Record<string, any>;
  layout?: "tabs" | "accordion";
  className?: string;
  previewState?: "auto" | "ready" | "processing" | "error";
  apiBaseUrl?: string;
}

// ---------------------------------------------------------------------------
// Mock payment form for design-time
// ---------------------------------------------------------------------------

function MockStripePaymentForm({ className }: { className?: string }) {
  return (
    <div
      className={className}
      data-ep-stripe-payment=""
      style={{
        border: "1px solid #e0e0e0",
        borderRadius: "8px",
        padding: "16px",
        background: "#fafafa",
      }}
    >
      <div style={{ marginBottom: "12px" }}>
        <div
          style={{ fontSize: "12px", color: "#666", marginBottom: "4px" }}
        >
          Card number
        </div>
        <div
          style={{
            height: "40px",
            background: "#fff",
            border: "1px solid #d0d0d0",
            borderRadius: "6px",
          }}
        />
      </div>
      <div style={{ display: "flex", gap: "12px" }}>
        <div style={{ flex: 1 }}>
          <div
            style={{ fontSize: "12px", color: "#666", marginBottom: "4px" }}
          >
            MM / YY
          </div>
          <div
            style={{
              height: "40px",
              background: "#fff",
              border: "1px solid #d0d0d0",
              borderRadius: "6px",
            }}
          />
        </div>
        <div style={{ flex: 1 }}>
          <div
            style={{ fontSize: "12px", color: "#666", marginBottom: "4px" }}
          >
            CVC
          </div>
          <div
            style={{
              height: "40px",
              background: "#fff",
              border: "1px solid #d0d0d0",
              borderRadius: "6px",
            }}
          />
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Mock data for design-time
// ---------------------------------------------------------------------------

const MOCK_DATA: Record<string, any> = {
  ready: {
    isReady: true,
    isProcessing: false,
    error: null,
    paymentMethodType: "card",
  },
  processing: {
    isReady: true,
    isProcessing: true,
    error: null,
    paymentMethodType: "card",
  },
  error: {
    isReady: true,
    isProcessing: false,
    error: "Your card was declined. Please try a different card.",
    paymentMethodType: "card",
  },
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const EPStripePayment = React.forwardRef<
  any,
  EPStripePaymentProps
>(function EPStripePayment(props, ref) {
  const {
    children,
    publishableKey,
    appearance = {},
    layout = "tabs",
    className,
    previewState = "auto",
    apiBaseUrl = "/api",
  } = props;

  const inEditor = usePlasmicCanvasContext();

  // ── Design-time preview ─────────────────────────────────────────────
  if (inEditor && previewState !== "auto") {
    const mockData = MOCK_DATA[previewState] ?? MOCK_DATA.ready;
    return (
      <div className={className}>
        <DataProvider name="stripePaymentData" data={mockData}>
          <MockStripePaymentForm />
          {children}
        </DataProvider>
      </div>
    );
  }

  if (inEditor) {
    const autoData = {
      isReady: true,
      isProcessing: false,
      error: null,
      paymentMethodType: "card",
    };
    return (
      <div className={className}>
        <DataProvider name="stripePaymentData" data={autoData}>
          <MockStripePaymentForm />
          {children}
        </DataProvider>
      </div>
    );
  }

  return (
    <EPStripePaymentRuntime
      ref={ref}
      publishableKey={publishableKey}
      appearance={appearance}
      layout={layout}
      className={className}
      apiBaseUrl={apiBaseUrl}
    >
      {children}
    </EPStripePaymentRuntime>
  );
});

// ---------------------------------------------------------------------------
// Runtime component (hooks must be unconditional)
// ---------------------------------------------------------------------------

const EPStripePaymentRuntime = React.forwardRef<
  any,
  {
    publishableKey: string;
    appearance: Record<string, any>;
    layout: string;
    className?: string;
    apiBaseUrl: string;
    children?: React.ReactNode;
  }
>(function EPStripePaymentRuntime(props, ref) {
  const { publishableKey, appearance, layout, className, apiBaseUrl, children } =
    props;

  const paymentReg = usePaymentRegistration();
  const { session, confirmPayment: hookConfirmPayment } =
    useCheckoutSession(apiBaseUrl);

  const [isReady, setIsReady] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [paymentMethodType, setPaymentMethodType] = useState("card");

  // Stripe instances loaded lazily
  const [stripeInstance, setStripeInstance] = useState<any>(null);
  const [StripeComponents, setStripeComponents] = useState<{
    Elements: any;
    PaymentElement: any;
  } | null>(null);

  // Elements instance captured from inside <Elements> provider
  const elementsRef = useRef<any>(null);
  const mountedRef = useRef(true);

  // Client secret from session
  const clientSecret = session?.payment?.clientToken ?? null;

  // ── Lazy-load Stripe SDK ──────────────────────────────────────────────
  useEffect(() => {
    mountedRef.current = true;
    let cancelled = false;

    if (!publishableKey) {
      setError("Stripe publishable key is required");
      return;
    }

    Promise.all([
      import("@stripe/stripe-js").then((m) => m.loadStripe),
      import("@stripe/react-stripe-js"),
    ])
      .then(([loadStripe, reactStripe]) => {
        if (cancelled) return;
        setStripeComponents({
          Elements: reactStripe.Elements,
          PaymentElement: reactStripe.PaymentElement,
        });
        return loadStripe(publishableKey);
      })
      .then((stripe) => {
        if (cancelled || !stripe) return;
        setStripeInstance(stripe);
        setError(null);
      })
      .catch((err) => {
        if (cancelled) return;
        const msg =
          err instanceof Error ? err.message : "Failed to load Stripe SDK";
        log.error("Stripe SDK load failed", { error: msg } as Record<string, unknown>);
        setError(msg);
      });

    return () => {
      cancelled = true;
      mountedRef.current = false;
    };
  }, [publishableKey]);

  // ── Register gateway with EPCheckoutSessionProvider ───────────────────
  useEffect(() => {
    if (!paymentReg) {
      log.warn(
        "EPStripePayment is outside EPCheckoutSessionProvider — gateway registration skipped"
      );
      return;
    }

    // For Stripe, the confirm handler returns {} because no client-side
    // tokenization is needed before PaymentIntent creation. The server-side
    // stripe-adapter creates the PaymentIntent and returns clientSecret.
    paymentReg.registerGateway("stripe", async () => {
      return {};
    });
  }, [paymentReg]);

  // ── Handle PaymentElement ready event ─────────────────────────────────
  const handleReady = useCallback(() => {
    setIsReady(true);
    log.debug("Stripe PaymentElement is ready");
  }, []);

  // ── Handle PaymentElement change event ────────────────────────────────
  const handleChange = useCallback((event: any) => {
    if (event.error) {
      setError(event.error.message);
    } else {
      setError(null);
    }
    if (event.value?.type) {
      setPaymentMethodType(event.value.type);
    }
  }, []);

  // ── Submit payment (refAction) ────────────────────────────────────────
  const submitPayment = useCallback(async () => {
    if (!stripeInstance || !elementsRef.current || !clientSecret) {
      setError("Payment form is not ready");
      return;
    }

    setIsProcessing(true);
    setError(null);

    try {
      const result = await stripeInstance.confirmPayment({
        elements: elementsRef.current,
        confirmParams: {
          return_url: window.location.href,
        },
        redirect: "if_required",
      });

      if (result.error) {
        // Card declined, validation error, etc.
        setError(result.error.message || "Payment failed");
        return;
      }

      // Payment succeeded — notify the server via /confirm
      const paymentIntentId =
        result.paymentIntent?.id ??
        session?.payment?.gatewayMetadata?.paymentIntentId;

      if (paymentIntentId) {
        await hookConfirmPayment({ paymentIntentId });
      }
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : "Payment submission failed";
      log.error("submitPayment failed", { error: msg } as Record<string, unknown>);
      setError(msg);
    } finally {
      if (mountedRef.current) {
        setIsProcessing(false);
      }
    }
  }, [stripeInstance, clientSecret, session, hookConfirmPayment]);

  // ── Expose refAction ──────────────────────────────────────────────────
  useImperativeHandle(ref, () => ({
    submitPayment,
  }));

  // ── DataProvider value ────────────────────────────────────────────────
  const paymentData = useMemo(
    () => ({
      isReady,
      isProcessing,
      error,
      paymentMethodType,
    }),
    [isReady, isProcessing, error, paymentMethodType]
  );

  // ── Stripe not loaded yet ─────────────────────────────────────────────
  if (!stripeInstance || !StripeComponents) {
    return (
      <div className={className} data-ep-stripe-payment="">
        <DataProvider name="stripePaymentData" data={{ ...paymentData, isReady: false }}>
          {error ? (
            <div style={{ color: "#d32f2f", fontSize: "14px" }}>{error}</div>
          ) : (
            <div>Loading payment form...</div>
          )}
          {children}
        </DataProvider>
      </div>
    );
  }

  // ── No clientSecret yet — waiting for placeOrder / PaymentIntent ──────
  if (!clientSecret) {
    return (
      <div className={className} data-ep-stripe-payment="">
        <DataProvider name="stripePaymentData" data={{ ...paymentData, isReady: false }}>
          {children}
        </DataProvider>
      </div>
    );
  }

  // ── Render Stripe Elements + PaymentElement ───────────────────────────
  const { Elements, PaymentElement } = StripeComponents;

  const elementsOptions = {
    clientSecret,
    appearance: {
      theme: "stripe" as const,
      ...(appearance || {}),
    },
    loader: "auto" as const,
  };

  return (
    <Elements stripe={stripeInstance} options={elementsOptions}>
      <div className={className} data-ep-stripe-payment="">
        <DataProvider name="stripePaymentData" data={paymentData}>
          <PaymentElement
            onReady={handleReady}
            onChange={handleChange}
            options={{ layout }}
          />
          <ElementsCapture onElements={(el: any) => { elementsRef.current = el; }} />
          {children}
        </DataProvider>
      </div>
    </Elements>
  );
});

// ---------------------------------------------------------------------------
// Capture Elements instance from Stripe context
// ---------------------------------------------------------------------------

function ElementsCapture({ onElements }: { onElements: (e: any) => void }) {
  const [useElementsHook, setUseElementsHook] = useState<(() => any) | null>(
    null
  );

  useEffect(() => {
    import("@stripe/react-stripe-js").then((mod) => {
      setUseElementsHook(() => mod.useElements);
    });
  }, []);

  if (!useElementsHook) return null;

  return (
    <ElementsCaptureInner
      useElements={useElementsHook}
      onElements={onElements}
    />
  );
}

function ElementsCaptureInner({
  useElements,
  onElements,
}: {
  useElements: () => any;
  onElements: (e: any) => void;
}) {
  const elements = useElements();
  useEffect(() => {
    if (elements) {
      onElements(elements);
    }
  }, [elements, onElements]);
  return null;
}

// ---------------------------------------------------------------------------
// Registration metadata
// ---------------------------------------------------------------------------

export const epStripePaymentMeta: ComponentMeta<EPStripePaymentProps> = {
  name: "plasmic-commerce-ep-stripe-payment",
  displayName: "EP Stripe Payment",
  description:
    "Stripe Payment Elements wrapper with automatic 3DS support. " +
    "Drop inside EPCheckoutSessionProvider. Card form renders after placeOrder() creates a PaymentIntent.",
  props: {
    children: {
      type: "slot",
    },
    publishableKey: {
      type: "string",
      displayName: "Publishable Key",
      description: "Your Stripe pk_live_* or pk_test_* key.",
    },
    appearance: {
      type: "object",
      displayName: "Stripe Appearance",
      description:
        "Stripe Elements appearance config (theme, variables, rules).",
      advanced: true,
    },
    layout: {
      type: "choice",
      options: ["tabs", "accordion"],
      defaultValue: "tabs",
      displayName: "Payment Element Layout",
      description: "Layout style for the Stripe PaymentElement.",
    },
    previewState: {
      type: "choice",
      options: ["auto", "ready", "processing", "error"],
      defaultValue: "auto",
      displayName: "Preview State",
      description: "Show mock state for design-time editing.",
      advanced: true,
    },
    apiBaseUrl: {
      type: "string",
      displayName: "API Base URL",
      defaultValue: "/api",
      description:
        "Must match EPCheckoutSessionProvider's apiBaseUrl for session state sharing.",
      advanced: true,
    },
  },
  importPath: "@elasticpath/plasmic-ep-commerce-elastic-path",
  importName: "EPStripePayment",
  providesData: true,
  refActions: {
    submitPayment: {
      description:
        "Confirm payment via Stripe (handles 3DS automatically), then notify the server.",
      argTypes: [],
    },
  },
};

export function registerEPStripePayment(
  loader?: Registerable,
  customMeta?: ComponentMeta<EPStripePaymentProps>
) {
  const doRegisterComponent: typeof registerComponent = (...args) =>
    loader ? loader.registerComponent(...args) : registerComponent(...args);
  doRegisterComponent(
    EPStripePayment,
    customMeta ?? epStripePaymentMeta
  );
}
