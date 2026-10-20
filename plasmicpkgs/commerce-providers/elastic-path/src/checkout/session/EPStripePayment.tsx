/**
 * EPStripePayment — Plasmic component for the EP-native Stripe gateway.
 *
 *   - Loads Stripe.js from js.stripe.com when it mounts, and mounts a
 *     Payment Element (card) in Elements mode "payment" (deferred
 *     PaymentIntent). Billing name/address are NOT
 *     collected here — the checkout form already captures them and EP attaches
 *     the order's billing server-side (createCartPaymentIntent).
 *   - On submit: stripe.createConfirmationToken({ elements }) → token.
 *   - Self-registers as gateway "stripe" with PaymentRegistrationContext;
 *     the registered confirm callback returns { confirmation_token }.
 *   - After /pay returns requires_action, completeRequiresAction runs
 *     stripe.handleNextAction({ clientSecret: session.payment.clientToken })
 *     then resumePayment() with its publishable key and connected account,
 *     so the server can read the PaymentIntent. It does not call /confirm.
 *     Failed/cancelled handleNextAction calls abandonPayment() to clear the
 *     cart payment_intent_id; it does not call resumePayment.
 *   - Falls back to $ctx.stripe.publishableKey when the prop is unset
 *     (set by StripeProvider global context).
 *
 * The host app no longer holds a Stripe secret key. Server-side, the cart
 * payment-intent adapter calls EP's createCartPaymentIntent with confirm:true.
 * No client-side stripe.confirmPayment.
 */
import {
  DataProvider,
  useDataEnv,
  usePlasmicCanvasContext,
} from "@plasmicapp/host";
import registerComponent, {
  CodeComponentMeta,
} from "@plasmicapp/host/registerComponent";
import type { Stripe, StripeElements } from "@stripe/stripe-js";
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { Registerable } from "../../registerable";
import { createLogger } from "../../utils/logger";
import { loadStripeJs } from "../stripe/load-stripe-js";
import { usePaymentElement } from "../stripe/use-payment-element";
import { usePaymentRegistration } from "./payment-registration-context";
import type {
  GatewayContinuationResult,
  GatewayPaySession,
} from "./payment-registration-context";
import { useCheckoutSession } from "./use-checkout-session";
import { paymentIntentPhase } from "./payment-intent-status";
import type { PaymentIntentReadKeys } from "./types";

// @stripe/stripe-js 2.x types predate confirmation tokens; Stripe.js v3 has them.
type StripeWithConfirmationTokens = Stripe & {
  createConfirmationToken(options: { elements: StripeElements }): Promise<
    | { confirmationToken: { id: string }; error?: undefined }
    | { confirmationToken?: undefined; error: { message?: string } }
  >;
};

async function readPaymentIntentStatus(
  stripe: { retrievePaymentIntent?: (clientSecret: string) => Promise<any> },
  clientSecret: string
): Promise<string | undefined> {
  if (typeof stripe.retrievePaymentIntent !== "function") return undefined;
  try {
    const result = await stripe.retrievePaymentIntent(clientSecret);
    const status = result?.paymentIntent?.status;
    return typeof status === "string" ? status : undefined;
  } catch {
    return undefined;
  }
}

function stripeNextActionFailureMessage(
  err: { code?: string; message?: string } | null | undefined,
  piStatus: string | undefined
): string {
  const code = err?.code;
  if (
    code === "payment_intent_authentication_failure" ||
    piStatus === "requires_payment_method" ||
    piStatus === "requires_source"
  ) {
    return "Card authentication failed. Please try again or use a different card.";
  }
  if (
    piStatus === "canceled" ||
    piStatus === "cancelled" ||
    code === "canceled" ||
    /cancel/i.test(err?.message ?? "")
  ) {
    return "Payment was cancelled. Please try again.";
  }
  return err?.message || "Payment authentication failed. Please try again.";
}

