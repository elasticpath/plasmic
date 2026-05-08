/**
 * @jest-environment jsdom
 *
 * Tests for the deep-module hook that owns the autocomplete-core lifecycle.
 *
 * The hook is the single point of integration between
 * `@algolia/autocomplete-core` and the EP catalog-search query state. The
 * four React components consume the hook output and never touch
 * `createAutocomplete` directly — that boundary is what we test here.
 *
 * `@algolia/autocomplete-core` is mocked: a small fake replicates the
 * state-machine contract (createAutocomplete returns prop-getters,
 * `setQuery`/`setIsOpen` mutate state, every mutation calls onStateChange).
 * `react-instantsearch` is mocked the same way the existing component
 * tests mock it.
 */

import React from "react";
import { render, act } from "@testing-library/react";

/* ---------- mock variables ---------- */
const mockUseSearchBox = jest.fn();

interface FakeState {
  query: string;
  isOpen: boolean;
  activeItemId: number | null;
  collections: Array<{ source: { sourceId: string }; items: Array<any> }>;
  status: string;
}

interface FakeAutocompleteInstance {
  state: FakeState;
  setIsOpen: (value: boolean) => void;
  setQuery: (value: string) => void;
  setActiveItemId: (value: number | null) => void;
  getInputProps: (props?: any) => any;
  getPanelProps: (props?: any) => any;
  getListProps: (props?: any) => any;
  getItemProps: (props: any) => any;
  getRootProps: (props?: any) => any;
  getEnvironmentProps: (props?: any) => any;
  // test-only helpers
  __triggerInput: (value: string) => Promise<void>;
  __triggerSubmit: () => void;
  __triggerSelect: (sourceId: string, itemIndex: number) => void;
  __sourcesConfig: Array<{ sourceId: string; getItems: any; onSelect?: any }>;
  __onStateChangeCalls: number;
}

const fakeInstances: FakeAutocompleteInstance[] = [];

