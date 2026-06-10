/**
 * Checkout Body Builder — converts a CheckoutSession into the EP `checkoutApi`
 * request body.
 *
 * Slice 1 (this PR): guest path only — `CustomerCheckout` shape with name +
 * email. Slices 2+ add the account path and subscription gating.
 *
 * EP requires snake_case + several fields (company_name, line_2, county) as
 * present strings even when empty. The session model doesn't carry those, so
 * the builder fills empty-string defaults at the boundary.
 *
 * Shipping: EP requires a shipping address whenever any cart item is
 * shippable. Single-page / digital checkouts set `session.requiresShipping =
 * false` and may not collect one — in that case the builder defaults the
 * shipping address to the billing address (EP still accepts the order, and
 * a digital item ignores it).
 */
import type { CheckoutSession, SessionAddress, SessionCustomerInfo } from "./types";

export interface GuestCheckoutBody {
  data: {
    customer: { name: string; email: string };
    billing_address: EpAddressFull;
    shipping_address: EpAddressFull;
  };
}

interface EpAddressFull {
  first_name: string;
  last_name: string;
  line_1: string;
  line_2: string;
  city: string;
  postcode: string;
  country: string;
  county: string;
  company_name: string;
}

function toEpAddressFull(addr: SessionAddress): EpAddressFull {
  return {
    first_name: addr.firstName,
    last_name: addr.lastName,
    line_1: addr.line1,
    line_2: addr.line2 ?? "",
    city: addr.city,
    postcode: addr.postcode,
    country: addr.country,
    county: addr.county ?? "",
    company_name: addr.company ?? "",
  };
}

function toEpCustomer(info: SessionCustomerInfo) {
  return { name: info.name, email: info.email };
}

export function buildGuestCheckoutBody(
  session: CheckoutSession
): GuestCheckoutBody {
  if (!session.customerInfo) {
    throw new Error("buildGuestCheckoutBody: customerInfo is required");
  }
  if (!session.billingAddress) {
    throw new Error("buildGuestCheckoutBody: billingAddress is required");
  }
  // EP always wants a shipping address on the body. When the checkout doesn't
  // collect one (digital / shipping-less), default it to billing.
  const shipping = session.shippingAddress ?? session.billingAddress;
  if (!session.shippingAddress && session.requiresShipping !== false) {
    throw new Error("buildGuestCheckoutBody: shippingAddress is required");
  }

  return {
    data: {
      customer: toEpCustomer(session.customerInfo),
      billing_address: toEpAddressFull(session.billingAddress),
      shipping_address: toEpAddressFull(shipping),
    },
  };
}
