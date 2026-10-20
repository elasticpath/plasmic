/**
 * EPCheckoutSessionProvider — Plasmic component wrapping the server-authoritative
 * checkout session model.
 *
 * Exposes a `checkoutSession` DataProvider with the current session state and
 * refActions for mutation. Gateway components (EPCloverPayment, EPStripePayment,
 * EPManualPayment) register via the PaymentRegistrationContext so the provider
 * knows which gateway to call when placeOrder() fires.
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
import useSWR, { mutate as swrMutate } from "swr";
import type { Registerable } from "../../registerable";
import { epCartCacheKey } from "../../cart-provider/cache-keys";
import { epGetCart, epReadCart } from "../../ep-server-functions/getCart";
import { createLogger } from "../../utils/logger";
import type { Cart } from "../../types/cart";
import type {
  CheckoutSessionStatus,
  ClientCheckoutSession,
  SessionTotals,
  UpdateSessionRequest,
} from "./types";
import {
  CART_CHANGED_COPY,
  CART_UNREAD_COPY,
  EMPTY_CART_COPY,
  enteredDetails,
  isOlderNoCartRefusal,
  isOlderStorefrontSession,
  olderCheckoutView,
  olderSessionKey,
  withShopperCopy,
} from "./older-storefront";
import { hasPurchasableItem } from "./purchasable-items";
import { useCheckoutSession } from "./use-checkout-session";
import type { PreviewState } from "./design-time-data";
import { getMockSession } from "./design-time-data";
import { PaymentRegistrationContext } from "./payment-registration-context";
import type {
  GatewayRegistration,
  PaymentRegistrationContextValue,
} from "./payment-registration-context";

const log = createLogger("EPCheckoutSessionProvider");

const TERMINAL = new Set<CheckoutSessionStatus>(["complete", "expired"]);

const CREATE_FAILED = "Checkout could not start. Please try again.";

const FOCUS_SYNC_INTERVAL_MS = 2000;

const MAX_AUTO_RESTARTS = 2;

/** Watches the shared cart cache without reading the cart on mount or focus. */
const CART_WATCH = {
  revalidateOnMount: false,
  revalidateOnFocus: false,
  revalidateIfStale: false,
  revalidateOnReconnect: false,
};

