/**
 * @jest-environment jsdom
 *
 * Component-level tests for the EPSearchAutocomplete compound — the
 * provider plus the three bridge components (Input, Panel, List).
 *
 * The deep-module logic (autocomplete-core lifecycle, predictions source,
 * debounced refine) lives in `useEPAutocompleteState` and `predictionsSource`
 * and has its own dedicated tests. The tests here exercise the React-shaped
 * surface: the headless styling contract, default-slot shapes, parent-
 * component enforcement, mocked-state editor branch, and how the four
 * components compose to deliver designer-visible behaviours (selection
 * triggers refine, panel hides when closed, etc.).
 */

import React from "react";

/* ---------- mock variables (declared before jest.mock) ---------- */
const mockUsePlasmicCanvasContext = jest.fn();
const mockUsePlasmicCanvasComponentInfo = jest.fn().mockReturnValue({
  isSelected: false,
});
const mockRepeatedElement = jest.fn(
  (_idx: number, children: React.ReactNode) => children
);

const mockUseSearchBox = jest.fn().mockReturnValue({
  query: "",
  refine: jest.fn(),
  clear: jest.fn(),
});

const mockUseCommerce = jest.fn();

interface FakeState {
  query: string;
  isOpen: boolean;
  activeItemId: number | null;
  collections: Array<{ source: { sourceId: string }; items: Array<any> }>;
  status: string;
}

const fakeAutocompleteInstances: any[] = [];

