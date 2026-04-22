/**
 * Tests for the ingestion callback surface.
 *
 * Studio's `syncCodeComponents` orchestrator surfaces sync-time anomalies
 * through a `CodeComponentSyncCallbackFns` interface (code-components.ts:643)
 * designed for a browser UI — it expects callers to pop antd notifications.
 *
 * The MCP needs the same information in a JSON-response shape. These tests
 * lock in the callback → IngestionResult.warnings translation.
 */

import { describe, it, expect } from "vitest";
import { createIngestionCallbacks } from "../ingestion-callbacks";

describe("createIngestionCallbacks", () => {
  it("starts with an empty result", () => {
    const { getResult } = createIngestionCallbacks();
    expect(getResult().warnings).toEqual([]);
  });

  it("records a warning for each missing code component", async () => {
    const { callbacks, getResult } = createIngestionCallbacks();
    await callbacks.onMissingCodeComponents(
      {} as any,
      [{ name: "comp-a" }, { name: "comp-b" }] as any,
      [] as any
    );

    const warnings = getResult().warnings;
    expect(warnings).toHaveLength(2);
    expect(warnings[0]).toMatchObject({ code: "missing-component", componentName: "comp-a" });
    expect(warnings[1]).toMatchObject({ code: "missing-component", componentName: "comp-b" });
  });

  it("records a warning for each missing context", async () => {
    const { callbacks, getResult } = createIngestionCallbacks();
    await callbacks.onMissingCodeComponents(
      {} as any,
      [] as any,
      [{ name: "my-provider" }] as any
    );

    const warnings = getResult().warnings;
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatchObject({ code: "missing-context", componentName: "my-provider" });
  });

  it("records a warning for schema-to-tpl warnings", () => {
    const { callbacks, getResult } = createIngestionCallbacks();
    callbacks.onSchemaToTplWarnings([
      { message: "unknown allowedComponent 'X'", description: "details" },
    ]);

    const warnings = getResult().warnings;
    expect(warnings).toHaveLength(1);
    expect(warnings[0].code).toBe("schema-to-tpl");
    expect(warnings[0].message).toContain("unknown allowedComponent");
  });

  it("records a warning for invalid JSON defaults", () => {
    const { callbacks, getResult } = createIngestionCallbacks();
    callbacks.onInvalidJsonForDefaultValue("default value not valid JSON");

    const warnings = getResult().warnings;
    expect(warnings).toHaveLength(1);
    expect(warnings[0].code).toBe("invalid-json-default");
  });

  it("onInvalidComponentImportNames records one warning per bad name", () => {
    const { callbacks, getResult } = createIngestionCallbacks();
    callbacks.onInvalidComponentImportNames(["BadName With Space", "Another Bad"]);

    const warnings = getResult().warnings;
    expect(warnings).toHaveLength(2);
    expect(warnings.every((w: any) => w.code === "invalid-import-name")).toBe(true);
  });

  it("onReset clears accumulated state so a subsequent sync starts clean", () => {
    const { callbacks, getResult } = createIngestionCallbacks();
    callbacks.onInvalidJsonForDefaultValue("first-run warning");
    expect(getResult().warnings).toHaveLength(1);

    callbacks.onReset?.();
    expect(getResult().warnings).toEqual([]);
    expect(getResult().addedComponents).toEqual([]);
    expect(getResult().removedComponents).toEqual([]);
  });
});
