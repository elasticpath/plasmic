import {
  SHIPPING_FORM_FIELD_NAMES,
  formHasShippingFields,
  isShippingAddressCompleteEnough,
  mapShippingFormValuesToSessionAddress,
} from "../shipping-form-fields";

const COMPLETE_GEO = {
  shippingAddress: "123 Main St",
  shippingCity: "Springfield",
  shippingPostal: "12345",
  shippingCountry: "US",
};

describe("mapShippingFormValuesToSessionAddress", () => {
  it("maps shipping* form keys onto SessionAddress fields", () => {
    expect(
      mapShippingFormValuesToSessionAddress({
        shippingFirstName: "Jane",
        shippingLastName: "Doe",
        shippingCompany: "Acme",
        shippingAddress: "123 Main St",
        shippingLine2: "Apt 4",
        shippingCity: "Springfield",
        shippingCounty: "Sangamon",
        shippingPostal: "12345",
        shippingCountry: "US",
      })
    ).toEqual({
      firstName: "Jane",
      lastName: "Doe",
      company: "Acme",
      line1: "123 Main St",
      line2: "Apt 4",
      city: "Springfield",
      county: "Sangamon",
      postcode: "12345",
      country: "US",
    });
  });

  it("omits empty optional fields and trims values", () => {
    expect(
      mapShippingFormValuesToSessionAddress({
        shippingFirstName: " Jane ",
        shippingLastName: "",
        shippingCompany: "  ",
        shippingAddress: " 123 Main St ",
        shippingLine2: "",
        shippingCity: "Springfield",
        shippingCounty: "",
        shippingPostal: "12345",
        shippingCountry: "US",
      })
    ).toEqual({
      firstName: "Jane",
      lastName: "",
      line1: "123 Main St",
      city: "Springfield",
      postcode: "12345",
      country: "US",
    });
  });
});

describe("isShippingAddressCompleteEnough", () => {
  it("is true with destination fields even when firstName/lastName are empty", () => {
    expect(
      isShippingAddressCompleteEnough(
        mapShippingFormValuesToSessionAddress(COMPLETE_GEO)
      )
    ).toBe(true);
  });

  it("is false when a destination field is missing", () => {
    expect(
      isShippingAddressCompleteEnough(
        mapShippingFormValuesToSessionAddress({
          shippingCity: "Springfield",
          shippingPostal: "12345",
          shippingCountry: "US",
        })
      )
    ).toBe(false);
  });
});

describe("formHasShippingFields", () => {
  it("is true when a shipping* field is registered", () => {
    const registry = new Set(["shippingCity"]);
    expect(formHasShippingFields({}, { has: (n) => registry.has(n) })).toBe(
      true
    );
  });

  it("is false when no shipping* fields are present", () => {
    expect(
      formHasShippingFields(
        { firstName: "Jane", email: "jane@example.com" },
        { has: () => false }
      )
    ).toBe(false);
  });

  it("includes every reserved shipping* name", () => {
    expect(SHIPPING_FORM_FIELD_NAMES).toEqual([
      "shippingFirstName",
      "shippingLastName",
      "shippingCompany",
      "shippingAddress",
      "shippingLine2",
      "shippingCity",
      "shippingCounty",
      "shippingPostal",
      "shippingCountry",
    ]);
  });
});
