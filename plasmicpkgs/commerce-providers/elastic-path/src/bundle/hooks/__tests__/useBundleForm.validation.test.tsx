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

  it("has a message ready on first render, with no interaction at all", async () => {
    // react-hook-form only fills formState.errors for fields it has seen
    // written, so an invalid configuration that arrived with the page — a shared
    // link, an unsatisfiable catalog default — left the shopper with a disabled
    // button and nothing explaining why. Caught in a browser, not here.
    const { result } = renderHook(() =>
      useBundleForm({ components, defaultConfiguration: configFor(1) })
    );

    await waitFor(() => {
      expect(result.current.errors.games).toBe(
        "Please select exactly 2 options for Games"
      );
    });
    expect(result.current.isValid).toBe(false);
  });

  it("reports a message for every component that needs one", async () => {
    // Both need two and the auto-select can only pick one, so both are short.
    // A min-1 component would have been satisfied by the auto-select and is not
    // a test of anything.
    const twoShort = {
      games: components.games,
      extras: {
        name: "Extras",
        min: 2,
        max: 2,
        sort_order: 1,
        options: [
          { id: "x", type: "product" as const, quantity: 1 },
          { id: "y", type: "product" as const, quantity: 1 },
        ],
      },
    };

    const { result } = renderHook(() =>
      useBundleForm({ components: twoShort })
    );

    await waitFor(() => {
      expect(Object.keys(result.current.errors).sort()).toEqual([
        "extras",
        "games",
      ]);
    });
    expect(result.current.errors.extras).toBe(
      "Please select exactly 2 options for Extras"
    );
  });

  it("switching a variation leaves one child, not both", async () => {
    // useVariationSelection clears the old child and sets the new one with two
    // synchronous calls. Rebuilding the map from the render-time `watch()`
    // snapshot made the second call overwrite the first with stale data, so both
    // children survived and EP rejected the add with "too many selections" —
    // the very failure the branch set out to remove.
    const twoPicks = {
      games: {
        name: "Games",
        min: 1,
        max: 2,
        sort_order: 0,
        options: [{ id: "parent", type: "product" as const, quantity: 1 }],
      },
    };

    const { result } = renderHook(() =>
      useBundleForm({
        components: twoPicks,
        defaultConfiguration: btoa(JSON.stringify({ games: { "parent:A": 1 } })),
      })
    );

    await act(async () => {
      // Exactly what useVariationSelection does, in one tick.
      result.current.handleComponentSelection("games", "parent", 0, "A");
      result.current.handleComponentSelection("games", "parent", 1, "B");
    });

    await waitFor(() => {
      expect(result.current.selectedOptions.games).toEqual({ "parent:B": 1 });
    });
  });

  it("replaces the variant even when nobody clears the old one", async () => {
    // EPBundleVariationPicker never passes selectedVariationId, so
    // useVariationSelection's clear branch does not fire and the set call
    // arrives alone. One option resolves to one variant, so the write itself
    // has to supersede the option's other variants and its bare parent.
    const gift = {
      gift: {
        name: "Gift",
        min: 0,
        max: 3,
        sort_order: 0,
        options: [{ id: "parent", type: "product" as const, quantity: 1 }],
      },
    };

    const { result } = renderHook(() =>
      useBundleForm({
        components: gift,
        defaultConfiguration: btoa(
          JSON.stringify({ gift: { parent: 1, "parent:A": 1 } })
        ),
      })
    );

    await act(async () => {
      result.current.handleComponentSelection("gift", "parent", 1, "B");
    });

    await waitFor(() => {
      expect(result.current.selectedOptions.gift).toEqual({ "parent:B": 1 });
    });
  });

  it("does not re-add the bare parent after a variant is chosen", async () => {
    // Selecting a variation also toggles the option checkbox, which writes the
    // bare parent with no variationId. Whichever write lands last, the option
    // must not count twice — the component read "2 of 0-3" for one gift.
    const gift = {
      gift: {
        name: "Gift",
        min: 0,
        max: 3,
        sort_order: 0,
        options: [{ id: "parent", type: "product" as const, quantity: 1 }],
      },
    };

    const { result } = renderHook(() =>
      useBundleForm({
        components: gift,
        defaultConfiguration: btoa(JSON.stringify({ gift: { "parent:A": 1 } })),
      })
    );

    await act(async () => {
      result.current.handleComponentSelection("gift", "parent", 1);
    });

    await waitFor(() => {
      expect(result.current.selectedOptions.gift).toEqual({ "parent:A": 1 });
    });
  });

  it("keeps a different option's selection when a variant is chosen", async () => {
    const gift = {
      gift: {
        name: "Gift",
        min: 0,
        max: 3,
        sort_order: 0,
        options: [
          { id: "parent", type: "product" as const, quantity: 1 },
          { id: "other", type: "product" as const, quantity: 1 },
        ],
      },
    };

    const { result } = renderHook(() =>
      useBundleForm({
        components: gift,
        defaultConfiguration: btoa(
          JSON.stringify({ gift: { other: 1, "parent:A": 1 } })
        ),
      })
    );

    await act(async () => {
      result.current.handleComponentSelection("gift", "parent", 1, "B");
    });

    await waitFor(() => {
      expect(result.current.selectedOptions.gift).toEqual({
        other: 1,
        "parent:B": 1,
      });
    });
  });
});
