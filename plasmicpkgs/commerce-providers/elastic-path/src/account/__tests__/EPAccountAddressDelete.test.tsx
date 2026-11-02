/**
 * @jest-environment jsdom
 *
 * Address delete goes through the one Address Provider ref. Row buttons pass
 * the id from that row's data context. A repeated child must not own the ref.
 */

const mockUsePlasmicCanvasContext = jest.fn().mockReturnValue(false);
const mockDeleteAccountAddress = jest.fn();
const mockAccountAddresses = jest.fn();
const mockIdentity = {
  deleteAccountAddress: mockDeleteAccountAddress,
  accountAddresses: mockAccountAddresses,
};

/** Records useState writes after unmount. React 18 does not warn for them. */
let mockRecordProviderState = false;
const mockProviderStatePublications: unknown[] = [];

jest.mock("react", () => {
  const actual = jest.requireActual("react");
  return {
    ...actual,
    useState: (initial: unknown) => {
      const tuple = actual.useState(initial);
      const setState = tuple[1];
      const recordSetState = (value: unknown) => {
        if (mockRecordProviderState) {
          mockProviderStatePublications.push(
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
    repeatedElement: (index: number, children: React.ReactNode) => {
      if (Array.isArray(children)) {
        return children.map((child) =>
          React.isValidElement(child) ? React.cloneElement(child) : child
        );
      }
      if (React.isValidElement(children)) {
        return React.cloneElement(children, { key: index });
      }
      return children;
    },
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

const { EPAccountAddressProvider, epAccountAddressProviderMeta } = require("../EPAccountAddressProvider");
const { EPAccountAddressList, epAccountAddressListMeta } = require("../EPAccountAddressList");
const { epAccountAddressFieldMeta } = require("../EPAccountAddressField");
const { epAccountAddressFormProviderMeta } = require("../EPAccountAddressFormProvider");

interface DeleteActions {
  delete(addressId: string): Promise<void>;
}

const ADDRESS_A = { id: "addr-a", line_1: "Line A" };
const ADDRESS_B = { id: "addr-b", line_1: "Line B" };
const ADDRESS_C = { id: "addr-c", line_1: "Line C" };

const $refs: { addressProvider: DeleteActions | null } = {
  addressProvider: null,
};
const rowRerender: Record<string, () => void> = {};
let lastDelete: Promise<void> = Promise.resolve();

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

function publishedDeletes() {
  return screen
    .getAllByTestId("data-provider-accountAddressDeleteData")
    .map((node) => JSON.parse(node.getAttribute("data-value")!));
}

function publishedBook() {
  return JSON.parse(
    screen.getByTestId("data-provider-accountAddresses").getAttribute("data-value")!
  );
}

function AccountScope(props: {
  account?: AccountContext;
  children?: React.ReactNode;
}) {
  const { DataProvider } = require("@plasmicapp/host");
  return (
    <DataProvider name="account" data={props.account}>
      {props.children}
    </DataProvider>
  );
}

function RowButton() {
  const { useSelector } = require("@plasmicapp/host");
  const address = useSelector("currentAccountAddress") as { id: string };
  const data = useSelector("accountAddressDeleteData") as {
    status: string;
    isDeleting: boolean;
  };
  const [, setTick] = React.useState(0);
  rowRerender[address.id] = () => setTick((tick) => tick + 1);
  return (
    <button
      type="button"
      disabled={data.isDeleting}
      onClick={() => {
        lastDelete = $refs.addressProvider!.delete(address.id);
      }}
    >
      {`${address.id}:${data.status}`}
    </button>
  );
}

function renderBook(account: AccountContext = selected("acct-a")) {
  return render(
    <AccountScope account={account}>
      <EPAccountAddressProvider
        ref={(node: DeleteActions | null) => {
          $refs.addressProvider = node;
        }}
      >
        <EPAccountAddressList>
          <RowButton />
        </EPAccountAddressList>
      </EPAccountAddressProvider>
    </AccountScope>
  );
}

describe("EP account address delete", () => {
  beforeEach(() => {
    mockDeleteAccountAddress.mockReset();
    mockAccountAddresses.mockReset();
    mockDeleteAccountAddress.mockImplementation(async ({ id }: { id: string }) => ({
      id,
    }));
    mockAccountAddresses.mockResolvedValue({
      addresses: [ADDRESS_A, ADDRESS_B, ADDRESS_C],
      total: 3,
    });
    mockUsePlasmicCanvasContext.mockReturnValue(false);
    mockRecordProviderState = false;
    mockProviderStatePublications.length = 0;
    $refs.addressProvider = null;
    for (const id of Object.keys(rowRerender)) delete rowRerender[id];
  });

  afterEach(() => {
    cleanup();
  });

  it("deletes the row whose button passed that row's address id", async () => {
    const gate = deferred<{ id: string }>();
    mockDeleteAccountAddress.mockReturnValue(gate.promise);
    mockAccountAddresses.mockResolvedValueOnce({
      addresses: [ADDRESS_A, ADDRESS_B, ADDRESS_C],
      total: 3,
    });
    renderBook();
    await waitFor(() => expect(screen.getByText("addr-c:idle")).toBeTruthy());

    fireEvent.click(screen.getByText("addr-c:idle"));
    await waitFor(() => expect(screen.getByText("addr-c:deleting")).toBeTruthy());

    expect(mockDeleteAccountAddress).toHaveBeenCalledTimes(1);
    expect(mockDeleteAccountAddress).toHaveBeenCalledWith({ id: "addr-c" });
    expect(publishedDeletes()).toEqual([
      { status: "idle", error: null, isDeleting: true },
      { status: "idle", error: null, isDeleting: true },
      { status: "deleting", error: null, isDeleting: true },
    ]);

    await act(() => {
      rowRerender["addr-b"]();
    });
    fireEvent.click(screen.getByText("addr-c:deleting"));

    expect(mockDeleteAccountAddress).toHaveBeenCalledTimes(1);
    expect(mockDeleteAccountAddress).toHaveBeenCalledWith({ id: "addr-c" });
    expect(publishedDeletes()[1]).toEqual({
      status: "idle",
      error: null,
      isDeleting: true,
    });

    await act(async () => {
      gate.resolve({ id: "addr-c" });
      await lastDelete;
    });
  });

  it("trims the address id captured when delete is invoked", async () => {
    const gate = deferred<{ id: string }>();
    mockDeleteAccountAddress.mockReturnValue(gate.promise);
    renderBook();
    await waitFor(() => expect($refs.addressProvider).toBeTruthy());

    let pending!: Promise<void>;
    act(() => {
      pending = $refs.addressProvider!.delete("  addr-a  ");
    });

    expect(mockDeleteAccountAddress).toHaveBeenCalledTimes(1);
    expect(mockDeleteAccountAddress).toHaveBeenCalledWith({ id: "addr-a" });

    await act(async () => {
      gate.resolve({ id: "addr-a" });
      await pending;
    });
    expect(mockDeleteAccountAddress).toHaveBeenCalledTimes(1);
  });

  it("does not delete from the Studio canvas", async () => {
    mockUsePlasmicCanvasContext.mockReturnValue(true);
    render(
      <EPAccountAddressProvider
        ref={(node: DeleteActions | null) => {
          $refs.addressProvider = node;
        }}
      >
        <EPAccountAddressList>
          <RowButton />
        </EPAccountAddressList>
      </EPAccountAddressProvider>
    );
    await waitFor(() => expect(screen.getAllByRole("button").length).toBeGreaterThan(0));
    await act(async () => {
      await $refs.addressProvider!.delete("addr-a");
    });
    expect(mockDeleteAccountAddress).not.toHaveBeenCalled();
    expect(mockAccountAddresses).not.toHaveBeenCalled();
  });

  it("disables every row while one delete and refresh are in flight", async () => {
    const gate = deferred<{ id: string }>();
    const refresh = deferred<{ addresses: unknown[]; total: number }>();
    mockDeleteAccountAddress.mockReturnValue(gate.promise);
    mockAccountAddresses
      .mockResolvedValueOnce({
        addresses: [ADDRESS_A, ADDRESS_B, ADDRESS_C],
        total: 3,
      })
      .mockImplementationOnce(() => refresh.promise);
    renderBook();
    await waitFor(() => expect($refs.addressProvider).toBeTruthy());

    let first!: Promise<void>;
    await act(async () => {
      first = $refs.addressProvider!.delete("addr-a");
      await Promise.resolve();
    });
    expect(publishedDeletes()).toEqual([
      { status: "deleting", error: null, isDeleting: true },
      { status: "idle", error: null, isDeleting: true },
      { status: "idle", error: null, isDeleting: true },
    ]);

    await act(async () => {
      await $refs.addressProvider!.delete("addr-b");
    });
    expect(mockDeleteAccountAddress).toHaveBeenCalledTimes(1);
    expect(mockDeleteAccountAddress).toHaveBeenCalledWith({ id: "addr-a" });

    mockAccountAddresses.mockResolvedValue({
      addresses: [ADDRESS_B, ADDRESS_C],
      total: 2,
    });
    await act(async () => {
      gate.resolve({ id: "addr-a" });
      await Promise.resolve();
    });
    expect(publishedDeletes().map((row) => row.isDeleting)).toEqual([
      true,
      true,
      true,
    ]);

    await act(async () => {
      refresh.resolve({ addresses: [ADDRESS_B, ADDRESS_C], total: 2 });
      await first;
    });
    expect(publishedDeletes()).toEqual([
      { status: "idle", error: null, isDeleting: false },
      { status: "idle", error: null, isDeleting: false },
    ]);

    await act(async () => {
      await $refs.addressProvider!.delete("addr-b");
    });
    expect(mockDeleteAccountAddress).toHaveBeenCalledTimes(2);
    expect(mockDeleteAccountAddress).toHaveBeenLastCalledWith({ id: "addr-b" });
  });

  it("does not publish delete state after the provider unmounts during refresh", async () => {
    const refresh = deferred<{ addresses: unknown[]; total: number }>();
    mockAccountAddresses
      .mockResolvedValueOnce({
        addresses: [ADDRESS_A, ADDRESS_B],
        total: 2,
      })
      .mockImplementationOnce(() => refresh.promise);
    const { unmount } = renderBook();
    await waitFor(() => expect($refs.addressProvider).toBeTruthy());

    let pending!: Promise<void>;
    await act(async () => {
      pending = $refs.addressProvider!.delete("addr-a");
      await Promise.resolve();
    });
    expect(mockDeleteAccountAddress).toHaveBeenCalledTimes(1);
    expect(mockAccountAddresses).toHaveBeenCalledTimes(2);

    unmount();
    mockRecordProviderState = true;
    mockProviderStatePublications.length = 0;
    await act(async () => {
      refresh.resolve({ addresses: [ADDRESS_B], total: 1 });
      await pending;
    });
    expect(mockProviderStatePublications).toEqual([]);
    mockRecordProviderState = false;
  });

  it("keeps the row until the refresh commits", async () => {
    const refresh = deferred<{ addresses: unknown[]; total: number }>();
    mockAccountAddresses
      .mockResolvedValueOnce({
        addresses: [ADDRESS_A, ADDRESS_B, ADDRESS_C],
        total: 3,
      })
      .mockImplementationOnce(() => refresh.promise);
    renderBook();
    await waitFor(() => expect(screen.getByText("addr-a:idle")).toBeTruthy());

    fireEvent.click(screen.getByText("addr-a:idle"));
    await waitFor(() => expect(screen.getByText("addr-a:deleting")).toBeTruthy());
    expect(screen.getByText("addr-b:idle")).toBeTruthy();
    expect(screen.getByText("addr-c:idle")).toBeTruthy();
    expect(
      publishedBook().addresses.map((address: { id: string }) => address.id)
    ).toEqual(["addr-a", "addr-b", "addr-c"]);

    mockAccountAddresses.mockResolvedValue({
      addresses: [ADDRESS_B, ADDRESS_C],
      total: 2,
    });
    await act(async () => {
      refresh.resolve({ addresses: [ADDRESS_B, ADDRESS_C], total: 2 });
      await lastDelete;
    });
    expect(screen.queryByText(/addr-a:/)).toBeNull();
    expect(screen.getByText("addr-b:idle")).toBeTruthy();
    expect(screen.getByText("addr-c:idle")).toBeTruthy();
  });

  it("keeps a delete error on the matching row only", async () => {
    mockDeleteAccountAddress.mockRejectedValueOnce(
      Object.assign(new Error("Elastic Path rejected the account-address delete."), {
        code: "account_address_delete_failed",
      })
    );
    renderBook();
    await waitFor(() => expect($refs.addressProvider).toBeTruthy());
    await act(async () => {
      await $refs.addressProvider!.delete("addr-a");
    });
    expect(publishedDeletes()).toEqual([
      {
        status: "error",
        error: {
          code: "account_address_delete_failed",
          message: "Elastic Path rejected the account-address delete.",
        },
        isDeleting: false,
      },
      { status: "idle", error: null, isDeleting: false },
      { status: "idle", error: null, isDeleting: false },
    ]);
  });

  it("stays deleted when the address was deleted but the list could not refresh", async () => {
    mockAccountAddresses
      .mockResolvedValueOnce({
        addresses: [ADDRESS_A, ADDRESS_B, ADDRESS_C],
        total: 3,
      })
      .mockRejectedValueOnce(new Error("Elastic Path was unreachable."));
    renderBook();
    await waitFor(() => expect($refs.addressProvider).toBeTruthy());

    await act(async () => {
      await $refs.addressProvider!.delete("addr-a");
    });
    expect(publishedDeletes()[0]).toEqual({
      status: "deleted",
      error: {
        code: "account_addresses_refresh_failed",
        message:
          "The saved address was deleted, but the address list could not be refreshed.",
      },
      isDeleting: false,
    });
    expect(publishedDeletes()[1].status).toBe("idle");
    expect(publishedDeletes()[2].status).toBe("idle");
    expect(screen.getByText("addr-a:deleted")).toBeTruthy();

    await act(async () => {
      await $refs.addressProvider!.delete("addr-a");
    });
    expect(mockDeleteAccountAddress).toHaveBeenCalledTimes(1);

    mockAccountAddresses.mockResolvedValueOnce({
      addresses: [ADDRESS_C],
      total: 1,
    });
    await act(async () => {
      await $refs.addressProvider!.delete("addr-b");
    });
    expect(mockDeleteAccountAddress).toHaveBeenCalledTimes(2);
    expect(mockDeleteAccountAddress).toHaveBeenLastCalledWith({ id: "addr-b" });
  });

  it("does not call for a blank address id", async () => {
    renderBook();
    await waitFor(() => expect($refs.addressProvider).toBeTruthy());
    await act(async () => {
      await $refs.addressProvider!.delete("   ");
    });
    expect(mockDeleteAccountAddress).not.toHaveBeenCalled();
    expect(publishedDeletes().every((row) => row.status === "idle")).toBe(true);
  });

  it("discards a refresh from account A after the shopper selects account B", async () => {
    const requests: Array<
      ReturnType<typeof deferred<{ addresses: unknown[]; total: number }>>
    > = [];
    mockAccountAddresses.mockImplementation(() => {
      const next = deferred<{ addresses: unknown[]; total: number }>();
      requests.push(next);
      return next.promise;
    });
    const { rerender } = renderBook(selected("acct-a"));
    await act(async () => {
      requests[0].resolve({ addresses: [ADDRESS_A], total: 1 });
    });
    await waitFor(() => expect(screen.getByText("addr-a:idle")).toBeTruthy());

    const gate = deferred<{ id: string }>();
    mockDeleteAccountAddress.mockReturnValue(gate.promise);
    fireEvent.click(screen.getByText("addr-a:idle"));
    await waitFor(() => expect(mockDeleteAccountAddress).toHaveBeenCalledTimes(1));
    expect(requests).toHaveLength(1);

    await act(async () => {
      gate.resolve({ id: "addr-a" });
      await Promise.resolve();
    });
    expect(requests).toHaveLength(2);

    rerender(
      <AccountScope account={selected("acct-b")}>
        <EPAccountAddressProvider
          ref={(node: DeleteActions | null) => {
            $refs.addressProvider = node;
          }}
        >
          <EPAccountAddressList>
            <RowButton />
          </EPAccountAddressList>
        </EPAccountAddressProvider>
      </AccountScope>
    );
    expect(requests).toHaveLength(3);
    await act(async () => {
      requests[2].resolve({ addresses: [ADDRESS_B], total: 1 });
    });
    await waitFor(() => expect(screen.getByText("addr-b:idle")).toBeTruthy());

    await act(async () => {
      requests[1].resolve({
        addresses: [{ id: "stale", line_1: "Stale" }],
        total: 1,
      });
      await lastDelete;
    });
    expect(screen.getByText("addr-b:idle")).toBeTruthy();
    expect(screen.queryByText(/stale:/)).toBeNull();
    expect(screen.queryByText(/addr-a:/)).toBeNull();
    expect(publishedBook()).toEqual({
      status: "ready",
      addresses: [ADDRESS_B],
      total: 1,
      error: null,
    });
  });

  describe("registration", () => {
    it("puts delete only on the address provider", () => {
      expect(Object.keys(epAccountAddressProviderMeta.refActions ?? {})).toEqual([
        "delete",
      ]);
      expect(epAccountAddressProviderMeta.refActions.delete.argTypes).toEqual([
        { name: "addressId", type: "string", displayName: "Address ID" },
      ]);
      expect(epAccountAddressListMeta.refActions).toBeUndefined();
      expect(epAccountAddressFieldMeta.refActions).toBeUndefined();
      expect(Object.keys(epAccountAddressFormProviderMeta.refActions ?? {})).toEqual([
        "submit",
      ]);
      const account = require("../index");
      expect(account.EPAccountAddressDeleteProvider).toBeUndefined();
      expect(account.registerEPAccountAddressDeleteProvider).toBeUndefined();
      expect(account.epAccountAddressDeleteProviderMeta).toBeUndefined();
    });
  });
});