function resumeFailureMessage(resp: GatewayContinuationResult): string {
  const code = resp?.error?.code;
  if (code === "PAYMENT_STILL_REQUIRES_ACTION") {
    return (
      resp.error?.message ||
      "Payment is still pending. Please wait a moment and try completing checkout again."
    );
  }
  if (code === "EP_ERROR") {
    return (
      resp.error?.message ||
      "We couldn't confirm your payment. Please try again."
    );
  }
  if (code === "CART_MISMATCH") {
    return (
      resp.error?.message ||
      "Your cart has changed. Please review your cart and start checkout again."
    );
  }
  return (
    resp.error?.message ||
    resp.paymentError ||
    "Payment did not complete. Please check your details and try again."
  );
}

/**
 * Stripe 3DS continuation used by EPCheckoutSessionProvider after /pay
 * returns requires_action. Exported for tests (same pattern as handleClover3DS).
 *
 * handleNextAction success is not checkout completion — resumePayment is.
 * Auth failure / cancel must not call resumePayment; they abandon the cart
 * PI association so /pay can create a new PaymentIntent. When
 * handleNextAction gives no PaymentIntent state (it throws for a challenge
 * already passed), the state is read with retrievePaymentIntent: a paid
 * PaymentIntent resumes, an unreadable one does neither. Resume carries the
 * publishable key and connected account, so the server can read the
 * PaymentIntent from Stripe before it confirms the order.
 */
export async function runStripeRequiresAction(options: {
  stripe: {
    handleNextAction: (args: { clientSecret: string }) => Promise<any>;
    retrievePaymentIntent?: (clientSecret: string) => Promise<any>;
  };
  clientSecret: string;
  resumePayment: (readKeys?: PaymentIntentReadKeys) => Promise<GatewayContinuationResult>;
  abandonPayment: (readKeys?: PaymentIntentReadKeys) => Promise<GatewayContinuationResult>;
  readKeys?: PaymentIntentReadKeys;
}): Promise<GatewayContinuationResult> {
  const { stripe, clientSecret, abandonPayment, readKeys } = options;
  const resumePayment = () =>
    readKeys ? options.resumePayment(readKeys) : options.resumePayment();
  if (typeof clientSecret !== "string" || clientSecret.length === 0) {
    return {
      success: false,
      error: { message: "Session has no payment client secret to continue" },
    };
  }

  let stripeError: { code?: string; message?: string } | undefined;
  let piStatus: string | undefined;
  let completed = false;
  try {
    const result = await stripe.handleNextAction({ clientSecret });
    stripeError = result?.error;
    piStatus = result?.paymentIntent?.status ?? result?.error?.payment_intent?.status;
    completed = !stripeError;
  } catch {
    // Stripe.js throws when the PaymentIntent has no action left, e.g. a
    // challenge passed in an earlier attempt. Its state decides below.
  }
  if (!piStatus && !completed) {
    piStatus = await readPaymentIntentStatus(stripe, clientSecret);
  }

  // Only a PaymentIntent that took the payment may settle the order, and only
  // one that can no longer take it may be abandoned: abandoning a paid one, or
  // settling one still waiting, would leave the charge without its order.
  const phase = paymentIntentPhase(piStatus);
  if (piStatus && phase !== "settled" && phase !== "failed") {
    return {
      success: false,
      error: {
        message:
          piStatus === "processing"
            ? "Your payment is still processing. Please try again in a moment."
            : "Your card check is not finished. Please complete it and try again.",
        code: "PAYMENT_ACTION_PENDING",
      },
    };
  }
  if (!piStatus && !completed) {
    return {
      success: false,
      error: {
        message: "We couldn't confirm your payment status. Please try again.",
        code: "PAYMENT_STATUS_UNKNOWN",
      },
    };
  }

  let failMessage: string | undefined;
  if (phase === "failed") {
    failMessage = stripeNextActionFailureMessage(stripeError, piStatus);
  }

  if (failMessage) {
    let abandoned: GatewayContinuationResult;
    try {
      const abandonResp = (await (readKeys
        ? abandonPayment(readKeys)
        : abandonPayment())) as
        | GatewayContinuationResult
        | undefined;
      abandoned = abandonResp ?? {
        success: false,
        error: {
          message: "Failed to reset cart payment",
          code: "EP_ERROR",
        },
      };
    } catch (err) {
      abandoned = {
        success: false,
        error: {
          message:
            err instanceof Error
              ? err.message
              : "We couldn't reset your payment. Please try again.",
          code: "EP_ERROR",
        },
      };
    }

    if (
      abandoned.error?.code === "PAYMENT_ALREADY_TAKEN" &&
      abandoned.data?.session?.status === "complete"
    ) {
      // The payment completed the order while it was being abandoned.
      return { ...abandoned, success: true, error: undefined };
    } else if (abandoned.error?.code === "PAYMENT_ALREADY_TAKEN") {
      // The server found the payment taken after all: settle the order.
      failMessage = undefined;
    } else if (!abandoned.success) {
      const resetMsg =
        abandoned.error?.message ||
        abandoned.paymentError ||
        "We couldn't reset your payment. Please try again.";
      return {
        ...abandoned,
        success: false,
        error: abandoned.error
          ? { ...abandoned.error, message: resetMsg }
          : { message: resetMsg, code: "EP_ERROR" },
      };
    } else {
      return {
        success: false,
        error: { message: failMessage },
        paymentError: failMessage,
        data: abandoned.data,
      };
    }
  }

  const resumeResp = (await resumePayment()) as
    | GatewayContinuationResult
    | undefined;
  const resp: GatewayContinuationResult = resumeResp ?? {
    success: false,
    error: { message: "Failed to resume payment" },
  };

  if (resp.success && resp.data?.session?.status === "complete") {
    return resp;
  }

  const msg = resumeFailureMessage(resp);
  return {
    ...resp,
    error: resp.error ? { ...resp.error, message: msg } : { message: msg },
  };
}

