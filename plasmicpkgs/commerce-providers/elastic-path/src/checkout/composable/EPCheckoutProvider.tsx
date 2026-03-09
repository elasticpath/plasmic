/**
 * EPCheckoutProvider — root orchestrator for the composable checkout flow.
 *
 * Wraps the useCheckout() state machine and exposes the complete checkout
 * state as `checkoutData` to descendant components via DataProvider.
 * Child components (EPCheckoutStepIndicator, EPCheckoutButton, etc.) read
 * from this context to adapt their presentation and behaviour to the
 * current checkout step.
 *
 * Nine refActions are exposed for Plasmic interaction wiring:
 *   nextStep, previousStep, goToStep, submitCustomerInfo,
 *   submitShippingAddress, submitBillingAddress, selectShippingRate,
 *   submitPayment, reset.
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
  useImperativeHandle,
  useMemo,
  useState,
} from "react";
import { Registerable } from "../../registerable";
import { useShopperContext } from "../../shopper-context/useShopperContext";
import { formatCurrencyFromCents } from "../../utils/formatCurrency";
import { createLogger } from "../../utils/logger";
import {
  MOCK_CHECKOUT_DATA_CUSTOMER_INFO,
  MOCK_CHECKOUT_DATA_SHIPPING,
  MOCK_CHECKOUT_DATA_PAYMENT,
  MOCK_CHECKOUT_DATA_CONFIRMATION,
} from "../../utils/design-time-data";
import { useCheckout } from "../hooks/use-checkout";
import { CheckoutStep } from "../types";
import type { AddressData, CheckoutFormData, ShippingRate } from "../types";
import { CheckoutPaymentContext } from "./CheckoutContext";

const log = createLogger("EPCheckoutProvider");

// ---------------------------------------------------------------------------
// Step order — matches CheckoutStep enum values
// ---------------------------------------------------------------------------
const STEP_ORDER: string[] = [
  CheckoutStep.CUSTOMER_INFO,
  CheckoutStep.SHIPPING,
  CheckoutStep.PAYMENT,
  CheckoutStep.CONFIRMATION,
];

const STEP_LABELS: Record<string, string> = {
  [CheckoutStep.CUSTOMER_INFO]: "Customer Info",
  [CheckoutStep.SHIPPING]: "Shipping",
  [CheckoutStep.PAYMENT]: "Payment",
  [CheckoutStep.CONFIRMATION]: "Confirmation",
};

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
type PreviewState =
  | "auto"
  | "customerInfo"
  | "shipping"
  | "payment"
  | "confirmation";

type PaymentStatus = "idle" | "pending" | "processing" | "succeeded" | "failed";

/** CustomerInfo exposed in checkoutData — uses split first/last name. */
interface CustomerInfo {
  firstName: string;
  lastName: string;
  email: string;
}

/** Normalized shipping rate exposed in checkoutData. */
interface NormalizedShippingRate {
  id: string;
  name: string;
  price: number;
  priceFormatted: string;
  currency: string;
  estimatedDays?: string;
  carrier?: string;
}

/** Summary totals exposed in checkoutData. */
interface CheckoutSummary {
  subtotal: number;
  subtotalFormatted: string;
  tax: number;
  taxFormatted: string;
  shipping: number;
  shippingFormatted: string;
  discount: number;
  discountFormatted: string;
  total: number;
  totalFormatted: string;
  currency: string;
  itemCount: number;
}

/** Full checkoutData shape exposed via DataProvider. */
export interface CheckoutData {
  step: string;
  stepIndex: number;
  totalSteps: number;
  canProceed: boolean;
  isProcessing: boolean;
  customerInfo: CustomerInfo | null;
  shippingAddress: AddressData | null;
  billingAddress: AddressData | null;
  sameAsShipping: boolean;
  selectedShippingRate: NormalizedShippingRate | null;
  order: any | null;
  paymentStatus: PaymentStatus;
  error: string | null;
  summary: CheckoutSummary;
}

