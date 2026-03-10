import { registerEPCheckoutForm } from "./registerEPCheckoutForm";
import { registerEPPaymentForm } from "./registerEPPaymentForm";
import { registerEPOrderSummary } from "./registerEPOrderSummary";
import { registerEPCheckoutConfirmation } from "./registerEPCheckoutConfirmation";
import { registerEPCheckoutCartField } from "./checkout/composable/EPCheckoutCartField";
import { registerEPCheckoutCartItemList } from "./checkout/composable/EPCheckoutCartItemList";
import { registerEPCheckoutCartSummary } from "./checkout/composable/EPCheckoutCartSummary";
import { registerEPPromoCodeInput } from "./checkout/composable/EPPromoCodeInput";
import { registerEPCountrySelect } from "./checkout/composable/EPCountrySelect";
import { registerEPBillingAddressToggle } from "./checkout/composable/EPBillingAddressToggle";
import { registerEPCheckoutProvider } from "./checkout/composable/EPCheckoutProvider";
import { registerEPCheckoutStepIndicator } from "./checkout/composable/EPCheckoutStepIndicator";
import { registerEPCheckoutButton } from "./checkout/composable/EPCheckoutButton";
import { registerEPOrderTotalsBreakdown } from "./checkout/composable/EPOrderTotalsBreakdown";
import { registerEPCustomerInfoFields } from "./checkout/composable/EPCustomerInfoFields";
import { registerEPShippingAddressFields } from "./checkout/composable/EPShippingAddressFields";
import { registerEPBillingAddressFields } from "./checkout/composable/EPBillingAddressFields";
import { registerEPShippingMethodSelector } from "./checkout/composable/EPShippingMethodSelector";
import { registerEPPaymentElements } from "./checkout/composable/EPPaymentElements";
import { registerEPCheckoutSessionProvider } from "./checkout/session/EPCheckoutSessionProvider";
import { registerEPCloverPayment } from "./checkout/session/EPCloverPayment";
import { registerEPCloverCardNumber } from "./checkout/session/EPCloverCardNumber";
import { registerEPCloverCardExpiry } from "./checkout/session/EPCloverCardExpiry";
import { registerEPCloverCardCVV } from "./checkout/session/EPCloverCardCVV";
import { registerEPCloverCardPostalCode } from "./checkout/session/EPCloverCardPostalCode";
import { Registerable } from "./registerable";

export function registerEPCheckout(loader?: Registerable) {
  // Legacy monolithic checkout components
  registerEPCheckoutForm(loader);
  registerEPPaymentForm(loader);
  registerEPOrderSummary(loader);
  registerEPCheckoutConfirmation(loader);

  // Composable checkout components (leaf-first registration order)
  registerEPCheckoutCartField(loader);
  registerEPCheckoutCartItemList(loader);
  registerEPCheckoutCartSummary(loader);
  registerEPPromoCodeInput(loader);
  registerEPCountrySelect(loader);
  registerEPBillingAddressToggle(loader);
  registerEPOrderTotalsBreakdown(loader);
  registerEPCheckoutButton(loader);
  registerEPCheckoutStepIndicator(loader);
  registerEPCustomerInfoFields(loader);
  registerEPShippingAddressFields(loader);
  registerEPBillingAddressFields(loader);
  registerEPShippingMethodSelector(loader);
  registerEPPaymentElements(loader);

  // Composable checkout provider (registered last — parent of leaf components)
  registerEPCheckoutProvider(loader);

  // Session-based checkout components (leaf-first)
  registerEPCloverCardNumber(loader);
  registerEPCloverCardExpiry(loader);
  registerEPCloverCardCVV(loader);
  registerEPCloverCardPostalCode(loader);
  registerEPCloverPayment(loader);
  registerEPCheckoutSessionProvider(loader);
}

// Export individual registration functions
export {
  registerEPCheckoutForm,
  registerEPPaymentForm,
  registerEPOrderSummary,
  registerEPCheckoutConfirmation,
  registerEPCheckoutCartField,
  registerEPCheckoutCartItemList,
  registerEPCheckoutCartSummary,
  registerEPPromoCodeInput,
  registerEPCountrySelect,
  registerEPBillingAddressToggle,
  registerEPCheckoutProvider,
  registerEPCheckoutStepIndicator,
  registerEPCheckoutButton,
  registerEPOrderTotalsBreakdown,
  registerEPCustomerInfoFields,
  registerEPShippingAddressFields,
  registerEPBillingAddressFields,
  registerEPShippingMethodSelector,
  registerEPPaymentElements,
  registerEPCheckoutSessionProvider,
  registerEPCloverPayment,
  registerEPCloverCardNumber,
  registerEPCloverCardExpiry,
  registerEPCloverCardCVV,
  registerEPCloverCardPostalCode,
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
export {
  epCheckoutCartFieldMeta,
} from "./checkout/composable/EPCheckoutCartField";
export {
  epCheckoutCartItemListMeta,
} from "./checkout/composable/EPCheckoutCartItemList";
export {
  epCheckoutCartSummaryMeta,
} from "./checkout/composable/EPCheckoutCartSummary";
export {
  epPromoCodeInputMeta,
} from "./checkout/composable/EPPromoCodeInput";
export {
  epCountrySelectMeta,
} from "./checkout/composable/EPCountrySelect";
export {
  epBillingAddressToggleMeta,
} from "./checkout/composable/EPBillingAddressToggle";
export {
  epCheckoutProviderMeta,
} from "./checkout/composable/EPCheckoutProvider";
export {
  epCheckoutStepIndicatorMeta,
} from "./checkout/composable/EPCheckoutStepIndicator";
export {
  epCheckoutButtonMeta,
} from "./checkout/composable/EPCheckoutButton";
export {
  epOrderTotalsBreakdownMeta,
} from "./checkout/composable/EPOrderTotalsBreakdown";
export {
  epCustomerInfoFieldsMeta,
} from "./checkout/composable/EPCustomerInfoFields";
export {
  epShippingAddressFieldsMeta,
} from "./checkout/composable/EPShippingAddressFields";
export {
  epBillingAddressFieldsMeta,
} from "./checkout/composable/EPBillingAddressFields";
export {
  epShippingMethodSelectorMeta,
} from "./checkout/composable/EPShippingMethodSelector";
export {
  epPaymentElementsMeta,
} from "./checkout/composable/EPPaymentElements";
export {
  epCheckoutSessionProviderMeta,
} from "./checkout/session/EPCheckoutSessionProvider";
export {
  epCloverPaymentMeta,
} from "./checkout/session/EPCloverPayment";
export {
  epCloverCardNumberMeta,
} from "./checkout/session/EPCloverCardNumber";
export {
  epCloverCardExpiryMeta,
} from "./checkout/session/EPCloverCardExpiry";
export {
  epCloverCardCVVMeta,
} from "./checkout/session/EPCloverCardCVV";
export {
  epCloverCardPostalCodeMeta,
} from "./checkout/session/EPCloverCardPostalCode";