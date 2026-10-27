/**
 * @jest-environment jsdom
 *
 * EPAccountAddressFormProvider — creates a saved address, then refreshes
 * the surrounding address book.
 */

const mockUsePlasmicCanvasContext = jest.fn().mockReturnValue(false);
const mockCreateAccountAddress = jest.fn();
const mockAccountAddresses = jest.fn();
const mockIdentity = {
  createAccountAddress: mockCreateAccountAddress,
  accountAddresses: mockAccountAddresses,
};

jest.mock("@plasmicapp/host", () => {
  const React = require("react");
  const DataCtx = React.createContext({});
  return {
    DataProvider: ({ name, data, children }: any) => {
      const parent = React.useContext(DataCtx);
      const next = { ...parent, [name]: data };
      return React.createElement(
        DataCtx.Provider,
        { value: next },
        React.createElement(
          "div",
          {
            "data-testid": `data-provider-${name}`,
            "data-value": JSON.stringify(data),
          },
          children
        )
      );
    },
    useSelector: (key: string) => React.useContext(DataCtx)[key],
    usePlasmicCanvasContext: () => mockUsePlasmicCanvasContext(),
    repeatedElement: (_i: number, children: React.ReactNode) => children,
  };
});

jest.mock("@plasmicapp/host/registerComponent", () => {
  const fn = jest.fn();
  fn.default = jest.fn();
  return fn;
});

jest.mock("../../identity/useEpIdentity", () => ({
  useEpIdentity: () => mockIdentity,
}));

import React from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MOCK_ACCOUNT_SELECTED } from "../../utils/design-time-data";

const {
  EPAccountAddressFormProvider,
  epAccountAddressFormProviderMeta,
  registerEPAccountAddressFormProvider,
} = require("../EPAccountAddressFormProvider");
const {
  EPAccountAddressFormField,
  epAccountAddressFormFieldMeta,
  registerEPAccountAddressFormField,
} = require("../EPAccountAddressFormField");
const { EPAccountAddressProvider } = require("../EPAccountAddressProvider");
const { EPAccountAddressList } = require("../EPAccountAddressList");
const { EPAccountAddressField } = require("../EPAccountAddressField");

interface FormActions {
  submit(): Promise<void>;
}

const OLD = { id: "addr-old", line_1: "Old Street", city: "York" };
const CREATED = { id: "addr-new", line_1: "1 High Street", city: "London" };

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function publishedForm() {
  return JSON.parse(
    screen
      .getByTestId("data-provider-accountAddressFormData")
      .getAttribute("data-value")!
  );
}

function publishedBook() {
  return JSON.parse(
    screen
      .getByTestId("data-provider-accountAddresses")
      .getAttribute("data-value")!
  );
}

function lineInput() {
  return screen.getByLabelText("Line 1 *") as HTMLInputElement;
}

function countrySelect() {
  return screen.getByLabelText("Country *") as HTMLSelectElement;
}

const REQUIRED_FIELDS = [
  "first_name",
  "last_name",
  "line_1",
  "county",
  "postcode",
  "country",
] as const;

const REQUIRED_VALUES: Record<(typeof REQUIRED_FIELDS)[number], string> = {
  first_name: "Zain",
  last_name: "Test",
  line_1: "123 A",
  county: "Lahore",
  postcode: "54000",
  country: "PK",
};

function fillRequired(overrides: Partial<typeof REQUIRED_VALUES> = {}) {
  const values = { ...REQUIRED_VALUES, ...overrides };
  const labels: Record<string, string> = {
    first_name: "First name *",
    last_name: "Last name *",
    line_1: "Line 1 *",
    county: "County *",
    postcode: "Postcode *",
    country: "Country *",
  };
  for (const field of REQUIRED_FIELDS) {
    fireEvent.change(screen.getByLabelText(labels[field]), {
      target: { value: values[field] },
    });
  }
}

