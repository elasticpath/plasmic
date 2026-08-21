/**
 * @jest-environment jsdom
 *
 * useBundleForm against the real react-hook-form and the real Zod schema.
 *
 * The rest of the suite mocks both, which is why a bundle could report itself
 * valid with a required component empty: the schema attached its issue two
 * levels deep (`["games","games"]`), `errors` only ever read the top level, and
 * no test joined the two halves. These do.
 */
jest.mock("../../../utils/logger", () => ({
  createLogger: () => ({
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  }),
}));

import { renderHook, act, waitFor } from "@testing-library/react";

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { useBundleForm } = require("../useBundleForm");

const components = {
  games: {
    name: "Games",
    min: 2,
    max: 2,
    sort_order: 0,
    options: [
      { id: "game-a", type: "product" as const, quantity: 1 },
      { id: "game-b", type: "product" as const, quantity: 1 },
      { id: "game-c", type: "product" as const, quantity: 1 },
    ],
  },
};

/** Base64 config selecting `count` of the three games. */
function configFor(count: number) {
  const ids = ["game-a", "game-b", "game-c"].slice(0, count);
  const games: Record<string, number> = {};
  ids.forEach((id) => (games[id] = 1));
  return btoa(JSON.stringify({ games }));
}

describe("useBundleForm — validation reaches the caller", () => {
  it("reports an error for an under-filled required component", async () => {
    const { result } = renderHook(() =>
      useBundleForm({ components, defaultConfiguration: configFor(1) })
    );

    await act(async () => {
      // mode: "onChange" validates on write, so touch the component.
      result.current.handleComponentSelection("games", "game-a", 1);
    });

    await waitFor(() => {
      expect(result.current.errors.games).toBe(
        "Please select exactly 2 options for Games"
      );
    });
    expect(result.current.isValid).toBe(false);
  });

  it("clears the error once the component is satisfied", async () => {
    const { result } = renderHook(() =>
      useBundleForm({ components, defaultConfiguration: configFor(1) })
    );

    await act(async () => {
      result.current.handleComponentSelection("games", "game-b", 1);
    });

    await waitFor(() => {
      expect(result.current.errors.games).toBeUndefined();
    });
  });

  it("reports an over-filled component", async () => {
    const { result } = renderHook(() =>
      useBundleForm({ components, defaultConfiguration: configFor(2) })
    );

    await act(async () => {
      result.current.handleComponentSelection("games", "game-c", 1);
    });

    await waitFor(() => {
      expect(result.current.errors.games).toBe(
        "Please remove 1 option from Games (maximum: 2)"
      );
    });
  });

  it("leaves no zero-quantity entry behind when an option is deselected", async () => {
    const { result } = renderHook(() =>
      useBundleForm({ components, defaultConfiguration: configFor(2) })
    );

    await act(async () => {
      result.current.handleComponentSelection("games", "game-a", 0);
    });

    await waitFor(() => {
      expect(result.current.selectedOptions.games).toEqual({ "game-b": 1 });
    });
  });

  it("reports a satisfied configuration as valid without any interaction", async () => {
    // Add-to-cart is gated on this. If a freshly loaded, already-valid bundle
    // read as invalid, the button would be disabled for no reason.
    const { result } = renderHook(() =>
      useBundleForm({ components, defaultConfiguration: configFor(2) })
    );

    await waitFor(() => {
      expect(result.current.isValid).toBe(true);
    });
    expect(result.current.errors).toEqual({});
  });

  it("reports an under-filled configuration as invalid without any interaction", async () => {
    const { result } = renderHook(() =>
      useBundleForm({ components, defaultConfiguration: configFor(1) })
    );

    await waitFor(() => {
      expect(result.current.isValid).toBe(false);
    });
  });
});
