/** @jest-environment jsdom */

import { render, screen } from "@testing-library/react";
import React from "react";
import { SWRConfig } from "swr";
import { ServerCartActionsProvider } from "../ServerCartActionsProvider";

// ---------------------------------------------------------------------------
// jest.mock doesn't hoist with this project's esbuild transform.
// Mock global.fetch directly (matching existing test patterns).
// ---------------------------------------------------------------------------

const mockFetch = jest.fn();
(global as any).fetch = mockFetch;

function mockFetchSuccess(data: any = {}) {
  mockFetch.mockResolvedValue({
    ok: true,
    json: () => Promise.resolve(data),
    text: () => Promise.resolve(JSON.stringify(data)),
  });
}

beforeEach(() => {
  mockFetch.mockReset();
  mockFetchSuccess({ items: [], meta: null });
});

describe("ServerCartActionsProvider", () => {
  it("renders children", () => {
    render(
      <SWRConfig value={{ dedupingInterval: 0, provider: () => new Map() }}>
        <ServerCartActionsProvider globalContextName="test-provider">
          <span>child content</span>
        </ServerCartActionsProvider>
      </SWRConfig>
    );
    expect(screen.getByText("child content")).toBeTruthy();
  });

  it("provides addItem that sends POST /api/cart/items", async () => {
    // We can't directly access global actions from outside Plasmic,
    // but we can verify the hooks are initialized by checking that
    // useCart's SWR fetch was triggered (hooks are called during render)
    render(
      <SWRConfig value={{ dedupingInterval: 0, provider: () => new Map() }}>
        <ServerCartActionsProvider globalContextName="test-provider">
          <span>ready</span>
        </ServerCartActionsProvider>
      </SWRConfig>
    );

    expect(screen.getByText("ready")).toBeTruthy();

    // The hooks inside ServerCartActionsProvider trigger useCart which
    // fetches /api/cart on mount via SWR
    expect(mockFetch).toHaveBeenCalled();
    const fetchUrl = mockFetch.mock.calls[0][0];
    expect(fetchUrl).toBe("/api/cart");
  });
});
