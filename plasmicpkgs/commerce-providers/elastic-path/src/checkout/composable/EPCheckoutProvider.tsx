/**
 * EPCheckoutProvider — root orchestrator for the composable checkout flow.
 *
 * Wraps `useCheckout()` and exposes complete checkout state via
 * `checkoutData` DataProvider. Provides 9 refActions callable from
 * Plasmic interactions. Works with or without EPShopperContextProvider.
 *
 * Also sets a checkout-scoped React context so EPPaymentElements can
 * read the `clientSecret` and expose its `elements` instance back.
 */
import {
  DataProvider,
  useSelector,
  usePlasmicCanvasContext,
} from "@plasmicapp/host";
import registerComponent, {
  CodeComponentMeta,
} from "@plasmicapp/host/registerComponent";
import React, {
  createContext,
  useCallback,
  useContext,
  useImperativeHandle,
  useMemo,
  useState,
} from "react";
import { Registerable } from "../../registerable";
import { getCartId } from "../../utils/cart-cookie";
import {
  MOCK_CHECKOUT_DATA_CUSTOMER_INFO,
  MOCK_CHECKOUT_DATA_SHIPPING,
  MOCK_CHECKOUT_DATA_PAYMENT,
  MOCK_CHECKOUT_DATA_CONFIRMATION,
} from "../../utils/design-time-data";
import { createLogger } from "../../utils/logger";
import { useCheckout } from "../hooks/use-checkout";
import { CheckoutStep } from "../types";
import type {
  AddressData,
  CheckoutFormData,
  ElasticPathOrder,
  ShippingRate,
} from "../types";

const log = createLogger("EPCheckoutProvider");

// ---------------------------------------------------------------------------
// Checkout-scoped context for EPPaymentElements ↔ EPCheckoutProvider
// ---------------------------------------------------------------------------
interface CheckoutInternalContextValue {
  clientSecret: string | null;
  setElements: (elements: any) => void;
  elements: any;
}

export const CheckoutInternalContext =
  createContext<CheckoutInternalContextValue>({
    clientSecret: null,
    setElements: () => {},
    elements: null,
  });

export function useCheckoutInternal() {
  return useContext(CheckoutInternalContext);
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
type PreviewState =
  | "auto"
  | "customerInfo"
  | "shipping"
  | "payment"
  | "confirmation";

interface EPCheckoutProviderActions {
  nextStep(): void;
  previousStep(): void;
  goToStep(step: "customer_info" | "shipping" | "payment" | "confirmation"): void;
  submitCustomerInfo(data: {
    firstName: string;
    lastName: string;
    email: string;
    shippingAddress: AddressData;
    sameAsShipping: boolean;
    billingAddress?: AddressData;
  }): Promise<void>;
  submitShippingAddress(data: AddressData): void;
  submitBillingAddress(data: AddressData): void;
  selectShippingRate(rateId: string): void;
  submitPayment(): Promise<void>;
  reset(): void;
}

interface EPCheckoutProviderProps {
  children?: React.ReactNode;
  loadingContent?: React.ReactNode;
  errorContent?: React.ReactNode;
  cartId?: string;
  apiBaseUrl?: string;
  autoAdvanceSteps?: boolean;
  previewState?: PreviewState;
  className?: string;
  onComplete?: (data: { orderId: string }) => void;
}

// ---------------------------------------------------------------------------
// Step label / index helpers
// ---------------------------------------------------------------------------
const STEP_ORDER: CheckoutStep[] = [
  CheckoutStep.CUSTOMER_INFO,
  CheckoutStep.SHIPPING,
  CheckoutStep.PAYMENT,
  CheckoutStep.CONFIRMATION,
];

function stepToIndex(step: CheckoutStep): number {
  const i = STEP_ORDER.indexOf(step);
  return i >= 0 ? i : 0;
}

// ---------------------------------------------------------------------------
// Mock map for design-time
// ---------------------------------------------------------------------------
const MOCK_MAP: Record<string, any> = {
  customerInfo: MOCK_CHECKOUT_DATA_CUSTOMER_INFO,
  shipping: MOCK_CHECKOUT_DATA_SHIPPING,
  payment: MOCK_CHECKOUT_DATA_PAYMENT,
  confirmation: MOCK_CHECKOUT_DATA_CONFIRMATION,
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
    onComplete,
  } = props;

  const inEditor = !!usePlasmicCanvasContext();

  // Design-time preview — return mock data without hooks
  if (inEditor && previewState !== "auto") {
    const mockData = MOCK_MAP[previewState] ?? MOCK_MAP.customerInfo;
    return (
      <DataProvider name="checkoutData" data={mockData}>
        <div className={className} data-ep-checkout-provider="">
          {children}
        </div>
      </DataProvider>
    );
  }

  // Editor auto mode with no runtime — show customer info mock
  if (inEditor) {
    return (
      <DataProvider name="checkoutData" data={MOCK_MAP.customerInfo}>
        <div className={className} data-ep-checkout-provider="">
          {children}
        </div>
      </DataProvider>
    );
  }

  return (
    <EPCheckoutProviderRuntime
      ref={ref}
      cartId={cartIdProp}
      apiBaseUrl={apiBaseUrl}
      autoAdvanceSteps={autoAdvanceSteps}
      className={className}
      loadingContent={loadingContent}
      errorContent={errorContent}
      onComplete={onComplete}
    >
      {children}
    </EPCheckoutProviderRuntime>
  );
});