const mockCreateAutocomplete = jest.fn((config: any) => {
  const state: FakeState = {
    query: "",
    isOpen: false,
    activeItemId: null,
    collections: [],
    status: "idle",
  };

  let onStateChangeCalls = 0;
  const notify = () => {
    onStateChangeCalls += 1;
    if (config.onStateChange) {
      config.onStateChange({ state, prevState: state });
    }
  };

  let sourcesConfig: any[] = config.getSources
    ? config.getSources({ query: "", state }) ?? []
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

  const noop = () => undefined;
  const instance: any = {
    state,
    setQuery,
    setIsOpen,
    setActiveItemId,
    getInputProps: () => ({
      value: state.query,
      onChange: (event: any) => setQuery(event.currentTarget.value),
      onKeyDown: noop,
      onFocus: noop,
      onBlur: noop,
    }),
    getPanelProps: (props?: any) => ({
      ...(props ?? {}),
      "data-ep-autocomplete-test": "panel",
    }),
    getListProps: () => ({ role: "listbox" }),
    getItemProps: ({ item, source }: any) => ({
      role: "option",
      "aria-selected": "false",
      onClick: () => {
        const src = sourcesConfig.find(
          (s) => s.sourceId === source.sourceId
        );
        src?.onSelect?.({ item, source: { sourceId: source.sourceId }, setQuery, setIsOpen, state });
      },
    }),
    getRootProps: () => ({}),
    getEnvironmentProps: () => ({}),
    __triggerInput: async (value: string) => {
      setQuery(value);
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    },
    __triggerSelect: (sourceId: string, itemIndex: number) => {
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
    __sourcesConfig: () => sourcesConfig,
    __onStateChangeCalls: () => onStateChangeCalls,
  };

  fakeAutocompleteInstances.push(instance);
  return instance;
});

/* ---------- jest.mock calls ---------- */
jest.mock("@plasmicapp/host", () => ({
  DataProvider: ({
    children,
    name,
    data,
  }: {
    children: React.ReactNode;
    name: string;
    data: any;
  }) => (
    <div
      data-testid={`data-provider-${name}`}
      data-provider-data={JSON.stringify(data, (_k, v) =>
        typeof v === "function" ? "[fn]" : v
      )}
    >
      {children}
    </div>
  ),
  useSelector: jest.fn(),
  usePlasmicCanvasContext: () => mockUsePlasmicCanvasContext(),
  usePlasmicCanvasComponentInfo: (...args: any[]) =>
    mockUsePlasmicCanvasComponentInfo(...args),
  repeatedElement: (...args: any[]) => mockRepeatedElement(...args),
}));

jest.mock("@plasmicapp/host/registerComponent", () => ({
  __esModule: true,
  default: jest.fn(),
}));

jest.mock("../../elastic-path", () => ({
  useCommerce: (...a: unknown[]) => mockUseCommerce(...a),
}));

jest.mock("react-instantsearch", () => ({
  useSearchBox: (...a: unknown[]) => mockUseSearchBox(...a),
}));

jest.mock(
  "@algolia/autocomplete-core",
  () => ({
    __esModule: true,
    createAutocomplete: (...args: any[]) => mockCreateAutocomplete(...args),
  }),
  { virtual: true }
);

jest.mock("../../utils/getEPClient", () => ({
  getEPClient: jest.fn().mockReturnValue({ baseUrl: "https://test.example" }),
}));

const mockPostMultiSearch = jest.fn().mockResolvedValue({
  data: { results: [{ hits: [] }] },
});
jest.mock("@epcc-sdk/sdks-shopper", () => ({
  __esModule: true,
  postMultiSearch: (...a: any[]) => mockPostMultiSearch(...a),
}));

/* ---------- code under test ---------- */
import { render, act, fireEvent } from "@testing-library/react";
import { describeHeadlessStylingContract } from "./headless-styling-contract";

const {
  EPSearchAutocomplete,
  epSearchAutocompleteMeta,
  registerEPSearchAutocomplete,
} = require("../EPSearchAutocomplete") as typeof import("../EPSearchAutocomplete");

const {
  EPSearchAutocompleteInput,
  epSearchAutocompleteInputMeta,
  registerEPSearchAutocompleteInput,
} = require("../EPSearchAutocompleteInput") as typeof import("../EPSearchAutocompleteInput");

const {
  EPSearchAutocompletePanel,
  epSearchAutocompletePanelMeta,
  registerEPSearchAutocompletePanel,
} = require("../EPSearchAutocompletePanel") as typeof import("../EPSearchAutocompletePanel");

const {
  EPSearchAutocompleteList,
  epSearchAutocompleteListMeta,
  registerEPSearchAutocompleteList,
} = require("../EPSearchAutocompleteList") as typeof import("../EPSearchAutocompleteList");

const {
  MOCK_AUTOCOMPLETE_DATA,
} = require("../design-time-data") as typeof import("../design-time-data");

function setEditorMode(inEditor: boolean) {
  if (inEditor) {
    mockUsePlasmicCanvasContext.mockReturnValue({});
  } else {
    mockUsePlasmicCanvasContext.mockReturnValue(null);
  }
}

function setIsSelected(isSelected: boolean) {
  mockUsePlasmicCanvasComponentInfo.mockReturnValue({ isSelected });
}

beforeEach(() => {
  jest.clearAllMocks();
  // mockClear leaves mockResolvedValueOnce queues intact across tests; reset
  // the postMultiSearch mock to flush anything left over.
  mockPostMultiSearch.mockReset();
  mockPostMultiSearch.mockResolvedValue({
    data: { results: [{ hits: [] }] },
  });
  fakeAutocompleteInstances.length = 0;
  mockUsePlasmicCanvasContext.mockReturnValue(null);
  mockUsePlasmicCanvasComponentInfo.mockReturnValue({ isSelected: false });
  mockUseSearchBox.mockReturnValue({
    query: "",
    refine: jest.fn(),
    clear: jest.fn(),
  });
  mockUseCommerce.mockReturnValue({
    providerRef: { current: { client: {}, locale: "en-US" } },
  });
});

/* ================================================================
 * EPSearchAutocomplete provider — meta + editor mock branch
 * ================================================================ */
describe("EPSearchAutocomplete provider", () => {
  it("meta enforces parentComponentName and exposes ref-actions", () => {
    expect(epSearchAutocompleteMeta.name).toBe(
      "plasmic-commerce-ep-search-autocomplete"
    );
    expect(epSearchAutocompleteMeta.parentComponentName).toBe(
      "plasmic-commerce-ep-catalog-search-provider"
    );
    expect(epSearchAutocompleteMeta.providesData).toBe(true);
    expect(epSearchAutocompleteMeta.refActions!.setQuery).toBeDefined();
    expect(epSearchAutocompleteMeta.refActions!.focus).toBeDefined();
    expect(epSearchAutocompleteMeta.refActions!.clear).toBeDefined();
  });

  it("publishes mock autocompleteData via DataProvider in editor", () => {
    setEditorMode(true);

    const { container } = render(
      <EPSearchAutocomplete>
        <div data-testid="user-content">child</div>
      </EPSearchAutocomplete>
    );

    const provider = container.querySelector(
      '[data-testid="data-provider-autocompleteData"]'
    );
    expect(provider).not.toBeNull();
    const data = JSON.parse(
      provider!.getAttribute("data-provider-data") || "{}"
    );
    expect(data.isOpen).toBe(MOCK_AUTOCOMPLETE_DATA.isOpen);
    expect(data.query).toBe(MOCK_AUTOCOMPLETE_DATA.query);
    expect(data.collections[0].sourceId).toBe("predictions");
  });

  it("renders children and the data-ep-autocomplete-root wrapper", () => {
    setEditorMode(true);

    const { container, getByTestId } = render(
      <EPSearchAutocomplete>
        <div data-testid="user-content">child</div>
      </EPSearchAutocomplete>
    );

    expect(container.querySelector("[data-ep-autocomplete-root]")).not.toBeNull();
    expect(getByTestId("user-content")).not.toBeNull();
  });

  it("at runtime, drives createAutocomplete via useEPAutocompleteState", () => {
    setEditorMode(false);

    render(
      <EPSearchAutocomplete>
        <div>child</div>
      </EPSearchAutocomplete>
    );

    expect(mockCreateAutocomplete).toHaveBeenCalledTimes(1);
  });

  it("at runtime, publishes autocompleteData with collections from the hook", async () => {
    setEditorMode(false);
    mockPostMultiSearch.mockResolvedValueOnce({
      data: { results: [{ hits: [{ q: "leather bag" }] }] },
    });

    const { container } = render(
      <EPSearchAutocomplete>
        <div>child</div>
      </EPSearchAutocomplete>
    );

    await act(async () => {
      await fakeAutocompleteInstances[0].__triggerInput("leat");
    });

    const provider = container.querySelector(
      '[data-testid="data-provider-autocompleteData"]'
    );
    const data = JSON.parse(
      provider!.getAttribute("data-provider-data") || "{}"
    );
    expect(data.query).toBe("leat");
    expect(data.isOpen).toBe(true);
    expect(data.collections[0].items[0].q).toBe("leather bag");
  });
});

/* ================================================================
 * Headless styling contracts
 * ================================================================ */
describeHeadlessStylingContract({
  componentName: "EPSearchAutocomplete",
  leafSelector: "[data-ep-autocomplete-root]",
  setEditorMode,
  renderInEditor: ({ className }) => (
    <EPSearchAutocomplete className={className}>
      <div>child</div>
    </EPSearchAutocomplete>
  ),
  renderAtRuntime: ({ className }) => (
    <EPSearchAutocomplete className={className}>
      <div>child</div>
    </EPSearchAutocomplete>
  ),
});

/* ================================================================
 * EPSearchAutocompleteInput — meta + Pattern C cloneElement
 * ================================================================ */
describe("EPSearchAutocompleteInput", () => {
  it("meta enforces parentComponentName", () => {
    expect(epSearchAutocompleteInputMeta.parentComponentName).toBe(
      "plasmic-commerce-ep-search-autocomplete"
    );
  });

  it("renders the slot's input and forwards getInputProps via cloneElement at runtime", () => {
    setEditorMode(false);

    const { container } = render(
      <EPSearchAutocomplete>
        <EPSearchAutocompleteInput>
          <input type="search" data-testid="user-input" />
        </EPSearchAutocompleteInput>
      </EPSearchAutocomplete>
    );

    const input = container.querySelector(
      '[data-testid="user-input"]'
    ) as HTMLInputElement;
    expect(input).not.toBeNull();
    expect(input.value).toBe("");
  });

  it("typing in the slot input drives autocomplete-core's setQuery (and the DataProvider state)", async () => {
    setEditorMode(false);
    mockPostMultiSearch.mockResolvedValueOnce({
      data: { results: [{ hits: [{ q: "boots" }] }] },
    });

    const { container } = render(
      <EPSearchAutocomplete>
        <EPSearchAutocompleteInput>
          <input type="search" data-testid="user-input" />
        </EPSearchAutocompleteInput>
      </EPSearchAutocomplete>
    );

    const input = container.querySelector(
      '[data-testid="user-input"]'
    ) as HTMLInputElement;

    await act(async () => {
      fireEvent.change(input, { target: { value: "boot" } });
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(fakeAutocompleteInstances[0].state.query).toBe("boot");
  });

  it("injects the default placeholder when the prop is undefined (existing instances)", () => {
    setEditorMode(false);

    const { container } = render(
      <EPSearchAutocomplete>
        <EPSearchAutocompleteInput>
          <input type="search" data-testid="user-input" />
        </EPSearchAutocompleteInput>
      </EPSearchAutocomplete>
    );

    const input = container.querySelector(
      '[data-testid="user-input"]'
    ) as HTMLInputElement;
    expect(input.getAttribute("placeholder")).toBe("Search products...");
  });

  it("injects the placeholder prop onto the slot input", () => {
    setEditorMode(false);

    const { container } = render(
      <EPSearchAutocomplete>
        <EPSearchAutocompleteInput placeholder="Find boots…">
          <input type="search" data-testid="user-input" />
        </EPSearchAutocompleteInput>
      </EPSearchAutocomplete>
    );

    const input = container.querySelector(
      '[data-testid="user-input"]'
    ) as HTMLInputElement;
    expect(input.getAttribute("placeholder")).toBe("Find boots…");
  });

  it("placeholder prop overrides any placeholder set on the slot child", () => {
    setEditorMode(false);

    const { container } = render(
      <EPSearchAutocomplete>
        <EPSearchAutocompleteInput placeholder="From component">
          <input
            type="search"
            placeholder="From slot"
            data-testid="user-input"
          />
        </EPSearchAutocompleteInput>
      </EPSearchAutocomplete>
    );

    const input = container.querySelector(
      '[data-testid="user-input"]'
    ) as HTMLInputElement;
    expect(input.getAttribute("placeholder")).toBe("From component");
  });

  it("preserves the slot's own placeholder when the prop is empty", () => {
    setEditorMode(false);

    const { container } = render(
      <EPSearchAutocomplete>
        <EPSearchAutocompleteInput placeholder="">
          <input
            type="search"
            placeholder="From slot"
            data-testid="user-input"
          />
        </EPSearchAutocompleteInput>
      </EPSearchAutocomplete>
    );

    const input = container.querySelector(
      '[data-testid="user-input"]'
    ) as HTMLInputElement;
    expect(input.getAttribute("placeholder")).toBe("From slot");
  });

  it("meta declares a default placeholder so freshly-dropped components show one", () => {
    const placeholderProp = (epSearchAutocompleteInputMeta.props as any)
      .placeholder;
    expect(placeholderProp.type).toBe("string");
    expect(placeholderProp.defaultValue).toBe("Search products...");
  });
});

describeHeadlessStylingContract({
  componentName: "EPSearchAutocompleteInput",
  leafSelector: "input",
  setEditorMode,
  renderInEditor: ({ className }) => (
    <EPSearchAutocomplete>
      <EPSearchAutocompleteInput className={className}>
        <input type="search" />
      </EPSearchAutocompleteInput>
    </EPSearchAutocomplete>
  ),
  renderAtRuntime: ({ className }) => (
    <EPSearchAutocomplete>
      <EPSearchAutocompleteInput className={className}>
        <input type="search" />
      </EPSearchAutocompleteInput>
    </EPSearchAutocomplete>
  ),
});

/* ================================================================
 * EPSearchAutocompletePanel — visibility gated by state.isOpen
 * ================================================================ */
describe("EPSearchAutocompletePanel", () => {
  it("meta enforces parentComponentName", () => {
    expect(epSearchAutocompletePanelMeta.parentComponentName).toBe(
      "plasmic-commerce-ep-search-autocomplete"
    );
  });

  it("renders the panel only when state.isOpen is true at runtime", async () => {
    setEditorMode(false);

    const { container } = render(
      <EPSearchAutocomplete>
        <EPSearchAutocompletePanel>
          <div data-testid="panel-content">panel</div>
        </EPSearchAutocompletePanel>
      </EPSearchAutocomplete>
    );

    // Initially closed (empty query).
    expect(
      container.querySelector('[data-testid="panel-content"]')
    ).toBeNull();

    // Type a query to open the panel.
    mockPostMultiSearch.mockResolvedValueOnce({
      data: { results: [{ hits: [{ q: "shoes" }] }] },
    });
    await act(async () => {
      await fakeAutocompleteInstances[0].__triggerInput("sho");
    });

    expect(
      container.querySelector('[data-testid="panel-content"]')
    ).not.toBeNull();
    expect(
      container.querySelector("[data-ep-autocomplete-panel]")
    ).not.toBeNull();
  });

  it("renders the mobile close button with data-ep-autocomplete-close at runtime when open", async () => {
    setEditorMode(false);
    mockPostMultiSearch.mockResolvedValueOnce({
      data: { results: [{ hits: [{ q: "x" }] }] },
    });

    const { container } = render(
      <EPSearchAutocomplete>
        <EPSearchAutocompletePanel>
          <div>panel</div>
        </EPSearchAutocompletePanel>
      </EPSearchAutocomplete>
    );

    await act(async () => {
      await fakeAutocompleteInstances[0].__triggerInput("x");
    });

    const closeButton = container.querySelector(
      "[data-ep-autocomplete-close]"
    );
    expect(closeButton).not.toBeNull();
    expect(closeButton!.tagName.toLowerCase()).toBe("button");
  });

  it("editor mode hides the panel when not selected and not pinned open", () => {
    setEditorMode(true);
    setIsSelected(false);

    const { container } = render(
      <EPSearchAutocomplete>
        <EPSearchAutocompletePanel>
          <div data-testid="panel-content">panel</div>
        </EPSearchAutocompletePanel>
      </EPSearchAutocomplete>
    );

    expect(
      container.querySelector('[data-testid="panel-content"]')
    ).toBeNull();
    expect(
      container.querySelector("[data-ep-autocomplete-panel]")
    ).toBeNull();
  });

  it("editor mode renders the panel when the component is selected in Studio", () => {
    setEditorMode(true);
    setIsSelected(true);

    const { container } = render(
      <EPSearchAutocomplete>
        <EPSearchAutocompletePanel>
          <div data-testid="panel-content">panel</div>
        </EPSearchAutocompletePanel>
      </EPSearchAutocomplete>
    );

    expect(
      container.querySelector('[data-testid="panel-content"]')
    ).not.toBeNull();
  });

  it("editor mode renders the panel when `open` override is true", () => {
    setEditorMode(true);
    setIsSelected(false);

    const { container } = render(
      <EPSearchAutocomplete>
        <EPSearchAutocompletePanel open>
          <div data-testid="panel-content">panel</div>
        </EPSearchAutocompletePanel>
      </EPSearchAutocomplete>
    );

    expect(
      container.querySelector('[data-testid="panel-content"]')
    ).not.toBeNull();
  });

  it("calls plasmicNotifyAutoOpenedContent when the panel auto-opens via selection", () => {
    setEditorMode(true);
    setIsSelected(true);
    const notify = jest.fn();

    render(
      <EPSearchAutocomplete>
        <EPSearchAutocompletePanel
          plasmicNotifyAutoOpenedContent={notify}
        >
          <div>panel</div>
        </EPSearchAutocompletePanel>
      </EPSearchAutocomplete>
    );

    expect(notify).toHaveBeenCalled();
  });

  it("forwards __plasmic_selection_prop__ to usePlasmicCanvasComponentInfo", () => {
    setEditorMode(true);
    setIsSelected(true);
    const selectionProp = { isSelected: true };

    render(
      <EPSearchAutocomplete>
        <EPSearchAutocompletePanel
          __plasmic_selection_prop__={selectionProp}
        >
          <div>panel</div>
        </EPSearchAutocompletePanel>
      </EPSearchAutocomplete>
    );

    expect(mockUsePlasmicCanvasComponentInfo).toHaveBeenCalledWith({
      __plasmic_selection_prop__: selectionProp,
    });
  });
});

describeHeadlessStylingContract({
  componentName: "EPSearchAutocompletePanel",
  leafSelector: "[data-ep-autocomplete-panel]",
  setEditorMode,
  renderInEditor: ({ className }) => (
    // The panel only renders in canvas when selected or pinned open. The
    // contract test cares about className forwarding, not visibility logic
    // — `open` pins it visible regardless of selection state.
    <EPSearchAutocomplete>
      <EPSearchAutocompletePanel className={className} open>
        <div>panel</div>
      </EPSearchAutocompletePanel>
    </EPSearchAutocomplete>
  ),
});

/* ================================================================
 * EPSearchAutocompleteList — repeater + selection refine
 * ================================================================ */
describe("EPSearchAutocompleteList", () => {
  it("meta enforces parentComponentName", () => {
    expect(epSearchAutocompleteListMeta.parentComponentName).toBe(
      "plasmic-commerce-ep-search-autocomplete"
    );
  });

  it("renders one <li> per item in the configured source at runtime", async () => {
    setEditorMode(false);
    mockPostMultiSearch.mockResolvedValueOnce({
      data: {
        results: [
          {
            hits: [
              { q: "leather bag" },
              { q: "leather wallet" },
              { q: "leather shoes" },
            ],
          },
        ],
      },
    });

    const { container } = render(
      <EPSearchAutocomplete>
        <EPSearchAutocompleteList>
          <div data-testid="row">row</div>
        </EPSearchAutocompleteList>
      </EPSearchAutocomplete>
    );

    await act(async () => {
      await fakeAutocompleteInstances[0].__triggerInput("leat");
    });

    const items = container.querySelectorAll('[role="option"]');
    expect(items).toHaveLength(3);
  });

  it("publishes per-iteration currentSuggestion via DataProvider at runtime", async () => {
    setEditorMode(false);
    mockPostMultiSearch.mockResolvedValueOnce({
      data: {
        results: [{ hits: [{ q: "leather bag" }] }],
      },
    });

    const { container } = render(
      <EPSearchAutocomplete>
        <EPSearchAutocompleteList>
          <span data-testid="row">row</span>
        </EPSearchAutocompleteList>
      </EPSearchAutocomplete>
    );

    await act(async () => {
      await fakeAutocompleteInstances[0].__triggerInput("leat");
    });

    const suggestionProvider = container.querySelector(
      '[data-testid="data-provider-currentSuggestion"]'
    );
    expect(suggestionProvider).not.toBeNull();
    const data = JSON.parse(
      suggestionProvider!.getAttribute("data-provider-data") || "{}"
    );
    expect(data.item.q).toBe("leather bag");
    expect(typeof data.isHighlighted).toBe("boolean");
    expect(data.source).toBe("predictions");
  });

  it("renders mock items in editor mode", () => {
    setEditorMode(true);

    const { container } = render(
      <EPSearchAutocomplete>
        <EPSearchAutocompleteList>
          <span>row</span>
        </EPSearchAutocompleteList>
      </EPSearchAutocomplete>
    );

    const items = container.querySelectorAll('[role="option"]');
    expect(items.length).toBe(MOCK_AUTOCOMPLETE_DATA.collections[0].items.length);
  });
});

describeHeadlessStylingContract({
  componentName: "EPSearchAutocompleteList",
  leafSelector: "[data-ep-autocomplete-list]",
  setEditorMode,
  renderInEditor: ({ className }) => (
    <EPSearchAutocomplete>
      <EPSearchAutocompleteList className={className}>
        <span>row</span>
      </EPSearchAutocompleteList>
    </EPSearchAutocomplete>
  ),
});

/* ================================================================
 * Registerable smoke tests
 * ================================================================ */
describe("autocomplete component registrations", () => {
  it("each register* function calls registerComponent", () => {
    const registerComponent = require("@plasmicapp/host/registerComponent")
      .default as jest.Mock;
    registerComponent.mockClear();

    registerEPSearchAutocomplete();
    registerEPSearchAutocompleteInput();
    registerEPSearchAutocompletePanel();
    registerEPSearchAutocompleteList();

    expect(registerComponent).toHaveBeenCalledTimes(4);
  });
});