// ---------------------------------------------------------------------------
// refActions interface
// ---------------------------------------------------------------------------
interface EPCheckoutProviderActions {
  nextStep(): void;
  previousStep(): void;
  goToStep(step: string): void;
  submitCustomerInfo(data: {
    firstName: string;
    lastName: string;
    email: string;
    shippingAddress: AddressData;
    sameAsShipping: boolean;
    billingAddress?: AddressData;
  }): void;
  submitShippingAddress(data: AddressData): void;
  submitBillingAddress(data: AddressData): void;
  selectShippingRate(rateId: string): void;
  submitPayment(): Promise<void>;
  reset(): void;
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------
interface EPCheckoutProviderProps {
  children?: React.ReactNode;
  loadingContent?: React.ReactNode;
  errorContent?: React.ReactNode;
  cartId?: string;
  apiBaseUrl?: string;
  autoAdvanceSteps?: boolean;
  previewState?: PreviewState;
  className?: string;
}

// ---------------------------------------------------------------------------
// Map previewState → mock data
// ---------------------------------------------------------------------------
const MOCK_MAP: Record<string, CheckoutData> = {
  customerInfo: MOCK_CHECKOUT_DATA_CUSTOMER_INFO as unknown as CheckoutData,
  shipping: MOCK_CHECKOUT_DATA_SHIPPING as unknown as CheckoutData,
  payment: MOCK_CHECKOUT_DATA_PAYMENT as unknown as CheckoutData,
  confirmation: MOCK_CHECKOUT_DATA_CONFIRMATION as unknown as CheckoutData,
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
export const EPCheckoutProvider = React.forwardRef<
  EPCheckoutProviderActions,
  EPCheckoutProviderProps
>(function EPCheckoutProvider(props, ref) {
  const {
    children,
    loadingContent,
    errorContent,
    cartId: cartIdProp,
    apiBaseUrl = "/api",
    autoAdvanceSteps = false,
    previewState = "auto",
    className,
  } = props;

  const inEditor = !!usePlasmicCanvasContext();

  // -----------------------------------------------------------------------
  // Design-time preview — return mock data, skip all hooks
  // -----------------------------------------------------------------------
  const useMock =
    previewState !== "auto" || (previewState === "auto" && inEditor);

  if (useMock && inEditor) {
    const mockKey =
      previewState === "auto" ? "customerInfo" : previewState;
    const mockData = MOCK_MAP[mockKey] ?? MOCK_MAP.customerInfo;
    return (
      <DataProvider name="checkoutData" data={mockData}>
        <div className={className} data-ep-checkout-provider="">
          {children}
        </div>
      </DataProvider>
    );
  }

  // -----------------------------------------------------------------------
  // Runtime — real checkout flow
  // -----------------------------------------------------------------------
  return (
    <EPCheckoutProviderRuntime
      ref={ref}
      cartIdProp={cartIdProp}
      apiBaseUrl={apiBaseUrl}
      autoAdvanceSteps={autoAdvanceSteps}
      className={className}
      loadingContent={loadingContent}
      errorContent={errorContent}
    >
      {children}
    </EPCheckoutProviderRuntime>
  );
});

// ---------------------------------------------------------------------------
// Runtime inner component — uses hooks (safe from conditional rendering)
// ---------------------------------------------------------------------------
interface EPCheckoutProviderRuntimeProps {
  children?: React.ReactNode;
  loadingContent?: React.ReactNode;
  errorContent?: React.ReactNode;
  cartIdProp?: string;
  apiBaseUrl: string;
  autoAdvanceSteps: boolean;
  className?: string;
}

const EPCheckoutProviderRuntime = React.forwardRef<
  EPCheckoutProviderActions,
  EPCheckoutProviderRuntimeProps
>(function EPCheckoutProviderRuntime(props, ref) {
  const {
    children,
    loadingContent,
    errorContent,
    cartIdProp,
    apiBaseUrl,
    autoAdvanceSteps,
    className,
  } = props;

  // Resolve cart ID: prop > ShopperContext override > undefined (server cookie)
  const shopperCtx = useShopperContext();
  const effectiveCartId = cartIdProp || shopperCtx.cartId || undefined;

  // Main checkout state machine
  const checkout = useCheckout({
    cartId: effectiveCartId,
    apiBaseUrl,
    autoAdvanceSteps,
  });

  // -----------------------------------------------------------------------
  // Local state for expanded data not tracked by useCheckout()
  // -----------------------------------------------------------------------
  const [customerInfo, setCustomerInfo] = useState<CustomerInfo | null>(null);
  const [sameAsShipping, setSameAsShipping] = useState(true);
  const [paymentStatus, setPaymentStatus] = useState<PaymentStatus>("idle");
  const [availableRates, setAvailableRates] = useState<ShippingRate[]>([]);
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [stripeElements, setStripeElements] = useState<any | null>(null);

  // -----------------------------------------------------------------------
  // Build normalized shipping rate from useCheckout state
  // -----------------------------------------------------------------------
  const selectedRate = checkout.state.selectedShippingRate;
  const normalizedRate = useMemo<NormalizedShippingRate | null>(() => {
    if (!selectedRate) return null;
    const currency = selectedRate.currency || "USD";
    return {
      id: selectedRate.id,
      name: selectedRate.name,
      price: selectedRate.amount,
      priceFormatted: formatCurrencyFromCents(selectedRate.amount, currency),
      currency,
      estimatedDays: selectedRate.delivery_time,
      carrier: selectedRate.carrier,
    };
  }, [selectedRate]);

  // -----------------------------------------------------------------------
  // Build summary — uses order data when available, otherwise defaults
  // -----------------------------------------------------------------------
  const summary = useMemo<CheckoutSummary>(() => {
    const order = checkout.state.order;
    if (order) {
      const currency = order.total.currency || "USD";
      const shipping = order.shipping?.amount ?? 0;
      return {
        subtotal: order.subtotal.amount,
        subtotalFormatted: formatCurrencyFromCents(order.subtotal.amount, currency),
        tax: order.tax.amount,
        taxFormatted: formatCurrencyFromCents(order.tax.amount, currency),
        shipping,
        shippingFormatted: shipping
          ? formatCurrencyFromCents(shipping, currency)
          : "$0.00",
        discount: 0,
        discountFormatted: "$0.00",
        total: order.total.amount,
        totalFormatted: formatCurrencyFromCents(order.total.amount, currency),
        currency,
        itemCount: order.relationships?.items?.data?.length ?? 0,
      };
    }

    // Pre-order: derive from selected shipping rate
    const shippingAmount = selectedRate?.amount ?? 0;
    const currency = selectedRate?.currency || "USD";
    return {
      subtotal: 0,
      subtotalFormatted: "$0.00",
      tax: 0,
      taxFormatted: "Calculated at next step",
      shipping: shippingAmount,
      shippingFormatted: shippingAmount
        ? formatCurrencyFromCents(shippingAmount, currency)
        : "TBD",
      discount: 0,
      discountFormatted: "$0.00",
      total: 0,
      totalFormatted: "$0.00",
      currency,
      itemCount: 0,
    };
  }, [checkout.state.order, selectedRate]);

  // -----------------------------------------------------------------------
  // Build checkoutData exposed via DataProvider
  // -----------------------------------------------------------------------
  const step = checkout.state.currentStep;
  const stepIndex = STEP_ORDER.indexOf(step);

  const checkoutData = useMemo<CheckoutData>(
    () => ({
      step,
      stepIndex: stepIndex >= 0 ? stepIndex : 0,
      totalSteps: 4,
      canProceed: checkout.canProceedToNext,
      isProcessing: checkout.state.isLoading,
      customerInfo,
      shippingAddress: checkout.state.shippingAddress ?? null,
      billingAddress: checkout.state.billingAddress ?? null,
      sameAsShipping,
      selectedShippingRate: normalizedRate,
      order: checkout.state.order ?? null,
      paymentStatus,
      error: checkout.state.error?.message ?? null,
      summary,
    }),
    [
      step,
      stepIndex,
      checkout.canProceedToNext,
      checkout.state.isLoading,
      checkout.state.shippingAddress,
      checkout.state.billingAddress,
      checkout.state.order,
      checkout.state.error,
      customerInfo,
      sameAsShipping,
      normalizedRate,
      paymentStatus,
      summary,
    ]
  );

  // -----------------------------------------------------------------------
  // refActions
  // -----------------------------------------------------------------------
  const handleSubmitCustomerInfo = useCallback(
    async (data: {
      firstName: string;
      lastName: string;
      email: string;
      shippingAddress: AddressData;
      sameAsShipping: boolean;
      billingAddress?: AddressData;
    }) => {
      setCustomerInfo({
        firstName: data.firstName,
        lastName: data.lastName,
        email: data.email,
      });
      setSameAsShipping(data.sameAsShipping);

      const billingAddr =
        data.sameAsShipping && !data.billingAddress
          ? data.shippingAddress
          : data.billingAddress ?? data.shippingAddress;

      const formData: CheckoutFormData = {
        customer: {
          name: `${data.firstName} ${data.lastName}`,
          email: data.email,
        },
        billingAddress: billingAddr,
        shippingAddress: data.shippingAddress,
        sameAsBilling: data.sameAsShipping,
      };

      await checkout.submitCustomerInfo(formData);
    },
    [checkout.submitCustomerInfo]
  );

  const handleSubmitShippingAddress = useCallback(
    (data: AddressData) => {
      // Store shipping address in checkout state by re-submitting customer info
      // with the new shipping address. If no customer info yet, this is a no-op.
      if (checkout.state.customerData) {
        checkout.submitCustomerInfo({
          customer: checkout.state.customerData,
          billingAddress: checkout.state.billingAddress!,
          shippingAddress: data,
          sameAsBilling: false,
        });
      }
    },
    [
      checkout.submitCustomerInfo,
      checkout.state.customerData,
      checkout.state.billingAddress,
    ]
  );

  const handleSubmitBillingAddress = useCallback(
    (data: AddressData) => {
      if (checkout.state.customerData) {
        checkout.submitCustomerInfo({
          customer: checkout.state.customerData,
          billingAddress: data,
          shippingAddress:
            checkout.state.shippingAddress ?? checkout.state.billingAddress,
          sameAsBilling: false,
        });
        setSameAsShipping(false);
      }
    },
    [
      checkout.submitCustomerInfo,
      checkout.state.customerData,
      checkout.state.shippingAddress,
      checkout.state.billingAddress,
    ]
  );

  const handleSelectShippingRate = useCallback(
    (rateId: string) => {
      const rate = availableRates.find((r) => r.id === rateId);
      if (rate) {
        checkout.selectShippingRate(rate);
      } else {
        log.warn("selectShippingRate: rate not found", { rateId });
      }
    },
    [checkout.selectShippingRate, availableRates]
  );

  const handleSubmitPayment = useCallback(async () => {
    try {
      setPaymentStatus("pending");

      // Step 1: Create order
      const order = await checkout.createOrder();
      log.debug("Order created", { orderId: order.id });

      // Step 2: Setup payment intent
      setPaymentStatus("processing");
      const { clientSecret: secret, transactionId } =
        await checkout.setupPayment(
          order.id,
          order.total.amount,
          order.total.currency
        );
      setClientSecret(secret);
      log.debug("Payment setup complete", { transactionId });

      // Step 3: Stripe confirmation happens via EPPaymentElements.
      // When EPPaymentElements completes confirmPayment, it calls
      // checkout.confirmPayment() and we move to confirmation step.
      // For now, we leave paymentStatus as "processing" — it will be
      // updated when confirmPayment completes via the checkout hook.
    } catch (err) {
      setPaymentStatus("failed");
      log.error("submitPayment failed", {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }, [checkout.createOrder, checkout.setupPayment]);

  const handleReset = useCallback(() => {
    checkout.reset();
    setCustomerInfo(null);
    setSameAsShipping(true);
    setPaymentStatus("idle");
    setAvailableRates([]);
    setClientSecret(null);
    setStripeElements(null);
  }, [checkout.reset]);

  useImperativeHandle(
    ref,
    () => ({
      nextStep: checkout.nextStep,
      previousStep: checkout.previousStep,
      goToStep: (stepName: string) => {
        const validStep = Object.values(CheckoutStep).find(
          (s) => s === stepName
        );
        if (validStep) {
          checkout.goToStep(validStep);
        }
      },
      submitCustomerInfo: handleSubmitCustomerInfo,
      submitShippingAddress: handleSubmitShippingAddress,
      submitBillingAddress: handleSubmitBillingAddress,
      selectShippingRate: handleSelectShippingRate,
      submitPayment: handleSubmitPayment,
      reset: handleReset,
    }),
    [
      checkout.nextStep,
      checkout.previousStep,
      checkout.goToStep,
      handleSubmitCustomerInfo,
      handleSubmitShippingAddress,
      handleSubmitBillingAddress,
      handleSelectShippingRate,
      handleSubmitPayment,
      handleReset,
    ]
  );

  // -----------------------------------------------------------------------
  // Checkout payment context — shares clientSecret + stripeElements
  // between this provider and EPPaymentElements
  // -----------------------------------------------------------------------
  const paymentCtxValue = useMemo(
    () => ({
      clientSecret,
      stripeElements,
      setStripeElements,
    }),
    [clientSecret, stripeElements]
  );

  // -----------------------------------------------------------------------
  // Render
  // -----------------------------------------------------------------------

  // Initial loading state (cart hydration)
  if (checkout.state.isLoading && !checkout.state.customerData && loadingContent) {
    return (
      <div className={className} data-ep-checkout-provider="">
        {loadingContent}
      </div>
    );
  }

  // Unrecoverable error
  if (checkout.state.error && errorContent) {
    return (
      <DataProvider name="checkoutData" data={checkoutData}>
        <div className={className} data-ep-checkout-provider="">
          {errorContent}
        </div>
      </DataProvider>
    );
  }

  return (
    <CheckoutPaymentContext.Provider value={paymentCtxValue}>
      <DataProvider name="checkoutData" data={checkoutData}>
        <div className={className} data-ep-checkout-provider="">
          {children}
        </div>
      </DataProvider>
    </CheckoutPaymentContext.Provider>
  );
});

// ---------------------------------------------------------------------------
// Registration metadata
// ---------------------------------------------------------------------------
export const epCheckoutProviderMeta: ComponentMeta<EPCheckoutProviderProps> = {
  name: "plasmic-commerce-ep-checkout-provider",
  displayName: "EP Checkout Provider",
  description:
    "Root orchestrator for the checkout flow. Wraps useCheckout() and exposes complete checkout state to descendant components.",
  props: {
    children: {
      type: "slot",
      defaultValue: [
        {
          type: "component",
          name: "plasmic-commerce-ep-checkout-step-indicator",
        },
        {
          type: "component",
          name: "plasmic-commerce-ep-checkout-button",
        },
      ],
    },
    loadingContent: {
      type: "slot",
      displayName: "Loading Content",
      hidePlaceholder: true,
    },
    errorContent: {
      type: "slot",
      displayName: "Error Content",
      hidePlaceholder: true,
    },
    cartId: {
      type: "string",
      displayName: "Cart ID",
      description:
        "Explicit cart ID. Falls back to ShopperContext override, then server cookie.",
      advanced: true,
    },
    apiBaseUrl: {
      type: "string",
      displayName: "API Base URL",
      defaultValue: "/api",
      advanced: true,
    },
    autoAdvanceSteps: {
      type: "boolean",
      displayName: "Auto-Advance Steps",
      defaultValue: false,
      description:
        "Automatically advance to the next step when the current step is completed.",
      advanced: true,
    },
    previewState: {
      type: "choice",
      options: ["auto", "customerInfo", "shipping", "payment", "confirmation"],
      defaultValue: "auto",
      displayName: "Preview State",
      description:
        "Force a preview state with sample data for design-time editing.",
      advanced: true,
    },
  },
  importPath: "@elasticpath/plasmic-ep-commerce-elastic-path",
  importName: "EPCheckoutProvider",
  providesData: true,
  refActions: {
    nextStep: {
      description: "Advance to the next checkout step",
      argTypes: [],
    },
    previousStep: {
      description: "Go back to the previous checkout step",
      argTypes: [],
    },
    goToStep: {
      description:
        "Navigate to a specific step (customer_info, shipping, payment, confirmation)",
      argTypes: [{ name: "step", type: "string" }],
    },
    submitCustomerInfo: {
      description: "Submit customer info and addresses",
      argTypes: [{ name: "data", type: "object" }],
    },
    submitShippingAddress: {
      description: "Update the shipping address",
      argTypes: [{ name: "data", type: "object" }],
    },
    submitBillingAddress: {
      description: "Update the billing address",
      argTypes: [{ name: "data", type: "object" }],
    },
    selectShippingRate: {
      description: "Select a shipping rate by ID",
      argTypes: [{ name: "rateId", type: "string" }],
    },
    submitPayment: {
      description:
        "Create order, setup Stripe payment intent, and begin payment confirmation",
      argTypes: [],
    },
    reset: {
      description: "Reset the entire checkout state to the beginning",
      argTypes: [],
    },
  },
};

export function registerEPCheckoutProvider(
  loader?: Registerable,
  customMeta?: ComponentMeta<EPCheckoutProviderProps>
) {
  const doRegisterComponent: typeof registerComponent = (...args) =>
    loader ? loader.registerComponent(...args) : registerComponent(...args);
  doRegisterComponent(
    EPCheckoutProvider,
    customMeta ?? epCheckoutProviderMeta
  );
}
