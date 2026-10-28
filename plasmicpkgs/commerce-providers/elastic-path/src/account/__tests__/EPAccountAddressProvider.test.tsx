/** @jest-environment jsdom */

const mockUsePlasmicCanvasContext = jest.fn().mockReturnValue(false);
const mockAccountAddresses = jest.fn();
const mockIdentity = { accountAddresses: mockAccountAddresses };

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
import { act, render, screen, waitFor } from "@testing-library/react";
import type { EpAccountAddress, EpAccountAddressResult } from "../../identity/operations";
import {
  MOCK_ACCOUNT_ADDRESSES,
  MOCK_ACCOUNT_ANONYMOUS,
  MOCK_ACCOUNT_LAPSED,
  MOCK_ACCOUNT_MEMBER_ONLY,
  MOCK_ACCOUNT_SELECTED,
} from "../../utils/design-time-data";
import type { AccountAddressBookContext, AccountContext } from "../types";

const {
  EPAccountAddressProvider,
  registerEPAccountAddressProvider,
  epAccountAddressProviderMeta,
  useAccountAddressBookRefresh,
} = require("../EPAccountAddressProvider");
const { EPAccountAddressList } = require("../EPAccountAddressList");
const { EPAccountAddressField } = require("../EPAccountAddressField");

const addressA: EpAccountAddress = {
  id: "addr-a",
  name: "Office A",
  line_1: "Line A",
};
const addressB: EpAccountAddress = {
  id: "addr-b",
  name: "Office B",
  line_1: "Line B",
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

function selected(
  id: string,
  patch: Partial<AccountContext> = {}
): AccountContext {
  return {
    ...MOCK_ACCOUNT_SELECTED,
    state: "selected",
    isLoading: false,
    selectedAccount: { id, name: id },
    lapsedAccount: null,
    ...patch,
  };
}

function published(): AccountAddressBookContext {
  const raw = screen
    .getByTestId("data-provider-accountAddresses")
    .getAttribute("data-value");
  return JSON.parse(raw || "null");
}

function Harness(props: {
  account?: AccountContext;
  previewState?: string;
  children?: React.ReactNode;
}) {
  const { account, previewState, children } = props;
  return (
    <div data-testid="account-root" data-account={account?.selectedAccount?.id}>
      {/* The host mock reads this provider. Re-provided below via DataProvider name. */}
      <AccountScope account={account}>
        <EPAccountAddressProvider previewState={previewState as any}>
          {children}
        </EPAccountAddressProvider>
      </AccountScope>
    </div>
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

describe("EPAccountAddressProvider", () => {
  beforeEach(() => {
    mockAccountAddresses.mockReset();
    mockAccountAddresses.mockResolvedValue({ addresses: [], total: 0 });
    mockUsePlasmicCanvasContext.mockReturnValue(false);
  });

  it("calls accountAddresses with no arguments and publishes the result", async () => {
    const result: EpAccountAddressResult = {
      addresses: [addressA, addressB],
      total: 2,
    };
    mockAccountAddresses.mockResolvedValue(result);
    let latest: AccountAddressBookContext | undefined;
    function Probe() {
      const { useSelector } = require("@plasmicapp/host");
      latest = useSelector("accountAddresses");
      return null;
    }

    render(
      <Harness account={selected("acct-a")}>
        <Probe />
      </Harness>
    );

    await waitFor(() => expect(latest?.status).toBe("ready"));
    expect(mockAccountAddresses).toHaveBeenCalledTimes(1);
    expect(mockAccountAddresses.mock.calls[0]).toEqual([]);
    expect(latest!.addresses).toBe(result.addresses);
    expect(latest!.total).toBe(2);
    expect(latest!.error).toBeNull();
    expect(Object.keys(latest!).sort()).toEqual([
      "addresses",
      "error",
      "status",
      "total",
    ]);
  });

  it("publishes empty for an empty collection and does not treat it as an error", async () => {
    const result: EpAccountAddressResult = { addresses: [], total: 0 };
    mockAccountAddresses.mockResolvedValue(result);
    let latest: AccountAddressBookContext | undefined;
    function Probe() {
      const { useSelector } = require("@plasmicapp/host");
      latest = useSelector("accountAddresses");
      return null;
    }
    render(
      <Harness account={selected("acct-a")}>
        <Probe />
      </Harness>
    );
    await waitFor(() => expect(latest?.status).toBe("empty"));
    expect(latest!.addresses).toBe(result.addresses);
    expect(latest!.total).toBe(0);
    expect(latest!.error).toBeNull();
  });

  it("publishes a read failure with the identity code and message", async () => {
    const err = new Error("Elastic Path rejected the account-address read.");
    (err as { code?: string }).code = "account_addresses_read_failed";
    mockAccountAddresses.mockRejectedValue(err);
    render(<Harness account={selected("acct-a")} />);
    await waitFor(() => expect(published().status).toBe("error"));
    expect(published().error).toEqual({
      code: "account_addresses_read_failed",
      message: "Elastic Path rejected the account-address read.",
    });
    expect(published().addresses).toEqual([]);
  });

  it("keeps a refusal code from the identity error", async () => {
    const err = new Error(
      "The account credential ran out and cannot be re-minted. Sign in again."
    );
    (err as { code?: string }).code = "account_lapsed";
    mockAccountAddresses.mockRejectedValue(err);
    render(<Harness account={selected("acct-a")} />);
    await waitFor(() => expect(published().status).toBe("error"));
    expect(published().error?.code).toBe("account_lapsed");
    expect(published().addresses).toEqual([]);
  });

  it("does not fetch while the account context is loading", async () => {
    const { rerender } = render(
      <Harness account={{ ...selected("acct-a"), isLoading: true }} />
    );
    await act(async () => {
      await Promise.resolve();
    });
    expect(mockAccountAddresses).not.toHaveBeenCalled();
    expect(published().status).toBe("loading");
    expect(published().addresses).toEqual([]);

    rerender(<Harness account={selected("acct-a")} />);
    await waitFor(() => expect(mockAccountAddresses).toHaveBeenCalledTimes(1));
    expect(mockAccountAddresses.mock.calls[0]).toEqual([]);
  });

  it.each([
    ["member only", MOCK_ACCOUNT_MEMBER_ONLY, "no_selected_account"],
    ["lapsed", MOCK_ACCOUNT_LAPSED, "account_lapsed"],
    ["anonymous", MOCK_ACCOUNT_ANONYMOUS, "no_account_member"],
  ] as const)(
    "publishes %s without calling accountAddresses",
    async (_label, account, code) => {
      render(<Harness account={account} />);
      await waitFor(() => expect(published().status).toBe("error"));
      expect(published().error?.code).toBe(code);
      expect(published().addresses).toEqual([]);
      expect(mockAccountAddresses).not.toHaveBeenCalled();
    }
  );

  it("publishes no_account_member when no account context is provided", async () => {
    render(<Harness />);
    await waitFor(() => expect(published().status).toBe("error"));
    expect(published().error?.code).toBe("no_account_member");
    expect(mockAccountAddresses).not.toHaveBeenCalled();
  });

  it("clears rows while the same account reloads and does not read again when it returns", async () => {
    mockAccountAddresses.mockResolvedValue({
      addresses: [addressA],
      total: 1,
    });
    const rows = (
      <EPAccountAddressList>
        <EPAccountAddressField field="line_1" />
      </EPAccountAddressList>
    );
    const { rerender } = render(
      <Harness account={selected("acct-a")}>{rows}</Harness>
    );
    await waitFor(() => expect(screen.getByText("Line A")).toBeTruthy());

    rerender(
      <Harness
        account={{
          ...MOCK_ACCOUNT_ANONYMOUS,
          isLoading: true,
        }}
      >
        {rows}
      </Harness>
    );
    expect(screen.queryByText("Line A")).toBeNull();
    expect(published().status).toBe("loading");
    expect(published().addresses).toEqual([]);

    rerender(
      <Harness account={selected("acct-a", { isLoading: true })}>{rows}</Harness>
    );
    expect(screen.queryByText("Line A")).toBeNull();
    expect(published().addresses).toEqual([]);

    rerender(
      <Harness
        account={selected("acct-a", {
          accountMember: { id: "sample-member", name: "Changed" },
        })}
      >
        {rows}
      </Harness>
    );
    expect(screen.getByText("Line A")).toBeTruthy();
    expect(published().status).toBe("ready");
    expect(published().addresses.map((address) => address.id)).toEqual([
      "addr-a",
    ]);
    expect(mockAccountAddresses).toHaveBeenCalledTimes(1);
  });

  it("clears rows while logout reload is pending and does not read again", async () => {
    mockAccountAddresses.mockResolvedValue({
      addresses: [addressA],
      total: 1,
    });
    const rows = (
      <EPAccountAddressList>
        <EPAccountAddressField field="line_1" />
      </EPAccountAddressList>
    );
    const { rerender } = render(
      <Harness account={selected("acct-a")}>{rows}</Harness>
    );
    await waitFor(() => expect(screen.getByText("Line A")).toBeTruthy());

    rerender(
      <Harness account={{ ...MOCK_ACCOUNT_ANONYMOUS, isLoading: true }}>
        {rows}
      </Harness>
    );
    expect(screen.queryByText("Line A")).toBeNull();
    expect(published()).toEqual({
      status: "loading",
      addresses: [],
      total: 0,
      error: null,
    });

    rerender(<Harness account={MOCK_ACCOUNT_ANONYMOUS}>{rows}</Harness>);
    await waitFor(() => expect(published().status).toBe("error"));
    expect(published().error?.code).toBe("no_account_member");
    expect(published().addresses).toEqual([]);
    expect(screen.queryByText("Line A")).toBeNull();
    expect(mockAccountAddresses).toHaveBeenCalledTimes(1);
  });

  it("clears A while the switch reload is loading, then reads B", async () => {
    const requests: Array<ReturnType<typeof deferred<EpAccountAddressResult>>> =
      [];
    mockAccountAddresses.mockImplementation(() => {
      const next = deferred<EpAccountAddressResult>();
      requests.push(next);
      return next.promise;
    });
    const seen: string[][] = [];
    function Recorder() {
      const { useSelector } = require("@plasmicapp/host");
      const book = useSelector("accountAddresses") as AccountAddressBookContext;
      seen.push(book.addresses.map((address) => address.line_1 ?? ""));
      return null;
    }
    const tree = (account: AccountContext) => (
      <Harness account={account}>
        <Recorder />
        <EPAccountAddressList>
          <EPAccountAddressField field="line_1" />
        </EPAccountAddressList>
      </Harness>
    );

    const { rerender } = render(tree(selected("acct-a")));
    await waitFor(() => expect(requests).toHaveLength(1));
    await act(async () => {
      requests[0].resolve({ addresses: [addressA], total: 1 });
    });
    await waitFor(() => expect(screen.getByText("Line A")).toBeTruthy());

    const beforeSwitch = seen.length;
    rerender(
      tree({
        ...MOCK_ACCOUNT_ANONYMOUS,
        isLoading: true,
        isSelecting: true,
      })
    );
    expect(seen.slice(beforeSwitch)[0]).toEqual([]);
    expect(
      seen.slice(beforeSwitch).some((lines) => lines.includes("Line A"))
    ).toBe(false);
    expect(screen.queryByText("Line A")).toBeNull();
    expect(published().status).toBe("loading");
    expect(published().addresses).toEqual([]);
    expect(mockAccountAddresses).toHaveBeenCalledTimes(1);

    rerender(tree(selected("acct-b")));
    expect(screen.queryByText("Line A")).toBeNull();
    expect(published().addresses).toEqual([]);
    expect(mockAccountAddresses).toHaveBeenCalledTimes(2);

    await act(async () => {
      requests[0].resolve({
        addresses: [{ ...addressA, line_1: "Late A" }],
        total: 1,
      });
    });
    expect(screen.queryByText("Late A")).toBeNull();

    await act(async () => {
      requests[1].resolve({ addresses: [addressB], total: 1 });
    });
    await waitFor(() => expect(screen.getByText("Line B")).toBeTruthy());
    expect(screen.queryByText("Line A")).toBeNull();
    expect(screen.queryByText("Late A")).toBeNull();
  });

  it("drops account A on the first render that selects B", async () => {
    const requests: Array<ReturnType<typeof deferred<EpAccountAddressResult>>> =
      [];
    mockAccountAddresses.mockImplementation(() => {
      const next = deferred<EpAccountAddressResult>();
      requests.push(next);
      return next.promise;
    });

    const seen: Array<{
      accountId?: string;
      status: string;
      lines: string[];
    }> = [];
    function Recorder() {
      const { useSelector } = require("@plasmicapp/host");
      const account = useSelector("account") as AccountContext | undefined;
      const book = useSelector("accountAddresses") as AccountAddressBookContext;
      seen.push({
        accountId: account?.selectedAccount?.id,
        status: book.status,
        lines: book.addresses.map((address) => address.line_1 ?? ""),
      });
      return null;
    }

    const tree = (account: AccountContext) => (
      <Harness account={account}>
        <span data-testid="sibling">Stay</span>
        <Recorder />
        <EPAccountAddressList>
          <EPAccountAddressField field="line_1" />
        </EPAccountAddressList>
      </Harness>
    );

    const { rerender } = render(tree(selected("acct-a")));
    await waitFor(() => expect(requests).toHaveLength(1));
    await act(async () => {
      requests[0].resolve({ addresses: [addressA], total: 1 });
    });
    await waitFor(() => expect(screen.getByText("Line A")).toBeTruthy());

    const beforeSwitch = seen.length;
    rerender(tree(selected("acct-b")));

    const forB = seen.slice(beforeSwitch).filter((row) => row.accountId === "acct-b");
    expect(forB.length).toBeGreaterThan(0);
    expect(forB[0]).toEqual({
      accountId: "acct-b",
      status: "loading",
      lines: [],
    });
    expect(forB.some((row) => row.lines.includes("Line A"))).toBe(false);
    expect(screen.queryByText("Line A")).toBeNull();
    expect(screen.getByTestId("sibling")).toBeTruthy();
    expect(mockAccountAddresses).toHaveBeenCalledTimes(2);
    expect(requests[1].promise).not.toBe(requests[0].promise);
  });

  it("ignores an in-flight response for A after B has been requested", async () => {
    const requests: Array<ReturnType<typeof deferred<EpAccountAddressResult>>> =
      [];
    mockAccountAddresses.mockImplementation(() => {
      const next = deferred<EpAccountAddressResult>();
      requests.push(next);
      return next.promise;
    });
    const { rerender } = render(<Harness account={selected("acct-a")} />);
    await waitFor(() => expect(requests).toHaveLength(1));
    rerender(<Harness account={selected("acct-b")} />);
    await waitFor(() => expect(requests).toHaveLength(2));

    await act(async () => {
      requests[0].resolve({ addresses: [addressA], total: 1 });
    });
    expect(published().status).toBe("loading");
    expect(published().addresses).toEqual([]);
    expect(screen.queryByText("Line A")).toBeNull();

    await act(async () => {
      requests[1].resolve({ addresses: [addressB], total: 1 });
    });
    await waitFor(() => expect(published().status).toBe("ready"));
    expect(published().addresses.map((address) => address.id)).toEqual([
      "addr-b",
    ]);

    await act(async () => {
      requests[0].resolve({
        addresses: [{ ...addressA, line_1: "Later A" }],
        total: 1,
      });
    });
    expect(published().addresses.map((address) => address.id)).toEqual([
      "addr-b",
    ]);
  });

  it.each([
    "auto",
    "withAddresses",
    "empty",
    "loading",
    "error",
    "noSelectedAccount",
    "lapsed",
  ] as const)(
    "canvas preview %s does not call accountAddresses",
    async (previewState) => {
      mockUsePlasmicCanvasContext.mockReturnValue(true);
      render(
        <Harness account={selected("acct-a")} previewState={previewState} />
      );
      await act(async () => {
        await Promise.resolve();
      });
      expect(mockAccountAddresses).not.toHaveBeenCalled();
    }
  );

  it("shows two fixture addresses for canvas auto", async () => {
    mockUsePlasmicCanvasContext.mockReturnValue(true);
    render(<Harness account={selected("acct-a")} previewState="auto" />);
    expect(published().status).toBe("ready");
    expect(published().addresses).toEqual(MOCK_ACCOUNT_ADDRESSES);
    expect(published().addresses.map((address) => address.id)).toEqual([
      "sample-address-1",
      "sample-address-2",
    ]);
    expect(mockAccountAddresses).not.toHaveBeenCalled();
  });

  it("ignores previewState at runtime", async () => {
    mockAccountAddresses.mockResolvedValue({
      addresses: [addressA],
      total: 1,
    });
    render(<Harness account={selected("acct-a")} previewState="empty" />);
    await waitFor(() => expect(published().status).toBe("ready"));
    expect(published().addresses.map((address) => address.id)).toEqual([
      "addr-a",
    ]);
    expect(mockAccountAddresses).toHaveBeenCalledTimes(1);
  });

  describe("mutation refresh", () => {
    function RefreshHandle(props: {
      current: { refresh: () => Promise<void> };
    }) {
      props.current.refresh = useAccountAddressBookRefresh();
      return null;
    }

    it("replaces the committed book and keeps the current rows until then", async () => {
      const refresh = deferred<EpAccountAddressResult>();
      mockAccountAddresses
        .mockResolvedValueOnce({ addresses: [addressA], total: 1 })
        .mockImplementationOnce(() => refresh.promise);
      const handle = {
        refresh: () => Promise.resolve(),
      };
      render(
        <Harness account={selected("acct-a")}>
          <RefreshHandle current={handle} />
          <EPAccountAddressList>
            <EPAccountAddressField field="line_1" />
          </EPAccountAddressList>
        </Harness>
      );
      await waitFor(() => expect(screen.getByText("Line A")).toBeTruthy());

      let settled = false;
      const pending = handle.refresh().then(() => {
        settled = true;
      });
      expect(screen.getByText("Line A")).toBeTruthy();
      expect(published().addresses.map((address) => address.id)).toEqual([
        "addr-a",
      ]);
      expect(settled).toBe(false);
      expect(mockAccountAddresses).toHaveBeenCalledTimes(2);
      expect(mockAccountAddresses.mock.calls[1]).toEqual([]);

      await act(async () => {
        refresh.resolve({ addresses: [addressB], total: 1 });
        await pending;
      });
      expect(screen.getByText("Line B")).toBeTruthy();
      expect(screen.queryByText("Line A")).toBeNull();
      expect(published()).toEqual({
        status: "ready",
        addresses: [addressB],
        total: 1,
        error: null,
      });
    });

    it("keeps B's committed rows when A's refresh resolves afterwards", async () => {
      const requests: Array<ReturnType<typeof deferred<EpAccountAddressResult>>> =
        [];
      mockAccountAddresses.mockImplementation(() => {
        const next = deferred<EpAccountAddressResult>();
        requests.push(next);
        return next.promise;
      });
      const handle = { refresh: () => Promise.resolve() };
      const rows = (
        <EPAccountAddressList>
          <EPAccountAddressField field="line_1" />
        </EPAccountAddressList>
      );
      const { rerender } = render(
        <Harness account={selected("acct-a")}>
          <RefreshHandle current={handle} />
          {rows}
        </Harness>
      );
      await act(async () => {
        requests[0].resolve({ addresses: [addressA], total: 1 });
      });
      await waitFor(() => expect(screen.getByText("Line A")).toBeTruthy());

      const stale = handle.refresh();
      expect(requests).toHaveLength(2);

      rerender(
        <Harness account={selected("acct-b")}>
          <RefreshHandle current={handle} />
          {rows}
        </Harness>
      );
      expect(requests).toHaveLength(3);

      await act(async () => {
        requests[2].resolve({ addresses: [addressB], total: 1 });
      });
      await waitFor(() => expect(screen.getByText("Line B")).toBeTruthy());
      expect(screen.queryByText("Line A")).toBeNull();
      expect(published()).toEqual({
        status: "ready",
        addresses: [addressB],
        total: 1,
        error: null,
      });

      await act(async () => {
        requests[1].resolve({
          addresses: [{ id: "stale", line_1: "Stale" }],
          total: 1,
        });
        await stale;
      });
      expect(screen.getByText("Line B")).toBeTruthy();
      expect(screen.queryByText("Stale")).toBeNull();
      expect(screen.queryByText("Line A")).toBeNull();
      expect(published()).toEqual({
        status: "ready",
        addresses: [addressB],
        total: 1,
        error: null,
      });
    });

    it("leaves the previous book in place when the refresh fails", async () => {
      mockAccountAddresses
        .mockResolvedValueOnce({ addresses: [addressA], total: 1 })
        .mockRejectedValueOnce(new Error("Elastic Path was unreachable."));
      const handle = { refresh: () => Promise.resolve() };
      render(
        <Harness account={selected("acct-a")}>
          <RefreshHandle current={handle} />
          <EPAccountAddressList>
            <EPAccountAddressField field="line_1" />
          </EPAccountAddressList>
        </Harness>
      );
      await waitFor(() => expect(screen.getByText("Line A")).toBeTruthy());

      await expect(handle.refresh()).rejects.toThrow(
        "Elastic Path was unreachable."
      );
      expect(screen.getByText("Line A")).toBeTruthy();
      expect(published()).toEqual({
        status: "ready",
        addresses: [addressA],
        total: 1,
        error: null,
      });
    });
  });

  describe("registration", () => {
    it("exposes only the display props and the account-provider parent", () => {
      expect(epAccountAddressProviderMeta.name).toBe(
        "plasmic-commerce-ep-account-address-provider"
      );
      expect(epAccountAddressProviderMeta.displayName).toBe(
        "EP Account Address Provider"
      );
      expect(epAccountAddressProviderMeta.importName).toBe(
        "EPAccountAddressProvider"
      );
      expect(epAccountAddressProviderMeta.importPath).toBe(
        "@elasticpath/plasmic-ep-commerce-elastic-path"
      );
      expect(epAccountAddressProviderMeta.providesData).toBe(true);
      expect(epAccountAddressProviderMeta.parentComponentName).toBe(
        "plasmic-commerce-ep-account-provider"
      );
      expect(epAccountAddressProviderMeta.refActions?.delete).toEqual({
        displayName: "Delete",
        description:
          "Delete one saved address by id, then read the address book again. Pass the row's `$ctx.currentAccountAddress.id`. No-op in the Studio canvas. Does nothing while a delete is in progress, and does nothing again for an address that has already been deleted.",
        argTypes: [
          {
            name: "addressId",
            type: "string",
            displayName: "Address ID",
          },
        ],
      });
      expect(Object.keys(epAccountAddressProviderMeta.refActions ?? {})).toEqual([
        "delete",
      ]);
      expect(Object.keys(epAccountAddressProviderMeta.props ?? {}).sort()).toEqual(
        ["children", "previewState"]
      );
      const preview = (epAccountAddressProviderMeta.props as any).previewState;
      expect(preview.options.map((option: { value: string }) => option.value)).toEqual([
        "auto",
        "withAddresses",
        "empty",
        "loading",
        "error",
        "noSelectedAccount",
        "lapsed",
      ]);
      for (const name of Object.keys(epAccountAddressProviderMeta.props ?? {})) {
        expect(name).not.toMatch(/account|token|credential|filter|path|reload/i);
      }
    });

    it("registers the component with its meta", () => {
      const loader = { registerComponent: jest.fn() };
      registerEPAccountAddressProvider(loader);
      expect(loader.registerComponent).toHaveBeenCalledWith(
        EPAccountAddressProvider,
        epAccountAddressProviderMeta
      );
    });
  });
});
