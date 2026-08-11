/**
 * Collects warnings surfaced by Studio's `syncCodeComponents` during a
 * dev-host ingestion pass and translates them into a JSON-response-shaped
 * `IngestionResult`. Fatal errors (e.g. `DuplicateCodeComponentError`,
 * `CodeComponentRegistrationTypeError`) come from the `Result` returned by
 * `syncCodeComponents` itself — this callback surface only handles the
 * non-fatal, "tell the user what happened but keep going" cases that
 * Studio's UI would pop as antd notifications.

 */

import { ok } from "neverthrow";

export interface IngestionWarning {
  code: string;
  componentName?: string;
  message: string;
}

export interface IngestionResult {
  addedComponents: string[];
  removedComponents: string[];
  warnings: IngestionWarning[];
}

export function createIngestionCallbacks(): {
  callbacks: Record<string, any>;
  getResult: () => IngestionResult;
} {
  const result: IngestionResult = {
    addedComponents: [],
    removedComponents: [],
    warnings: [],
  };

  const push = (warning: IngestionWarning) => {
    result.warnings.push(warning);
  };

  const callbacks = {
    onReset: () => {
      result.warnings.length = 0;
      result.addedComponents.length = 0;
      result.removedComponents.length = 0;
    },

    onMissingCodeComponents: async (
      _ctx: unknown,
      missingComponents: Array<{ name: string }>,
      missingContexts: Array<{ name: string }>
    ) => {
      for (const c of missingComponents) {
        push({
          code: "missing-component",
          componentName: c.name,
          message: `Code component "${c.name}" is referenced by the project but no longer registered on the dev host.`,
        });
      }
      for (const c of missingContexts) {
        push({
          code: "missing-context",
          componentName: c.name,
          message: `Context "${c.name}" is referenced by the project but no longer registered on the dev host.`,
        });
      }
      return ok(undefined);
    },

    onInvalidReactVersion: async (
      _ctx: unknown,
      pkgInfo: { name: string; minimumReactVersion?: string }
    ) => {
      push({
        code: "invalid-react-version",
        componentName: pkgInfo.name,
        message: `Package "${pkgInfo.name}" requires React >= ${pkgInfo.minimumReactVersion ?? "unknown"}.`,
      });
      return ok(undefined);
    },

    onInvalidComponentImportNames: (componentNames: string[]) => {
      for (const name of componentNames) {
        push({
          code: "invalid-import-name",
          componentName: name,
          message: `Component "${name}" has an invalid importName (e.g. whitespace).`,
        });
      }
    },

    onStaleProps: async () => false, // don't force-update props; Studio defaults to user-driven choice

    onNewDefaultComponents: (message: string) => {
      push({ code: "new-default-component", message });
    },

    onSchemaToTplWarnings: (warnings: Array<{ message: string; description?: string }>) => {
      for (const w of warnings) {
        push({
          code: "schema-to-tpl",
          message: w.message + (w.description ? ` (${w.description})` : ""),
        });
      }
    },

    onSchemaToTplError: (error: Error) => {
      push({ code: "schema-to-tpl-error", message: error.message });
    },

    onElementStyleWarnings: (warnings: Array<{ message: string; description?: string }>) => {
      for (const w of warnings) {
        push({
          code: "element-style",
          message: w.message + (w.description ? ` (${w.description})` : ""),
        });
      }
    },

    onInvalidJsonForDefaultValue: (message: string) => {
      push({ code: "invalid-json-default", message });
    },
  };

  return {
    callbacks,
    getResult: () => result,
  };
}