const log = createLogger("EPStripePayment");

export interface EPStripePaymentProps {
  children?: React.ReactNode;
  /**
   * Stripe publishable key. Optional — falls back to
   * `$ctx.stripe.publishableKey` (set by StripeProvider) when unset.
   */
  publishableKey?: string;
  /**
   * Connected Stripe account id (`acct_…`) for gateways that charge on a
   * connected account (e.g. EP-native Stripe / Stripe Connect). When set, the
   * Stripe SDK is initialised with `{ stripeAccount }` so the ConfirmationToken
   * is minted in that account's context — otherwise the server cannot find the
   * token on the account it confirms against ("No such confirmation_token").
   * Falls back to `$ctx.stripe.stripeAccount` (StripeProvider) when unset.
   */
  stripeAccount?: string;
  appearance?: Record<string, any>;
  layout?: "tabs" | "accordion";
  className?: string;
  previewState?: "auto" | "ready" | "processing" | "error";
  apiBaseUrl?: string;
}

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
      <div style={{ marginBottom: "12px", fontSize: "13px", color: "#666" }}>
        Card / Address fields render here at runtime.
      </div>
    </div>
  );
}

const MOCK_DATA: Record<string, any> = {
  ready: { isReady: true, isProcessing: false, error: null },
  processing: { isReady: true, isProcessing: true, error: null },
  error: {
    isReady: true,
    isProcessing: false,
    error: "Your card was declined. Please try a different card.",
  },
};

function useStripePublishableKey(propValue?: string): string | null {
  const env = useDataEnv?.();
  const ctx = (env as any)?.stripe;
  return propValue ?? ctx?.publishableKey ?? null;
}

function useStripeAccount(propValue?: string): string | null {
  const env = useDataEnv?.();
  const ctx = (env as any)?.stripe;
  return propValue ?? ctx?.stripeAccount ?? null;
}

