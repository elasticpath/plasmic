/**
 * EPPaymentElements — composable Stripe Elements wrapper for checkout.
 *
 * Reads `clientSecret` from CheckoutPaymentContext (set by EPCheckoutProvider
 * after setupPayment()). When available, initialises Stripe Elements and
 * renders a PaymentElement. Exposes `paymentData` via DataProvider so the
 * designer can show readiness, processing, and error states.
 *
 * At design-time, renders a static mock payment form for layout styling.
 */
import {
  DataProvider,
  usePlasmicCanvasContext,
} from "@plasmicapp/host";
import registerComponent, {
  ComponentMeta,
} from "@plasmicapp/host/registerComponent";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Registerable } from "../../registerable";
import { createLogger } from "../../utils/logger";
import { useCheckoutPaymentContext } from "./CheckoutContext";

const log = createLogger("EPPaymentElements");

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
type PreviewState = "auto" | "ready" | "processing" | "error";

interface PaymentData {
  isReady: boolean;
  isProcessing: boolean;
  error: string | null;
  paymentMethodType: string;
  clientSecret: string | null;
}

interface EPPaymentElementsProps {
  children?: React.ReactNode;
  stripePublishableKey?: string;
  appearance?: Record<string, any>;
  className?: string;
  previewState?: PreviewState;
}

// ---------------------------------------------------------------------------
// Mock data for design-time
// ---------------------------------------------------------------------------
const MOCK_PAYMENT_DATA: Record<string, PaymentData> = {
  ready: {
    isReady: true,
    isProcessing: false,
    error: null,
    paymentMethodType: "card",
    clientSecret: "pi_mock_secret",
  },
  processing: {
    isReady: true,
    isProcessing: true,
    error: null,
    paymentMethodType: "card",
    clientSecret: "pi_mock_secret",
  },
  error: {
    isReady: true,
    isProcessing: false,
    error: "Your card was declined. Please try a different card.",
    paymentMethodType: "card",
    clientSecret: "pi_mock_secret",
  },
};

// ---------------------------------------------------------------------------
// Mock payment form for design-time
// ---------------------------------------------------------------------------
function MockPaymentForm({ className }: { className?: string }) {
  return (
    <div
      className={className}
      data-ep-payment-elements=""
      style={{
        border: "1px solid #e0e0e0",
        borderRadius: "8px",
        padding: "16px",
        background: "#fafafa",
      }}
    >
      <div style={{ marginBottom: "12px" }}>
        <div
          style={{
            fontSize: "12px",
            color: "#666",
            marginBottom: "4px",
          }}
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
            style={{
              fontSize: "12px",
              color: "#666",
              marginBottom: "4px",
            }}
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
            style={{
              fontSize: "12px",
              color: "#666",
              marginBottom: "4px",
            }}
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
// Component
// ---------------------------------------------------------------------------
export function EPPaymentElements(props: EPPaymentElementsProps) {
  const {
    children,
    stripePublishableKey,
    appearance = {},
    className,
    previewState = "auto",
  } = props;

  const inEditor = !!usePlasmicCanvasContext();
  const paymentCtx = useCheckoutPaymentContext();

  // Design-time — always show mock form
  if (inEditor || previewState !== "auto") {
    const mockPreview = previewState === "auto" ? "ready" : previewState;
    const mockData = MOCK_PAYMENT_DATA[mockPreview] ?? MOCK_PAYMENT_DATA.ready;

    return (
      <DataProvider name="paymentData" data={mockData}>
        <MockPaymentForm className={className} />
        {children}
      </DataProvider>
    );
  }

  // Runtime — need Stripe key
  if (!stripePublishableKey) {
    const errorData: PaymentData = {
      isReady: false,
      isProcessing: false,
      error: "Stripe publishable key is required",
      paymentMethodType: "",
      clientSecret: null,
    };
    return (
      <DataProvider name="paymentData" data={errorData}>
        <div className={className} data-ep-payment-elements="">
          {children}
        </div>
      </DataProvider>
    );
  }

  return (
    <EPPaymentElementsRuntime
      stripePublishableKey={stripePublishableKey}
      appearance={appearance}
      className={className}
      clientSecret={paymentCtx?.clientSecret ?? null}
      setStripeElements={paymentCtx?.setStripeElements ?? null}
    >
      {children}
    </EPPaymentElementsRuntime>
  );
}

// ---------------------------------------------------------------------------
// Runtime (lazy-loads Stripe)
// ---------------------------------------------------------------------------
interface RuntimeProps {
  children?: React.ReactNode;
  stripePublishableKey: string;
  appearance: Record<string, any>;
  className?: string;
  clientSecret: string | null;
  setStripeElements: ((elements: any | null) => void) | null;
}

function EPPaymentElementsRuntime(props: RuntimeProps) {
  const {
    children,
    stripePublishableKey,
    appearance,
    className,
    clientSecret,
    setStripeElements,
  } = props;

  const [stripe, setStripe] = useState<any>(null);
  const [elements, setElements] = useState<any>(null);
  const [isReady, setIsReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [StripeComponents, setStripeComponents] = useState<{
    Elements: any;
    PaymentElement: any;
  } | null>(null);

  // Lazy-load Stripe
  useEffect(() => {
    let cancelled = false;

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
        return loadStripe(stripePublishableKey);
      })
      .then((stripeInstance) => {
        if (cancelled || !stripeInstance) return;
        setStripe(stripeInstance);
      })
      .catch((err) => {
        if (cancelled) return;
        log.warn("Failed to load Stripe:", err);
        setError("Failed to load payment form");
      });

    return () => {
      cancelled = true;
    };
  }, [stripePublishableKey]);

  // Register elements with checkout context
  useEffect(() => {
    if (elements && setStripeElements) {
      setStripeElements(elements);
    }
    return () => {
      if (setStripeElements) setStripeElements(null);
    };
  }, [elements, setStripeElements]);

  const handleReady = useCallback(() => {
    setIsReady(true);
    log.debug("Stripe PaymentElement is ready");
  }, []);

  const handleChange = useCallback((event: any) => {
    if (event.error) {
      setError(event.error.message);
    } else {
      setError(null);
    }
  }, []);

  const paymentData = useMemo<PaymentData>(
    () => ({
      isReady,
      isProcessing: false,
      error,
      paymentMethodType: "card",
      clientSecret,
    }),
    [isReady, error, clientSecret]
  );

  // Waiting for Stripe to load
  if (!stripe || !StripeComponents) {
    return (
      <DataProvider name="paymentData" data={{ ...paymentData, isReady: false }}>
        <div className={className} data-ep-payment-elements="">
          <div>Loading payment form...</div>
          {children}
        </div>
      </DataProvider>
    );
  }

  // No client secret yet — checkout hasn't reached payment step
  if (!clientSecret) {
    return (
      <DataProvider name="paymentData" data={{ ...paymentData, isReady: false }}>
        <div className={className} data-ep-payment-elements="">
          {children}
        </div>
      </DataProvider>
    );
  }

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
    <Elements stripe={stripe} options={elementsOptions}>
      <DataProvider name="paymentData" data={paymentData}>
        <div className={className} data-ep-payment-elements="">
          <PaymentElement
            onReady={handleReady}
            onChange={handleChange}
            options={{ layout: "tabs" }}
          />
          <ElementsCapture onElements={setElements} />
          {children}
        </div>
      </DataProvider>
    </Elements>
  );
}