// ---------------------------------------------------------------------------
// Runtime (hooks-safe inner component)
// ---------------------------------------------------------------------------
interface RuntimeProps {
  children?: React.ReactNode;
  loadingContent?: React.ReactNode;
  errorContent?: React.ReactNode;
  cartId?: string;
  apiBaseUrl: string;
  autoAdvanceSteps: boolean;
  className?: string;
  onComplete?: (data: { orderId: string }) => void;
}

const EPCheckoutProviderRuntime = React.forwardRef<
  EPCheckoutProviderActions,
  RuntimeProps
>(function EPCheckoutProviderRuntime(props, ref) {
  const {
    children,
    loadingContent,
    errorContent,
    cartId: cartIdProp,
    apiBaseUrl,
    autoAdvanceSteps,
    className,
    onComplete,
  } = props;

  // Resolve cart ID: prop → cookie
  const resolvedCartId = cartIdProp || getCartId() || undefined;

  const checkout = useCheckout({
    cartId: resolvedCartId,
    apiBaseUrl,
    autoAdvanceSteps,
    onComplete: onComplete
      ? (order: ElasticPathOrder) => onComplete({ orderId: order.id })
      : undefined,
  });

  const { state } = checkout;

  // Internal context for EPPaymentElements ↔ provider communication
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [elements, setElements] = useState<any>(null);

  // Local copies of submitted addresses (for checkoutData shape)
  const [submittedShippingAddress, setSubmittedShippingAddress] =
    useState<AddressData | null>(null);
  const [submittedBillingAddress, setSubmittedBillingAddress] =
    useState<AddressData | null>(null);
  const [sameAsShipping, setSameAsShipping] = useState(true);
  const [paymentStatus, setPaymentStatus] = useState<
    "idle" | "pending" | "processing" | "succeeded" | "failed"
  >("idle");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Build the formatted summary from state
  const summary = useMemo(() => {
    const cur = state.order?.total?.currency ?? "USD";
    const fmt = (cents: number) => {
      try {
        return new Intl.NumberFormat("en-US", {
          style: "currency",
          currency: cur,
        }).format(cents / 100);
      } catch {
        return `$${(cents / 100).toFixed(2)}`;
      }
    };

    const subtotal = state.order?.subtotal?.amount ?? 0;
    const tax = state.order?.tax?.amount ?? 0;
    const shipping = state.selectedShippingRate?.amount ?? 0;
    const total = state.order?.total?.amount ?? subtotal + tax + shipping;

    return {
      subtotal,
      subtotalFormatted: fmt(subtotal),
      tax,
      taxFormatted: tax > 0 ? fmt(tax) : "Calculated at next step",
      shipping,
      shippingFormatted:
        state.selectedShippingRate != null ? fmt(shipping) : "TBD",
      discount: 0,
      discountFormatted: fmt(0),
      total,
      totalFormatted: fmt(total),
      currency: cur,
      itemCount: state.order?.relationships?.items?.data?.length ?? 0,
    };
  }, [state.order, state.selectedShippingRate]);

  // Derive customerInfo from state
  const customerInfo = useMemo(() => {
    if (!state.customerData) return null;
    const parts = (state.customerData.name ?? "").split(/\s+/);
    return {
      firstName: parts[0] ?? "",
      lastName: parts.slice(1).join(" "),
      email: state.customerData.email ?? "",
    };
  }, [state.customerData]);

  // Actions
  const nextStep = useCallback(() => {
    checkout.nextStep();
  }, [checkout.nextStep]);

  const previousStep = useCallback(() => {
    checkout.previousStep();
  }, [checkout.previousStep]);

  const goToStep = useCallback(
    (step: "customer_info" | "shipping" | "payment" | "confirmation") => {
      checkout.goToStep(step as CheckoutStep);
    },
    [checkout.goToStep]
  );

  const submitCustomerInfo = useCallback(
    async (data: {
      firstName: string;
      lastName: string;
      email: string;
      shippingAddress: AddressData;
      sameAsShipping: boolean;
      billingAddress?: AddressData;
    }) => {
      setErrorMsg(null);
      const billingAddr =
        data.sameAsShipping || !data.billingAddress
          ? data.shippingAddress
          : data.billingAddress;
      setSameAsShipping(data.sameAsShipping);
      setSubmittedShippingAddress(data.shippingAddress);
      setSubmittedBillingAddress(billingAddr);

      const formData: CheckoutFormData = {
        customer: {
          name: `${data.firstName} ${data.lastName}`.trim(),
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

  const submitShippingAddress = useCallback(
    (data: AddressData) => {
      setSubmittedShippingAddress(data);
    },
    []
  );

  const submitBillingAddress = useCallback(
    (data: AddressData) => {
      setSubmittedBillingAddress(data);
    },
    []
  );

  const selectShippingRate = useCallback(
    (rateId: string) => {
      // Find rate by ID - create a minimal ShippingRate if needed
      const rate: ShippingRate = {
        id: rateId,
        name: "",
        amount: 0,
        currency: "USD",
        service_level: "",
      };
      checkout.selectShippingRate(rate);
    },
    [checkout.selectShippingRate]
  );

  const submitPayment = useCallback(async () => {
    setErrorMsg(null);
    setPaymentStatus("processing");
    try {
      // Step 1: Create order
      log.debug("Creating order...");
      const order = await checkout.createOrder();

      // Step 2: Setup payment
      log.debug("Setting up payment...", { orderId: order.id });
      const { clientSecret: secret, transactionId } =
        await checkout.setupPayment(
          order.id,
          checkout.totalAmount || order.total.amount,
          order.total.currency
        );

      setClientSecret(secret);
      setPaymentStatus("pending");

      // Step 3: Wait for Stripe confirmation from EPPaymentElements
      // EPPaymentElements calls stripe.confirmPayment(), then the user
      // triggers confirm via a Plasmic interaction that calls this provider's
      // confirmPayment if needed. For now, the clientSecret is set for
      // EPPaymentElements to pick up.
      log.debug("Payment setup complete, clientSecret set for EPPaymentElements");
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : "Payment failed";
      setErrorMsg(msg);
      setPaymentStatus("failed");
      log.error("Payment failed", err);
    }
  }, [checkout.createOrder, checkout.setupPayment, checkout.totalAmount]);

  const reset = useCallback(() => {
    checkout.reset();
    setClientSecret(null);
    setElements(null);
    setSubmittedShippingAddress(null);
    setSubmittedBillingAddress(null);
    setSameAsShipping(true);
    setPaymentStatus("idle");
    setErrorMsg(null);
  }, [checkout.reset]);

  useImperativeHandle(
    ref,
    () => ({
      nextStep,
      previousStep,
      goToStep,
      submitCustomerInfo,
      submitShippingAddress,
      submitBillingAddress,
      selectShippingRate,
      submitPayment,
      reset,
    }),
    [
      nextStep,
      previousStep,
      goToStep,
      submitCustomerInfo,
      submitShippingAddress,
      submitBillingAddress,
      selectShippingRate,
      submitPayment,
      reset,
    ]
  );

  // Build checkoutData shape
  const checkoutData = useMemo(
    () => ({
      step: state.currentStep,
      stepIndex: stepToIndex(state.currentStep),
      totalSteps: 4,
      canProceed: checkout.canProceedToNext,
      isProcessing: state.isLoading,
      customerInfo,
      shippingAddress: submittedShippingAddress ?? state.shippingAddress ?? null,
      billingAddress: submittedBillingAddress ?? state.billingAddress ?? null,
      sameAsShipping,
      selectedShippingRate: state.selectedShippingRate
        ? {
            id: state.selectedShippingRate.id,
            name: state.selectedShippingRate.name,
            price: state.selectedShippingRate.amount,
            priceFormatted: new Intl.NumberFormat("en-US", {
              style: "currency",
              currency: state.selectedShippingRate.currency || "USD",
            }).format(state.selectedShippingRate.amount / 100),
            currency: state.selectedShippingRate.currency || "USD",
            estimatedDays: state.selectedShippingRate.delivery_time,
            carrier: state.selectedShippingRate.carrier,
          }
        : null,
      order: state.order ?? null,
      paymentStatus,
      error: errorMsg ?? (state.error?.message || null),
      summary,
    }),
    [
      state.currentStep,
      state.isLoading,
      state.shippingAddress,
      state.billingAddress,
      state.selectedShippingRate,
      state.order,
      state.error,
      checkout.canProceedToNext,
      customerInfo,
      submittedShippingAddress,
      submittedBillingAddress,
      sameAsShipping,
      paymentStatus,
      errorMsg,
      summary,
    ]
  );

  // Loading state on initial mount (cart hydration)
  if (state.isLoading && !state.customerData && loadingContent) {
    return (
      <div className={className} data-ep-checkout-provider="">
        {loadingContent}
      </div>
    );
  }

  // Error state
  if (state.error && !state.customerData && errorContent) {
    return (
      <DataProvider name="checkoutData" data={checkoutData}>
        <div className={className} data-ep-checkout-provider="">
          {errorContent}
        </div>
      </DataProvider>
    );
  }

  // No cart
  if (!resolvedCartId && errorContent) {
    return (
      <DataProvider
        name="checkoutData"
        data={{ ...checkoutData, error: "No active cart found" }}
      >
        <div className={className} data-ep-checkout-provider="">
          {errorContent}
        </div>
      </DataProvider>
    );
  }

  const internalCtx: CheckoutInternalContextValue = {
    clientSecret,
    setElements,
    elements,
  };

  return (
    <CheckoutInternalContext.Provider value={internalCtx}>
      <DataProvider name="checkoutData" data={checkoutData}>
        <div className={className} data-ep-checkout-provider="">
          {children}
        </div>
      </DataProvider>
    </CheckoutInternalContext.Provider>
  );
});

// ---------------------------------------------------------------------------
// Registration metadata
// ---------------------------------------------------------------------------
export const epCheckoutProviderMeta: CodeComponentMeta<EPCheckoutProviderProps> = {
  name: "plasmic-commerce-ep-checkout-provider",
  displayName: "EP Checkout Provider",
  description:
    "Root orchestrator for the composable checkout flow. Wraps useCheckout() and exposes checkoutData for designer binding.",
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
      renderPropParams: [],
    },
    errorContent: {
      type: "slot",
      displayName: "Error Content",
      renderPropParams: [],
    },
    cartId: {
      type: "string",
      displayName: "Cart ID",
      description: "Explicit cart ID; falls back to cookie",
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
      description: "Auto-advance to next step on submit completion",
      defaultValue: false,
    },
    previewState: {
      type: "choice",
      options: ["auto", "customerInfo", "shipping", "payment", "confirmation"],
      defaultValue: "auto",
      displayName: "Preview State",
      description: "Force a preview state for design-time editing",
      advanced: true,
    },
  },
  importPath: "@elasticpath/plasmic-ep-commerce-elastic-path",
  importName: "EPCheckoutProvider",
  providesData: true,
  refActions: {
    nextStep: {
      displayName: "Next Step",
      argTypes: [],
    },
    previousStep: {
      displayName: "Previous Step",
      argTypes: [],
    },
    goToStep: {
      displayName: "Go To Step",
      argTypes: [
        {
          name: "step",
          type: "string",
          displayName: "Step key",
        },
      ],
    },
    submitCustomerInfo: {
      displayName: "Submit Customer Info",
      argTypes: [
        {
          name: "data",
          type: "object",
          displayName: "Customer data",
        },
      ],
    },
    submitShippingAddress: {
      displayName: "Submit Shipping Address",
      argTypes: [
        {
          name: "data",
          type: "object",
          displayName: "Address data",
        },
      ],
    },
    submitBillingAddress: {
      displayName: "Submit Billing Address",
      argTypes: [
        {
          name: "data",
          type: "object",
          displayName: "Address data",
        },
      ],
    },
    selectShippingRate: {
      displayName: "Select Shipping Rate",
      argTypes: [
        {
          name: "rateId",
          type: "string",
          displayName: "Rate ID",
        },
      ],
    },
    submitPayment: {
      displayName: "Submit Payment",
      argTypes: [],
    },
    reset: {
      displayName: "Reset Checkout",
      argTypes: [],
    },
  },
};

export function registerEPCheckoutProvider(
  loader?: Registerable,
  customMeta?: CodeComponentMeta<EPCheckoutProviderProps>
) {
  const doRegisterComponent: typeof registerComponent = (...args) =>
    loader ? loader.registerComponent(...args) : registerComponent(...args);
  doRegisterComponent(
    EPCheckoutProvider,
    customMeta ?? epCheckoutProviderMeta
  );
}
