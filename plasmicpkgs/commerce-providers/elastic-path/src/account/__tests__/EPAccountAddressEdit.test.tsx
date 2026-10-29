/** @jest-environment jsdom */

const mockUsePlasmicCanvasContext = jest.fn().mockReturnValue(false);
const mockUpdateAccountAddress = jest.fn();
const mockAccountAddresses = jest.fn();
const mockDeleteAccountAddress = jest.fn();
const mockCreateAccountAddress = jest.fn();
const mockIdentity = {
  updateAccountAddress: mockUpdateAccountAddress,
  accountAddresses: mockAccountAddresses,
  deleteAccountAddress: mockDeleteAccountAddress,
  createAccountAddress: mockCreateAccountAddress,
};

let mockRecordState = false;
const mockStatePublications: unknown[] = [];

jest.mock("react", () => {
  const actual = jest.requireActual("react");
  return {
    ...actual,
    useState: (initial: unknown) => {
      const tuple = actual.useState(initial);
      const setState = tuple[1];
      const recordSetState = (value: unknown) => {
        if (mockRecordState) {
          mockStatePublications.push(
            typeof value === "function" ? value(tuple[0]) : value
          );
        }
        return setState(value);
      };
      return [tuple[0], recordSetState];
    },
  };
});

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
import type { AccountContext } from "../types";
import type { EpAccountAddress } from "../../identity/operations";

const {
  EPAccountAddressDetailProvider,
  epAccountAddressDetailProviderMeta,
} = require("../EPAccountAddressDetailProvider");
const { EPAccountAddressProvider, epAccountAddressProviderMeta } = require("../EPAccountAddressProvider");
const { EPAccountAddressList, epAccountAddressListMeta } = require("../EPAccountAddressList");
const { EPAccountAddressField, epAccountAddressFieldMeta } = require("../EPAccountAddressField");
const {
  EPAccountAddressFormProvider,
  epAccountAddressFormProviderMeta,
} = require("../EPAccountAddressFormProvider");
const { EPAccountAddressFormField } = require("../EPAccountAddressFormField");
const account = require("../index");

interface FormActions {
  submit(): Promise<void>;
}

interface ProviderActions {
  delete(addressId: string): Promise<void>;
}

