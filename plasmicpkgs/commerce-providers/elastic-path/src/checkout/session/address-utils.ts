/**
 * Address format translation between session (camelCase) and EP API (snake_case).
 *
 * The session model uses camelCase for consistency with React conventions.
 * EP's checkout API requires snake_case addresses. These helpers translate.
 */
import type { SessionAddress, SessionCustomerInfo } from "./types";

/** EP API address shape (snake_case). */
export interface EPAddress {
  first_name: string;
  last_name: string;
  line_1: string;
  line_2?: string;
  city: string;
  county?: string;
  country: string;
  postcode: string;
}

/** Convert session address (camelCase) → EP address (snake_case). */
export function toEPAddress(addr: SessionAddress): EPAddress {
  const ep: EPAddress = {
    first_name: addr.firstName,
    last_name: addr.lastName,
    line_1: addr.line1,
    city: addr.city,
    country: addr.country,
    postcode: addr.postcode,
  };
  if (addr.line2 !== undefined) ep.line_2 = addr.line2;
  if (addr.county !== undefined) ep.county = addr.county;
  return ep;
}

/** Convert EP address (snake_case) → session address (camelCase). */
export function fromEPAddress(ep: EPAddress): SessionAddress {
  const addr: SessionAddress = {
    firstName: ep.first_name,
    lastName: ep.last_name,
    line1: ep.line_1,
    city: ep.city,
    country: ep.country,
    postcode: ep.postcode,
  };
  if (ep.line_2 !== undefined) addr.line2 = ep.line_2;
  if (ep.county !== undefined) addr.county = ep.county;
  return addr;
}

/** Build EP-format customer object from session customer info. */
export function toEPCustomer(
  info: SessionCustomerInfo
): { name: string; email: string } {
  return { name: info.name, email: info.email };
}

function addressFieldKey(value: string | undefined | null): string {
  return (value ?? "").trim();
}

export function sessionAddressesEquivalent(
  a: SessionAddress | null | undefined,
  b: SessionAddress | null | undefined
): boolean {
  if (a == null && b == null) return true;
  if (a == null || b == null) return false;
  return (
    addressFieldKey(a.firstName) === addressFieldKey(b.firstName) &&
    addressFieldKey(a.lastName) === addressFieldKey(b.lastName) &&
    addressFieldKey(a.company) === addressFieldKey(b.company) &&
    addressFieldKey(a.line1) === addressFieldKey(b.line1) &&
    addressFieldKey(a.line2) === addressFieldKey(b.line2) &&
    addressFieldKey(a.city) === addressFieldKey(b.city) &&
    addressFieldKey(a.county) === addressFieldKey(b.county) &&
    addressFieldKey(a.country) === addressFieldKey(b.country) &&
    addressFieldKey(a.postcode) === addressFieldKey(b.postcode)
  );
}
