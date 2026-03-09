/**
 * EPCheckoutStepIndicator — repeater over the 4 checkout steps.
 *
 * Each iteration receives a `currentStep` DataProvider so the designer can
 * bind any element to step names, completion status, and active state.
 * Zero rendering opinions — the designer controls all visual presentation.
 */
import {
  DataProvider,
  repeatedElement,
  useSelector,
  usePlasmicCanvasContext,
} from "@plasmicapp/host";
import registerComponent, {
  ComponentMeta,
} from "@plasmicapp/host/registerComponent";
import React from "react";
import { Registerable } from "../../registerable";
import { MOCK_CHECKOUT_STEP_DATA } from "../../utils/design-time-data";

// ---------------------------------------------------------------------------
// Step definitions
// ---------------------------------------------------------------------------
const STEPS = [
  { key: "customer_info", name: "Customer Info" },
  { key: "shipping", name: "Shipping" },
  { key: "payment", name: "Payment" },
  { key: "confirmation", name: "Confirmation" },
];

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
type PreviewState = "auto" | "withData";

interface EPCheckoutStepIndicatorProps {
  children?: React.ReactNode;
  className?: string;
  previewState?: PreviewState;
}

// ---------------------------------------------------------------------------
// Build step data for a given stepIndex
// ---------------------------------------------------------------------------
function buildStepData(stepIndex: number) {
  return STEPS.map((step, i) => ({
    name: step.name,
    stepKey: step.key,
    index: i,
    isActive: i === stepIndex,
    isCompleted: i < stepIndex,
    isFuture: i > stepIndex,
  }));
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
export function EPCheckoutStepIndicator(props: EPCheckoutStepIndicatorProps) {
  const { children, className, previewState = "auto" } = props;

  const checkoutData = useSelector("checkoutData") as
    | { stepIndex?: number }
    | undefined;
  const inEditor = !!usePlasmicCanvasContext();

  const useMock =
    previewState === "withData" ||
    (previewState === "auto" && inEditor);

  // Design-time mock: stepIndex=1 (Shipping active, Customer Info completed)
  const stepIndex = useMock
    ? 1
    : checkoutData?.stepIndex ?? 0;

  const steps = useMock ? MOCK_CHECKOUT_STEP_DATA : buildStepData(stepIndex);

  return (
    <div className={className} data-ep-checkout-step-indicator="" role="list" aria-label="Checkout steps">
      {steps.map((step, i) => (
        <div key={step.stepKey} role="listitem">
          <DataProvider name="currentStep" data={step}>
            <DataProvider name="currentStepIndex" data={i}>
              {repeatedElement(i, children)}
            </DataProvider>
          </DataProvider>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Registration metadata
// ---------------------------------------------------------------------------
export const epCheckoutStepIndicatorMeta: ComponentMeta<EPCheckoutStepIndicatorProps> =
  {
    name: "plasmic-commerce-ep-checkout-step-indicator",
    displayName: "EP Checkout Step Indicator",
    description:
      "Repeats children once per checkout step (Customer Info, Shipping, Payment, Confirmation). Each iteration exposes step name, index, and active/completed/future status.",
    props: {
      children: {
        type: "slot",
        defaultValue: [
          {
            type: "hbox",
            children: [
              { type: "text", value: "Step" },
            ],
          },
        ],
      },
      previewState: {
        type: "choice",
        options: ["auto", "withData"],
        defaultValue: "auto",
        displayName: "Preview State",
        description:
          "Force a preview state with sample data for design-time editing",
        advanced: true,
      },
    },
    importPath: "@elasticpath/plasmic-ep-commerce-elastic-path",
    importName: "EPCheckoutStepIndicator",
    providesData: true,
    parentComponentName: "plasmic-commerce-ep-checkout-provider",
  };

export function registerEPCheckoutStepIndicator(
  loader?: Registerable,
  customMeta?: ComponentMeta<EPCheckoutStepIndicatorProps>
) {
  const doRegisterComponent: typeof registerComponent = (...args) =>
    loader ? loader.registerComponent(...args) : registerComponent(...args);
  doRegisterComponent(
    EPCheckoutStepIndicator,
    customMeta ?? epCheckoutStepIndicatorMeta
  );
}