interface SessionError {
  message: string;
  code: string | null;
}

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
   * first render if none exists, for the shopper's session cart.
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

  // A refused create (an empty cart, no cart): the page shows it instead of
  // the finished session it would have replaced.
  const [createError, setCreateError] = useState<SessionError | null>(null);
  const terminal = !session || TERMINAL.has(session.status);
  const blocked = createError !== null && terminal;
  const olderStorefront = isOlderStorefrontSession(session);

  // The cart an open checkout pays for, read again whenever the session
  // changes (an older storefront) or the shopper may have changed the cart.
  const watchKey =
    session?.status === "open" && session.payment?.status !== "requires_action"
      ? olderStorefront
        ? olderSessionKey(session)
        : session.id
      : null;
  const watchKeyRef = useRef(watchKey);
  watchKeyRef.current = watchKey;
  const [checkedCart, setCheckedCart] = useState<{ cart: Cart; key: string } | null>(
    null
  );
  const checkCart = useCallback(async () => {
    const key = watchKeyRef.current;
    if (!key) return;
    const fresh = (await swrMutate(epCartCacheKey())) as Cart | null | undefined;
    if (fresh && typeof fresh === "object" && watchKeyRef.current === key) {
      setCheckedCart({ cart: fresh, key });
    }
  }, []);
  useEffect(() => {
    if (watchKey) void checkCart();
  }, [watchKey, checkCart]);

  const olderView = useMemo(
    () =>
      olderStorefront && session && watchKey && checkedCart?.key === watchKey
        ? olderCheckoutView(session, checkedCart.cart)
        : null,
    [olderStorefront, session, watchKey, checkedCart]
  );
  const cartEmpty =
    !!watchKey &&
    checkedCart !== null &&
    checkedCart.key === watchKey &&
    !hasPurchasableItem(checkedCart.cart.items);

  // An older storefront's session totals do not follow the cart: the page
  // shows the cart's own figures (older-storefront.ts), never totals known
  // to be stale.
  const staleSessionIdsRef = useRef(new Set<string>());
  const lastOlderTotalsRef = useRef<{ id: string; totals: SessionTotals } | null>(null);
  if (session && olderView?.totals) {
    lastOlderTotalsRef.current = { id: session.id, totals: olderView.totals };
  }
  const olderTotals = (() => {
    if (!olderStorefront || !session) return null;
    if (!watchKey) return session.totals;
    if (staleSessionIdsRef.current.has(session.id)) return null;
    if (olderView) return olderView.totals;
    const last = lastOlderTotalsRef.current;
    return last?.id === session.id ? last.totals : null;
  })();

  const emptied = cartEmpty && !blocked;
  const shownSession = useMemo(
    () =>
      blocked || emptied
        ? null
        : olderStorefront && session
          ? { ...session, totals: olderTotals }
          : session,
    [blocked, emptied, olderStorefront, session, olderTotals]
  );

  const runCreate = useCallback(async () => {
    let resp: Awaited<ReturnType<typeof createSession>> | undefined;
    try {
      resp = await createSession();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log.warn("createSession failed", { error: message });
      setCreateError({ message: CREATE_FAILED, code: "NETWORK_ERROR" });
      return resp;
    }
    setCreateError(
      resp?.success
        ? null
        : isOlderNoCartRefusal(resp)
          ? { message: EMPTY_CART_COPY, code: "NO_CART" }
          : {
              message: resp?.error?.message || CREATE_FAILED,
              code: resp?.error?.code ?? null,
            }
    );
    return resp;
  }, [createSession]);

  // RefActions
  const handleCreateSession = useCallback(
    async (_ignoredCartId?: string) => {
      await runCreate();
    },
    [runCreate]
  );

  // Auto-create on first render when no session exists.
  const autoCreatedRef = useRef(false);
  const openSessionIdRef = useRef<string | null>(null);
  if (session?.status === "open") openSessionIdRef.current = session.id;
  useEffect(() => {
    if (!autoCreate) return;
    if (isLoading) return;
    // Create a fresh session when none exists OR the existing one is terminal
    // (a finished/expired checkout must not block starting a new one — e.g.
    // returning to /checkout with a new cart after completing an order).
    // An order just placed on this page stays shown.
    if (!terminal) return;
    if (
      session?.status === "complete" &&
      session.id === openSessionIdRef.current
    ) {
      return;
    }
    if (autoCreatedRef.current) return;
    autoCreatedRef.current = true;
    void runCreate();
  }, [autoCreate, isLoading, terminal, session?.status, session?.id, runCreate]);

  const placeOrderInFlightRef = useRef(false);

  // The cart changed (on this page or, seen on focus, in another tab): bring
  // the session's totals up to date before the shopper pays, or try again to
  // start the checkout a refused create could not.
  const syncWithCart = useCallback(() => {
    if (placeOrderInFlightRef.current) return;
    if (blocked) {
      void runCreate();
    } else if (session?.status === "open") {
      // An older storefront does not requote on read; its cart is read instead.
      void (olderStorefront ? checkCart() : refresh());
    }
  }, [blocked, runCreate, session?.status, olderStorefront, checkCart, refresh]);

  const { data: cart } = useSWR(epCartCacheKey(), () => epGetCart(), CART_WATCH);
  const seenCartRef = useRef(cart);
  useEffect(() => {
    const seen = seenCartRef.current;
    seenCartRef.current = cart;
    if (seen === undefined || seen === cart) return;
    const key = watchKeyRef.current;
    if (!olderStorefront && key && cart && typeof cart === "object") {
      setCheckedCart({ cart, key });
    }
    syncWithCart();
  }, [cart, syncWithCart, olderStorefront]);

  const lastFocusSyncRef = useRef(0);
  useEffect(() => {
    if (typeof window === "undefined" || typeof document === "undefined") {
      return;
    }
    const onFocus = () => {
      if (document.visibilityState === "hidden") return;
      const now = Date.now();
      if (now - lastFocusSyncRef.current < FOCUS_SYNC_INTERVAL_MS) return;
      lastFocusSyncRef.current = now;
      syncWithCart();
      if (!olderStorefront) void swrMutate(epCartCacheKey());
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
    };
  }, [syncWithCart, olderStorefront]);

  // While a refused create stands, writes would reach the finished session it
  // replaced; answer them with the refusal instead. An emptied cart is
  // answered the same way.
  const refusal = useMemo(
    () =>
      blocked && createError
        ? {
            success: false as const,
            error: {
              message: createError.message,
              ...(createError.code ? { code: createError.code } : {}),
            },
          }
        : emptied
          ? {
              success: false as const,
              error: { message: EMPTY_CART_COPY, code: "EMPTY_CART" },
            }
          : null,
    [blocked, createError, emptied]
  );

  // The session is a cookie: a write sent while checkout starts again would
  // carry the session from before it and undo the rate it carries over.
  const restartRef = useRef<Promise<void> | null>(null);
  const afterRestart = useCallback(async () => {
    while (restartRef.current) await restartRef.current;
  }, []);

  const updateSessionData = useCallback(
    async (data: UpdateSessionRequest) => {
      if (refusal) return refusal;
      await afterRestart();
      const resp = await updateSessionFn(data);
      return olderStorefront ? withShopperCopy(resp) : resp;
    },
    [refusal, updateSessionFn, olderStorefront, afterRestart]
  );

  const calculateShippingData = useCallback(async () => {
    if (refusal) return refusal;
    await afterRestart();
    const resp = await calcShippingFn();
    return olderStorefront ? withShopperCopy(resp) : resp;
  }, [refusal, calcShippingFn, olderStorefront, afterRestart]);

  // An older storefront charges its live cart whatever the page shows, and
  // keeps the old totals after CART_MISMATCH. A session whose total no longer
  // matches the cart is never paid: checkout starts again (the storefront
  // reads cart and total together) with what the shopper entered.
  const restartCheckout = useCallback(
    (stale: ClientCheckoutSession, { hideTotals = true } = {}): Promise<void> => {
      if (hideTotals) staleSessionIdsRef.current.add(stale.id);
      if (restartRef.current) return restartRef.current;
      const run = (async () => {
        const created = await createSession();
        if (!created?.success) return;
        const details = enteredDetails(stale);
        let rates = created.data?.session?.availableShippingRates ?? [];
        if (details) {
          const updated = await updateSessionFn(details);
          rates = updated?.data?.session?.availableShippingRates ?? rates;
        }
        const rateId = stale.selectedShippingRateId;
        if (rateId && rates.some((rate) => rate.id === rateId)) {
          await updateSessionFn({ selectedShippingRateId: rateId });
        }
      })()
        .catch((err) => {
          log.warn("Starting checkout again failed", {
            error: err instanceof Error ? err.message : String(err),
          });
        })
        .finally(() => {
          restartRef.current = null;
        });
      restartRef.current = run;
      return run;
    },
    [createSession, updateSessionFn]
  );

  // An older storefront's session whose total is not its cart's starts again
  // as soon as the page sees it, so the first Place pays what the page shows.
  const autoRestartsRef = useRef(0);
  useEffect(() => {
    if (!olderView || !session || olderView.empty) return;
    if (olderView.inSync) {
      if (session.selectedShippingRateId) autoRestartsRef.current = 0;
      return;
    }
    if (placeOrderInFlightRef.current || restartRef.current) return;
    if (staleSessionIdsRef.current.has(session.id)) return;
    if (autoRestartsRef.current >= MAX_AUTO_RESTARTS) return;
    autoRestartsRef.current += 1;
    void restartCheckout(session, { hideTotals: false });
  }, [olderView, session, restartCheckout]);

  const handleUpdateSession = useCallback(
    async (data?: Record<string, unknown>) => {
      if (!data) return;
      try {
        await updateSessionData(data as UpdateSessionRequest);
      } catch (err) {
        log.error("updateSession failed", {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    },
    [updateSessionData]
  );

  const handleCalculateShipping = useCallback(async () => {
    try {
      await calculateShippingData();
    } catch (err) {
      log.error("calculateShipping failed", {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }, [calculateShippingData]);

  const handlePlaceOrder = useCallback(async () => {
    if (refusal) return refusal;
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
    // The total on the page when the shopper pressed Place: the server
    // charges it or refuses.
    const older = !!session && isOlderStorefrontSession(session);
    const shownTotal = older ? olderTotals?.total : session?.totals?.total;
    const cartChanged = async () => {
      if (session) await restartCheckout(session);
      void checkCart();
      return {
        success: false,
        error: { message: CART_CHANGED_COPY, code: "TOTAL_CHANGED" },
      };
    };
    const refuseBeforePay = async () => {
      if (older && staleSessionIdsRef.current.has(session!.id)) {
        return cartChanged();
      }
      let liveCart;
      try {
        liveCart = await epReadCart();
      } catch (err) {
        log.warn("Cart read before payment failed", {
          error: err instanceof Error ? err.message : String(err),
        });
        if (!older) return null;
        return {
          success: false,
          error: { message: CART_UNREAD_COPY, code: "CART_UNREAD" },
        };
      }
      if (liveCart ? !hasPurchasableItem(liveCart.items) : older) {
        return {
          success: false,
          error: { message: EMPTY_CART_COPY, code: "EMPTY_CART" },
        };
      }
      if (older) {
        const view = olderCheckoutView(session!, liveCart);
        if (!view.inSync || view.totals?.total !== shownTotal) return cartChanged();
      }
      return null;
    };
    const pay = async (
      body: Record<string, unknown>
    ): Promise<Awaited<ReturnType<typeof placeOrderFn>>> => {
      const resp = await placeOrderFn(body);
      if (!older) return resp;
      if (resp?.error?.code === "CART_MISMATCH") return cartChanged();
      return withShopperCopy(resp);
    };
    try {
      // Free orders (zero total) need no card / gateway — the server settles
      // them with the manual gateway. Don't ask a registered gateway to
      // tokenize (there's no card to read).
      if (shownTotal === 0) {
        const refused = await refuseBeforePay();
        if (refused) return refused;
        return await pay({ gateway: "manual", shownTotal });
      }

      const gw = gatewayRef.current;
      if (!gw) {
        log.error(
          "placeOrder called but no gateway registered. " +
            "Place EPCloverPayment, EPStripePayment, or EPManualPayment inside this provider."
        );
        return {
          success: false,
          error: {
            message: "No payment method available",
            code: "NO_GATEWAY",
          },
        };
      }

      // A card check (3DS) from an earlier attempt is still open: its order
      // is held, so finish or cancel that check instead of taking a new card.
      if (
        session?.payment?.status === "requires_action" &&
        session.payment.gateway === gw.name &&
        typeof gw.completeRequiresAction === "function"
      ) {
        return await gw.completeRequiresAction(session);
      }

      const refused = await refuseBeforePay();
      if (refused) return refused;

      // Ask the gateway component for its data (e.g. tokenize the card)
      const gwData = await gw.confirm();
      const payResp = await pay({
        gateway: gw.name,
        ...gwData,
        ...(typeof shownTotal === "number" ? { shownTotal } : {}),
      });
      const paySession = payResp?.data?.session;

      // Gateway continuation: /pay left the session open with requires_action.
      // Run the widget's completeRequiresAction (if registered) so the form
      // stays in "placing" until checkout is actually complete or failed.
      // Gateways without completeRequiresAction (e.g. Clover) are unchanged.
      // A 409 PAYMENT_ACTION_PENDING carries a challenge an earlier pay
      // started; the same gateway finishes or cancels it.
      const pendingChallenge =
        payResp?.error?.code === "PAYMENT_ACTION_PENDING" &&
        paySession?.payment?.gateway === gw.name;
      if (
        (payResp?.success || pendingChallenge) &&
        paySession?.payment?.status === "requires_action" &&
        typeof gw.completeRequiresAction === "function"
      ) {
        return await gw.completeRequiresAction(paySession);
      }

      return payResp;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log.error("placeOrder failed", { message });
      return { success: false, error: { message } };
    } finally {
      placeOrderInFlightRef.current = false;
    }
  }, [refusal, placeOrderFn, session, olderTotals, restartCheckout, checkCart]);

  const handleConfirmPayment = useCallback(
    async (confirmData?: Record<string, unknown>) => {
      try {
        await confirmPaymentFn(confirmData ?? {});
      } catch (err) {
        log.error("confirmPayment failed", {
          error: err instanceof Error ? err.message : String(err),
        });
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
        log.error("resumePayment failed", { message });
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
      });
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
      session: shownSession,
      isLoading,
      error:
        (blocked ? createError?.message : null) ??
        (emptied ? EMPTY_CART_COPY : null) ??
        error?.message ??
        null,
      errorCode: (blocked ? createError?.code : null) ?? (emptied ? "EMPTY_CART" : null),
      updateSession: updateSessionData,
      calculateShipping: calculateShippingData,
      createSession: handleCreateSession,
      placeOrder: handlePlaceOrder,
      confirmPayment: handleConfirmPayment,
      resumePayment: handleResumePayment,
      reset: handleReset,
    }),
    [
      shownSession,
      isLoading,
      blocked,
      createError,
      emptied,
      error,
      updateSessionData,
      calculateShippingData,
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
    const mockData = {
      session: getMockSession(previewState),
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
      "Server-authoritative checkout session. Exposes checkoutSession data and mutation refActions. Drop payment components (EPCloverPayment / EPStripePayment / EPManualPayment) inside.",
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
          "Create a session on first render if none exists. The session checks out the shopper's own cart.",
        advanced: true,
      },
    },
    importPath: "@elasticpath/plasmic-ep-commerce-elastic-path",
    importName: "EPCheckoutSessionProvider",
    providesData: true,
    refActions: {
      createSession: {
        description:
          "Create a new checkout session for the shopper's own cart. The server takes the cart from the shopper's session; a Cart ID passed here is ignored.",
        argTypes: [{ name: "cartId", type: "string" }],
      },
      updateSession: {
        description:
          "Update session fields (customerInfo, shippingAddress, billingAddress, selectedShippingRateId). A changed shippingAddress requotes shipping rates.",
        argTypes: [{ name: "data", type: "object" }],
      },
      calculateShipping: {
        description:
          "Requote shipping rates on demand, for example after the cart changes. Saving a shipping address already requotes.",
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
          "Resume payment after a customer action (cart PaymentIntent sequence)",
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
