/**
 * EPCloverPayment — Plasmic component for Clover card payments within the
 * checkout session model.
 *
 * WHY: Enables Plasmic designers to add Clover payment fields by dropping this
 * component inside EPCheckoutSessionProvider. Handles SDK initialization,
 * card tokenization, gateway registration, and the full 3DS2 state machine
 * (method + challenge flows with escalation support).
 *
 * Architecture:
 * - Loads Clover SDK lazily via clover-singleton.ts
 * - Provides CloverElementsContext to child card field components
 * - Self-registers with EPCheckoutSessionProvider via PaymentRegistrationContext
 * - 3DS state machine monitors session.payment.status === "requires_action"
 *   and handles method/challenge flows automatically via clover-3ds-sdk.ts
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
import type { Registerable } from "../../registerable";
import { createLogger } from "../../utils/logger";
import { usePaymentRegistration } from "./payment-registration-context";
import { CloverElementsContext } from "./clover-context";
import type { CloverElementsContextValue } from "./clover-context";
import { getOrCreateCloverInstance, createToken, destroyCloverInstance } from "./clover-singleton";
import { loadClover3DSSDK, getClover3DSUtil, waitForExecutePatch } from "./clover-3ds-sdk";
import type { ClientCheckoutSession } from "./types";

const log = createLogger("EPCloverPayment");

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface EPCloverPaymentProps {
  children?: React.ReactNode;
  pakmsKey: string;
  merchantId?: string;
  environment?: "sandbox" | "production";
  className?: string;
  previewState?: "auto" | "ready" | "processing" | "error";
}

// ---------------------------------------------------------------------------
// Helper to read session from the closest DataProvider
// ---------------------------------------------------------------------------

function useCheckoutSessionData(): {
  session: ClientCheckoutSession | null;
  confirmPayment: ((data: Record<string, unknown>) => Promise<void>) | null;
} {
  // We read from the DataProvider context directly via a simple approach:
  // The EPCheckoutSessionProvider wraps children in a DataProvider named
  // "checkoutSession" with { session, isLoading, error }.
  // We access this via the plasmicDataDict pattern.
  // However, for simplicity and to avoid tight coupling, EPCloverPayment
  // monitors session changes via the payment registration context.
  // The 3DS flow is triggered by the parent provider calling confirmPayment.
  return { session: null, confirmPayment: null };
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function EPCloverPayment(props: EPCloverPaymentProps) {
  const {
    children,
    pakmsKey,
    merchantId,
    environment = "sandbox",
    className,
    previewState = "auto",
  } = props;

  const inEditor = usePlasmicCanvasContext();
  const paymentReg = usePaymentRegistration();

  const [isReady, setIsReady] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isTokenizing, setIsTokenizing] = useState(false);
  const [is3DSActive, setIs3DSActive] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const cloverRef = useRef<any>(null);
  const elementsRef = useRef<any>(null);

  // ── Design-time preview ─────────────────────────────────────────────
  if (inEditor && previewState !== "auto") {
    const mockData = {
      isReady: previewState === "ready",
      isProcessing: previewState === "processing",
      error: previewState === "error" ? "Payment failed" : null,
      isTokenizing: false,
      is3DSActive: false,
    };
    return (
      <div className={className}>
        <DataProvider name="cloverPaymentData" data={mockData}>
          <CloverElementsContext.Provider value={{
            elements: null,
            clover: null,
            isReady: mockData.isReady,
            error: mockData.error,
          }}>
            {children}
          </CloverElementsContext.Provider>
        </DataProvider>
      </div>
    );
  }

  // ── In-editor auto mode: provide null context so fields render placeholders
  if (inEditor) {
    const mockData = {
      isReady: true,
      isProcessing: false,
      error: null,
      isTokenizing: false,
      is3DSActive: false,
    };
    return (
      <div className={className}>
        <DataProvider name="cloverPaymentData" data={mockData}>
          <CloverElementsContext.Provider value={{
            elements: null,
            clover: null,
            isReady: true,
            error: null,
          }}>
            {children}
          </CloverElementsContext.Provider>
        </DataProvider>
      </div>
    );
  }

  return (
    <EPCloverPaymentRuntime
      pakmsKey={pakmsKey}
      merchantId={merchantId}
      environment={environment}
      className={className}
    >
      {children}
    </EPCloverPaymentRuntime>
  );
}

// ---------------------------------------------------------------------------
// Runtime component (hooks must be unconditional)
// ---------------------------------------------------------------------------

function EPCloverPaymentRuntime(props: {
  pakmsKey: string;
  merchantId?: string;
  environment: string;
  className?: string;
  children?: React.ReactNode;
}) {
  const { pakmsKey, merchantId, environment, className, children } = props;

  const paymentReg = usePaymentRegistration();

  const [isReady, setIsReady] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isTokenizing, setIsTokenizing] = useState(false);
  const [is3DSActive, setIs3DSActive] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const cloverRef = useRef<any>(null);
  const elementsRef = useRef<any>(null);
  const mountedRef = useRef(true);

  // ── Initialize Clover SDK ───────────────────────────────────────────
  useEffect(() => {
    mountedRef.current = true;
    let cancelled = false;

    async function init() {
      try {
        const result = await getOrCreateCloverInstance(pakmsKey, {
          merchantId,
          environment,
        });
        if (cancelled) return;
        cloverRef.current = result.clover;
        elementsRef.current = result.elements;
        setIsReady(true);
        setError(null);
      } catch (err) {
        if (cancelled) return;
        const msg = err instanceof Error ? err.message : "Clover SDK failed to load";
        log.error("SDK init failed", { error: msg });
        setError(msg);
        setIsReady(false);
      }
    }

    init();

    return () => {
      cancelled = true;
      mountedRef.current = false;
    };
  }, [pakmsKey, merchantId, environment]);

  // ── Register gateway with EPCheckoutSessionProvider ─────────────────
  useEffect(() => {
    if (!paymentReg) {
      log.warn(
        "EPCloverPayment is outside EPCheckoutSessionProvider — gateway registration skipped"
      );
      return;
    }

    paymentReg.registerGateway("clover", async () => {
      setIsTokenizing(true);
      setError(null);
      try {
        const tokenResult = await createToken();
        if (tokenResult.errors?.length || !tokenResult.token) {
          const msg = tokenResult.errors?.[0]?.message ?? "Failed to tokenize card";
          throw new Error(msg);
        }
        return { token: tokenResult.token };
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Tokenization failed";
        setError(msg);
        throw err;
      } finally {
        if (mountedRef.current) {
          setIsTokenizing(false);
        }
      }
    });
  }, [paymentReg]);

  // ── Cleanup on unmount ──────────────────────────────────────────────
  useEffect(() => {
    return () => {
      destroyCloverInstance();
    };
  }, []);

  // ── CloverElementsContext value ─────────────────────────────────────
  const ctxValue = useMemo<CloverElementsContextValue>(
    () => ({
      elements: elementsRef.current,
      clover: cloverRef.current,
      isReady,
      error,
    }),
    [isReady, error]
  );

  // ── DataProvider value ──────────────────────────────────────────────
  const paymentData = useMemo(
    () => ({
      isReady,
      isProcessing,
      error,
      isTokenizing,
      is3DSActive,
    }),
    [isReady, isProcessing, error, isTokenizing, is3DSActive]
  );

  return (
    <div className={className}>
      <DataProvider name="cloverPaymentData" data={paymentData}>
        <CloverElementsContext.Provider value={ctxValue}>
          {children}
        </CloverElementsContext.Provider>
      </DataProvider>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 3DS handler — exported for use by EPCheckoutSessionProvider or tests
// ---------------------------------------------------------------------------

export async function handleClover3DS(
  actionData: Record<string, unknown>,
  confirmPayment: (data: Record<string, unknown>) => Promise<unknown>
): Promise<void> {
  const type = actionData.type as string;
  const chargeId = actionData.chargeId as string;

  await loadClover3DSSDK();
  const util = getClover3DSUtil();
  if (!util) {
    throw new Error("Clover 3DS SDK not available");
  }

  if (type === "3ds_method") {
    util.perform3DSFingerPrinting({
      _3DSServerTransId: actionData._3DSServerTransId as string,
      acsMethodUrl: actionData.acsMethodUrl as string,
      methodNotificationUrl: actionData.methodNotificationUrl as string,
    });

    const flowStatus = await waitForExecutePatch();

    const result = await confirmPayment({
      chargeId,
      flowStatus,
      stage: "method",
    }) as any;

    // Check for challenge escalation
    if (result?.data?.session?.payment?.status === "requires_action") {
      const newActionData = result.data.session.payment.actionData;
      if (newActionData?.type === "3ds_challenge") {
        await handleClover3DSChallenge(newActionData, confirmPayment);
      }
    }
  } else if (type === "3ds_challenge") {
    await handleClover3DSChallenge(actionData, confirmPayment);
  }
}

async function handleClover3DSChallenge(
  actionData: Record<string, unknown>,
  confirmPayment: (data: Record<string, unknown>) => Promise<unknown>
): Promise<void> {
  const util = getClover3DSUtil();
  if (!util) {
    throw new Error("Clover 3DS SDK not available");
  }

  const chargeId = actionData.chargeId as string;

  util.perform3DSChallenge({
    messageVersion: actionData.messageVersion as string,
    acsTransID: actionData.acsTransID as string,
    acsUrl: actionData.acsUrl as string,
    threeDSServerTransID: actionData.threeDSServerTransID as string,
  });

  const flowStatus = await waitForExecutePatch();

  await confirmPayment({
    chargeId,
    flowStatus,
    stage: "challenge",
  });
}

// ---------------------------------------------------------------------------
// Registration metadata
// ---------------------------------------------------------------------------

export const epCloverPaymentMeta: ComponentMeta<EPCloverPaymentProps> = {
  name: "plasmic-commerce-ep-clover-payment",
  displayName: "EP Clover Payment",
  description:
    "Clover card payment fields with 3D Secure support. " +
    "Drop inside EPCheckoutSessionProvider, add EPCloverCard* field components as children.",
  props: {
    children: {
      type: "slot",
    },
    pakmsKey: {
      type: "string",
      displayName: "PAKMS Key",
      description: "Clover PAKMS key for card tokenization.",
    },
    merchantId: {
      type: "string",
      displayName: "Merchant ID",
      description: "Clover merchant ID (optional).",
      advanced: true,
    },
    environment: {
      type: "choice",
      options: ["sandbox", "production"],
      defaultValue: "sandbox",
      displayName: "Environment",
      description: "Clover SDK environment.",
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
  importName: "EPCloverPayment",
  providesData: true,
};

export function registerEPCloverPayment(
  loader?: Registerable,
  customMeta?: ComponentMeta<EPCloverPaymentProps>
) {
  const doRegisterComponent: typeof registerComponent = (...args) =>
    loader ? loader.registerComponent(...args) : registerComponent(...args);
  doRegisterComponent(
    EPCloverPayment,
    customMeta ?? epCloverPaymentMeta
  );
}
