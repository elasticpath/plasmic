/**
 * @jest-environment jsdom
 *
 * Shared assertions for the EP catalog-search headless styling contract.
 *
 * The contract:
 *   1. The Plasmic-supplied `className` is forwarded to the documented leaf
 *      element (the visible interactive element the component represents).
 *   2. No element in the rendered tree has inline `style` properties for
 *      appearance (border, radius, padding, font, color, background).
 *   3. The editor render and the runtime render produce the same DOM tree
 *      shape given equivalent context. (Optional per-component; some
 *      components have runtime branches that only render with non-empty
 *      hooks.)
 *
 * Layout properties that Plasmic strips from code-component classNames
 * (display, grid-*, flex-*, gap, width, height, align-*, position) are
 * permitted as inline styles on a per-component basis via the allow-list.
 */

import { render } from "@testing-library/react";
import React from "react";

const APPEARANCE_PROPERTIES = [
  "border",
  "borderTop",
  "borderRight",
  "borderBottom",
  "borderLeft",
  "borderColor",
  "borderTopColor",
  "borderRightColor",
  "borderBottomColor",
  "borderLeftColor",
  "borderStyle",
  "borderWidth",
  "borderRadius",
  "borderTopLeftRadius",
  "borderTopRightRadius",
  "borderBottomLeftRadius",
  "borderBottomRightRadius",
  "color",
  "backgroundColor",
  "background",
  "fontFamily",
  "fontSize",
  "fontWeight",
  "fontStyle",
  "lineHeight",
  "letterSpacing",
  "textTransform",
  "textDecoration",
  "boxShadow",
] as const;

interface ContractAssertion {
  componentName: string;
  /** querySelector that locates the leaf element which should receive className */
  leafSelector: string;
  /**
   * Render a JSX tree containing the component, optionally accepting a
   * className override.
   */
  renderInEditor: (extraProps: { className?: string }) => React.ReactElement;
  /**
   * Render the same JSX with the editor context turned off. Some components
   * cannot be rendered at runtime in jsdom without setup work; in that case
   * pass `null` and the editor==runtime check is skipped.
   */
  renderAtRuntime?: (extraProps: { className?: string }) => React.ReactElement;
  /**
   * Per-component allow-list of element selectors that may legitimately set
   * an inline appearance property (e.g. an `<img>` whose `src` is dynamic).
   * Empty by default — the contract default is "no inline appearance styles
   * anywhere in the tree".
   */
  inlineAppearanceAllowList?: Array<{
    selector: string;
    properties: string[];
    reason: string;
  }>;
  /**
   * Set up `usePlasmicCanvasContext` to return a truthy value (editor mode).
   * Pass-through to whatever mock the test file uses.
   */
  setEditorMode: (inEditor: boolean) => void;
}

export function describeHeadlessStylingContract(opts: ContractAssertion): void {
  const {
    componentName,
    leafSelector,
    renderInEditor,
    renderAtRuntime,
    inlineAppearanceAllowList = [],
    setEditorMode,
  } = opts;

  describe(`${componentName} — headless styling contract`, () => {
    afterEach(() => {
      setEditorMode(false);
    });

    it("forwards className to the documented leaf element (editor render)", () => {
      setEditorMode(true);
      const { container } = render(
        renderInEditor({ className: "ep-test-class" })
      );
      const leaf = container.querySelector(leafSelector);
      expect(leaf).not.toBeNull();
      expect(leaf!.className).toContain("ep-test-class");
    });

    if (renderAtRuntime) {
      it("forwards className to the documented leaf element (runtime render)", () => {
        setEditorMode(false);
        const { container } = render(
          renderAtRuntime({ className: "ep-test-class" })
        );
        const leaf = container.querySelector(leafSelector);
        expect(leaf).not.toBeNull();
        expect(leaf!.className).toContain("ep-test-class");
      });
    }

    it("applies no inline appearance styles in editor render", () => {
      setEditorMode(true);
      const { container } = render(renderInEditor({}));
      assertNoInlineAppearance(container, inlineAppearanceAllowList);
    });

    if (renderAtRuntime) {
      it("applies no inline appearance styles in runtime render", () => {
        setEditorMode(false);
        const { container } = render(renderAtRuntime({}));
        assertNoInlineAppearance(container, inlineAppearanceAllowList);
      });

      it("renders structurally equivalent leaf element in editor and runtime", () => {
        setEditorMode(true);
        const editorRender = render(renderInEditor({}));
        const editorLeaf = editorRender.container.querySelector(leafSelector);
        expect(editorLeaf).not.toBeNull();
        const editorTag = editorLeaf!.tagName.toLowerCase();
        editorRender.unmount();

        setEditorMode(false);
        const runtimeRender = render(renderAtRuntime({}));
        const runtimeLeaf = runtimeRender.container.querySelector(leafSelector);
        expect(runtimeLeaf).not.toBeNull();
        expect(runtimeLeaf!.tagName.toLowerCase()).toBe(editorTag);
        runtimeRender.unmount();
      });
    }
  });
}

function assertNoInlineAppearance(
  container: HTMLElement,
  allowList: Array<{ selector: string; properties: string[]; reason: string }>
): void {
  const elements = container.querySelectorAll<HTMLElement>("*");
  const violations: Array<{ tag: string; prop: string; value: string }> = [];

  elements.forEach((el) => {
    APPEARANCE_PROPERTIES.forEach((prop) => {
      const value = el.style.getPropertyValue(camelToKebab(prop));
      if (!value) return;

      const allowed = allowList.some(
        (entry) =>
          el.matches(entry.selector) && entry.properties.includes(prop)
      );
      if (allowed) return;

      const dataAttrs = Array.from(el.attributes)
        .filter((a) => a.name.startsWith("data-ep-"))
        .map((a) => a.name)
        .join(",");
      violations.push({
        tag: `<${el.tagName.toLowerCase()}${dataAttrs ? ` ${dataAttrs}` : ""}>`,
        prop,
        value,
      });
    });
  });

  if (violations.length > 0) {
    const lines = violations.map(
      (v) => `  ${v.tag} sets inline ${v.prop}: ${v.value}`
    );
    throw new Error(
      `Inline appearance styles found:\n${lines.join("\n")}\n` +
        `These violate the headless styling contract. Move structural CSS to ` +
        `headless-styling.ts (with :where() so designers can override), or ` +
        `delete entirely if it was just visual polish.`
    );
  }
}

function camelToKebab(str: string): string {
  return str.replace(/([A-Z])/g, "-$1").toLowerCase();
}
