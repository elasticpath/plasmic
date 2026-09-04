/**
 * EPCheckoutSessionProvider — Plasmic component wrapping the server-authoritative
 * checkout session model.
 *
 * Exposes a `checkoutSession` DataProvider with the current session state and
 * refActions for mutation. Gateway components (EPCloverPayment, EPStripePayment)
 * register via the PaymentRegistrationContext so the provider knows which
 * gateway to call when placeOrder() fires.
 */
import {
  DataProvider,
  usePlasmicCanvasContext,
} from "@plasmicapp/host";
import registerComponent, {
  CodeComponentMeta,
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
import type {
  ClientCheckoutSession,
  UpdateSessionRequest,
} from "./types";
import { useCheckoutSession } from "./use-checkout-session";
import type { PreviewState } from "./design-time-data";
import { getMockSession } from "./design-time-data";
import { PaymentRegistrationContext } from "./payment-registration-context";
import type {
  GatewayRegistration,
  PaymentRegistrationContextValue,
} from "./payment-registration-context";

const log = createLogger("EPCheckoutSessionProvider");

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface EPCheckoutSessionProviderProps {
  children?: React.ReactNode;
  apiBaseUrl?: string;
  previewState?: PreviewState;
  className?: string;
  /**
   * When true (default), the provider auto-creates a checkout session on
   * first render if none exists. The server resolves `cartId` from the
   * better-auth session, so designers don't have to thread it through
   * Plasmic interactions.
   */
  autoCreate?: boolean;
}

// ---------------------------------------------------------------------------
// Inner runtime component (keeps hooks unconditional)
// ---------------------------------------------------------------------------

const EPCheckoutSessionRuntime = React.forwardRef<
  any,
  EPCheckoutSessionProviderProps
>(function EPCheckoutSessionRuntime(props, ref) {
  const { children, apiBaseUrl = "/api", autoCreate = true } = props;

  const {
    session,
    isLoading,
    error,
    createSession,
    updateSession: updateSessionFn,
    calculateShipping: calcShippingFn,
    placeOrder: placeOrderFn,
    confirmPayment: confirmPaymentFn,
    resumePayment: resumePaymentFn,
    reset: resetFn,
    refresh,
  } = useCheckoutSession(apiBaseUrl);

  // Gateway registration state
  const gatewayRef = useRef<GatewayRegistration | null>(null);

  const paymentRegValue = useMemo<PaymentRegistrationContextValue>(
    () => ({
      registerGateway(name, confirm, options) {
        gatewayRef.current = {
          name,
          confirm,
          completeRequiresAction: options?.completeRequiresAction,
        };
      },
      getRegisteredGateway() {
        return gatewayRef.current;
      },
    }),
    []
  );

  // RefActions
  const handleCreateSession = useCallback(
    async (cartId?: string) => {
      // cartId is now optional — server resolves from the better-auth
      // session when omitted.
      try {
        await createSession(cartId);
      } catch (err) {
        log.error("createSession failed", {
          error: err instanceof Error ? err.message : String(err),
        } as Record<string, unknown>);
      }
    },
    [createSession]
  );

  // Auto-create on first render when no session exists.
  const autoCreatedRef = useRef(false);
  useEffect(() => {
    if (!autoCreate) return;
    if (isLoading) return;
    // Create a fresh session when none exists OR the existing one is terminal
    // (a finished/expired checkout must not block starting a new one — e.g.
    // returning to /checkout with a new cart after completing an order).
    const needsSession =
      !session || session.status === "complete" || session.status === "expired";
    if (!needsSession) return;
    if (autoCreatedRef.current) return;
    autoCreatedRef.current = true;
    createSession().catch((err) => {
      log.warn("Auto-create session failed", {
        error: err instanceof Error ? err.message : String(err),
      } as Record<string, unknown>);
    });
  }, [autoCreate, isLoading, session, createSession]);

  const handleUpdateSession = useCallback(
    async (data?: Record<string, unknown>) => {
      if (!data) return;
      try {
        await updateSessionFn(data as UpdateSessionRequest);
      } catch (err) {
        log.error("updateSession failed", {
          error: err instanceof Error ? err.message : String(err),
        } as Record<string, unknown>);
      }
    },
    [updateSessionFn]
  );

  const handleCalculateShipping = useCallback(async () => {
    try {
      await calcShippingFn();
    } catch (err) {
      log.error("calculateShipping failed", {
        error: err instanceof Error ? err.message : String(err),
      } as Record<string, unknown>);
    }
  }, [calcShippingFn]);

  const placeOrderInFlightRef = useRef(false);

  const handlePlaceOrder = useCallback(async () => {
    if (placeOrderInFlightRef.current) {
      return {
        success: false,
        error: {
          message: "Order is already being placed",
          code: "IN_FLIGHT",
        },
      };
    }
    placeOrderInFlightRef.current = true;
    try {
      // Free orders (zero total) need no card / gateway — the server settles
      // them with the manual gateway. Don't ask a registered gateway to
      // tokenize (there's no card to read).
      if (session?.totals?.total === 0) {
        return await placeOrderFn({ gateway: "manual" });
      }

      const gw = gatewayRef.current;
      if (!gw) {
        log.error(
          "placeOrder called but no gateway registered. " +
            "Place EPCloverPayment or EPStripePayment inside this provider."
        );
        return {
          success: false,
          error: {
            message: "No payment method available",
            code: "NO_GATEWAY",
          },
        };
      }

      // Ask the gateway component for its data (e.g. tokenize the card)
      const gwData = await gw.confirm();
      const payResp = await placeOrderFn({ gateway: gw.name, ...gwData });
      const paySession = payResp?.data?.session;

      // Stripe 3DS: /pay left the session open with requires_action. Run
      // handleNextAction + resumePayment before returning so the form stays
      // in "placing" until checkout is actually complete or failed.
      // Clover (and any gateway without completeRequiresAction) is unchanged.
      if (
        payResp?.success &&
        paySession?.payment?.status === "requires_action" &&
        gw.name === "stripe" &&
        typeof gw.completeRequiresAction === "function"
      ) {
        return await gw.completeRequiresAction(paySession);
      }

      return payResp;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log.error("placeOrder failed", { message } as Record<string, unknown>);
      return { success: false, error: { message } };
    } finally {
      placeOrderInFlightRef.current = false;
    }
  }, [placeOrderFn, session]);

  const handleConfirmPayment = useCallback(
    async (confirmData?: Record<string, unknown>) => {
      try {
        await confirmPaymentFn(confirmData ?? {});
      } catch (err) {
        log.error("confirmPayment failed", {
          error: err instanceof Error ? err.message : String(err),
        } as Record<string, unknown>);
      }
    },
    [confirmPaymentFn]
  );

  const handleResumePayment = useCallback(
    async (resumeData?: Record<string, unknown>) => {
      try {
        return await resumePaymentFn(resumeData ?? {});
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        log.error("resumePayment failed", { message } as Record<string, unknown>);
        return { success: false, error: { message } };
      }
    },
    [resumePaymentFn]
  );

  const handleReset = useCallback(async () => {
    try {
      await resetFn();
    } catch (err) {
      log.error("reset failed", {
        error: err instanceof Error ? err.message : String(err),
      } as Record<string, unknown>);
    }
  }, [resetFn]);

  useImperativeHandle(ref, () => ({
    createSession: handleCreateSession,
    updateSession: handleUpdateSession,
    calculateShipping: handleCalculateShipping,
    placeOrder: handlePlaceOrder,
    confirmPayment: handleConfirmPayment,
    resumePayment: handleResumePayment,
    reset: handleReset,
  }));

  // Data exposed via DataProvider
  const checkoutSessionData = useMemo(
    () => ({
      session,
      isLoading,
      error: error?.message ?? null,
      updateSession: updateSessionFn,
      calculateShipping: calcShippingFn,
      createSession: handleCreateSession,
      placeOrder: handlePlaceOrder,
      confirmPayment: handleConfirmPayment,
      resumePayment: handleResumePayment,
      reset: handleReset,
    }),
    [
      session,
      isLoading,
      error,
      updateSessionFn,
      calcShippingFn,
      handleCreateSession,
      handlePlaceOrder,
      handleConfirmPayment,
      handleResumePayment,
      handleReset,
    ]
  );

  return (
    <PaymentRegistrationContext.Provider value={paymentRegValue}>
      <DataProvider name="checkoutSession" data={checkoutSessionData}>
        {children}
      </DataProvider>
    </PaymentRegistrationContext.Provider>
  );
});

// ---------------------------------------------------------------------------
// Outer component — design-time switch
// ---------------------------------------------------------------------------

export const EPCheckoutSessionProvider = React.forwardRef<
  any,
  EPCheckoutSessionProviderProps
>(function EPCheckoutSessionProvider(props, ref) {
  const { children, previewState = "auto", className } = props;
  const inEditor = usePlasmicCanvasContext();

  if (inEditor && previewState !== "auto") {
    const mockSession = getMockSession(previewState);
    // Strip cartHash for client-visible shape
    const { cartHash, ...clientSession } = mockSession;
    const mockData = {
      session: clientSession,
      isLoading: false,
      error: null,
    };
    return (
      <div className={className}>
        <DataProvider name="checkoutSession" data={mockData}>
          {children}
        </DataProvider>
      </div>
    );
  }

  return (
    <div className={className}>
      <EPCheckoutSessionRuntime ref={ref} {...props} />
    </div>
  );
});

// ---------------------------------------------------------------------------
// Registration metadata
// ---------------------------------------------------------------------------

export const epCheckoutSessionProviderMeta: CodeComponentMeta<EPCheckoutSessionProviderProps> =
  {
    name: "plasmic-commerce-ep-checkout-session-provider",
    displayName: "EP Checkout Session Provider",
    description:
      "Server-authoritative checkout session. Exposes checkoutSession data and mutation refActions. Drop payment components (EPCloverPayment / EPStripePayment) inside.",
    props: {
      children: {
        type: "slot",
      },
      apiBaseUrl: {
        type: "string",
        displayName: "API Base URL",
        defaultValue: "/api",
        advanced: true,
      },
      previewState: {
        type: "choice",
        options: ["auto", "collecting", "paying", "complete"],
        defaultValue: "auto",
        displayName: "Preview State",
        description:
          "Show mock session data for design-time editing.",
        advanced: true,
      },
      autoCreate: {
        type: "boolean",
        defaultValue: true,
        displayName: "Auto-create Session",
        description:
          "Create a session on first render if none exists. Server resolves cartId from the better-auth session.",
        advanced: true,
      },
    },
    importPath: "@elasticpath/plasmic-ep-commerce-elastic-path",
    importName: "EPCheckoutSessionProvider",
    providesData: true,
    refActions: {
      createSession: {
        description:
          "Create a new checkout session. cartId is optional — server resolves from the better-auth session when omitted.",
        argTypes: [{ name: "cartId", type: "string" }],
      },
      updateSession: {
        description:
          "Update session fields (customerInfo, shippingAddress, billingAddress, selectedShippingRateId)",
        argTypes: [{ name: "data", type: "object" }],
      },
      calculateShipping: {
        description:
          "Fetch shipping rates for the current shipping address",
        argTypes: [],
      },
      placeOrder: {
        description:
          "Tokenize payment via the registered gateway and initiate the order",
        argTypes: [],
      },
      confirmPayment: {
        description:
          "Confirm a gateway action (e.g. Clover 3DS authentication)",
        argTypes: [{ name: "confirmData", type: "object" }],
      },
      resumePayment: {
        description:
          "Resume a Stripe PaymentIntent after 3DS (server checkoutApi + confirmOrder)",
        argTypes: [{ name: "resumeData", type: "object" }],
      },
      reset: {
        description: "Reset the checkout session",
        argTypes: [],
      },
    },
  };

export function registerEPCheckoutSessionProvider(
  loader?: Registerable,
  customMeta?: CodeComponentMeta<EPCheckoutSessionProviderProps>
) {
  const doRegisterComponent: typeof registerComponent = (...args) =>
    loader ? loader.registerComponent(...args) : registerComponent(...args);
  doRegisterComponent(
    EPCheckoutSessionProvider,
    customMeta ?? epCheckoutSessionProviderMeta
  );
}
