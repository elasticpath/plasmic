/**
 * EPCheckoutStepIndicator — repeater over the 4 checkout steps.
 *
 * Each iteration provides a `currentStep` DataProvider so the designer
 * can bind any element to step names, completion status, and active state.
 * Zero rendering opinions — the designer controls all visual presentation.
 */
import {
  DataProvider,
  repeatedElement,
  useSelector,
  usePlasmicCanvasContext,
} from "@plasmicapp/host";
import registerComponent, {
  CodeComponentMeta,
} from "@plasmicapp/host/registerComponent";
import React from "react";
import { Registerable } from "../../registerable";
import { MOCK_CHECKOUT_STEP_DATA } from "../../utils/design-time-data";

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
// Step definitions
// ---------------------------------------------------------------------------
const STEPS = [
  { key: "customer_info", name: "Customer Info" },
  { key: "shipping", name: "Shipping" },
  { key: "payment", name: "Payment" },
  { key: "confirmation", name: "Confirmation" },
];

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
export function EPCheckoutStepIndicator(props: EPCheckoutStepIndicatorProps) {
  const { children, className, previewState = "auto" } = props;

  const inEditor = !!usePlasmicCanvasContext();

  // Read stepIndex from EPCheckoutProvider's checkoutData
  const checkoutData = useSelector("checkoutData") as
    | { stepIndex?: number }
    | undefined;

  const stepIndex = checkoutData?.stepIndex ?? 0;

  // Design-time: when no context or forced preview
  const useMock =
    previewState === "withData" ||
    (previewState === "auto" && !checkoutData && inEditor);

  const stepsData = useMock
    ? MOCK_CHECKOUT_STEP_DATA
    : STEPS.map((s, i) => ({
        name: s.name,
        stepKey: s.key,
        index: i,
        isActive: stepIndex === i,
        isCompleted: stepIndex > i,
        isFuture: stepIndex < i,
      }));

  return (
    <div className={className} data-ep-checkout-step-indicator="">
      {stepsData.map((step, i) => (
        <DataProvider key={step.stepKey} name="currentStep" data={step}>
          <DataProvider name="currentStepIndex" data={i}>
            {repeatedElement(i, children)}
          </DataProvider>
        </DataProvider>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Registration metadata
// ---------------------------------------------------------------------------
export const epCheckoutStepIndicatorMeta: CodeComponentMeta<EPCheckoutStepIndicatorProps> =
  {
    name: "plasmic-commerce-ep-checkout-step-indicator",
    displayName: "EP Checkout Step Indicator",
    description:
      "Repeats children for each of the 4 checkout steps, exposing step name, active/completed/future state per iteration.",
    props: {
      children: {
        type: "slot",
        defaultValue: [
          {
            type: "hbox",
            children: [
              { type: "text", value: "Step" },
              { type: "text", value: "Name" },
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
          "Force sample data for design-time editing",
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
  customMeta?: CodeComponentMeta<EPCheckoutStepIndicatorProps>
) {
  const doRegisterComponent: typeof registerComponent = (...args) =>
    loader ? loader.registerComponent(...args) : registerComponent(...args);
  doRegisterComponent(
    EPCheckoutStepIndicator,
    customMeta ?? epCheckoutStepIndicatorMeta
  );
}