// ---------------------------------------------------------------------------
// Capture Elements instance from Stripe context
// ---------------------------------------------------------------------------
function ElementsCapture({ onElements }: { onElements: (e: any) => void }) {
  // useElements is only available inside <Elements>. Import dynamically.
  const [useElementsHook, setUseElementsHook] = useState<(() => any) | null>(null);

  useEffect(() => {
    import("@stripe/react-stripe-js").then((mod) => {
      setUseElementsHook(() => mod.useElements);
    });
  }, []);

  if (!useElementsHook) return null;

  return <ElementsCaptureInner useElements={useElementsHook} onElements={onElements} />;
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
export const epPaymentElementsMeta: ComponentMeta<EPPaymentElementsProps> = {
  name: "plasmic-commerce-ep-payment-elements",
  displayName: "EP Payment Elements",
  description:
    "Stripe Payment Elements wrapper. Initialises with the client secret from EPCheckoutProvider and renders a PaymentElement for card/payment method input.",
  props: {
    children: {
      type: "slot",
    },
    stripePublishableKey: {
      type: "string",
      displayName: "Stripe Publishable Key",
      description: "Your Stripe pk_live_* or pk_test_* key",
    },
    appearance: {
      type: "object",
      displayName: "Stripe Appearance",
      description:
        "Stripe Elements appearance config (theme, variables, rules)",
      advanced: true,
    },
    previewState: {
      type: "choice",
      options: ["auto", "ready", "processing", "error"],
      defaultValue: "auto",
      displayName: "Preview State",
      description:
        "Force a preview state for design-time editing",
      advanced: true,
    },
  },
  importPath: "@elasticpath/plasmic-ep-commerce-elastic-path",
  importName: "EPPaymentElements",
  providesData: true,
};

export function registerEPPaymentElements(
  loader?: Registerable,
  customMeta?: ComponentMeta<EPPaymentElementsProps>
) {
  const doRegisterComponent: typeof registerComponent = (...args) =>
    loader ? loader.registerComponent(...args) : registerComponent(...args);
  doRegisterComponent(
    EPPaymentElements,
    customMeta ?? epPaymentElementsMeta
  );
}
