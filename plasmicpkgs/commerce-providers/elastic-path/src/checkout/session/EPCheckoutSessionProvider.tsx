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
}

// ---------------------------------------------------------------------------
// Inner runtime component (keeps hooks unconditional)
// ---------------------------------------------------------------------------

const EPCheckoutSessionRuntime = React.forwardRef<
  any,
  EPCheckoutSessionProviderProps
>(function EPCheckoutSessionRuntime(props, ref) {
  const { children, apiBaseUrl = "/api" } = props;

  const {
    session,
    isLoading,
    error,
    createSession,
    updateSession: updateSessionFn,
    calculateShipping: calcShippingFn,
    placeOrder: placeOrderFn,
    confirmPayment: confirmPaymentFn,
    reset: resetFn,
    refresh,
  } = useCheckoutSession(apiBaseUrl);

  // Gateway registration state
  const gatewayRef = useRef<GatewayRegistration | null>(null);

  const paymentRegValue = useMemo<PaymentRegistrationContextValue>(
    () => ({
      registerGateway(name, confirm) {
        gatewayRef.current = { name, confirm };
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
      if (!cartId) {
        log.error("createSession called without cartId");
        return;
      }
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

  const handlePlaceOrder = useCallback(async () => {
    const gw = gatewayRef.current;
    if (!gw) {
      log.error(
        "placeOrder called but no gateway registered. " +
          "Place EPCloverPayment or EPStripePayment inside this provider."
      );
      return;
    }

    try {
      // Ask the gateway component for its data (e.g. tokenize the card)
      const gwData = await gw.confirm();
      await placeOrderFn({ gateway: gw.name, ...gwData });
    } catch (err) {
      log.error("placeOrder failed", {
        error: err instanceof Error ? err.message : String(err),
      } as Record<string, unknown>);
    }
  }, [placeOrderFn]);

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
    },
    importPath: "@elasticpath/plasmic-ep-commerce-elastic-path",
    importName: "EPCheckoutSessionProvider",
    providesData: true,
    refActions: {
      createSession: {
        description: "Create a new checkout session for a cart",
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
          "Confirm a gateway action (e.g. 3DS authentication)",
        argTypes: [{ name: "confirmData", type: "object" }],
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
