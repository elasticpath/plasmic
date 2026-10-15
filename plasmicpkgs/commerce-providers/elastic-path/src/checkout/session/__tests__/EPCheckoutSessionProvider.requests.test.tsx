/**
 * @jest-environment jsdom
 */
jest.mock("@plasmicapp/host", () => ({
  DataProvider: ({ children }: any) => children,
  usePlasmicCanvasContext: () => false,
}));

jest.mock("@plasmicapp/host/registerComponent", () => {
  const fn = jest.fn();
  (fn as any).default = jest.fn();
  return fn;
});

import React from "react";
import { act, render, waitFor } from "@testing-library/react";
import { SWRConfig } from "swr";

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { EPCheckoutSessionProvider } = require("../EPCheckoutSessionProvider");

const fetchMock = jest.fn();

function json(body: unknown) {
  return { ok: true, status: 200, json: async () => body };
}

function createRequests() {
  return fetchMock.mock.calls.filter(
    ([url, init]) => url === "/api/checkout/sessions" && init?.method === "POST"
  );
}

function renderProvider(props: Record<string, unknown>, ref?: React.Ref<any>) {
  return render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <EPCheckoutSessionProvider ref={ref} {...props}>
        <span>content</span>
      </EPCheckoutSessionProvider>
    </SWRConfig>
  );
}

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockImplementation(async () =>
    json({ success: true, data: { session: null } })
  );
  global.fetch = fetchMock as any;
});

describe("EPCheckoutSessionProvider session requests", () => {
  it("creates the session for the shopper's session cart, sending no cart id", async () => {
    await act(async () => {
      renderProvider({});
    });

    await waitFor(() => expect(createRequests()).toHaveLength(1));
    expect(createRequests()[0][1].body).toBe("{}");
  });

  it("sends no cart id when the createSession action is given one", async () => {
    const ref = React.createRef<any>();
    await act(async () => {
      renderProvider({ autoCreate: false }, ref);
    });

    await act(async () => {
      await ref.current.createSession("cart-xyz");
    });

    expect(createRequests()).toHaveLength(1);
    expect(createRequests()[0][1].body).toBe("{}");
    expect(JSON.stringify(fetchMock.mock.calls)).not.toContain("cart-xyz");
  });
});
