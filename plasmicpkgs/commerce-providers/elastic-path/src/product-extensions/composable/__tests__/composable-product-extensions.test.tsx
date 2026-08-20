/**
 * @jest-environment jsdom
 *
 * Tests for the composable product-extensions components. These rely on
 * @plasmicapp/host for DataProvider/useSelector data flow and
 * usePlasmicCanvasContext for design-time detection — all mocked here.
 *
 * esbuild's jest transform hoists `import` to top-of-file `require()` BEFORE
 * jest.mock() runs, so every code-under-test module is loaded via explicit
 * `require()` (after the mocks take effect), matching the bundle test setup.
 */

// --- Mocks (hoisted by Jest before anything else) ---

jest.mock("@plasmicapp/host", () => {
  const React = require("react");
  return {
    DataProvider: ({ children, name, data }: any) =>
      React.createElement(
        "div",
        {
          "data-provider": name,
          "data-provider-value": JSON.stringify(data),
        },
        children,
      ),
    useSelector: jest.fn(),
    usePlasmicCanvasContext: jest.fn().mockReturnValue(null),
    repeatedElement: jest.fn((_i: number, children: any) => children),
  };
});

jest.mock("@plasmicapp/host/registerComponent", () => ({
  __esModule: true,
  default: jest.fn(),
}));

// --- Imports (not mocked — safe for esbuild to hoist) ---
import React from "react";
import { render, screen } from "@testing-library/react";

// --- Load mocked host functions via require (after jest.mock) ---
const {
  useSelector: mockUseSelector,
  usePlasmicCanvasContext: mockUsePlasmicCanvasContext,
} = require("@plasmicapp/host");

// --- Load components-under-test via require (after jest.mock) ---
const {
  EPProductExtensionsProvider,
} = require("../EPProductExtensionsProvider");
const {
  EPProductExtensionTemplateList,
} = require("../EPProductExtensionTemplateList");
const {
  EPProductExtensionTemplateField,
} = require("../EPProductExtensionTemplateField");
const {
  EPProductExtensionFieldList,
} = require("../EPProductExtensionFieldList");
const { EPProductExtensionField } = require("../EPProductExtensionField");
const { MOCK_EXTENSION_TEMPLATES } = require("../../../utils/extensions-mock");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function setupSelector(selectorData: Record<string, any>) {
  (mockUseSelector as jest.Mock).mockImplementation(
    (key: string) => selectorData[key],
  );
}

function setEditorMode(inEditor: boolean) {
  (mockUsePlasmicCanvasContext as jest.Mock).mockReturnValue(
    inEditor ? {} : null,
  );
}

/** A live product whose attributes carry one extension template. */
function productWithExtensions() {
  return {
    id: "p1",
    attributes: {
      extensions: {
        "products(example-template-2)": { name: "my name" },
      },
    },
  };
}

/** A live product with no extensions (variation parent / bundle case). */
function productWithoutExtensions() {
  return {
    id: "p2",
    attributes: { extensions: null },
  };
}

const SAMPLE_TEMPLATE = {
  slug: "products(example-template-2)",
  label: "Example Template 2",
  fieldCount: 1,
  fields: [
    {
      key: "name",
      label: "Name",
      value: "my name",
      type: "string",
      displayValue: "my name",
    },
  ],
};

const SAMPLE_FIELD = SAMPLE_TEMPLATE.fields[0];

beforeEach(() => {
  jest.clearAllMocks();
  setEditorMode(false);
});

// ===========================================================================
// EPProductExtensionsProvider
// ===========================================================================

describe("EPProductExtensionsProvider", () => {
  it("renders children when the product has extensions", () => {
    setupSelector({ currentProduct: productWithExtensions() });
    render(
      <EPProductExtensionsProvider>
        <span>child content</span>
      </EPProductExtensionsProvider>,
    );
    expect(screen.getByText("child content")).toBeTruthy();
  });

  it("publishes extensionsData via DataProvider", () => {
    setupSelector({ currentProduct: productWithExtensions() });
    const { container } = render(
      <EPProductExtensionsProvider>
        <span>x</span>
      </EPProductExtensionsProvider>,
    );
    const provider = container.querySelector(
      '[data-provider="extensionsData"]',
    );
    expect(provider).toBeTruthy();
    expect(
      JSON.parse(provider!.getAttribute("data-provider-value")!),
    ).toEqual({ templateCount: 1, isEmpty: false });
  });

  it("self-gates (renders nothing) when extensions are null at runtime", () => {
    setupSelector({ currentProduct: productWithoutExtensions() });
    const { container } = render(
      <EPProductExtensionsProvider>
        <span>should not show</span>
      </EPProductExtensionsProvider>,
    );
    expect(container.textContent).toBe("");
    expect(screen.queryByText("should not show")).toBeNull();
  });

  it("renders notExtensionsContent when provided and empty", () => {
    setupSelector({ currentProduct: productWithoutExtensions() });
    render(
      <EPProductExtensionsProvider
        notExtensionsContent={<span>no details</span>}
      >
        <span>hidden</span>
      </EPProductExtensionsProvider>,
    );
    expect(screen.getByText("no details")).toBeTruthy();
    expect(screen.queryByText("hidden")).toBeNull();
  });

  it("falls back to mock data in the editor when no live product is bound", () => {
    setEditorMode(true);
    setupSelector({ currentProduct: undefined });
    const { container } = render(
      <EPProductExtensionsProvider>
        <span>child</span>
      </EPProductExtensionsProvider>,
    );
    const provider = container.querySelector(
      '[data-provider="extensionsData"]',
    );
    expect(
      JSON.parse(provider!.getAttribute("data-provider-value")!).templateCount,
    ).toBe(MOCK_EXTENSION_TEMPLATES.length);
  });

  it("previewState=empty forces the self-gated branch even in the editor", () => {
    setEditorMode(true);
    setupSelector({ currentProduct: productWithExtensions() });
    const { container } = render(
      <EPProductExtensionsProvider previewState="empty">
        <span>hidden</span>
      </EPProductExtensionsProvider>,
    );
    expect(screen.queryByText("hidden")).toBeNull();
    expect(container.textContent).toBe("");
  });
});