export const EPStripePayment = React.forwardRef<any, EPStripePaymentProps>(
  function EPStripePayment(props, ref) {
    const {
      children,
      publishableKey: publishableKeyProp,
      stripeAccount: stripeAccountProp,
      appearance = {},
      layout = "tabs",
      className,
      previewState = "auto",
      apiBaseUrl = "/api",
    } = props;

    const inEditor = usePlasmicCanvasContext();
    const publishableKey = useStripePublishableKey(publishableKeyProp);
    const stripeAccount = useStripeAccount(stripeAccountProp);

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
      const autoData = { isReady: true, isProcessing: false, error: null };
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
        stripeAccount={stripeAccount}
        appearance={appearance}
        layout={layout}
        className={className}
        apiBaseUrl={apiBaseUrl}
      >
        {children}
      </EPStripePaymentRuntime>
    );
  }
);

const EPStripePaymentRuntime = React.forwardRef<
  any,
  {
    publishableKey: string | null;
    stripeAccount: string | null;
    appearance: Record<string, any>;
    layout: "tabs" | "accordion";
    className?: string;
    apiBaseUrl: string;
    children?: React.ReactNode;
  }
>(function EPStripePaymentRuntime(props, ref) {
  const {
    publishableKey,
    stripeAccount,
    appearance,
    layout,
    className,
    apiBaseUrl,
    children,
  } = props;

  const paymentReg = usePaymentRegistration();
  const { session: storedSession, resumePayment, abandonPayment } =
    useCheckoutSession(apiBaseUrl);
  // The session EP Checkout Session Provider shows: none for an emptied cart,
  // and an older storefront's totals read from its cart.
  const shown = (useDataEnv?.() as { checkoutSession?: { session?: unknown } } | undefined)
    ?.checkoutSession;
  const session = (shown ? shown.session : storedSession) as typeof storedSession;

  const [isReady, setIsReady] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stripeInstance, setStripeInstance] = useState<Stripe | null>(null);

  const cardFormRef = useRef<{
    stripe: StripeWithConfirmationTokens;
    elements: StripeElements;
  } | null>(null);
  const mountedRef = useRef(true);
  const inFlightRef = useRef(false);
  const resumePaymentRef = useRef(resumePayment);
  resumePaymentRef.current = resumePayment;
  const readKeysRef = useRef<PaymentIntentReadKeys | undefined>(undefined);
  readKeysRef.current = publishableKey
    ? { publishableKey, ...(stripeAccount ? { stripeAccount } : {}) }
    : undefined;
  const abandonPaymentRef = useRef(abandonPayment);
  abandonPaymentRef.current = abandonPayment;

  useEffect(() => {
    mountedRef.current = true;
    let cancelled = false;
    if (!publishableKey) {
      setError("Stripe publishable key is required");
      return;
    }
    // For connected-account gateways (EP-native Stripe / Connect), the
    // ConfirmationToken must be minted in the connected account's context
    // so the server can confirm it on that account.
    loadStripeJs()
      .then((StripeJs) => {
        if (cancelled) return;
        const stripe = StripeJs(
          publishableKey,
          stripeAccount ? { stripeAccount } : undefined
        );
        setStripeInstance(stripe);
        setError(null);
      })
      .catch((err) => {
        if (cancelled) return;
        const msg =
          err instanceof Error ? err.message : "Failed to load Stripe SDK";
        log.error("Stripe SDK load failed", { error: msg } as Record<
          string,
          unknown
        >);
        setError(msg);
      });
    return () => {
      cancelled = true;
      mountedRef.current = false;
    };
  }, [publishableKey, stripeAccount]);

  // Register the gateway. confirm() captures a Stripe ConfirmationToken and
  // forwards it to placeOrder({ confirmation_token, gateway: "stripe" }).
  // completeRequiresAction runs after /pay returns requires_action.
  const confirmGateway = useCallback(async () => {
    const cardForm = cardFormRef.current;
    if (!cardForm) {
      throw new Error("Stripe is not ready — wait for isReady");
    }
    const { stripe, elements } = cardForm;
    const submit = await elements.submit();
    if (submit?.error) {
      throw new Error(submit.error.message ?? "Form validation failed");
    }
    const result = await stripe.createConfirmationToken({ elements });
    if (result.error) {
      throw new Error(
        result.error.message ?? "Could not create confirmation token"
      );
    }
    return { confirmation_token: result.confirmationToken.id };
  }, []);

  const completeRequiresAction = useCallback(
    async (
      paySession: GatewayPaySession
    ): Promise<GatewayContinuationResult> => {
      if (inFlightRef.current) {
        return {
          success: false,
          error: {
            message: "Payment is already being completed",
            code: "IN_FLIGHT",
          },
        };
      }
      inFlightRef.current = true;
      setIsProcessing(true);
      setError(null);
      try {
        const stripe = cardFormRef.current?.stripe;
        if (!stripe?.handleNextAction) {
          throw new Error("Stripe is not ready — wait for isReady");
        }
        const clientSecret = paySession?.payment?.clientToken;
        if (typeof clientSecret !== "string" || clientSecret.length === 0) {
          throw new Error("Session has no payment client secret to continue");
        }

        const resp = await runStripeRequiresAction({
          stripe,
          clientSecret,
          resumePayment: (keys) => resumePaymentRef.current(keys && { ...keys }),
          abandonPayment: (keys) => abandonPaymentRef.current(keys && { ...keys }),
          readKeys: readKeysRef.current,
        });

        if (!(resp.success && resp.data?.session?.status === "complete")) {
          const msg =
            resp.error?.message ||
            resp.paymentError ||
            "Payment did not complete. Please check your details and try again.";
          setError(msg);
        }
        return resp;
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Payment authentication failed.";
        if (mountedRef.current) setError(message);
        return { success: false, error: { message } };
      } finally {
        inFlightRef.current = false;
        if (mountedRef.current) setIsProcessing(false);
      }
    },
    []
  );

  useEffect(() => {
    if (!paymentReg) {
      log.warn(
        "EPStripePayment is outside EPCheckoutSessionProvider — gateway registration skipped"
      );
      return;
    }
    paymentReg.registerGateway("stripe", confirmGateway, {
      completeRequiresAction,
    });
  }, [paymentReg, confirmGateway, completeRequiresAction]);

  const handleReady = useCallback(() => setIsReady(true), []);
  const handleChange = useCallback((event: any) => {
    if (event?.error) setError(event.error.message);
    else setError(null);
  }, []);

  const paymentData = useMemo(
    () => ({ isReady, isProcessing, error }),
    [isReady, isProcessing, error]
  );

  // Stub refAction (kept for compatibility — placeOrder is the way now).
  React.useImperativeHandle(ref, () => ({
    submitPayment: async () => {
      log.warn("submitPayment is deprecated — call $refs.session.placeOrder()");
    },
  }));

  // Free / zero-total (or unknown-currency) carts take no card — the server
  // settles them via the manual gateway. Render the slot without Stripe so we
  // never hand Stripe Elements an amount of 0 or an empty currency (Stripe
  // throws an IntegrationError on either). This also keeps the card hidden on
  // a free checkout without any page-level conditional wiring.
  const total = session?.totals?.total ?? 0;
  const currency = (session?.totals?.currency || "").toLowerCase();
  const free = !(total > 0) || !currency;
  // A finished checkout (an order placed, or an earlier visit's checkout
  // still in the cookie while a new one cannot start) takes no card either.
  const ended = session?.status === "complete" || session?.status === "expired";
  const noCard = free || ended;

  // Deferred PaymentIntent: amount + currency declared upfront. On submit,
  // EP creates the PaymentIntent server-side via createCartPaymentIntent.
  // Card-only: the PaymentElement's default doesn't collect name/address,
  // and EP attaches the order's billing server-side.
  const {
    ref: paymentElementRef,
    elements,
    stripe: elementsStripe,
  } = usePaymentElement(
    noCard ? null : stripeInstance,
    {
      elements: {
        mode: "payment",
        amount: total,
        currency,
        appearance: { theme: "stripe", ...(appearance || {}) },
        loader: "auto",
      },
      paymentElement: { layout },
      onReady: handleReady,
      onChange: handleChange,
    }
  );
  cardFormRef.current =
    elements && elementsStripe
      ? { stripe: elementsStripe as StripeWithConfirmationTokens, elements }
      : null;

  if (noCard) {
    return (
      <div
        className={className}
        data-ep-stripe-payment=""
        data-ep-payment-free={free ? "true" : undefined}
      >
        <DataProvider
          name="stripePaymentData"
          data={{ isReady: false, isProcessing: false, error: null, free }}
        >
          {children}
        </DataProvider>
      </div>
    );
  }

  if (!stripeInstance) {
    return (
      <div className={className} data-ep-stripe-payment="">
        <DataProvider
          name="stripePaymentData"
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

  return (
    <div className={className} data-ep-stripe-payment="">
      <DataProvider name="stripePaymentData" data={paymentData}>
        <div ref={paymentElementRef} />
        {children}
      </DataProvider>
    </div>
  );
});

export const epStripePaymentMeta: CodeComponentMeta<EPStripePaymentProps> = {
  name: "plasmic-commerce-ep-stripe-payment",
  displayName: "EP Stripe Payment",
  description:
    "Stripe Payment Element (card) for the EP-native gateway, mode='payment'. " +
    "Billing name/address are not collected here — the checkout form captures them and EP attaches the order's billing server-side. " +
    "On placeOrder, captures a Stripe ConfirmationToken and forwards it to the server.",
  props: {
    children: { type: "slot" },
    publishableKey: {
      type: "string",
      displayName: "Publishable Key",
      description:
        "Stripe pk_live_* or pk_test_*. Falls back to $ctx.stripe.publishableKey if unset.",
    },
    stripeAccount: {
      type: "string",
      displayName: "Connected Account ID",
      description:
        "Optional acct_* for connected-account gateways (EP-native Stripe / Connect). The ConfirmationToken is minted in this account's context. Falls back to $ctx.stripe.stripeAccount.",
      advanced: true,
    },
    appearance: {
      type: "object",
      displayName: "Stripe Appearance",
      description: "Stripe Elements appearance config (theme, variables, rules).",
      advanced: true,
    },
    layout: {
      type: "choice",
      options: ["tabs", "accordion"],
      defaultValue: "tabs",
      displayName: "Payment Element Layout",
    },
    previewState: {
      type: "choice",
      options: ["auto", "ready", "processing", "error"],
      defaultValue: "auto",
      displayName: "Preview State",
      advanced: true,
    },
    apiBaseUrl: {
      type: "string",
      displayName: "API Base URL",
      defaultValue: "/api",
      description: "Must match EPCheckoutSessionProvider's apiBaseUrl.",
      advanced: true,
    },
  },
  importPath: "@elasticpath/plasmic-ep-commerce-elastic-path",
  importName: "EPStripePayment",
  providesData: true,
  refActions: {
    submitPayment: {
      description:
        "Deprecated — ignored. Call $refs.session.placeOrder() on EP Checkout Session Provider instead.",
      argTypes: [],
    },
  },
};

export function registerEPStripePayment(
  loader?: Registerable,
  customMeta?: CodeComponentMeta<EPStripePaymentProps>
) {
  const doRegisterComponent: typeof registerComponent = (...args) =>
    loader ? loader.registerComponent(...args) : registerComponent(...args);
  doRegisterComponent(EPStripePayment, customMeta ?? epStripePaymentMeta);
}
