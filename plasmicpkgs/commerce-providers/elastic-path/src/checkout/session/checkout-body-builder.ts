/**
 * Checkout Body Builder — converts a CheckoutSession into the EP `checkoutApi`
 * request body.
 *
 * A guest checkout sends `customer` (name, email). An account checkout
 * (`session.account`) sends `account` (id, member_id) and the same name and
 * email as `contact`: Elastic Path refuses `contact` without an account,
 * `account` without `contact`, and both `customer` and `contact`.
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

interface CheckoutAddresses {
  billing_address: EpAddressFull;
  shipping_address: EpAddressFull;
}

export type CheckoutBody =
  | { data: CheckoutAddresses & { customer: { name: string; email: string } } }
  | {
      data: CheckoutAddresses & {
        account: { id: string; member_id?: string };
        contact: { name: string; email: string };
      };
    };

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

function nameAndEmail(info: SessionCustomerInfo) {
  return { name: info.name, email: info.email };
}

export function buildCheckoutBody(session: CheckoutSession): CheckoutBody {
  if (!session.customerInfo) {
    throw new Error("buildCheckoutBody: customerInfo is required");
  }
  if (!session.billingAddress) {
    throw new Error("buildCheckoutBody: billingAddress is required");
  }
  // EP always wants a shipping address on the body. When the checkout doesn't
  // collect one (digital / shipping-less), default it to billing.
  const shipping = session.shippingAddress ?? session.billingAddress;
  if (!session.shippingAddress && session.requiresShipping !== false) {
    throw new Error("buildCheckoutBody: shippingAddress is required");
  }

  const addresses = {
    billing_address: toEpAddressFull(session.billingAddress),
    shipping_address: toEpAddressFull(shipping),
  };
  const account = session.account;
  if (account) {
    return {
      data: {
        account: {
          id: account.id,
          ...(account.memberId ? { member_id: account.memberId } : {}),
        },
        contact: nameAndEmail(session.customerInfo),
        ...addresses,
      },
    };
  }
  return { data: { customer: nameAndEmail(session.customerInfo), ...addresses } };
}