const mockCreateAutocomplete = jest.fn((config: any) => {
  const state: FakeState = {
    query: "",
    isOpen: false,
    activeItemId: null,
    collections: [],
    status: "idle",
  };

  // eslint-disable-next-line @typescript-eslint/no-empty-function
  const noop = () => {};

  let onStateChangeCalls = 0;

  const notify = () => {
    onStateChangeCalls += 1;
    if (config.onStateChange) {
      config.onStateChange({ state, prevState: state });
    }
  };

  // Sources are populated synchronously from config.getSources() so the
  // hook's first render leaves sourcesConfig observable without an await.
  // Real autocomplete-core only calls getSources lazily on setQuery — but
  // the fake materialises them eagerly because tests rely on them.
  let sourcesConfig: any[] = config.getSources
    ? config.getSources({ query: "", state, setQuery, setIsOpen }) ?? []
    : [];

  const refreshSources = async (query: string) => {
    if (query.length === 0) {
      state.collections = [];
      state.isOpen = false;
      notify();
      return;
    }
    const items = await Promise.all(
      sourcesConfig.map(async (src) => ({
        source: { sourceId: src.sourceId },
        items: await src.getItems({ query }),
      }))
    );
    state.collections = items;
    state.isOpen = items.some((c) => c.items.length > 0);
    notify();
  };

  function setQuery(value: string) {
    state.query = value;
    notify();
    void refreshSources(value);
  }
  function setIsOpen(value: boolean) {
    state.isOpen = value;
    notify();
  }
  function setActiveItemId(value: number | null) {
    state.activeItemId = value;
    notify();
  }

  const instance: FakeAutocompleteInstance = {
    state,
    setQuery,
    setIsOpen,
    setActiveItemId,
    getInputProps: () => ({
      value: state.query,
      onChange: (event: { currentTarget: { value: string } }) =>
        setQuery(event.currentTarget.value),
      onKeyDown: noop,
      onFocus: noop,
      onBlur: noop,
    }),
    getPanelProps: (props?: any) => ({ ...(props ?? {}) }),
    getListProps: (props?: any) => ({ ...(props ?? {}), role: "listbox" }),
    getItemProps: ({ item, source }: any) => ({
      role: "option",
      "aria-selected": "false",
      onClick: () => {
        const src = sourcesConfig.find(
          (s) => s.sourceId === source.sourceId
        );
        if (src?.onSelect) {
          src.onSelect({ item, source, setQuery, setIsOpen, state });
        }
      },
      "data-item-id": item?.q,
    }),
    getRootProps: (props?: any) => ({ ...(props ?? {}) }),
    getEnvironmentProps: (props?: any) => ({ ...(props ?? {}) }),
    __sourcesConfig: sourcesConfig,
    get __onStateChangeCalls() {
      return onStateChangeCalls;
    },
    async __triggerInput(value: string) {
      // Simulate `getInputProps().onChange` to exercise the integration.
      setQuery(value);
      // Wait for refreshSources to settle.
      await Promise.resolve();
      await Promise.resolve();
    },
    __triggerSubmit() {
      // Submit without an active item — the hook's submit handler should
      // refine with current state.query.
      // The real autocomplete-core surfaces this via onSubmit on
      // getFormProps — we expose a hook-level handler to keep the test
      // isolated from the prop-getter wiring detail.
    },
    __triggerSelect(sourceId: string, itemIndex: number) {
      const collection = state.collections.find(
        (c) => c.source.sourceId === sourceId
      );
      const item = collection?.items[itemIndex];
      const src = sourcesConfig.find((s) => s.sourceId === sourceId);
      if (item && src?.onSelect) {
        src.onSelect({
          item,
          source: { sourceId },
          setQuery,
          setIsOpen,
          state,
        });
      }
    },
  };

  // Patch sources back so the fake reflects the actual config after
  // the async getSources() resolves.
  Object.defineProperty(instance, "__sourcesConfig", {
    get: () => sourcesConfig,
  });

  fakeInstances.push(instance);
  return instance;
});

jest.mock(
  "@algolia/autocomplete-core",
  () => ({
    __esModule: true,
    createAutocomplete: (...args: any[]) => mockCreateAutocomplete(...args),
  }),
  { virtual: true }
);

jest.mock("react-instantsearch", () => ({
  useSearchBox: (...a: unknown[]) => mockUseSearchBox(...a),
}));

/* ---------- code under test ---------- */
import {
  useEPAutocompleteState,
  UseEPAutocompleteStateConfig,
} from "../useEPAutocompleteState";

/* ---------- harness ---------- */
type CapturedHookOutput = ReturnType<typeof useEPAutocompleteState>;

function HookHarness({
  config,
  capture,
}: {
  config: UseEPAutocompleteStateConfig;
  capture: (output: CapturedHookOutput) => void;
}) {
  const output = useEPAutocompleteState(config);
  capture(output);
  return null;
}

function makePostMultiSearch(items: Array<{ q: string }>) {
  return jest.fn().mockResolvedValue({ results: [{ hits: items }] });
}

beforeEach(() => {
  jest.clearAllMocks();
  fakeInstances.length = 0;
  mockUseSearchBox.mockReturnValue({
    query: "",
    refine: jest.fn(),
    clear: jest.fn(),
  });
});

