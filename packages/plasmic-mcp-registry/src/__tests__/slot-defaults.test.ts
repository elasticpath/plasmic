import { describe, it, expect } from "vitest";
import { serializeComponentMeta } from "../serialize";

/**
 * These tests enforce the invariant that slot-typed props keep their
 * `defaultValue` PlasmicElement JSON tree intact after serialization.
 *
 * Studio's `addNewRegisteredComponents` (wab/shared/code-components/
 * code-components.ts) consumes this field via `elementSchemaToTpl` to
 * populate default slot contents on first drop of a code component. If
 * the MCP's registry transport silently drops slot defaults, dev-host
 * ingestion would succeed but drop the defaults users carefully authored
 * in their `registerComponent(...)` meta — a silent data-loss footgun.
 */
describe("serializeComponentMeta — slot defaults survive JSON transport", () => {
  it("preserves a single PlasmicElement text default on a slot prop", () => {
    const meta = {
      name: "WithTextSlot",
      props: {
        children: {
          type: "slot",
          defaultValue: { type: "text", value: "Hello world" },
        },
      },
    };

    const result = serializeComponentMeta(meta);
    const props = result.props as Record<string, Record<string, unknown>>;
    expect(props.children.type).toBe("slot");
    expect(props.children.defaultValue).toEqual({
      type: "text",
      value: "Hello world",
    });
  });

  it("leaves slot props with no defaultValue unchanged (no injected null)", () => {
    // Studio's ingestion distinguishes "no default" (undefined) from "explicit
    // null default". The serializer must not inject a synthetic defaultValue
    // for slot props that didn't have one.
    const meta = {
      name: "NoSlotDefault",
      props: {
        header: { type: "slot" },
      },
    };

    const result = serializeComponentMeta(meta);
    const props = result.props as Record<string, Record<string, unknown>>;
    expect(props.header.type).toBe("slot");
    expect(props.header).not.toHaveProperty("defaultValue");
  });

  it("preserves an array-of-PlasmicElement default (common slot pattern)", () => {
    // Exact shape used by EPProductProvider and most EP components — an array
    // of element schemas as the children slot default.
    const meta = {
      name: "WithArraySlot",
      props: {
        children: {
          type: "slot",
          defaultValue: [
            { type: "text", value: "Drop product UI here." },
          ],
        },
      },
    };

    const result = serializeComponentMeta(meta);
    const props = result.props as Record<string, Record<string, unknown>>;
    expect(props.children.defaultValue).toEqual([
      { type: "text", value: "Drop product UI here." },
    ]);
  });
});
