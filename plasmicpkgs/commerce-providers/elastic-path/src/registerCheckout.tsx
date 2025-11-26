import { registerEPCheckoutForm } from "./registerEPCheckoutForm";
import { registerEPPaymentForm } from "./registerEPPaymentForm";
import { registerEPOrderSummary } from "./registerEPOrderSummary";
import { registerEPCheckoutConfirmation } from "./registerEPCheckoutConfirmation";

export function registerEPCheckout() {
  registerEPCheckoutForm();
  registerEPPaymentForm();
  registerEPOrderSummary();
  registerEPCheckoutConfirmation();
}

// Export individual registration functions
export {
  registerEPCheckoutForm,
  registerEPPaymentForm,
  registerEPOrderSummary,
  registerEPCheckoutConfirmation,
};

// Export component metas for advanced usage
export {
  epCheckoutFormMeta,
} from "./registerEPCheckoutForm";
export {
  epPaymentFormMeta,
} from "./registerEPPaymentForm";
export {
  epOrderSummaryMeta,
} from "./registerEPOrderSummary";
export {
  epCheckoutConfirmationMeta,
} from "./registerEPCheckoutConfirmation";