// ===========================================================================
// EPProductExtensionTemplateList
// ===========================================================================

describe("EPProductExtensionTemplateList", () => {
  it("self-gates when there are no templates and not in editor", () => {
    setupSelector({});
    const { container } = render(
      <EPProductExtensionTemplateList>
        <span>row</span>
      </EPProductExtensionTemplateList>,
    );
    // No provider context + not editor => nothing rendered.
    expect(container.textContent).toBe("");
  });

  it("uses mock templates in the editor with no provider context", () => {
    setEditorMode(true);
    setupSelector({});
    const { container } = render(
      <EPProductExtensionTemplateList>
        <span>row</span>
      </EPProductExtensionTemplateList>,
    );
    const providers = container.querySelectorAll(
      '[data-provider="currentExtensionTemplate"]',
    );
    expect(providers.length).toBe(MOCK_EXTENSION_TEMPLATES.length);
  });
});

// ===========================================================================
// EPProductExtensionTemplateField
// ===========================================================================

describe("EPProductExtensionTemplateField", () => {
  it("renders the humanized label", () => {
    setupSelector({ currentExtensionTemplate: SAMPLE_TEMPLATE });
    render(<EPProductExtensionTemplateField field="label" />);
    expect(screen.getByText("Example Template 2")).toBeTruthy();
  });

  it("renders the raw slug", () => {
    setupSelector({ currentExtensionTemplate: SAMPLE_TEMPLATE });
    render(<EPProductExtensionTemplateField field="slug" />);
    expect(
      screen.getByText("products(example-template-2)"),
    ).toBeTruthy();
  });

  it("renders the field count", () => {
    setupSelector({ currentExtensionTemplate: SAMPLE_TEMPLATE });
    render(<EPProductExtensionTemplateField field="fieldCount" />);
    expect(screen.getByText("1")).toBeTruthy();
  });

  it("renders nothing when there is no template and not in editor", () => {
    setupSelector({});
    const { container } = render(
      <EPProductExtensionTemplateField field="label" />,
    );
    expect(container.textContent).toBe("");
  });
});

// ===========================================================================
// EPProductExtensionFieldList
// ===========================================================================

describe("EPProductExtensionFieldList", () => {
  it("provides currentExtensionField per field in the template", () => {
    setupSelector({ currentExtensionTemplate: SAMPLE_TEMPLATE });
    const { container } = render(
      <EPProductExtensionFieldList>
        <span>field row</span>
      </EPProductExtensionFieldList>,
    );
    const providers = container.querySelectorAll(
      '[data-provider="currentExtensionField"]',
    );
    expect(providers.length).toBe(1);
    expect(
      JSON.parse(providers[0].getAttribute("data-provider-value")!),
    ).toMatchObject({ key: "name", displayValue: "my name" });
  });

  it("renders nothing when the template has no fields", () => {
    setupSelector({
      currentExtensionTemplate: { ...SAMPLE_TEMPLATE, fields: [] },
    });
    const { container } = render(
      <EPProductExtensionFieldList>
        <span>row</span>
      </EPProductExtensionFieldList>,
    );
    expect(container.textContent).toBe("");
  });
});

// ===========================================================================
// EPProductExtensionField
// ===========================================================================

describe("EPProductExtensionField", () => {
  it.each([
    ["label", "Name"],
    ["displayValue", "my name"],
    ["value", "my name"],
    ["key", "name"],
    ["type", "string"],
  ])("renders the %s field", (field, expected) => {
    setupSelector({ currentExtensionField: SAMPLE_FIELD });
    render(<EPProductExtensionField field={field as any} />);
    expect(screen.getByText(expected)).toBeTruthy();
  });

  it("stringifies a non-primitive raw value", () => {
    setupSelector({
      currentExtensionField: {
        key: "spec",
        label: "Spec",
        value: { cpu: "x" },
        type: "object",
        displayValue: "Cpu: x",
      },
    });
    render(<EPProductExtensionField field="value" />);
    expect(screen.getByText('{"cpu":"x"}')).toBeTruthy();
  });

  it("renders nothing when there is no field and not in editor", () => {
    setupSelector({});
    const { container } = render(
      <EPProductExtensionField field="displayValue" />,
    );
    expect(container.textContent).toBe("");
  });
});
