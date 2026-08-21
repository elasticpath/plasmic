/**
 * @jest-environment jsdom
 */
import React from "react";
import { render } from "@testing-library/react";

import {
  CUSTOMER_INFO_DEFAULT_FIELDS,
  DefaultFieldsForm,
} from "../default-fields";

describe("DefaultFieldsForm", () => {
  it("ties each field's error message to its input", () => {
    // Without aria-describedby a screen reader reaches the input and hears
    // nothing about why it was rejected, across every checkout input.
    const { container } = render(
      <DefaultFieldsForm
        fields={CUSTOMER_INFO_DEFAULT_FIELDS}
        values={{ email: "not-an-email" }}
        errors={{ email: "Enter a valid email address" }}
        onChange={() => undefined}
      />
    );

    const error = container.querySelector("[data-ep-field-error]")!;
    const input = container.querySelector("#ep-field-email")!;

    expect(error.textContent).toBe("Enter a valid email address");
    expect(error.id).toBeTruthy();
    expect(input.getAttribute("aria-describedby")).toBe(error.id);
  });

  it("leaves aria-describedby off a field with no error", () => {
    const { container } = render(
      <DefaultFieldsForm
        fields={CUSTOMER_INFO_DEFAULT_FIELDS}
        values={{}}
        errors={{}}
        onChange={() => undefined}
      />
    );

    expect(
      container.querySelector("#ep-field-email")!.getAttribute("aria-describedby")
    ).toBeNull();
  });
});