const ADDRESS_A: EpAccountAddress = {
  id: "addr-a",
  first_name: "Ada",
  last_name: "Lovelace",
  line_1: "1 Strand",
  line_2: "Floor 2",
  city: "London",
  phone_number: "123456",
  country: "GB",
};
const ADDRESS_B: EpAccountAddress = {
  id: "addr-b",
  first_name: "Grace",
  last_name: "Hopper",
  line_1: "9 Fixture Road",
  city: "New York",
  phone_number: "",
  country: "US",
};
const ADDRESS_C: EpAccountAddress = {
  id: "addr-c",
  first_name: "Alan",
  city: "Cambridge",
  country: "GB",
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function selected(id: string): AccountContext {
  return {
    ...MOCK_ACCOUNT_SELECTED,
    state: "selected",
    isLoading: false,
    selectedAccount: { id, name: id },
    lapsedAccount: null,
  };
}

function book(addresses: EpAccountAddress[]) {
  return {
    status: "ready" as const,
    addresses,
    total: addresses.length,
    error: null,
  };
}

function published(name: string) {
  return JSON.parse(
    screen.getByTestId(`data-provider-${name}`).getAttribute("data-value")!
  );
}

function cityInput() {
  return screen.getByLabelText("City") as HTMLInputElement;
}

function phoneInput() {
  return screen.getByLabelText("Phone number") as HTMLInputElement;
}

function firstNameInput() {
  return screen.getByLabelText("First name *") as HTMLInputElement;
}

function countrySelect() {
  return screen.getByLabelText("Country") as HTMLSelectElement;
}

function AccountScope(props: {
  account?: AccountContext;
  children?: React.ReactNode;
}) {
  const { DataProvider } = require("@plasmicapp/host");
  return (
    <DataProvider name="account" data={props.account ?? MOCK_ACCOUNT_SELECTED}>
      {props.children}
    </DataProvider>
  );
}

function EditFields() {
  return (
    <>
      <EPAccountAddressFormField name="first_name" required />
      <EPAccountAddressFormField name="city" />
      <EPAccountAddressFormField name="phone_number" />
      <EPAccountAddressFormField name="country" />
    </>
  );
}

function renderDetail(addressId: string | undefined, addresses = [ADDRESS_A, ADDRESS_B, ADDRESS_C]) {
  mockAccountAddresses.mockResolvedValue({
    addresses,
    total: addresses.length,
  });
  render(
    <AccountScope>
      <EPAccountAddressProvider>
        <EPAccountAddressDetailProvider addressId={addressId}>
          <EPAccountAddressField field="line_1" />
        </EPAccountAddressDetailProvider>
      </EPAccountAddressProvider>
    </AccountScope>
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  mockUsePlasmicCanvasContext.mockReturnValue(false);
  mockRecordState = false;
  mockStatePublications.length = 0;
  mockUpdateAccountAddress.mockResolvedValue(ADDRESS_A);
  mockAccountAddresses.mockResolvedValue({
    addresses: [ADDRESS_A, ADDRESS_B],
    total: 2,
  });
});

afterEach(() => {
  cleanup();
});

describe("EP Account Address Detail Provider", () => {
  it("publishes the address named by addressId and no other", async () => {
    mockAccountAddresses.mockResolvedValue({
      addresses: [ADDRESS_A, ADDRESS_B, ADDRESS_C],
      total: 3,
    });
    const { rerender } = render(
      <AccountScope>
        <EPAccountAddressProvider>
          <EPAccountAddressDetailProvider addressId="addr-b">
            <EPAccountAddressField field="city" />
          </EPAccountAddressDetailProvider>
        </EPAccountAddressProvider>
      </AccountScope>
    );
    await waitFor(() => expect(screen.getByText("New York")).toBeTruthy());
    expect(published("currentAccountAddress")).toEqual(ADDRESS_B);
    expect(published("currentAccountAddressIndex")).toBe(1);
    expect(mockAccountAddresses).toHaveBeenCalledTimes(1);

    rerender(
      <AccountScope>
        <EPAccountAddressProvider>
          <EPAccountAddressDetailProvider addressId="addr-c">
            <EPAccountAddressField field="city" />
          </EPAccountAddressDetailProvider>
        </EPAccountAddressProvider>
      </AccountScope>
    );
    await waitFor(() => expect(screen.getByText("Cambridge")).toBeTruthy());
    expect(published("currentAccountAddress").id).toBe("addr-c");
    expect(screen.queryByText("New York")).toBeNull();
    expect(mockAccountAddresses).toHaveBeenCalledTimes(1);
  });

  it.each([undefined, "", "   ", "missing"])(
    "publishes no current address for %s",
    async (addressId) => {
      renderDetail(addressId);
      await waitFor(() =>
        expect(published("accountAddressDetailData").status).toBe("not-found")
      );
      expect(published("accountAddressDetailData").error).toBeNull();
      expect(screen.queryByTestId("data-provider-currentAccountAddress")).toBeNull();
      expect(screen.queryByText("1 Strand")).toBeNull();
    }
  );

  it("stays loading until the address book resolves, then publishes the matching address", async () => {
    const firstLoad = deferred<{ addresses: EpAccountAddress[]; total: number }>();
    mockAccountAddresses.mockReturnValue(firstLoad.promise);
    render(
      <AccountScope>
        <EPAccountAddressProvider>
          <EPAccountAddressDetailProvider addressId="addr-a">
            <EPAccountAddressField field="line_1" />
          </EPAccountAddressDetailProvider>
        </EPAccountAddressProvider>
      </AccountScope>
    );
    expect(published("accountAddressDetailData")).toEqual({
      status: "loading",
      error: null,
    });
    expect(screen.queryByTestId("data-provider-currentAccountAddress")).toBeNull();
    expect(screen.queryByText("1 Strand")).toBeNull();

    await act(async () => {
      firstLoad.resolve({ addresses: [ADDRESS_A, ADDRESS_B], total: 2 });
    });
    await waitFor(() => expect(screen.getByText("1 Strand")).toBeTruthy());
    expect(published("accountAddressDetailData")).toEqual({
      status: "ready",
      error: null,
    });
    expect(published("currentAccountAddress")).toEqual(ADDRESS_A);
    expect(published("currentAccountAddressIndex")).toBe(0);
  });

  it("becomes not-found when the deleted address leaves the refreshed book", async () => {
    const loads: Array<
      ReturnType<typeof deferred<{ addresses: EpAccountAddress[]; total: number }>>
    > = [];
    mockAccountAddresses.mockImplementation(() => {
      const next = deferred<{ addresses: EpAccountAddress[]; total: number }>();
      loads.push(next);
      return next.promise;
    });
    mockDeleteAccountAddress.mockResolvedValue({ id: "addr-a" });
    const providerRef = React.createRef<ProviderActions>();
    const formRef = React.createRef<FormActions>();
    render(
      <AccountScope>
        <EPAccountAddressProvider ref={providerRef}>
          <EPAccountAddressDetailProvider addressId="addr-a">
            <EPAccountAddressField field="line_1" />
            <EPAccountAddressFormProvider ref={formRef} mode="edit">
              <EditFields />
            </EPAccountAddressFormProvider>
          </EPAccountAddressDetailProvider>
        </EPAccountAddressProvider>
      </AccountScope>
    );
    await act(async () => {
      loads[0].resolve({ addresses: [ADDRESS_A, ADDRESS_B], total: 2 });
    });
    await waitFor(() => expect(cityInput().value).toBe("London"));
    expect(published("accountAddressDetailData").status).toBe("ready");

    let deleting!: Promise<void>;
    await act(async () => {
      deleting = providerRef.current!.delete("addr-a");
      await Promise.resolve();
    });
    expect(loads).toHaveLength(2);
    expect(published("accountAddressDetailData").status).toBe("ready");
    expect(published("currentAccountAddress").id).toBe("addr-a");
    expect(published("accountAddresses").addresses.map((row: EpAccountAddress) => row.id)).toEqual([
      "addr-a",
      "addr-b",
    ]);

    await act(async () => {
      loads[1].resolve({ addresses: [ADDRESS_B], total: 1 });
      await deleting;
    });
    expect(published("accountAddressDetailData")).toEqual({
      status: "not-found",
      error: null,
    });
    expect(screen.queryByTestId("data-provider-currentAccountAddress")).toBeNull();
    expect(screen.queryByText("1 Strand")).toBeNull();
    expect(cityInput().value).toBe("");

    mockAccountAddresses.mockResolvedValue({ addresses: [ADDRESS_B], total: 1 });
    mockUpdateAccountAddress.mockResolvedValue({ ...ADDRESS_A, city: "Leeds" });
    fireEvent.change(firstNameInput(), { target: { value: "Ada" } });
    fireEvent.change(cityInput(), { target: { value: "Leeds" } });
    await act(async () => {
      await formRef.current!.submit();
    });
    expect(mockUpdateAccountAddress).not.toHaveBeenCalled();
    expect(mockUpdateAccountAddress.mock.calls).toEqual([]);
    expect(published("accountAddressFormData")).toEqual({
      status: "idle",
      error: null,
      isSubmitting: false,
    });
    expect(screen.queryByTestId("data-provider-currentAccountAddress")).toBeNull();
    expect(Object.keys(epAccountAddressProviderMeta.refActions ?? {})).toEqual(["delete"]);
    expect(epAccountAddressDetailProviderMeta.refActions).toBeUndefined();
  });

  it("reports the parent book error and does not publish another address", async () => {
    mockAccountAddresses.mockRejectedValue(new Error("Elastic Path was unreachable."));
    render(
      <AccountScope>
        <EPAccountAddressProvider>
          <EPAccountAddressDetailProvider addressId="addr-a">
            <EPAccountAddressField field="line_1" />
          </EPAccountAddressDetailProvider>
        </EPAccountAddressProvider>
      </AccountScope>
    );
    await waitFor(() =>
      expect(published("accountAddressDetailData")).toEqual({
        status: "error",
        error: {
          code: "account_addresses_read_failed",
          message: "Elastic Path was unreachable.",
        },
      })
    );
    expect(screen.queryByTestId("data-provider-currentAccountAddress")).toBeNull();
    expect(screen.queryByText("1 Strand")).toBeNull();
    expect(screen.queryByText("New York")).toBeNull();
  });

  it("stays ready when a refresh fails after the address book is committed", async () => {
    const committed = [ADDRESS_B, ADDRESS_A];
    mockAccountAddresses
      .mockResolvedValueOnce({ addresses: committed, total: 2 })
      .mockRejectedValueOnce(new Error("Elastic Path was unreachable."));
    const formRef = React.createRef<FormActions>();
    render(
      <AccountScope>
        <EPAccountAddressProvider>
          <EPAccountAddressDetailProvider addressId="addr-a">
            <EPAccountAddressField field="line_1" />
            <EPAccountAddressFormProvider ref={formRef} mode="edit">
              <EditFields />
            </EPAccountAddressFormProvider>
          </EPAccountAddressDetailProvider>
        </EPAccountAddressProvider>
      </AccountScope>
    );
    await waitFor(() => expect(cityInput().value).toBe("London"));
    expect(published("accountAddressDetailData")).toEqual({
      status: "ready",
      error: null,
    });
    expect(published("currentAccountAddress")).toEqual(ADDRESS_A);
    expect(published("currentAccountAddressIndex")).toBe(1);

    fireEvent.change(cityInput(), { target: { value: "Manchester" } });
    await act(async () => {
      await formRef.current!.submit();
    });

    expect(published("accountAddressDetailData")).toEqual({
      status: "ready",
      error: null,
    });
    expect(published("currentAccountAddress")).toEqual(ADDRESS_A);
    expect(published("currentAccountAddressIndex")).toBe(1);
    expect(published("accountAddresses")).toEqual({
      status: "ready",
      addresses: committed,
      total: 2,
      error: null,
    });
    expect(screen.getByText("1 Strand")).toBeTruthy();
  });

  it("returns to ready when the address id changes to another saved address", async () => {
    const { rerender } = render(
      <AccountScope>
        <EPAccountAddressProvider>
          <EPAccountAddressDetailProvider addressId="missing">
            <EPAccountAddressField field="city" />
          </EPAccountAddressDetailProvider>
        </EPAccountAddressProvider>
      </AccountScope>
    );
    await waitFor(() =>
      expect(published("accountAddressDetailData").status).toBe("not-found")
    );

    rerender(
      <AccountScope>
        <EPAccountAddressProvider>
          <EPAccountAddressDetailProvider addressId="addr-b">
            <EPAccountAddressField field="city" />
          </EPAccountAddressDetailProvider>
        </EPAccountAddressProvider>
      </AccountScope>
    );
    await waitFor(() => expect(screen.getByText("New York")).toBeTruthy());
    expect(published("accountAddressDetailData")).toEqual({
      status: "ready",
      error: null,
    });
    expect(published("currentAccountAddress")).toEqual(ADDRESS_B);
  });

  it("has no ref actions", () => {
    expect(epAccountAddressDetailProviderMeta.refActions).toBeUndefined();
    expect(epAccountAddressDetailProviderMeta.parentComponentName).toBe(
      "plasmic-commerce-ep-account-address-provider"
    );
  });
});

describe("editing a saved address", () => {
  function renderEdit(options?: {
    addressId?: string;
    addresses?: EpAccountAddress[];
    account?: AccountContext;
  }) {
    const ref = React.createRef<FormActions>();
    const view = render(
      <AccountScope account={options?.account}>
        <EPAccountAddressProvider>
          <EPAccountAddressDetailProvider addressId={options?.addressId ?? "addr-a"}>
            <EPAccountAddressField field="line_1" />
            <EPAccountAddressFormProvider ref={ref} mode="edit">
              <EditFields />
            </EPAccountAddressFormProvider>
          </EPAccountAddressDetailProvider>
        </EPAccountAddressProvider>
      </AccountScope>
    );
    return { ref, ...view };
  }

  it("seeds mounted fields, including the saved country, and omits unmounted fields", async () => {
    const { ref } = renderEdit();
    await waitFor(() => expect(firstNameInput().value).toBe("Ada"));
    expect(cityInput().value).toBe("London");
    expect(phoneInput().value).toBe("123456");
    expect(countrySelect().value).toBe("GB");
    expect(screen.getByText("1 Strand")).toBeTruthy();

    fireEvent.change(cityInput(), { target: { value: "Manchester" } });
    await act(async () => {
      await ref.current!.submit();
    });
    expect(mockUpdateAccountAddress).toHaveBeenCalledWith({
      id: "addr-a",
      city: "Manchester",
    });
    expect(mockUpdateAccountAddress.mock.calls[0][0].line_2).toBeUndefined();
    expect(mockUpdateAccountAddress.mock.calls[0][0].first_name).toBeUndefined();
    expect(mockUpdateAccountAddress.mock.calls[0][0].phone_number).toBeUndefined();
  });

  it("sends only the dirty fields and an explicit empty string when a value is cleared", async () => {
    const { ref } = renderEdit();
    await waitFor(() => expect(phoneInput().value).toBe("123456"));
    fireEvent.change(cityInput(), { target: { value: " Manchester " } });
    fireEvent.change(phoneInput(), { target: { value: "" } });
    await act(async () => {
      await ref.current!.submit();
    });
    expect(mockUpdateAccountAddress).toHaveBeenCalledWith({
      id: "addr-a",
      city: "Manchester",
      phone_number: "",
    });
  });

  it("omits a mounted field whose baseline is already empty", async () => {
    mockAccountAddresses.mockResolvedValue({
      addresses: [{ ...ADDRESS_A, phone_number: "" }],
      total: 1,
    });
    const { ref } = renderEdit({
      addresses: [{ ...ADDRESS_A, phone_number: "" }],
    });
    await waitFor(() => expect(phoneInput().value).toBe(""));
    fireEvent.change(cityInput(), { target: { value: "Manchester" } });
    await act(async () => {
      await ref.current!.submit();
    });
    expect(mockUpdateAccountAddress).toHaveBeenCalledWith({
      id: "addr-a",
      city: "Manchester",
    });
  });

  it("does not update when nothing changed", async () => {
    const { ref } = renderEdit();
    await waitFor(() => expect(cityInput().value).toBe("London"));
    await act(async () => {
      await ref.current!.submit();
    });
    expect(mockUpdateAccountAddress).not.toHaveBeenCalled();
    expect(published("accountAddressFormData").status).toBe("idle");
  });

  it("blocks submit when a mounted required field is blank", async () => {
    const { ref } = renderEdit();
    await waitFor(() => expect(firstNameInput().value).toBe("Ada"));
    fireEvent.change(firstNameInput(), { target: { value: "  " } });
    await act(async () => {
      await ref.current!.submit();
    });
    expect(mockUpdateAccountAddress).not.toHaveBeenCalled();
    expect(screen.getByText("This field is required.")).toBeTruthy();
    expect(published("accountAddressFormData").status).toBe("error");
  });

  it("does not update from the Studio canvas and previews a saved address", async () => {
    mockUsePlasmicCanvasContext.mockReturnValue(true);
    const { useAccountAddressForm } = require("../EPAccountAddressFormProvider");
    function DirtyCity() {
      const form = useAccountAddressForm();
      const once = React.useRef(false);
      React.useEffect(() => {
        if (once.current) {
          return;
        }
        once.current = true;
        form.setField("first_name", "Grace");
      });
      return null;
    }
    const ref = React.createRef<FormActions>();
    const fields = (
      <>
        <EPAccountAddressFormField name="first_name" />
        <EPAccountAddressFormField name="country" />
      </>
    );
    const { rerender } = render(
      <EPAccountAddressFormProvider ref={ref} mode="edit">
        {fields}
      </EPAccountAddressFormProvider>
    );
    expect((screen.getByLabelText("First name") as HTMLInputElement).value).toBe("Ada");
    expect((screen.getByLabelText("Country") as HTMLSelectElement).value).toBe("GB");

    for (const previewState of ["idle", "submitting", "submitted", "error"] as const) {
      rerender(
        <EPAccountAddressFormProvider ref={ref} mode="edit" previewState={previewState}>
          {fields}
        </EPAccountAddressFormProvider>
      );
      expect(published("accountAddressFormData").status).toBe(previewState);
      expect((screen.getByLabelText("First name") as HTMLInputElement).value).toBe("Ada");
    }
    expect(published("accountAddressFormData").error.code).toBe(
      "account_address_update_failed"
    );

    rerender(
      <EPAccountAddressFormProvider ref={ref} mode="edit">
        {fields}
        <DirtyCity />
      </EPAccountAddressFormProvider>
    );
    await waitFor(() =>
      expect((screen.getByLabelText("First name") as HTMLInputElement).value).toBe("Grace")
    );
    await act(async () => {
      await ref.current!.submit();
    });
    expect(mockUpdateAccountAddress).not.toHaveBeenCalled();
  });

  it("ignores a second submit while the first is in progress", async () => {
    const gate = deferred<EpAccountAddress>();
    mockUpdateAccountAddress.mockReturnValue(gate.promise);
    const { ref } = renderEdit();
    await waitFor(() => expect(cityInput().value).toBe("London"));
    fireEvent.change(cityInput(), { target: { value: "Manchester" } });
    let first!: Promise<void>;
    await act(async () => {
      first = ref.current!.submit();
      await Promise.resolve();
    });
    expect(cityInput().readOnly).toBe(true);
    await act(async () => {
      await ref.current!.submit();
    });
    expect(mockUpdateAccountAddress).toHaveBeenCalledTimes(1);
    await act(async () => {
      gate.resolve({ ...ADDRESS_A, city: "Manchester" });
      await first;
    });
  });

  function editSurface(addressId: string, ref: React.RefObject<FormActions>, fields?: React.ReactNode) {
    return (
      <AccountScope>
        <EPAccountAddressProvider>
          <EPAccountAddressDetailProvider addressId={addressId}>
            <EPAccountAddressField field="line_1" />
            <EPAccountAddressFormProvider ref={ref} mode="edit">
              {fields ?? <EditFields />}
            </EPAccountAddressFormProvider>
          </EPAccountAddressDetailProvider>
        </EPAccountAddressProvider>
      </AccountScope>
    );
  }

  it("lets B submit while A's update is in flight", async () => {
    const updates: Array<ReturnType<typeof deferred<EpAccountAddress>>> = [];
    mockUpdateAccountAddress.mockImplementation(() => {
      const next = deferred<EpAccountAddress>();
      updates.push(next);
      return next.promise;
    });
    const refreshes: Array<
      ReturnType<typeof deferred<{ addresses: EpAccountAddress[]; total: number }>>
    > = [];
    mockAccountAddresses.mockImplementation(() => {
      const next = deferred<{ addresses: EpAccountAddress[]; total: number }>();
      refreshes.push(next);
      return next.promise;
    });

    const ref = React.createRef<FormActions>();
    const { rerender } = render(editSurface("addr-a", ref));
    await act(async () => {
      refreshes[0].resolve({ addresses: [ADDRESS_A, ADDRESS_B], total: 2 });
    });
    await waitFor(() => expect(cityInput().value).toBe("London"));
    fireEvent.change(cityInput(), { target: { value: "Manchester" } });
    let submitA!: Promise<void>;
    await act(async () => {
      submitA = ref.current!.submit();
      await Promise.resolve();
    });
    expect(mockUpdateAccountAddress).toHaveBeenCalledWith({
      id: "addr-a",
      city: "Manchester",
    });

    rerender(editSurface("addr-b", ref));
    await waitFor(() => expect(firstNameInput().value).toBe("Grace"));
    expect(cityInput().value).toBe("New York");
    expect(countrySelect().value).toBe("US");
    expect(published("accountAddressFormData")).toEqual({
      status: "idle",
      error: null,
      isSubmitting: false,
    });

    fireEvent.change(cityInput(), { target: { value: "Boston" } });
    let submitB!: Promise<void>;
    await act(async () => {
      submitB = ref.current!.submit();
      await Promise.resolve();
    });
    expect(mockUpdateAccountAddress).toHaveBeenNthCalledWith(2, {
      id: "addr-b",
      city: "Boston",
    });
    expect(cityInput().readOnly).toBe(true);
    expect(refreshes).toHaveLength(1);

    await act(async () => {
      updates[0].resolve({ ...ADDRESS_A, city: "Manchester" });
      await Promise.resolve();
    });
    expect(refreshes).toHaveLength(1);
    expect(cityInput().value).toBe("Boston");
    expect(firstNameInput().value).toBe("Grace");
    expect(published("accountAddressFormData")).toEqual({
      status: "submitting",
      error: null,
      isSubmitting: true,
    });
    await act(async () => {
      await ref.current!.submit();
    });
    expect(mockUpdateAccountAddress).toHaveBeenCalledTimes(2);

    await act(async () => {
      updates[1].resolve({ ...ADDRESS_B, city: "Boston" });
      await Promise.resolve();
    });
    expect(refreshes).toHaveLength(2);
    expect(published("accountAddressFormData").isSubmitting).toBe(true);
    expect(published("accountAddresses").addresses[1].city).toBe("New York");

    const newestRefresh = refreshes.length - 1;
    await act(async () => {
      refreshes[newestRefresh].resolve({
        addresses: [{ ...ADDRESS_A, city: "Manchester" }, { ...ADDRESS_B, city: "Boston" }],
        total: 2,
      });
      await submitB;
      await submitA;
    });
    await act(async () => {
      for (let i = newestRefresh - 1; i >= 1; i -= 1) {
        refreshes[i].resolve({
          addresses: [{ id: "stale", line_1: "Stale", city: "Stale City", country: "GB" }],
          total: 1,
        });
      }
    });
    expect(cityInput().value).toBe("Boston");
    expect(published("accountAddressFormData")).toEqual({
      status: "submitted",
      error: null,
      isSubmitting: false,
    });
    expect(published("accountAddresses").addresses.map((row: EpAccountAddress) => row.city)).toEqual([
      "Manchester",
      "Boston",
    ]);

    mockUpdateAccountAddress.mockClear();
    await act(async () => {
      await ref.current!.submit();
    });
    expect(mockUpdateAccountAddress).not.toHaveBeenCalled();
  });

  it("ignores the abandoned update when the shopper returns to the same address", async () => {
    const updates: Array<ReturnType<typeof deferred<EpAccountAddress>>> = [];
    mockUpdateAccountAddress.mockImplementation(() => {
      const next = deferred<EpAccountAddress>();
      updates.push(next);
      return next.promise;
    });
    const ref = React.createRef<FormActions>();
    const { rerender } = render(editSurface("addr-a", ref));
    await waitFor(() => expect(cityInput().value).toBe("London"));
    fireEvent.change(cityInput(), { target: { value: "Manchester" } });
    let first!: Promise<void>;
    await act(async () => {
      first = ref.current!.submit();
      await Promise.resolve();
    });

    rerender(editSurface("addr-b", ref));
    await waitFor(() => expect(cityInput().value).toBe("New York"));
    rerender(editSurface("addr-a", ref));
    await waitFor(() => expect(cityInput().value).toBe("London"));
    expect(published("accountAddressFormData")).toEqual({
      status: "idle",
      error: null,
      isSubmitting: false,
    });

    await act(async () => {
      updates[0].resolve({ ...ADDRESS_A, city: "Manchester" });
      await first;
    });
    expect(cityInput().value).toBe("London");
    expect(firstNameInput().value).toBe("Ada");
    expect(published("accountAddressFormData")).toEqual({
      status: "idle",
      error: null,
      isSubmitting: false,
    });
    await act(async () => {
      await ref.current!.submit();
    });
    expect(mockUpdateAccountAddress).toHaveBeenCalledTimes(1);

    fireEvent.change(cityInput(), { target: { value: "Leeds" } });
    let second!: Promise<void>;
    await act(async () => {
      second = ref.current!.submit();
      await Promise.resolve();
    });
    expect(mockUpdateAccountAddress).toHaveBeenLastCalledWith({
      id: "addr-a",
      city: "Leeds",
    });
    rerender(editSurface("addr-b", ref));
    await waitFor(() => expect(cityInput().value).toBe("New York"));
    rerender(editSurface("addr-a", ref));
    await waitFor(() => expect(cityInput().value).toBe("London"));
    fireEvent.change(cityInput(), { target: { value: "Boston" } });
    let third!: Promise<void>;
    await act(async () => {
      third = ref.current!.submit();
      await Promise.resolve();
    });
    expect(mockUpdateAccountAddress).toHaveBeenLastCalledWith({
      id: "addr-a",
      city: "Boston",
    });

    await act(async () => {
      updates[1].reject(new Error("Elastic Path rejected the account-address update."));
      await second;
    });
    expect(cityInput().value).toBe("Boston");
    expect(published("accountAddressFormData")).toEqual({
      status: "submitting",
      error: null,
      isSubmitting: true,
    });
    await act(async () => {
      await ref.current!.submit();
    });
    expect(mockUpdateAccountAddress).toHaveBeenCalledTimes(3);

    await act(async () => {
      updates[2].resolve({ ...ADDRESS_A, city: "Boston" });
      await third;
      await second;
    });
    expect(cityInput().value).toBe("Boston");
    expect(published("accountAddressFormData")).toEqual({
      status: "submitted",
      error: null,
      isSubmitting: false,
    });
    mockUpdateAccountAddress.mockClear();
    await act(async () => {
      await ref.current!.submit();
    });
    expect(mockUpdateAccountAddress).not.toHaveBeenCalled();
  });

  it("shows a saved value in a field mounted after the edit session starts", async () => {
    const ref = React.createRef<FormActions>();
    const { rerender } = render(
      editSurface(
        "addr-a",
        ref,
        <EPAccountAddressFormField name="city" />
      )
    );
    await waitFor(() => expect(cityInput().value).toBe("London"));
    expect(screen.queryByLabelText("Phone number")).toBeNull();

    rerender(
      editSurface(
        "addr-a",
        ref,
        <>
          <EPAccountAddressFormField name="city" />
          <EPAccountAddressFormField name="phone_number" />
        </>
      )
    );
    expect(phoneInput().value).toBe("123456");
    await act(async () => {
      await ref.current!.submit();
    });
    expect(mockUpdateAccountAddress).not.toHaveBeenCalled();

    fireEvent.change(phoneInput(), { target: { value: "" } });
    await act(async () => {
      await ref.current!.submit();
    });
    expect(mockUpdateAccountAddress).toHaveBeenCalledWith({
      id: "addr-a",
      phone_number: "",
    });
  });

  it("does not send a trimmed-equal value and sends a whitespace clear", async () => {
    const { ref } = renderEdit();
    await waitFor(() => expect(cityInput().value).toBe("London"));
    fireEvent.change(cityInput(), { target: { value: " London " } });
    await act(async () => {
      await ref.current!.submit();
    });
    expect(mockUpdateAccountAddress).not.toHaveBeenCalled();

    fireEvent.change(cityInput(), { target: { value: " " } });
    await act(async () => {
      await ref.current!.submit();
    });
    expect(mockUpdateAccountAddress).toHaveBeenCalledWith({
      id: "addr-a",
      city: "",
    });
  });

  it("omits whitespace when the baseline is empty and sends a later value", async () => {
    mockAccountAddresses.mockResolvedValue({
      addresses: [{ ...ADDRESS_A, phone_number: "" }],
      total: 1,
    });
    const { ref } = renderEdit({
      addresses: [{ ...ADDRESS_A, phone_number: "" }],
    });
    await waitFor(() => expect(phoneInput().value).toBe(""));
    fireEvent.change(phoneInput(), { target: { value: " " } });
    await act(async () => {
      await ref.current!.submit();
    });
    expect(mockUpdateAccountAddress).not.toHaveBeenCalled();

    fireEvent.change(phoneInput(), { target: { value: "123" } });
    await act(async () => {
      await ref.current!.submit();
    });
    expect(mockUpdateAccountAddress).toHaveBeenCalledWith({
      id: "addr-a",
      phone_number: "123",
    });
  });

  it("resets the whole edit session when the address id changes", async () => {
    const { ref, rerender } = renderEdit();
    await waitFor(() => expect(cityInput().value).toBe("London"));
    fireEvent.change(cityInput(), { target: { value: "Manchester" } });
    fireEvent.change(firstNameInput(), { target: { value: "" } });
    await act(async () => {
      await ref.current!.submit();
    });
    expect(screen.getByText("This field is required.")).toBeTruthy();

    rerender(
      <AccountScope>
        <EPAccountAddressProvider>
          <EPAccountAddressDetailProvider addressId="addr-b">
            <EPAccountAddressField field="line_1" />
            <EPAccountAddressFormProvider ref={ref} mode="edit">
              <EditFields />
            </EPAccountAddressFormProvider>
          </EPAccountAddressDetailProvider>
        </EPAccountAddressProvider>
      </AccountScope>
    );
    await waitFor(() => expect(firstNameInput().value).toBe("Grace"));
    expect(cityInput().value).toBe("New York");
    expect(countrySelect().value).toBe("US");
    expect(screen.queryByText("This field is required.")).toBeNull();
    expect(published("accountAddressFormData")).toEqual({
      status: "idle",
      error: null,
      isSubmitting: false,
    });

    fireEvent.change(cityInput(), { target: { value: "Boston" } });
    await act(async () => {
      await ref.current!.submit();
    });
    expect(mockUpdateAccountAddress).toHaveBeenCalledWith({
      id: "addr-b",
      city: "Boston",
    });
  });

  it("does not reseed when the same address id is republished", async () => {
    const ref = React.createRef<FormActions>();
    const view = (addresses: EpAccountAddress[]) => (
      <AccountScope>
        <div>
          {React.createElement(require("@plasmicapp/host").DataProvider, {
            name: "accountAddresses",
            data: book(addresses),
            children: (
              <EPAccountAddressDetailProvider addressId="addr-a">
                <EPAccountAddressFormProvider ref={ref} mode="edit">
                  <EditFields />
                </EPAccountAddressFormProvider>
              </EPAccountAddressDetailProvider>
            ),
          })}
        </div>
      </AccountScope>
    );
    const { rerender } = render(view([ADDRESS_A]));
    await waitFor(() => expect(cityInput().value).toBe("London"));
    rerender(view([{ ...ADDRESS_A, city: "Paris", first_name: "Augusta" }]));
    expect(cityInput().value).toBe("London");
    expect(firstNameInput().value).toBe("Ada");

    fireEvent.change(cityInput(), { target: { value: "Manchester" } });
    rerender(view([{ ...ADDRESS_A, city: "Paris" }]));
    expect(cityInput().value).toBe("Manchester");
    await act(async () => {
      await ref.current!.submit();
    });
    expect(mockUpdateAccountAddress).toHaveBeenCalledWith({
      id: "addr-a",
      city: "Manchester",
    });
  });

  it("keeps submitted drafts as the baseline across the same-id refresh", async () => {
    const refresh = deferred<{ addresses: EpAccountAddress[]; total: number }>();
    mockAccountAddresses
      .mockResolvedValueOnce({ addresses: [ADDRESS_A, ADDRESS_B], total: 2 })
      .mockImplementationOnce(() => refresh.promise);
    const { ref } = renderEdit();
    await waitFor(() => expect(cityInput().value).toBe("London"));
    expect(screen.getByText("1 Strand")).toBeTruthy();
    fireEvent.change(cityInput(), { target: { value: "Manchester" } });
    let submit!: Promise<void>;
    await act(async () => {
      submit = ref.current!.submit();
      await Promise.resolve();
    });
    expect(screen.getByText("1 Strand")).toBeTruthy();
    expect(published("accountAddressFormData").isSubmitting).toBe(true);
    await act(async () => {
      refresh.resolve({
        addresses: [{ ...ADDRESS_A, city: "Manchester" }, ADDRESS_B],
        total: 2,
      });
      await submit;
    });
    expect(cityInput().value).toBe("Manchester");
    expect(published("accountAddressFormData").status).toBe("submitted");
    expect(published("accountAddresses").addresses[0].city).toBe("Manchester");

    mockUpdateAccountAddress.mockClear();
    await act(async () => {
      await ref.current!.submit();
    });
    expect(mockUpdateAccountAddress).not.toHaveBeenCalled();

    fireEvent.change(cityInput(), { target: { value: "Leeds" } });
    await act(async () => {
      await ref.current!.submit();
    });
    expect(mockUpdateAccountAddress).toHaveBeenCalledTimes(1);
    expect(mockUpdateAccountAddress).toHaveBeenCalledWith({
      id: "addr-a",
      city: "Leeds",
    });
  });

  it("stays submitted when the address updated but the list could not refresh", async () => {
    mockAccountAddresses
      .mockResolvedValueOnce({ addresses: [ADDRESS_A], total: 1 })
      .mockRejectedValueOnce(new Error("Elastic Path was unreachable."));
    const { ref } = renderEdit({ addresses: [ADDRESS_A] });
    await waitFor(() => expect(cityInput().value).toBe("London"));
    fireEvent.change(cityInput(), { target: { value: "Manchester" } });
    await act(async () => {
      await ref.current!.submit();
    });
    expect(published("accountAddressFormData")).toEqual({
      status: "submitted",
      error: {
        code: "account_addresses_refresh_failed",
        message:
          "The saved address was updated, but the address list could not be refreshed.",
      },
      isSubmitting: false,
    });
    expect(cityInput().value).toBe("Manchester");
    expect(published("accountAddresses").addresses[0].city).toBe("London");
  });

  it("discards a refresh from account A after the shopper selects account B", async () => {
    const requests: Array<ReturnType<typeof deferred<{ addresses: EpAccountAddress[]; total: number }>>> = [];
    mockAccountAddresses.mockImplementation(() => {
      const next = deferred<{ addresses: EpAccountAddress[]; total: number }>();
      requests.push(next);
      return next.promise;
    });
    const ref = React.createRef<FormActions>();
    const { rerender } = render(
      <AccountScope account={selected("acct-a")}>
        <EPAccountAddressProvider>
          <EPAccountAddressDetailProvider addressId="addr-a">
            <EPAccountAddressFormProvider ref={ref} mode="edit">
              <EditFields />
            </EPAccountAddressFormProvider>
          </EPAccountAddressDetailProvider>
        </EPAccountAddressProvider>
      </AccountScope>
    );
    await act(async () => {
      requests[0].resolve({ addresses: [ADDRESS_A], total: 1 });
    });
    await waitFor(() => expect(cityInput().value).toBe("London"));
    fireEvent.change(cityInput(), { target: { value: "Manchester" } });

    const updated = deferred<EpAccountAddress>();
    mockUpdateAccountAddress.mockReturnValue(updated.promise);
    let submit!: Promise<void>;
    await act(async () => {
      submit = ref.current!.submit();
      await Promise.resolve();
    });
    await act(async () => {
      updated.resolve({ ...ADDRESS_A, city: "Manchester" });
      await Promise.resolve();
    });
    expect(requests).toHaveLength(2);

    rerender(
      <AccountScope account={selected("acct-b")}>
        <EPAccountAddressProvider>
          <EPAccountAddressDetailProvider addressId="addr-b">
            <EPAccountAddressFormProvider ref={ref} mode="edit">
              <EditFields />
            </EPAccountAddressFormProvider>
          </EPAccountAddressDetailProvider>
        </EPAccountAddressProvider>
      </AccountScope>
    );
    expect(requests).toHaveLength(3);
    await act(async () => {
      requests[2].resolve({ addresses: [ADDRESS_B], total: 1 });
    });
    await waitFor(() => expect(cityInput().value).toBe("New York"));
    await act(async () => {
      requests[1].resolve({
        addresses: [{ id: "stale", line_1: "Stale", city: "Stale City", country: "GB" }],
        total: 1,
      });
      await submit;
    });
    expect(published("accountAddresses").addresses.map((row: EpAccountAddress) => row.id)).toEqual([
      "addr-b",
    ]);
    expect(screen.queryByDisplayValue("Stale City")).toBeNull();
  });

  it("does not publish form state after the form unmounts", async () => {
    const gate = deferred<EpAccountAddress>();
    mockUpdateAccountAddress.mockReturnValue(gate.promise);
    const { ref, unmount } = renderEdit();
    await waitFor(() => expect(cityInput().value).toBe("London"));
    fireEvent.change(cityInput(), { target: { value: "Manchester" } });
    let submit!: Promise<void>;
    await act(async () => {
      submit = ref.current!.submit();
      await Promise.resolve();
    });
    mockRecordState = true;
    mockStatePublications.length = 0;
    unmount();
    await act(async () => {
      gate.resolve({ ...ADDRESS_A, city: "Manchester" });
      await submit;
    });
    expect(mockStatePublications).toEqual([]);
  });
});

describe("existing address surfaces", () => {
  it("keeps delete on the address provider and gives the list and field no edit action", () => {
    expect(Object.keys(epAccountAddressProviderMeta.refActions ?? {})).toEqual([
      "delete",
    ]);
    expect(epAccountAddressListMeta.refActions).toBeUndefined();
    expect(epAccountAddressFieldMeta.refActions).toBeUndefined();
    expect(Object.keys(epAccountAddressFormProviderMeta.refActions ?? {})).toEqual([
      "submit",
    ]);
    expect((epAccountAddressFormProviderMeta.props as any).mode.defaultValue).toBe(
      "create"
    );
    expect(account.useAccountAddressBookRefresh).toBeUndefined();
    expect(account.EPAccountAddressList).toBe(EPAccountAddressList);
  });
});