function AccountScope(props: { children?: React.ReactNode }) {
  const { DataProvider } = require("@plasmicapp/host");
  return (
    <DataProvider name="account" data={MOCK_ACCOUNT_SELECTED}>
      {props.children}
    </DataProvider>
  );
}

function renderForm(options?: { book?: boolean }) {
  const ref = React.createRef<FormActions>();
  const fields = (
    <EPAccountAddressFormProvider ref={ref}>
      <EPAccountAddressFormField name="first_name" required />
      <EPAccountAddressFormField name="last_name" required />
      <EPAccountAddressFormField name="line_1" required />
      <EPAccountAddressFormField name="city" />
      <EPAccountAddressFormField name="county" required />
      <EPAccountAddressFormField name="postcode" required />
      <EPAccountAddressFormField name="country" required />
      <EPAccountAddressFormField name="name" />
    </EPAccountAddressFormProvider>
  );
  if (options?.book === false) {
    render(fields);
    return ref;
  }
  render(
    <AccountScope>
      <EPAccountAddressProvider>
        <EPAccountAddressList>
          <EPAccountAddressField field="line_1" />
        </EPAccountAddressList>
        {fields}
      </EPAccountAddressProvider>
    </AccountScope>
  );
  return ref;
}

describe("EPAccountAddressFormProvider", () => {
  beforeEach(() => {
    mockCreateAccountAddress.mockReset();
    mockAccountAddresses.mockReset();
    mockCreateAccountAddress.mockResolvedValue(CREATED);
    mockAccountAddresses.mockResolvedValue({
      addresses: [OLD],
      total: 1,
    });
    mockUsePlasmicCanvasContext.mockReturnValue(false);
  });

  it("publishes only form status and does not publish field values", async () => {
    renderForm();
    await waitFor(() => expect(screen.getByText("Old Street")).toBeTruthy());
    expect(publishedForm()).toEqual({
      status: "idle",
      error: null,
      isSubmitting: false,
    });
    expect(Object.keys(publishedForm()).sort()).toEqual([
      "error",
      "isSubmitting",
      "status",
    ]);
    expect(JSON.stringify(publishedForm())).not.toContain("line_1");
  });

  it("does not create from the Studio canvas", async () => {
    mockUsePlasmicCanvasContext.mockReturnValue(true);
    const ref = renderForm();
    fireEvent.change(lineInput(), { target: { value: "1 High Street" } });
    await act(async () => {
      await ref.current!.submit();
    });
    expect(mockCreateAccountAddress).not.toHaveBeenCalled();
    expect(mockAccountAddresses).not.toHaveBeenCalled();
  });

  it("marks the six default-required fields and leaves city and name optional", () => {
    renderForm({ book: false });
    for (const label of [
      "First name *",
      "Last name *",
      "Line 1 *",
      "County *",
      "Postcode *",
      "Country *",
    ]) {
      expect(screen.getByLabelText(label).hasAttribute("required")).toBe(true);
    }
    const city = screen.getByLabelText("City");
    expect(city.hasAttribute("required")).toBe(false);
    expect(city.closest("[data-ep-form-field]")?.textContent).not.toContain("*");
    expect(screen.getByLabelText("Name").hasAttribute("required")).toBe(false);
    expect(countrySelect().required).toBe(true);
  });

  it("does not create when a default-required field is missing", async () => {
    const ref = renderForm();
    await waitFor(() => expect(screen.getByText("Old Street")).toBeTruthy());
    await act(async () => {
      await ref.current!.submit();
    });
    expect(mockCreateAccountAddress).not.toHaveBeenCalled();
    expect(publishedForm()).toEqual({
      status: "error",
      error: {
        code: "invalid_input",
        message: "Please complete the required fields.",
      },
      isSubmitting: false,
    });
    expect(screen.getAllByText("This field is required.")).toHaveLength(6);
    expect(screen.getByLabelText("City").getAttribute("aria-invalid")).toBeNull();
  });

  it.each([
    ["first_name", "First name *"],
    ["last_name", "Last name *"],
    ["line_1", "Line 1 *"],
    ["county", "County *"],
    ["postcode", "Postcode *"],
    ["country", "Country *"],
  ] as const)(
    "shows a required error when %s is empty and does not create",
    async (field, label) => {
      const ref = renderForm({ book: false });
      fillRequired({ [field]: field === "country" ? "" : "   " });
      await act(async () => {
        await ref.current!.submit();
      });
      expect(mockCreateAccountAddress).not.toHaveBeenCalled();
      expect(publishedForm().error).toEqual({
        code: "invalid_input",
        message: "Please complete the required fields.",
      });
      expect(screen.getAllByText("This field is required.")).toHaveLength(1);
      expect(screen.getByLabelText(label).getAttribute("aria-invalid")).toBe(
        "true"
      );
      expect((screen.getByLabelText(label) as HTMLInputElement).value).toBe(
        field === "country" ? "" : "   "
      );
    }
  );

  it("sends the six required fields, trims them, and omits blank optional fields", async () => {
    const ref = renderForm();
    await waitFor(() => expect(screen.getByText("Old Street")).toBeTruthy());
    fireEvent.change(lineInput(), { target: { value: "  1 High Street  " } });
    expect(lineInput().value).toBe("  1 High Street  ");
    fillRequired({ line_1: "  1 High Street  " });
    fireEvent.change(screen.getByLabelText("City"), {
      target: { value: "   " },
    });
    fireEvent.change(screen.getByLabelText("Name"), {
      target: { value: "  " },
    });
    await act(async () => {
      await ref.current!.submit();
    });
    expect(mockCreateAccountAddress).toHaveBeenCalledTimes(1);
    expect(mockCreateAccountAddress).toHaveBeenCalledWith({
      first_name: "Zain",
      last_name: "Test",
      line_1: "1 High Street",
      county: "Lahore",
      postcode: "54000",
      country: "PK",
    });
  });

  it("does not block submit when County is configured optional", async () => {
    const ref = React.createRef<FormActions>();
    render(
      <EPAccountAddressFormProvider ref={ref}>
        <EPAccountAddressFormField name="first_name" required />
        <EPAccountAddressFormField name="last_name" required />
        <EPAccountAddressFormField name="line_1" required />
        <EPAccountAddressFormField name="county" required={false} />
        <EPAccountAddressFormField name="postcode" required />
        <EPAccountAddressFormField name="country" required />
      </EPAccountAddressFormProvider>
    );
    expect(screen.getByLabelText("County").hasAttribute("required")).toBe(
      false
    );
    fireEvent.change(screen.getByLabelText("First name *"), {
      target: { value: "Zain" },
    });
    fireEvent.change(screen.getByLabelText("Last name *"), {
      target: { value: "Test" },
    });
    fireEvent.change(screen.getByLabelText("Line 1 *"), {
      target: { value: "123 A" },
    });
    fireEvent.change(screen.getByLabelText("Postcode *"), {
      target: { value: "54000" },
    });
    fireEvent.change(screen.getByLabelText("Country *"), {
      target: { value: "PK" },
    });
    await act(async () => {
      await ref.current!.submit();
    });
    expect(mockCreateAccountAddress).toHaveBeenCalledWith({
      first_name: "Zain",
      last_name: "Test",
      line_1: "123 A",
      postcode: "54000",
      country: "PK",
    });
    expect(screen.queryByText("This field is required.")).toBeNull();
  });

  it("blocks submit when City is configured required", async () => {
    const ref = React.createRef<FormActions>();
    render(
      <EPAccountAddressFormProvider ref={ref}>
        <EPAccountAddressFormField name="line_1" required />
        <EPAccountAddressFormField name="city" required />
      </EPAccountAddressFormProvider>
    );
    const city = screen.getByLabelText("City *");
    expect(city.hasAttribute("required")).toBe(true);
    fireEvent.change(lineInput(), { target: { value: "123 A" } });
    await act(async () => {
      await ref.current!.submit();
    });
    expect(mockCreateAccountAddress).not.toHaveBeenCalled();
    expect(publishedForm().error).toEqual({
      code: "invalid_input",
      message: "Please complete the required fields.",
    });
    expect(screen.getByText("This field is required.")).toBeTruthy();
    expect(city.getAttribute("aria-invalid")).toBe("true");
    expect(lineInput().getAttribute("aria-invalid")).toBeNull();
  });

  describe("duplicate fields", () => {
    function renderDuplicates(
      fields: React.ReactNode,
      ref: React.RefObject<FormActions>
    ) {
      render(
        <EPAccountAddressFormProvider ref={ref}>
          <EPAccountAddressFormField name="line_1" label="Line" />
          {fields}
        </EPAccountAddressFormProvider>
      );
      fireEvent.change(screen.getByLabelText("Line"), {
        target: { value: "123 A" },
      });
    }

    function expectPostcodeStillRequired() {
      expect(mockCreateAccountAddress).not.toHaveBeenCalled();
      expect(publishedForm().error).toEqual({
        code: "invalid_input",
        message: "Please complete the required fields.",
      });
      expect(screen.getAllByText("This field is required.").length).toBeGreaterThan(
        0
      );
      expect(
        screen.getByLabelText("Postcode *").getAttribute("aria-invalid")
      ).toBe("true");
    }

    it("keeps Postcode required after a second Postcode unmounts", async () => {
      const ref = React.createRef<FormActions>();
      function Harness() {
        const [showSecond, setShowSecond] = React.useState(true);
        return (
          <EPAccountAddressFormProvider ref={ref}>
            <EPAccountAddressFormField name="line_1" label="Line" />
            <EPAccountAddressFormField name="postcode" label="Postcode" required />
            {showSecond ? (
              <EPAccountAddressFormField
                name="postcode"
                label="Extra postcode"
                required
              />
            ) : null}
            <button type="button" onClick={() => setShowSecond(false)}>
              Hide extra
            </button>
          </EPAccountAddressFormProvider>
        );
      }
      render(<Harness />);
      fireEvent.change(screen.getByLabelText("Line"), {
        target: { value: "123 A" },
      });
      expect(screen.getByLabelText("Extra postcode *")).toBeTruthy();
      fireEvent.click(screen.getByText("Hide extra"));
      expect(screen.queryByLabelText("Extra postcode *")).toBeNull();
      await act(async () => {
        await ref.current!.submit();
      });
      expectPostcodeStillRequired();
    });

    it.each(["required-first", "optional-first"] as const)(
      "treats Postcode as required when any mounted copy is required (%s)",
      async (order) => {
        const ref = React.createRef<FormActions>();
        const required = (
          <EPAccountAddressFormField
            key="required"
            name="postcode"
            label="Postcode"
            required
          />
        );
        const optional = (
          <EPAccountAddressFormField
            key="optional"
            name="postcode"
            label="Other postcode"
          />
        );
        renderDuplicates(
          order === "required-first" ? (
            <>
              {required}
              {optional}
            </>
          ) : (
            <>
              {optional}
              {required}
            </>
          ),
          ref
        );
        await act(async () => {
          await ref.current!.submit();
        });
        expectPostcodeStillRequired();
      }
    );

    it("gives each mounted field its own input id", () => {
      render(
        <EPAccountAddressFormProvider>
          <EPAccountAddressFormField name="postcode" label="Postcode A" />
          <EPAccountAddressFormField name="postcode" label="Postcode B" />
          <EPAccountAddressFormField name="country" label="Country A" />
          <EPAccountAddressFormField name="country" label="Country B" />
        </EPAccountAddressFormProvider>
      );
      const ids = ["Postcode A", "Postcode B", "Country A", "Country B"].map(
        (label) => {
          const control = screen.getByLabelText(label);
          const ownLabel = control
            .closest("[data-ep-form-field]")
            ?.querySelector("[data-ep-field-label]");
          expect(control.id).toBeTruthy();
          expect(ownLabel?.getAttribute("for")).toBe(control.id);
          return control.id;
        }
      );
      expect(new Set(ids).size).toBe(ids.length);
    });
  });

  it("blocks a second submit and keeps inputs read-only while creating", async () => {
    const gate = deferred<typeof CREATED>();
    mockCreateAccountAddress.mockReturnValue(gate.promise);
    const ref = renderForm();
    await waitFor(() => expect(screen.getByText("Old Street")).toBeTruthy());
    fillRequired({ line_1: "1 High Street" });

    let first!: Promise<void>;
    await act(async () => {
      first = ref.current!.submit();
      await Promise.resolve();
    });
    expect(lineInput().readOnly).toBe(true);
    expect(publishedForm().isSubmitting).toBe(true);
    await act(async () => {
      await ref.current!.submit();
    });
    expect(mockCreateAccountAddress).toHaveBeenCalledTimes(1);

    await act(async () => {
      gate.resolve(CREATED);
      await first;
    });
    expect(lineInput().readOnly).toBe(false);
  });

  it("surfaces an identity error and keeps the draft", async () => {
    const err = new Error("No organisation is selected.");
    (err as { code?: string }).code = "no_selected_account";
    mockCreateAccountAddress.mockRejectedValue(err);
    const ref = renderForm();
    await waitFor(() => expect(screen.getByText("Old Street")).toBeTruthy());
    fillRequired({ line_1: "1 High Street" });
    await act(async () => {
      await ref.current!.submit();
    });
    expect(publishedForm()).toEqual({
      status: "error",
      error: {
        code: "no_selected_account",
        message: "No organisation is selected.",
      },
      isSubmitting: false,
    });
    expect(lineInput().value).toBe("1 High Street");
    expect(screen.getByText("Old Street")).toBeTruthy();
  });

  it("clears the form and shows the created address after refresh", async () => {
    mockAccountAddresses
      .mockResolvedValueOnce({ addresses: [OLD], total: 1 })
      .mockResolvedValueOnce({ addresses: [OLD, CREATED], total: 2 });
    const ref = renderForm();
    await waitFor(() => expect(screen.getByText("Old Street")).toBeTruthy());
    fillRequired({ line_1: "  1 High Street  " });
    await act(async () => {
      await ref.current!.submit();
    });
    expect(lineInput().value).toBe("");
    expect(publishedForm()).toEqual({
      status: "submitted",
      error: null,
      isSubmitting: false,
    });
    expect(screen.getByText("1 High Street")).toBeTruthy();
    expect(mockAccountAddresses.mock.calls[1]).toEqual([]);
  });

  it("stays submitted when the address was created but the list could not refresh", async () => {
    mockAccountAddresses
      .mockResolvedValueOnce({ addresses: [OLD], total: 1 })
      .mockRejectedValueOnce(new Error("Elastic Path was unreachable."));
    const ref = renderForm();
    await waitFor(() => expect(screen.getByText("Old Street")).toBeTruthy());
    fillRequired({ line_1: "1 High Street" });
    await act(async () => {
      await ref.current!.submit();
    });
    expect(publishedForm()).toEqual({
      status: "submitted",
      error: {
        code: "account_addresses_refresh_failed",
        message:
          "The saved address was created, but the address list could not be refreshed.",
      },
      isSubmitting: false,
    });
    expect(lineInput().value).toBe("");
    expect(screen.getByText("Old Street")).toBeTruthy();
    expect(screen.queryByText("1 High Street")).toBeNull();
  });

  it("does not stay loading when refresh fails before the first book commits", async () => {
    const initial = deferred<{ addresses: unknown[]; total: number }>();
    const refresh = deferred<{ addresses: unknown[]; total: number }>();
    mockAccountAddresses
      .mockImplementationOnce(() => initial.promise)
      .mockImplementationOnce(() => refresh.promise);
    const ref = renderForm();
    expect(publishedBook()).toEqual({
      status: "loading",
      addresses: [],
      total: 0,
      error: null,
    });
    expect(mockAccountAddresses).toHaveBeenCalledTimes(1);

    fillRequired({ line_1: "1 High Street" });
    let submit!: Promise<void>;
    await act(async () => {
      submit = ref.current!.submit();
      await Promise.resolve();
    });
    expect(mockCreateAccountAddress).toHaveBeenCalledTimes(1);
    expect(mockAccountAddresses).toHaveBeenCalledTimes(2);

    await act(async () => {
      refresh.reject(new Error("Elastic Path was unreachable."));
      await submit;
    });
    await act(async () => {
      initial.resolve({
        addresses: [{ id: "late", line_1: "Late Street" }],
        total: 1,
      });
      await initial.promise;
    });

    expect(publishedForm()).toEqual({
      status: "submitted",
      error: {
        code: "account_addresses_refresh_failed",
        message:
          "The saved address was created, but the address list could not be refreshed.",
      },
      isSubmitting: false,
    });
    expect(publishedBook()).toEqual({
      status: "error",
      addresses: [],
      total: 0,
      error: {
        code: "account_addresses_read_failed",
        message: "Elastic Path was unreachable.",
      },
    });
    expect(screen.queryByText("Late Street")).toBeNull();
    expect(screen.queryByText("1 High Street")).toBeNull();
  });

  describe("country", () => {
    it("requires a country and submits the ISO code", async () => {
      const ref = renderForm({ book: false });
      const select = countrySelect();
      expect(select.value).toBe("");
      expect(select.selectedOptions[0].textContent).toBe("Select country");
      fillRequired({ country: "" });
      await act(async () => {
        await ref.current!.submit();
      });
      expect(mockCreateAccountAddress).not.toHaveBeenCalled();
      expect(screen.getByText("This field is required.")).toBeTruthy();
      expect(publishedForm().error).toEqual({
        code: "invalid_input",
        message: "Please complete the required fields.",
      });
      expect(JSON.stringify(mockCreateAccountAddress.mock.calls)).not.toContain(
        "Pakistan"
      );

      fireEvent.change(select, { target: { value: "PK" } });
      expect(select.value).toBe("PK");
      expect(select.selectedOptions[0].textContent).toBe("Pakistan");
      await act(async () => {
        await ref.current!.submit();
      });
      expect(mockCreateAccountAddress).toHaveBeenCalledWith({
        first_name: "Zain",
        last_name: "Test",
        line_1: "123 A",
        county: "Lahore",
        postcode: "54000",
        country: "PK",
      });
      expect(JSON.stringify(mockCreateAccountAddress.mock.calls)).not.toContain(
        "Pakistan"
      );
    });

    it("does not change the country dropdown on the canvas or while submitting", async () => {
      mockUsePlasmicCanvasContext.mockReturnValue(true);
      const canvas = renderForm({ book: false });
      expect(countrySelect().disabled).toBe(true);
      fireEvent.change(countrySelect(), { target: { value: "PK" } });
      expect(countrySelect().value).toBe("");
      await act(async () => {
        await canvas.current!.submit();
      });
      expect(mockCreateAccountAddress).not.toHaveBeenCalled();

      cleanup();
      mockUsePlasmicCanvasContext.mockReturnValue(false);
      const gate = deferred<typeof CREATED>();
      mockCreateAccountAddress.mockReturnValue(gate.promise);
      const ref = renderForm({ book: false });
      fillRequired();
      let pending!: Promise<void>;
      await act(async () => {
        pending = ref.current!.submit();
        await Promise.resolve();
      });
      expect(countrySelect().disabled).toBe(true);
      await act(async () => {
        gate.resolve(CREATED);
        await pending;
      });
    });
  });

  it("creates when it is not inside an address provider", async () => {
    const ref = renderForm({ book: false });
    fillRequired({ line_1: "1 High Street" });
    await act(async () => {
      await ref.current!.submit();
    });
    expect(mockCreateAccountAddress).toHaveBeenCalledWith({
      first_name: "Zain",
      last_name: "Test",
      line_1: "1 High Street",
      county: "Lahore",
      postcode: "54000",
      country: "PK",
    });
    expect(mockAccountAddresses).not.toHaveBeenCalled();
    expect(publishedForm().status).toBe("submitted");
    expect(publishedForm().error).toBeNull();
  });

  describe("registration", () => {
    it("registers the form under the address provider with a submit action", () => {
      expect(epAccountAddressFormProviderMeta.name).toBe(
        "plasmic-commerce-ep-account-address-form-provider"
      );
      expect(epAccountAddressFormProviderMeta.displayName).toBe(
        "EP Account Address Form Provider"
      );
      expect(epAccountAddressFormProviderMeta.parentComponentName).toBe(
        "plasmic-commerce-ep-account-address-provider"
      );
      expect(epAccountAddressFormProviderMeta.providesData).toBe(true);
      expect(Object.keys(epAccountAddressFormProviderMeta.props ?? {})).toEqual([
        "children",
      ]);
      expect(
        Object.keys(epAccountAddressFormProviderMeta.refActions ?? {})
      ).toEqual(["submit"]);
      const slot = (epAccountAddressFormProviderMeta.props as any).children
        .defaultValue;
      expect(slot.map((child: { props: { name: string } }) => child.props.name)).toEqual([
        "first_name",
        "last_name",
        "line_1",
        "city",
        "county",
        "postcode",
        "country",
      ]);
      expect(slot.map((child: { props: { label: string } }) => child.props.label)).toEqual([
        "First Name",
        "Last Name",
        "Line 1",
        "City",
        "County",
        "Postcode",
        "Country",
      ]);
      expect(slot.map((child: { props: { name: string; required: boolean } }) => child.props.required)).toEqual([
        true,
        true,
        true,
        false,
        true,
        true,
        true,
      ]);
      expect(
        slot.map((child: { props: { name: string } }) => child.props.name)
      ).not.toContain("name");
      const loader = { registerComponent: jest.fn() };
      registerEPAccountAddressFormProvider(loader);
      expect(loader.registerComponent).toHaveBeenCalledWith(
        EPAccountAddressFormProvider,
        epAccountAddressFormProviderMeta
      );
    });

    it("registers the thirteen address inputs under the form", () => {
      expect(epAccountAddressFormFieldMeta.name).toBe(
        "plasmic-commerce-ep-account-address-form-field"
      );
      expect(epAccountAddressFormFieldMeta.parentComponentName).toBe(
        "plasmic-commerce-ep-account-address-form-provider"
      );
      expect(epAccountAddressFormFieldMeta.providesData).toBeUndefined();
      expect(epAccountAddressFormFieldMeta.refActions).toBeUndefined();
      const name = (epAccountAddressFormFieldMeta.props as any).name;
      expect(name.options.map((option: { value: string }) => option.value)).toEqual([
        "name",
        "first_name",
        "last_name",
        "company_name",
        "phone_number",
        "instructions",
        "line_1",
        "line_2",
        "city",
        "county",
        "region",
        "postcode",
        "country",
      ]);
      expect((epAccountAddressFormFieldMeta.props as any).required).toEqual({
        type: "boolean",
        defaultValue: false,
        displayName: "Required",
      });
      const loader = { registerComponent: jest.fn() };
      registerEPAccountAddressFormField(loader);
      expect(loader.registerComponent).toHaveBeenCalledWith(
        EPAccountAddressFormField,
        epAccountAddressFormFieldMeta
      );
    });
  });
});
