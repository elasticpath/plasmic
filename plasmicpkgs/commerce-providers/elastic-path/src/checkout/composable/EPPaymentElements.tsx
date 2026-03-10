/**
 * EPPaymentElements — composable Stripe Elements wrapper for the
 * EPCheckoutProvider flow.
 *
 * Reads `clientSecret` from CheckoutInternalContext (set by
 * EPCheckoutProvider after setupPayment), renders Stripe Elements +
 * PaymentElement, and exposes the Stripe `elements` instance back
 * to the provider for confirmPayment calls.
 *
 * DataProvider: paymentData (isReady, isProcessing, error, paymentMethodType, clientSecret)
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
  useMemo,
  useRef,
  useState,
} from "react";
import { Registerable } from "../../registerable";
import { createLogger } from "../../utils/logger";
import { useCheckoutInternal } from "./EPCheckoutProvider";

const log = createLogger("EPPaymentElements");

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
type PreviewState = "auto" | "ready" | "processing" | "error";

interface EPPaymentElementsProps {
  children?: React.ReactNode;
  stripePublishableKey?: string;
  appearance?: Record<string, any>;
  className?: string;
  previewState?: PreviewState;
}

interface PaymentData {
  isReady: boolean;
  isProcessing: boolean;
  error: string | null;
  paymentMethodType: string;
  clientSecret: string | null;
}

// ---------------------------------------------------------------------------
// Mock payment form for design-time
// ---------------------------------------------------------------------------
function MockPaymentForm() {
  return (
    <div
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
const MOCK_DATA: Record<string, PaymentData> = {
  ready: {
    isReady: true,
    isProcessing: false,
    error: null,
    paymentMethodType: "card",
    clientSecret: null,
  },
  processing: {
    isReady: true,
    isProcessing: true,
    error: null,
    paymentMethodType: "card",
    clientSecret: null,
  },
  error: {
    isReady: true,
    isProcessing: false,
    error: "Your card was declined. Please try a different card.",
    paymentMethodType: "card",
    clientSecret: null,
  },
};

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

  // Design-time preview — no Stripe load in editor
  if (inEditor) {
    const mockData =
      previewState !== "auto"
        ? MOCK_DATA[previewState] ?? MOCK_DATA.ready
        : MOCK_DATA.ready;
    return (
      <div className={className} data-ep-payment-elements="">
        <DataProvider name="paymentData" data={mockData}>
          <MockPaymentForm />
          {children}
        </DataProvider>
      </div>
    );
  }

  return (
    <EPPaymentElementsRuntime
      stripePublishableKey={stripePublishableKey}
      appearance={appearance}
      className={className}
    >
      {children}
    </EPPaymentElementsRuntime>
  );
}

// ---------------------------------------------------------------------------
// Runtime (hooks-safe inner component)
// ---------------------------------------------------------------------------
interface RuntimeProps {
  children?: React.ReactNode;
  stripePublishableKey?: string;
  appearance: Record<string, any>;
  className?: string;
}

function EPPaymentElementsRuntime(props: RuntimeProps) {
  const { children, stripePublishableKey, appearance, className } = props;

  const checkoutInternal = useCheckoutInternal();
  const clientSecret = checkoutInternal?.clientSecret ?? null;

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

  // Elements instance to expose back to CheckoutInternalContext
  const elementsRef = useRef<any>(null);
  const mountedRef = useRef(true);

  // Lazy-load Stripe SDK
  useEffect(() => {
    mountedRef.current = true;
    let cancelled = false;

    if (!stripePublishableKey) {
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
        return loadStripe(stripePublishableKey);
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
  }, [stripePublishableKey]);

  // Expose elements instance to EPCheckoutProvider via CheckoutInternalContext
  const syncElements = useCallback(
    (el: any) => {
      elementsRef.current = el;
      if (checkoutInternal?.setElements) {
        checkoutInternal.setElements(el);
      }
    },
    [checkoutInternal]
  );

  // Handle PaymentElement ready event
  const handleReady = useCallback(() => {
    setIsReady(true);
    log.debug("Stripe PaymentElement is ready");
  }, []);

  // Handle PaymentElement change event
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

  // DataProvider value
  const paymentData = useMemo<PaymentData>(
    () => ({
      isReady,
      isProcessing,
      error,
      paymentMethodType,
      clientSecret,
    }),
    [isReady, isProcessing, error, paymentMethodType, clientSecret]
  );

  // Stripe not loaded yet
  if (!stripeInstance || !StripeComponents) {
    return (
      <div className={className} data-ep-payment-elements="">
        <DataProvider
          name="paymentData"
          data={{ ...paymentData, isReady: false }}
        >
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

  // No clientSecret yet — waiting for submitPayment to create PaymentIntent
  if (!clientSecret) {
    return (
      <div className={className} data-ep-payment-elements="">
        <DataProvider
          name="paymentData"
          data={{ ...paymentData, isReady: false }}
        >
          {children}
        </DataProvider>
      </div>
    );
  }

  // Render Stripe Elements + PaymentElement
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
      <div className={className} data-ep-payment-elements="">
        <DataProvider name="paymentData" data={paymentData}>
          <PaymentElement
            onReady={handleReady}
            onChange={handleChange}
            options={{ layout: "tabs" }}
          />
          <ElementsCapture onElements={syncElements} />
          {children}
        </DataProvider>
      </div>
    </Elements>
  );
}

// ---------------------------------------------------------------------------
// Capture Elements instance from Stripe context
// ---------------------------------------------------------------------------
function ElementsCapture({ onElements }: { onElements: (e: any) => void }) {
  const [useElementsHook, setUseElementsHook] = useState<
    (() => any) | null
  >(null);

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
export const epPaymentElementsMeta: ComponentMeta<EPPaymentElementsProps> = {
  name: "plasmic-commerce-ep-payment-elements",
  displayName: "EP Payment Elements",
  description:
    "Stripe Payment Elements wrapper for composable checkout. " +
    "Drop inside EPCheckoutProvider. Renders Stripe PaymentElement " +
    "when clientSecret is available from submitPayment flow.",
  props: {
    children: {
      type: "slot",
    },
    stripePublishableKey: {
      type: "string",
      displayName: "Stripe Publishable Key",
      description: "Your Stripe pk_live_* or pk_test_* key.",
    },
    appearance: {
      type: "object",
      displayName: "Stripe Appearance",
      description:
        "Stripe Elements appearance config (theme, variables, rules).",
      advanced: true,
    },
    previewState: {
      type: "choice",
      options: ["auto", "ready", "processing", "error"],
      defaultValue: "auto",
      displayName: "Preview State",
      description: "Show mock state for design-time editing.",
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
