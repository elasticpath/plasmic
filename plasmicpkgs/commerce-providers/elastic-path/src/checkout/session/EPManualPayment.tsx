/**
 * EPManualPayment — Studio component that selects the EP Manual gateway.
 *
 * Drop inside EPCheckoutSessionProvider. Registers gateway "manual" with
 * PaymentRegistrationContext so placeOrder() posts `{ gateway: "manual" }`.
 * No card fields, credentials, or customer-action continuation.
 * Purchase vs authorize is not exposed; the server adapter chooses.
 */
import {
  DataProvider,
  usePlasmicCanvasContext,
} from "@plasmicapp/host";
import registerComponent, {
  CodeComponentMeta,
} from "@plasmicapp/host/registerComponent";
import React, { useCallback, useEffect } from "react";
import type { Registerable } from "../../registerable";
import { createLogger } from "../../utils/logger";
import { usePaymentRegistration } from "./payment-registration-context";

const log = createLogger("EPManualPayment");

export interface EPManualPaymentProps {
  children?: React.ReactNode;
  className?: string;
}

const READY_DATA = { isReady: true, isProcessing: false, error: null };

function ManualPaymentShell(props: {
  className?: string;
  children?: React.ReactNode;
  showPlaceholder: boolean;
}) {
  const { className, children, showPlaceholder } = props;
  return (
    <div
      className={className}
      data-ep-manual-payment=""
    >
      <DataProvider name="manualPaymentData" data={READY_DATA}>
        {showPlaceholder ? (
          <div
            style={{
              border: "1px solid #e0e0e0",
              borderRadius: "8px",
              padding: "16px",
              background: "#fafafa",
              fontSize: "13px",
              color: "#666",
            }}
          >
            Manual payment — no card details required
          </div>
        ) : null}
        {children}
      </DataProvider>
    </div>
  );
}

export function EPManualPayment(props: EPManualPaymentProps) {
  const { children, className } = props;
  const inEditor = !!usePlasmicCanvasContext();
  const paymentReg = usePaymentRegistration();

  const confirmGateway = useCallback(async () => ({}), []);

  useEffect(() => {
    if (inEditor) return;
    if (!paymentReg) {
      log.warn(
        "EPManualPayment is outside EPCheckoutSessionProvider — gateway registration skipped"
      );
      return;
    }
    paymentReg.registerGateway("manual", confirmGateway);
  }, [inEditor, paymentReg, confirmGateway]);

  const showPlaceholder = inEditor;

  return (
    <ManualPaymentShell
      className={className}
      showPlaceholder={showPlaceholder}
    >
      {children}
    </ManualPaymentShell>
  );
}

export const epManualPaymentMeta: CodeComponentMeta<EPManualPaymentProps> = {
  name: "plasmic-commerce-ep-manual-payment",
  displayName: "EP Manual Payment",
  description:
    "Selects Elastic Path Manual payment (no card), for offline or invoice payment. Drop inside EP Checkout Session Provider. " +
    "A zero-total order completes without it. For an order with a total, the server allows Manual only when the host registers the Manual adapter with a rule that allows it for that cart and account; otherwise Place Order fails.",
  props: {
    children: { type: "slot" },
  },
  importPath: "@elasticpath/plasmic-ep-commerce-elastic-path",
  importName: "EPManualPayment",
  providesData: true,
};

export function registerEPManualPayment(
  loader?: Registerable,
  customMeta?: CodeComponentMeta<EPManualPaymentProps>
) {
  const doRegisterComponent: typeof registerComponent = (...args) =>
    loader ? loader.registerComponent(...args) : registerComponent(...args);
  doRegisterComponent(EPManualPayment, customMeta ?? epManualPaymentMeta);
}