describe("useEPAutocompleteState", () => {
  it("initialises createAutocomplete with the predictions source and exposes prop-getters", () => {
    const postMultiSearch = makePostMultiSearch([{ q: "leather bag" }]);
    let captured: CapturedHookOutput | null = null;

    render(
      <HookHarness
        config={{
          predictionsField: "q",
          debounceMs: 300,
          enableRecentSearches: false,
          postMultiSearch,
        }}
        capture={(o) => {
          captured = o;
        }}
      />
    );

    expect(mockCreateAutocomplete).toHaveBeenCalledTimes(1);
    expect(captured).not.toBeNull();
    expect(typeof captured!.getInputProps).toBe("function");
    expect(typeof captured!.getPanelProps).toBe("function");
    expect(typeof captured!.getListProps).toBe("function");
    expect(typeof captured!.getItemProps).toBe("function");
    expect(typeof captured!.setQuery).toBe("function");
    expect(typeof captured!.clear).toBe("function");
  });

  it("with enableRecentSearches=false, registers exactly the predictions source", () => {
    const postMultiSearch = makePostMultiSearch([]);
    let captured: CapturedHookOutput | null = null;

    render(
      <HookHarness
        config={{
          predictionsField: "q",
          debounceMs: 300,
          enableRecentSearches: false,
          postMultiSearch,
        }}
        capture={(o) => {
          captured = o;
        }}
      />
    );

    const instance = fakeInstances[0];
    expect(instance.__sourcesConfig).toHaveLength(1);
    expect(instance.__sourcesConfig[0].sourceId).toBe("predictions");
  });

  it("publishes collections for the predictions source after typing", async () => {
    const postMultiSearch = makePostMultiSearch([
      { q: "leather bag" },
      { q: "leather wallet" },
    ]);
    const captures: CapturedHookOutput[] = [];

    render(
      <HookHarness
        config={{
          predictionsField: "q",
          debounceMs: 300,
          enableRecentSearches: false,
          postMultiSearch,
        }}
        capture={(o) => captures.push(o)}
      />
    );

    await act(async () => {
      await fakeInstances[0].__triggerInput("leat");
    });

    const last = captures[captures.length - 1];
    expect(last.collections).toHaveLength(1);
    expect(last.collections[0].sourceId).toBe("predictions");
    expect(last.collections[0].items).toHaveLength(2);
    expect(last.collections[0].items[0].q).toBe("leather bag");
  });

  it("debounces useSearchBox().refine — many keystrokes produce one call with the latest value", async () => {
    jest.useFakeTimers();
    const refine = jest.fn();
    mockUseSearchBox.mockReturnValue({ query: "", refine, clear: jest.fn() });

    const postMultiSearch = makePostMultiSearch([]);
    render(
      <HookHarness
        config={{
          predictionsField: "q",
          debounceMs: 250,
          enableRecentSearches: false,
          postMultiSearch,
        }}
        capture={() => {}}
      />
    );

    await act(async () => {
      await fakeInstances[0].__triggerInput("l");
      await fakeInstances[0].__triggerInput("le");
      await fakeInstances[0].__triggerInput("lea");
    });

    expect(refine).not.toHaveBeenCalled();

    act(() => {
      jest.advanceTimersByTime(250);
    });

    expect(refine).toHaveBeenCalledTimes(1);
    expect(refine).toHaveBeenCalledWith("lea");

    jest.useRealTimers();
  });

  it("selection invokes refine immediately with item[predictionsField] and closes the panel", async () => {
    const refine = jest.fn();
    mockUseSearchBox.mockReturnValue({ query: "", refine, clear: jest.fn() });
    const postMultiSearch = makePostMultiSearch([
      { q: "leather bag" },
      { q: "leather wallet" },
    ]);

    render(
      <HookHarness
        config={{
          predictionsField: "q",
          debounceMs: 300,
          enableRecentSearches: false,
          postMultiSearch,
        }}
        capture={() => {}}
      />
    );

    await act(async () => {
      await fakeInstances[0].__triggerInput("leat");
    });

    refine.mockClear();
    act(() => {
      fakeInstances[0].__triggerSelect("predictions", 0);
    });

    expect(refine).toHaveBeenCalledTimes(1);
    expect(refine).toHaveBeenCalledWith("leather bag");
    expect(fakeInstances[0].state.isOpen).toBe(false);
  });

  it("submit() — refines with the current input value and closes the panel", async () => {
    const refine = jest.fn();
    mockUseSearchBox.mockReturnValue({ query: "", refine, clear: jest.fn() });
    const postMultiSearch = makePostMultiSearch([{ q: "leather" }]);

    let captured: CapturedHookOutput | null = null;
    render(
      <HookHarness
        config={{
          predictionsField: "q",
          debounceMs: 300,
          enableRecentSearches: false,
          postMultiSearch,
        }}
        capture={(o) => {
          captured = o;
        }}
      />
    );

    await act(async () => {
      await fakeInstances[0].__triggerInput("leat");
    });

    refine.mockClear();
    act(() => {
      captured!.submit();
    });

    expect(refine).toHaveBeenCalledTimes(1);
    expect(refine).toHaveBeenCalledWith("leat");
    expect(fakeInstances[0].state.isOpen).toBe(false);
  });

  it("initial input value mirrors useSearchBox().query", async () => {
    mockUseSearchBox.mockReturnValue({
      query: "boots",
      refine: jest.fn(),
      clear: jest.fn(),
    });
    const postMultiSearch = makePostMultiSearch([{ q: "boots" }]);

    await act(async () => {
      render(
        <HookHarness
          config={{
            predictionsField: "q",
            debounceMs: 300,
            enableRecentSearches: false,
            postMultiSearch,
          }}
          capture={() => {}}
        />
      );
      // Flush the deferred setQuery effect and the async source refresh.
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    // The hook should call setQuery("boots") on the autocomplete-core
    // instance, so the state reflects the existing refinement.
    expect(fakeInstances[0].state.query).toBe("boots");
  });

  it("clear() — empties query, closes panel, and clears the underlying useSearchBox", async () => {
    const refine = jest.fn();
    const clearRefine = jest.fn();
    mockUseSearchBox.mockReturnValue({
      query: "leat",
      refine,
      clear: clearRefine,
    });
    const postMultiSearch = makePostMultiSearch([{ q: "leather" }]);

    let captured: CapturedHookOutput | null = null;
    await act(async () => {
      render(
        <HookHarness
          config={{
            predictionsField: "q",
            debounceMs: 300,
            enableRecentSearches: false,
            postMultiSearch,
          }}
          capture={(o) => {
            captured = o;
          }}
        />
      );
      // Flush the deferred initial-mirror effect + async source refresh.
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    act(() => {
      captured!.clear();
    });

    expect(fakeInstances[0].state.query).toBe("");
    expect(fakeInstances[0].state.isOpen).toBe(false);
    expect(clearRefine).toHaveBeenCalledTimes(1);
  });

  it("setQuery() — drives autocomplete-core's setQuery (parity with the input onChange path)", async () => {
    const postMultiSearch = makePostMultiSearch([{ q: "leather" }]);

    let captured: CapturedHookOutput | null = null;
    render(
      <HookHarness
        config={{
          predictionsField: "q",
          debounceMs: 300,
          enableRecentSearches: false,
          postMultiSearch,
        }}
        capture={(o) => {
          captured = o;
        }}
      />
    );

    await act(async () => {
      captured!.setQuery("hat");
      // settle async getItems
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(fakeInstances[0].state.query).toBe("hat");
  });

  it("unmount cancels the pending debounce and never calls refine", async () => {
    jest.useFakeTimers();
    const refine = jest.fn();
    mockUseSearchBox.mockReturnValue({ query: "", refine, clear: jest.fn() });
    const postMultiSearch = makePostMultiSearch([]);

    const { unmount } = render(
      <HookHarness
        config={{
          predictionsField: "q",
          debounceMs: 250,
          enableRecentSearches: false,
          postMultiSearch,
        }}
        capture={() => {}}
      />
    );

    await act(async () => {
      await fakeInstances[0].__triggerInput("lea");
    });

    unmount();
    act(() => {
      jest.advanceTimersByTime(500);
    });

    expect(refine).not.toHaveBeenCalled();
    jest.useRealTimers();
  });
});
