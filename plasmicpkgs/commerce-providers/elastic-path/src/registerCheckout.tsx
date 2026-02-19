import { registerEPCheckoutForm } from "./registerEPCheckoutForm";
import { registerEPPaymentForm } from "./registerEPPaymentForm";
import { registerEPOrderSummary } from "./registerEPOrderSummary";
import { registerEPCheckoutConfirmation } from "./registerEPCheckoutConfirmation";
import { Registerable } from "./registerable";

export function registerEPCheckout(loader?: Registerable) {
  registerEPCheckoutForm(loader);
  registerEPPaymentForm(loader);
  registerEPOrderSummary(loader);
  registerEPCheckoutConfirmation(loader);
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