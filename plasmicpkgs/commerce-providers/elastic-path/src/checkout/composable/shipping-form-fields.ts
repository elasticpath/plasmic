import type { SessionAddress } from "../session/types";

export const SHIPPING_FORM_TO_SESSION = {
  shippingFirstName: "firstName",
  shippingLastName: "lastName",
  shippingCompany: "company",
  shippingAddress: "line1",
  shippingLine2: "line2",
  shippingCity: "city",
  shippingCounty: "county",
  shippingPostal: "postcode",
  shippingCountry: "country",
} as const;

export type ShippingFormFieldName = keyof typeof SHIPPING_FORM_TO_SESSION;

export const SHIPPING_FORM_FIELD_NAMES = Object.keys(
  SHIPPING_FORM_TO_SESSION
) as ShippingFormFieldName[];

const GEO_FIELDS: Array<keyof SessionAddress> = [
  "line1",
  "city",
  "country",
  "postcode",
];

function emptyToUndef(value: string | undefined): string | undefined {
  const trimmed = (value ?? "").trim();
  return trimmed === "" ? undefined : trimmed;
}

export function mapShippingFormValuesToSessionAddress(
  values: Record<string, string>
): SessionAddress {
  const company = emptyToUndef(values.shippingCompany);
  const line2 = emptyToUndef(values.shippingLine2);
  const county = emptyToUndef(values.shippingCounty);
  return {
    firstName: (values.shippingFirstName ?? "").trim(),
    lastName: (values.shippingLastName ?? "").trim(),
    line1: (values.shippingAddress ?? "").trim(),
    city: (values.shippingCity ?? "").trim(),
    country: (values.shippingCountry ?? "").trim(),
    postcode: (values.shippingPostal ?? "").trim(),
    ...(company ? { company } : {}),
    ...(line2 ? { line2 } : {}),
    ...(county ? { county } : {}),
  };
}

export function isShippingAddressCompleteEnough(
  address: SessionAddress
): boolean {
  return GEO_FIELDS.every((field) => (address[field] ?? "").trim() !== "");
}

export function formHasShippingFields(
  values: Record<string, string>,
  registry: { has(name: string): boolean }
): boolean {
  return SHIPPING_FORM_FIELD_NAMES.some(
    (name) => registry.has(name) || (values[name] ?? "").trim() !== ""
  );
}
