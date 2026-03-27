/**
 * MCP server setup and tool registration.
 *
 * Uses McpServer from @modelcontextprotocol/sdk with Zod schemas for input
 * validation. All tools are registered before the transport connects.
 *
 * STRAP architecture: 104 actions consolidated into 8 domain tools.
 * Each domain tool uses an `action` discriminator to route to the
 * appropriate handler function.
 *
 * Domains:
 *   - project (8 actions): session lifecycle, persistence, batch, undo
 *   - inspect (11 actions): read-only queries on component trees, visual capture
 *   - component (18 actions): component/page lifecycle, props, states
 *   - node (17 actions): element mutations (structure, style, text, attrs, props, html import)
 *   - variant (12 actions): variant management (component, global, style, screen)
 *   - design (22 actions): site-level design system (tokens, mixins, etc.)
 *   - data (16 actions): data flow (queries, data-tokens, splits, etc.)
 *   - interaction (4 actions): event handlers
 *
 * CRITICAL: Never use console.log() — stdout is the JSON-RPC transport.
 * All logging goes through console.error().
 */

import { randomUUID } from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { PlasmicApiClient } from "./api-client.js";
import { getAuth } from "./auth.js";
import { requireSession, setSession } from "./session.js";
import { loadProject } from "./model-loader.js";
import { listPackages, addPackage, removePackage, upgradePackage, listAvailablePackages, listPackageComponents } from "./package-manager.js";
import { syncFromDevHost, clearRegistryCache, recordVariantMetadataSync } from "./devhost-sync.js";
import {
  readComponentTree,
  readComponentSummary,
  readNodeDetails,
  readSubtree,
  countTreeNodes,
  countTplNodes,
  truncateTreeToCharBudget,
  toConciseFormat,
} from "./tree-reader.js";
import { readTokens, getAllStyleTokens } from "./token-reader.js";
import { resolveNode, requireSingleNode, invalidateNodeCache, clearNodeCache } from "./node-resolver.js";
import { listPatternsMeta } from "./patterns/registry.js";
import { captureScreenshot } from "./headless-canvas.js";
import { applyPattern } from "./patterns/applier.js";
import { initChangeTracker, disposeChangeTracker, getChangeTracker } from "./change-tracker.js";
import {
  updateText,
  updateRichText,
  updateStyles,
  updateAttrs,
  updateProps,
  addChild,
  removeChild,
  moveChild,
  cloneChild,
  listVariants,
  createStyleVariant,
  createVariantGroup,
  renameComponent,
  updatePageMeta,
  deleteComponent,
  getValidStylePropertyNames,
  setVisibility,
  setDataCond,
  setDataRep,
  createToken,
  updateToken,
  removeToken,
  duplicateToken,
  listProps,
  addProp,
  removeProp,
  updateProp,
  listStates,
  addState,
  removeState,
  updateState,
  listInteractions,
  addInteraction,
  updateInteraction,
  removeInteraction,
  listQueries,
  addQuery,
  removeQuery,
  updateQuery,
  listMixins,
  createMixin,
  updateMixin,
  removeMixin,
  applyMixin,
  detachMixin,
  listAnimationSequences,
  createAnimationSequence,
  updateAnimationSequence,
  removeAnimationSequence,
  addNodeAnimation,
  removeNodeAnimation,
  listThemes,
  createTheme,
  updateTheme,
  removeTheme,
  setActiveTheme,
  reorderChildren,
  convertToPage,
  convertToComponent,
  listDataTokens,
  createDataToken,
  updateDataToken,
  removeDataToken,
  listGlobalVariantGroups,
  createGlobalVariantGroup,
  addGlobalVariant,
  removeGlobalVariantGroup,
  renameGlobalVariant,
  createScreenVariant as createScreenVariantAction,
  updateScreenVariant,
  renameVariant as renameVariantAction,
  removeVariant as removeVariantAction,
  getCodeComponentMeta,
  listCustomFunctions,
  listSplits,
  createSplit,
  updateSplit,
  removeSplit,
  listAssets,
  uploadAsset,
  renameAsset,
  removeAsset,
  setImage,
  extractToComponent,
} from "./edit-tools.js";
import { beginBatch, endBatch, isBatchActive, cancelBatch, cancelBatchWithRollback, getAccumulatedChanges } from "./batch-manager.js";
import { registerCall, failCall, isMicroBatchActive, isCallSettled, setCurrentCallId } from "./micro-batch.js";
import { undo as undoOperation, clearUndoStack, getUndoDepth } from "./undo-manager.js";
import { SaveManager } from "./save-manager.js";
import { startLiveSync, stopLiveSync, isLiveSyncActive } from "./live-sync.js";
import { isSocketConnected, getSocketProjectId } from "./socket-client.js";
import { emitEditPresence, clearEditPresence, emitInspectPresence } from "./tool-presence.js";
import { undoChanges } from "@/wab/shared/core/undo-util";
import type { TreeReadOptions } from "./types.js";

// ---------------------------------------------------------------------------
// PlasmicElement schema — strict top level, z.any() for recursive children.
//
// Flat discriminated union so MCP clients emit valid JSON Schema without
// $defs/$ref (which Claude Desktop, Gemini CLI, n8n, etc. drop or reject).
// The description on `children` tells LLMs to use the same shape recursively.
// ---------------------------------------------------------------------------

const plasmicElementChildren = z.any().optional().describe(
  "Nested PlasmicElement(s) — same format as the parent element. " +
  "Single element object or array of elements."
);

const plasmicElementStyles = z.record(z.string()).optional().describe(
  "CSS styles in camelCase, e.g. {fontSize:'16px', color:'#333'}"
);

const plasmicElementAttrs = z.record(z.any()).optional().describe(
  "HTML attributes, e.g. {id:'hero', 'aria-label':'Main section'}"
);

const PlasmicElementSchema = z.union([
  z.string().describe("Plain text string — creates an inline text node"),
  z.object({
    type: z.literal("text"),
    value: z.string().describe("Text content to display"),
    tag: z.string().optional().describe("HTML tag: h1, h2, h3, p, span, div (default: div)"),
    styles: plasmicElementStyles,
    attrs: plasmicElementAttrs,
  }).describe("Text element"),
  z.object({
    type: z.enum(["box", "vbox", "hbox", "page-section"]),
    children: plasmicElementChildren,
    tag: z.string().optional().describe("HTML tag: div, section, nav, header, footer, main, article, aside, ul, ol, li (default: div)"),
    styles: plasmicElementStyles,
    attrs: plasmicElementAttrs,
  }).describe("Container element — vbox for vertical, hbox for horizontal, box for free layout"),
  z.object({
    type: z.literal("img"),
    src: z.string().default("").describe("Image URL (omit to set later via set-image)"),
    styles: plasmicElementStyles,
    attrs: plasmicElementAttrs,
  }).describe("Image element"),
  z.object({
    type: z.literal("button"),
    value: z.string().optional().describe("Button label text"),
    styles: plasmicElementStyles,
    attrs: plasmicElementAttrs,
  }).describe("Button element"),
  z.object({
    type: z.enum(["input", "password", "textarea"]),
    styles: plasmicElementStyles,
    attrs: plasmicElementAttrs,
  }).describe("Form input element"),
  z.object({
    type: z.literal("component"),
    name: z.string().describe("Component name as shown in Studio"),
    props: z.record(z.any()).optional().describe("Component prop values"),
    styles: plasmicElementStyles,
    children: plasmicElementChildren,
  }).describe("Code component or Plasmic component instance"),
  z.object({
    type: z.literal("default-component"),
    kind: z.string().describe("Default component kind"),
    props: z.record(z.any()).optional().describe("Component prop values"),
    styles: plasmicElementStyles,
    children: plasmicElementChildren,
  }).describe("Built-in default component instance"),
]).describe(
  "PlasmicElement — the building block for page/component trees. " +
  "Use type:'text' with value:'...' for text, type:'vbox' for vertical stacks, " +
  "type:'component' with name:'...' for component instances."
);

/**
 * Validate that a required parameter is present for a given action.
 * Throws a descriptive error if the value is undefined or null.
 */
function requireParam<T>(value: T | undefined, paramName: string, actionName: string): T {
  if (value === undefined || value === null) {
    throw new Error(`Missing required parameter '${paramName}' for '${actionName}' action`);
  }
  return value;
}

/**
 * Execute an edit function in dry-run mode: performs the mutation in-memory,
 * captures what changed, then reverts the model to its original state without
 * saving to the server. Uses batch mode to suppress auto-saves.
 *
 * Cannot be used during an active batch session (changes would intermingle).
 */
async function withDryRun<T>(fn: () => Promise<T>): Promise<T> {
  if (isBatchActive()) {
    throw new Error(
      "Cannot use dry-run during an active batch session. End the batch first."
    );
  }

  beginBatch();
  try {
    const result = await fn();

    // Get the accumulated changes so we can undo them
    const changes = getAccumulatedChanges();
    if (changes && changes.changes.length > 0) {
      const tracker = getChangeTracker();
      tracker.withRecording(() => {
        undoChanges(changes.changes);
      });
    }

    cancelBatch();
    return result;
  } catch (err) {
    // Undo any model changes on error too
    const changes = getAccumulatedChanges();
    if (changes && changes.changes.length > 0) {
      try {
        const tracker = getChangeTracker();
        tracker.withRecording(() => {
          undoChanges(changes.changes);
        });
      } catch (undoErr) {
        console.error(
          `[plasmic-mcp] CRITICAL: Dry-run rollback failed. ` +
            `Use refresh-project to reload a clean model. (${undoErr})`
        );
      }
    }
    cancelBatch();
    throw err;
  }
}

/** Extract a human-readable message from an unknown thrown value. */
function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Handle errors from mutation tool handlers. If a batch is active, cancels it
 * and rolls back all accumulated changes so the model stays clean.
 */
function handleMutationError(label: string, err: unknown, callId?: string) {
  let message = `Error ${label}: ${errorMessage(err)}`;
  if (isBatchActive()) {
    cancelBatchWithRollback();
    message += " Batch cancelled and all accumulated changes rolled back.";
  } else if (callId && isMicroBatchActive()) {
    failCall(callId);
    message += " This operation failed. Other parallel operations are unaffected.";
  }
  return {
    content: [{ type: "text" as const, text: message }],
    isError: true,
  };
}

export function createServer(): McpServer {
  const server = new McpServer({
    name: "plasmic",
    version: "0.1.0",
  });

  const auth = getAuth();
  const apiClient = new PlasmicApiClient(auth);

  console.error(`[plasmic-mcp] Authenticated as ${auth.user} against ${auth.host}`);

  // ========================================================================
  // DOMAIN 1: project (8 actions)
  // ========================================================================

  server.registerTool(
    "project",
    {
      description: "Project session lifecycle, persistence, batch operations, undo, and package management.\n" +
        "Actions: set, list, get-meta, save, refresh, begin-batch, end-batch, undo, list-packages, list-available-packages, list-package-components, add-package, remove-package, upgrade-package.\n" +
        "- set: Load a project into memory (required before other tools). Example: {action:\"set\",projectId:\"pId123\"} → {success:true,projectName:\"My App\"}\n" +
        "- list: List all accessible projects. Example: {action:\"list\"} → {projects:[{id:\"pId123\",name:\"My App\"}]}\n" +
        "- get-meta: Get project metadata (name, counts, pages, components). Example: {action:\"get-meta\"} → {name:\"My App\",pageCount:3,componentCount:5}\n" +
        "- save: Force full save to server\n" +
        "- refresh: Reload project from server\n" +
        "- begin-batch: Start accumulating edits. Example: {action:\"begin-batch\"} → {batchId:\"batch-1\"}\n" +
        "- end-batch: Save accumulated edits in one revision. Example: {action:\"end-batch\",batchId:\"batch-1\"} → {success:true,revision:42}\n" +
        "- undo: Revert most recent edit\n" +
        "- list-packages: List installed packages with version info\n" +
        "- list-available-packages: Browse catalog of installable hostless packages\n" +
        "- list-package-components: List components from installed hostless packages\n" +
        "- add-package: Add a hostless package by its source projectId\n" +
        "- remove-package: Remove an installed package by pkgId or name\n" +
        "- upgrade-package: Upgrade one or all packages to latest version",
      inputSchema: {
        action: z.enum(["set", "list", "get-meta", "save", "refresh", "begin-batch", "end-batch", "undo", "list-packages", "list-available-packages", "list-package-components", "add-package", "remove-package", "upgrade-package"]),
        projectId: z.string().optional().describe("The Plasmic project ID (required for 'set' and 'add-package')"),
        batchId: z.string().optional().describe("Optional batch ID for verification (used by 'end-batch')"),
        pkgId: z.string().optional().describe("Package ID for 'remove-package' and 'upgrade-package' (optional for upgrade-all)"),
        packageName: z.string().optional().describe("Package name filter for 'list-package-components'"),
      },
      annotations: { idempotentHint: true },
    },
    async ({ action, projectId, batchId, pkgId, packageName }) => {
      try {
        switch (action) {
          case "set": {
            const pid = requireParam(projectId, "projectId", "project.set");
            // Clean up previous session state before loading new project
            stopLiveSync();
            apiClient.clearSessionState();
            cancelBatch();
            clearUndoStack();
            disposeChangeTracker();
            clearNodeCache();

            const {
              site,
              bundler,
              projectName,
              revisionNum,
              modelVersion,
              hostlessDataVersion,
              hostUrl,
              bundleVersion,
            } = await loadProject(apiClient, pid);

            // Sync code component variants from the dev host (non-fatal)
            const syncResult = await syncFromDevHost(site, hostUrl);

            setSession({
              projectId: pid,
              projectName,
              site,
              bundler,
              revisionNum,
              modelVersion,
              hostlessDataVersion,
              bundleVersion,
              projectUuid: pid,
              hostUrl,
              devHostSynced: syncResult.devHostSynced,
              syncedVariantComponents: syncResult.syncedVariantComponents,
              registryData: syncResult.registryData,
            });

            // Initialize change tracking for incremental saves (M2)
            initChangeTracker(site);

            // Phase 2: Persist variant metadata inside change tracker so it's
            // included in the save delta (codeComponentMeta.variants with cssSelector).
            if (syncResult.registryData) {
              const variantComponents = syncResult.registryData.components.filter(
                (c) => c.variants && Object.keys(c.variants).length > 0
              );
              if (variantComponents.length > 0) {
                const tracker = getChangeTracker();
                const changes = tracker.withRecording(() => {
                  recordVariantMetadataSync(site, variantComponents);
                });
                if (changes.changes.length > 0) {
                  const saveManager = new SaveManager(apiClient);
                  await saveManager.saveChanges(changes);
                  console.error("[plasmic-mcp] Persisted variant metadata to server");
                }
              }
            }

            // Start live sync (non-blocking — continues in HTTP-only mode if socket fails)
            startLiveSync(apiClient, pid).catch((err) => {
              console.error(
                `[plasmic-mcp] LiveSync start failed (non-fatal): ${
                  err instanceof Error ? err.message : String(err)
                }`
              );
            });

            const components = site.components ?? [];
            const pages = components.filter((c: any) => c.pageMeta?.path);

            return {
              content: [
                {
                  type: "text" as const,
                  text: JSON.stringify({
                    projectId: pid,
                    projectName,
                    componentCount: components.length,
                    pageCount: pages.length,
                    hostUrl: hostUrl ?? null,
                    devHostSynced: syncResult.devHostSynced,
                    ...(syncResult.devHostSynced && {
                      syncedVariantComponents: syncResult.syncedVariantComponents,
                      ...(syncResult.registryData && {
                        devHostRegistry: {
                          componentCount: syncResult.registryData.components?.length ?? 0,
                          contextCount: syncResult.registryData.contexts?.length ?? 0,
                          functionCount: syncResult.registryData.functions?.length ?? 0,
                          tokenCount: syncResult.registryData.tokens?.length ?? 0,
                          traitCount: syncResult.registryData.traits?.length ?? 0,
                        },
                      }),
                    }),
                  }),
                },
              ],
            };
          }

          case "list": {
            const response = await apiClient.listProjects();
            const projects = response.projects.map((p) => ({
              id: p.id,
              name: p.name,
            }));
            return {
              content: [
                {
                  type: "text" as const,
                  text: JSON.stringify(projects),
                },
              ],
            };
          }

          case "get-meta": {
            const session = requireSession();
            const site = session.site;
            const components = site.components ?? [];
            const pages = components.filter((c: any) => c.pageMeta?.path);

            const meta: Record<string, unknown> = {
              projectId: session.projectId,
              projectName: session.projectName,
              componentCount: components.length,
              pageCount: pages.length,
              pages: pages.map((c: any) => ({
                uuid: c.uuid,
                name: c.name,
                path: c.pageMeta?.path,
              })),
              components: components
                .filter((c: any) => !c.pageMeta?.path)
                .map((c: any) => ({
                  uuid: c.uuid,
                  name: c.name,
                })),
            };

            if (site.styleTokens?.length > 0) {
              meta.tokenCount = site.styleTokens.length;
            }
            if (site.globalVariantGroups?.length > 0) {
              meta.globalVariantGroupCount = site.globalVariantGroups.length;
            }

            // Live sync status
            meta.liveSync = {
              socketConnected: isSocketConnected(),
              liveSyncActive: isLiveSyncActive(),
            };

            // Enrich with dev host registered contexts when available
            const regContexts = session.registryData?.contexts;
            if (Array.isArray(regContexts) && regContexts.length > 0) {
              meta.devHostContexts = regContexts.map((ctx) => ({
                name: ctx.name,
                ...(ctx.displayName && { displayName: ctx.displayName }),
                ...(ctx.description && { description: ctx.description }),
                ...(ctx.importName && { importName: ctx.importName }),
                ...(ctx.importPath && { importPath: ctx.importPath }),
                ...(ctx.props && Object.keys(ctx.props).length > 0 && { props: ctx.props }),
                ...(ctx.globalActions && Object.keys(ctx.globalActions).length > 0 && { globalActions: ctx.globalActions }),
              }));
            }

            // Enrich with dev host registered traits when available
            const regTraits = session.registryData?.traits;
            if (Array.isArray(regTraits) && regTraits.length > 0) {
              meta.devHostTraits = regTraits.map((t) => ({
                trait: t.trait,
                ...(t.meta && { meta: t.meta }),
              }));
            }

            return {
              content: [
                { type: "text" as const, text: JSON.stringify(meta) },
              ],
            };
          }

          case "save": {
            requireSession();
            const saveManager = new SaveManager(apiClient);
            const save = await saveManager.saveFullBundle();

            return {
              content: [
                {
                  type: "text" as const,
                  text: JSON.stringify(
                    {
                      success: true,
                      revision: save.revisionNum,
                      incremental: save.incremental,
                      message: `Full save completed at revision ${save.revisionNum}`,
                    }
                  ),
                },
              ],
            };
          }

          case "refresh": {
            const session = requireSession();

            // Stop live sync before cleanup
            stopLiveSync();

            // Cancel any active batch (changes are discarded)
            cancelBatch();

            // Dispose current change tracker
            disposeChangeTracker();

            // Clear undo stack (model state is being replaced)
            clearUndoStack();

            // Clear node resolver cache (model is being replaced)
            clearNodeCache();

            const {
              site,
              bundler,
              projectName,
              revisionNum,
              modelVersion,
              hostlessDataVersion,
              hostUrl,
              bundleVersion,
            } = await loadProject(apiClient, session.projectId);

            // Clear registry cache to force fresh fetch on explicit refresh
            clearRegistryCache(hostUrl);

            // Re-sync code component variants from the dev host (non-fatal)
            const syncResult = await syncFromDevHost(site, hostUrl);

            setSession({
              projectId: session.projectId,
              projectName,
              site,
              bundler,
              revisionNum,
              modelVersion,
              hostlessDataVersion,
              bundleVersion,
              projectUuid: session.projectId,
              hostUrl,
              devHostSynced: syncResult.devHostSynced,
              syncedVariantComponents: syncResult.syncedVariantComponents,
              registryData: syncResult.registryData,
            });

            // Re-initialize change tracking
            initChangeTracker(site);

            // Phase 2: Persist variant metadata inside change tracker
            if (syncResult.registryData) {
              const variantComponents = syncResult.registryData.components.filter(
                (c) => c.variants && Object.keys(c.variants).length > 0
              );
              if (variantComponents.length > 0) {
                const tracker = getChangeTracker();
                const changes = tracker.withRecording(() => {
                  recordVariantMetadataSync(site, variantComponents);
                });
                if (changes.changes.length > 0) {
                  const saveManager = new SaveManager(apiClient);
                  await saveManager.saveChanges(changes);
                  console.error("[plasmic-mcp] Persisted variant metadata to server");
                }
              }
            }

            // Restart live sync after reload (non-blocking)
            startLiveSync(apiClient, session.projectId).catch((err) => {
              console.error(
                `[plasmic-mcp] LiveSync restart failed (non-fatal): ${
                  err instanceof Error ? err.message : String(err)
                }`
              );
            });

            const components = site.components ?? [];
            const pages = components.filter((c: any) => c.pageMeta?.path);

            return {
              content: [
                {
                  type: "text" as const,
                  text: JSON.stringify(
                    {
                      success: true,
                      projectName,
                      revisionNum,
                      componentCount: components.length,
                      pageCount: pages.length,
                      message: `Project refreshed at revision ${revisionNum}`,
                      ...(syncResult.devHostSynced && {
                        devHostSynced: true,
                        syncedVariantComponents: syncResult.syncedVariantComponents,
                        ...(syncResult.registryData && {
                          devHostRegistry: {
                            contextCount: syncResult.registryData.contexts?.length ?? 0,
                            functionCount: syncResult.registryData.functions?.length ?? 0,
                            tokenCount: syncResult.registryData.tokens?.length ?? 0,
                            traitCount: syncResult.registryData.traits?.length ?? 0,
                          },
                        }),
                      }),
                    }
                  ),
                },
              ],
            };
          }

          case "begin-batch": {
            requireSession();
            const bId = beginBatch();
            return {
              content: [
                {
                  type: "text" as const,
                  text: JSON.stringify(
                    {
                      success: true,
                      batchId: bId,
                      message:
                        "Batch session started. Edits will accumulate until end-batch is called.",
                    }
                  ),
                },
              ],
            };
          }

          case "end-batch": {
            requireSession();
            const result = await endBatch(apiClient, batchId);
            const batchRevision = result.save?.revisionNum ?? null;
            return {
              content: [
                {
                  type: "text" as const,
                  text: JSON.stringify(
                    {
                      success: true,
                      operationCount: result.operationCount,
                      ...(batchRevision !== null && { revision: batchRevision }),
                      message: batchRevision !== null
                        ? `Batch saved: ${result.operationCount} operations in revision ${batchRevision}`
                        : `Batch completed: ${result.operationCount} operations`,
                    }
                  ),
                },
              ],
            };
          }

          case "undo": {
            requireSession();
            if (isBatchActive()) {
              throw new Error(
                "Cannot undo during a batch session. Call end-batch first, then undo."
              );
            }
            const result = await undoOperation(apiClient);
            const undoRevision = result.save?.revisionNum ?? null;
            return {
              content: [
                {
                  type: "text" as const,
                  text: JSON.stringify(
                    {
                      success: true,
                      undone: result.undone,
                      ...(undoRevision !== null && { revision: undoRevision }),
                      remainingUndos: getUndoDepth(),
                      message: `Undone: ${result.undone}`,
                    }
                  ),
                },
              ],
            };
          }

          case "list-packages": {
            requireSession();
            const packages = await listPackages(apiClient);
            return {
              content: [
                {
                  type: "text" as const,
                  text: JSON.stringify({
                    packages,
                    count: packages.length,
                    message: packages.length === 0
                      ? "No packages installed."
                      : `${packages.length} package(s) installed.`,
                  }),
                },
              ],
            };
          }

          case "list-available-packages": {
            requireSession();
            const packages = await listAvailablePackages(apiClient);
            return {
              content: [
                {
                  type: "text" as const,
                  text: JSON.stringify({
                    packages,
                    count: packages.length,
                    message: packages.length === 0
                      ? "No installable packages found."
                      : `${packages.length} package(s) available. Use project.add-package with a projectId to install.`,
                  }),
                },
              ],
            };
          }

          case "list-package-components": {
            requireSession();
            const components = await listPackageComponents(apiClient, packageName);
            return {
              content: [
                {
                  type: "text" as const,
                  text: JSON.stringify({
                    components,
                    count: components.length,
                    message: components.length === 0
                      ? "No components found from installed packages."
                      : `${components.length} component(s) available from installed packages.`,
                  }),
                },
              ],
            };
          }

          case "add-package": {
            const pid = requireParam(projectId, "projectId", "project.add-package");
            if (isBatchActive()) {
              throw new Error(
                "Package operations cannot be used inside a batch. " +
                  "End the current batch first, then add the package."
              );
            }
            const addPkgResult = await addPackage(apiClient, pid);
            // Package ops are structural (async fetch + sync mutation) so they
            // can't use the synchronous change tracker for incremental saves.
            // Full bundle save persists all model state — mirrors Studio which
            // records the sync mutation separately and lets auto-save handle it.
            const addPkgSave = new SaveManager(apiClient);
            const addPkgRevision = await addPkgSave.saveFullBundle();
            return {
              content: [
                {
                  type: "text" as const,
                  text: JSON.stringify({
                    success: true,
                    ...addPkgResult,
                    revision: addPkgRevision.revisionNum,
                    message: `Added "${addPkgResult.name}" (v${addPkgResult.version}) — ${addPkgResult.componentCount} components now available.`,
                  }),
                },
              ],
            };
          }

          case "remove-package": {
            const pkgIdOrName = requireParam(pkgId ?? projectId, "pkgId", "project.remove-package");
            if (isBatchActive()) {
              throw new Error(
                "Package operations cannot be used inside a batch. " +
                  "End the current batch first, then remove the package."
              );
            }
            const rmPkgResult = await removePackage(apiClient, pkgIdOrName);
            const rmPkgSave = new SaveManager(apiClient);
            const rmPkgRevision = await rmPkgSave.saveFullBundle();
            return {
              content: [
                {
                  type: "text" as const,
                  text: JSON.stringify({
                    success: true,
                    ...rmPkgResult,
                    revision: rmPkgRevision.revisionNum,
                    message: `Removed "${rmPkgResult.name}" (v${rmPkgResult.version}).`,
                  }),
                },
              ],
            };
          }

          case "upgrade-package": {
            if (isBatchActive()) {
              throw new Error(
                "Package operations cannot be used inside a batch. " +
                  "End the current batch first, then upgrade packages."
              );
            }
            const upgResults = await upgradePackage(apiClient, pkgId);
            if (upgResults.length === 0) {
              return {
                content: [
                  {
                    type: "text" as const,
                    text: JSON.stringify({
                      success: true,
                      upgraded: [],
                      message: "All packages are up to date.",
                    }),
                  },
                ],
              };
            }
            const upgPkgSave = new SaveManager(apiClient);
            const upgPkgRevision = await upgPkgSave.saveFullBundle();
            return {
              content: [
                {
                  type: "text" as const,
                  text: JSON.stringify({
                    success: true,
                    upgraded: upgResults,
                    revision: upgPkgRevision.revisionNum,
                    message: `Upgraded ${upgResults.length} package(s): ${upgResults.map((r) => `${r.name} (${r.oldVersion} → ${r.newVersion})`).join(", ")}.`,
                  }),
                },
              ],
            };
          }

          default:
            throw new Error(`Unknown action '${action}' for project tool. Available: set, list, get-meta, save, refresh, begin-batch, end-batch, undo, list-packages, list-available-packages, list-package-components, add-package, remove-package, upgrade-package`);
        }
      } catch (err: unknown) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error in project.${action}: ${errorMessage(err)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  // ========================================================================
  // DOMAIN 2: inspect (8 actions)
  // ========================================================================

  // Helper: build response with both content and structuredContent for inspect actions
  const inspectResult = (data: Record<string, unknown>) => ({
    content: [{ type: "text" as const, text: JSON.stringify(data) }],
    structuredContent: data,
  });

  server.registerTool(
    "inspect",
    {
      description: "Read-only queries on component trees, nodes, style properties, page metadata, and visual capture.\n" +
        "Actions: tree, summary, node, subtree, export, style-properties, preview-url, page-meta, list-design-system, list-patterns, capture-screenshot.\n" +
        "- tree: Full element tree with styles, text, layout. Example: {action:\"tree\",componentUuid:\"abc\"} → {type:\"tag\",tag:\"div\",layoutType:\"vbox\",layoutHint:\"flex-col\",children:[...]}\n" +
        "- summary: Compact outline (type, tag, name, uuid, childCount). Example: {action:\"summary\",componentUuid:\"abc\"} → {name:\"Hero\",tree:{type:\"tag\",tag:\"div\",childCount:3}}\n" +
        "- node: Full details for a single node. Example: {action:\"node\",componentUuid:\"abc\",nodeRef:\"heading\"} → {type:\"tag\",tag:\"h1\",styles:{fontSize:\"32px\"},text:\"Hello\"}\n" +
        "- subtree: Tree from a specific node downward. Example: {action:\"subtree\",componentUuid:\"abc\",nodeRef:\"card-container\"} → {type:\"tag\",tag:\"div\",children:[...]}\n" +
        "- export: Write full tree to temp file. Example: {action:\"export\",componentUuid:\"abc\"} → {filePath:\"/tmp/tree-abc.json\"}\n" +
        "- style-properties: List valid CSS property names. Example: {action:\"style-properties\",filter:\"flex\"} → [\"flex\",\"flexDirection\",\"flexGrow\",...]\n" +
        "- preview-url: Get preview and studio URLs. Example: {action:\"preview-url\",componentUuid:\"abc\"} → {previewUrl:\"https://...\",studioUrl:\"https://...\"}\n" +
        "- page-meta: Read page SEO metadata. Example: {action:\"page-meta\",componentUuid:\"abc\"} → {title:\"Home\",path:\"/\",description:\"...\"}\n" +
        "- list-design-system: Consolidated summary of all design tokens, mixins, and themes. Example: {action:\"list-design-system\"} → {tokens:{Color:[...],Spacing:[...]},mixins:[...],themes:[...]}\n" +
        "- list-patterns: List available UI patterns (heroes, cards, navbars, etc.) that can be applied with node.apply-pattern. No session required. Example: {action:\"list-patterns\"} → [{name:\"hero-centered\",description:\"...\",tags:[...],customisationKeys:[...]}]\n" +
        "- capture-screenshot: Capture a PNG screenshot of a component via headless Chromium and the dev host. Requires dev host running. Example: {action:\"capture-screenshot\",componentUuid:\"abc\"} → PNG image",
      inputSchema: {
        action: z.enum(["tree", "summary", "node", "subtree", "export", "style-properties", "preview-url", "page-meta", "list-design-system", "list-patterns", "capture-screenshot"]),
        componentUuid: z.string().optional().describe("UUID of the component to inspect"),
        nodeRef: z.string().optional().describe("Node reference: UUID, name, path, or index"),
        maxDepth: z.number().optional().describe("Maximum tree depth to return. Defaults to 3 for tree, 2 for summary. Pass -1 for unlimited."),
        maxChars: z.number().optional().describe("Character budget for response JSON. Defaults to 15000 (~4000 tokens). Pass -1 for unlimited."),
        excludeStyles: z.boolean().optional().describe("Strip styles from output to reduce size"),
        summaryOnly: z.boolean().optional().describe("Return compact outline (same as summary action)"),
        format: z.enum(["concise", "full"]).optional().describe('Response format. "concise" strips UUIDs (except root), abbreviates keys (childCount→cc, componentName→comp), replaces detail fields with booleans. ~70% token reduction for orientation. Default: "full".'),
        filter: z.string().optional().describe("Filter string for style-properties action"),
      },
      outputSchema: {
        // Union of output shapes per action. All fields optional since each action
        // returns a different subset. z.unknown() on complex fields keeps validation permissive.
        // tree action output:
        name: z.string().optional().describe("Component name (tree/summary)"),
        uuid: z.string().optional().describe("Component UUID (tree/summary)"),
        path: z.string().optional().describe("Page path if page component (tree)"),
        tree: z.unknown().optional().describe("TreeNode root: {type,tag,layoutHint,styles,children,...} (tree/subtree)"),
        truncated: z.boolean().optional().describe("Whether tree was truncated (tree)"),
        totalNodes: z.number().optional().describe("Total Tpl node count (tree)"),
        nodesShown: z.number().optional().describe("Nodes included after truncation (tree)"),
        hint: z.string().optional().describe("Truncation guidance (tree)"),
        // list-design-system output:
        tokenCount: z.number().optional().describe("Number of design tokens (list-design-system)"),
        tokens: z.unknown().optional().describe("Tokens grouped by type: {Color:[{name,value},...],Spacing:[...]} (list-design-system)"),
        mixinCount: z.number().optional().describe("Number of mixins (list-design-system)"),
        mixins: z.unknown().optional().describe("Array of mixin summaries (list-design-system)"),
        themeCount: z.number().optional().describe("Number of themes (list-design-system)"),
        themes: z.unknown().optional().describe("Array of theme summaries (list-design-system)"),
        note: z.string().optional().describe("Advisory note when design system is empty"),
        // list-patterns output:
        patterns: z.unknown().optional().describe("Array of {name,description,tags,customisationKeys} (list-patterns)"),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ action, componentUuid, nodeRef, maxDepth, maxChars, excludeStyles, summaryOnly, format, filter }) => {
      try {
        // Emit inspect presence so Studio users see which component the agent is viewing
        if (componentUuid) {
          emitInspectPresence(componentUuid);
        }

        switch (action) {
          case "tree": {
            const cuuid = requireParam(componentUuid, "componentUuid", "inspect.tree");
            const session = requireSession();
            const component = session.site.components?.find(
              (c: any) => c.uuid === cuuid
            );

            if (!component) {
              return {
                content: [
                  {
                    type: "text" as const,
                    text: `Component UUID "${cuuid}" not found in project. Use component tool with action 'list' to see available components.`,
                  },
                ],
                isError: true,
              };
            }

            // Default maxDepth: 3 for tree; -1 means unlimited
            const effectiveMaxDepth = maxDepth === -1 ? undefined : (maxDepth ?? 3);
            const effectiveMaxChars = maxChars === -1 ? undefined : (maxChars ?? 15000);

            // Build options — always pass styleTokens for token reference resolution
            const styleTokens = session.site.styleTokens;
            let tree = readComponentTree(component, {
              maxDepth: effectiveMaxDepth,
              excludeStyles: excludeStyles || undefined,
              summaryOnly: summaryOnly || undefined,
              styleTokens,
            } as TreeReadOptions);

            // Truncation metadata — count total Tpl nodes independently of maxDepth
            const totalNodes = component.tplTree ? countTplNodes(component.tplTree) : 0;
            let nodesShown = tree ? countTreeNodes(tree) : 0;
            let charTruncated = false;

            // Apply character-budget truncation
            if (effectiveMaxChars !== undefined && tree) {
              const truncResult = truncateTreeToCharBudget(tree, effectiveMaxChars);
              tree = truncResult.tree;
              nodesShown = truncResult.nodesShown;
              charTruncated = truncResult.wasTruncated;
            }

            const truncated = nodesShown < totalNodes;

            // Apply concise format transformation (after truncation, before serialization)
            const outputTree = format === "concise" && tree ? toConciseFormat(tree) : tree;

            const result: Record<string, unknown> = {
              name: component.name,
              uuid: component.uuid,
              path: component.pageMeta?.path,
              tree: outputTree,
            };

            if (truncated) {
              result.truncated = true;
              result.nodesShown = nodesShown;
              result.totalNodes = totalNodes;
              if (charTruncated) {
                result.hint = `Response truncated at ${effectiveMaxChars} chars. Use inspect.subtree with a nodeRef to see deeper sections, or pass maxDepth to limit tree depth.`;
              } else {
                result.maxDepthApplied = effectiveMaxDepth;
                result.hint = "Use inspect.subtree or inspect.node to drill into specific sections";
              }
            } else {
              result.truncated = false;
              result.totalNodes = totalNodes;
            }

            return inspectResult(result);
          }

          case "summary": {
            const cuuid = requireParam(componentUuid, "componentUuid", "inspect.summary");
            const session = requireSession();
            const component = session.site.components?.find(
              (c: any) => c.uuid === cuuid
            );

            if (!component) {
              return {
                content: [
                  {
                    type: "text" as const,
                    text: `Component UUID "${cuuid}" not found in project. Use component tool with action 'list' to see available components.`,
                  },
                ],
                isError: true,
              };
            }

            // Default maxDepth: 2 for summary; -1 means unlimited
            const effectiveMaxDepth = maxDepth === -1 ? undefined : (maxDepth ?? 2);
            const effectiveMaxChars = maxChars === -1 ? undefined : (maxChars ?? 15000);
            let tree = readComponentSummary(component, effectiveMaxDepth);

            // Truncation metadata — count total Tpl nodes independently of maxDepth
            const totalNodes = component.tplTree ? countTplNodes(component.tplTree) : 0;
            let nodesShown = tree ? countTreeNodes(tree) : 0;
            let charTruncated = false;

            // Apply character-budget truncation
            if (effectiveMaxChars !== undefined && tree) {
              const truncResult = truncateTreeToCharBudget(tree, effectiveMaxChars);
              tree = truncResult.tree;
              nodesShown = truncResult.nodesShown;
              charTruncated = truncResult.wasTruncated;
            }

            const truncated = nodesShown < totalNodes;

            // Apply concise format transformation (after truncation, before serialization)
            const outputTree = format === "concise" && tree ? toConciseFormat(tree) : tree;

            const result: Record<string, unknown> = {
              name: component.name,
              uuid: component.uuid,
              path: component.pageMeta?.path,
              tree: outputTree,
            };

            if (truncated) {
              result.truncated = true;
              result.nodesShown = nodesShown;
              result.totalNodes = totalNodes;
              if (charTruncated) {
                result.hint = `Response truncated at ${effectiveMaxChars} chars. Use inspect.subtree with a nodeRef to see deeper sections, or pass maxDepth to limit tree depth.`;
              } else {
                result.maxDepthApplied = effectiveMaxDepth;
                result.hint = "Use inspect.subtree or inspect.node to drill into specific sections";
              }
            } else {
              result.truncated = false;
              result.totalNodes = totalNodes;
            }

            return inspectResult(result);
          }

          case "node": {
            const cuuid = requireParam(componentUuid, "componentUuid", "inspect.node");
            const nref = requireParam(nodeRef, "nodeRef", "inspect.node");
            const session = requireSession();
            const component = session.site.components?.find(
              (c: any) => c.uuid === cuuid
            );

            if (!component) {
              return {
                content: [
                  {
                    type: "text" as const,
                    text: `Component UUID "${cuuid}" not found in project. Use component tool with action 'list' to see available components.`,
                  },
                ],
                isError: true,
              };
            }

            const resolveResult = resolveNode(component, nref);
            const resolved = requireSingleNode(resolveResult, nref);
            const node = readNodeDetails(resolved.node, session.site.styleTokens);

            return inspectResult({
              path: resolved.path,
              name: resolved.name,
              uuid: resolved.uuid,
              node,
            });
          }

          case "subtree": {
            const cuuid = requireParam(componentUuid, "componentUuid", "inspect.subtree");
            const nref = requireParam(nodeRef, "nodeRef", "inspect.subtree");
            const session = requireSession();
            const component = session.site.components?.find(
              (c: any) => c.uuid === cuuid
            );

            if (!component) {
              return {
                content: [
                  {
                    type: "text" as const,
                    text: `Component UUID "${cuuid}" not found in project. Use component tool with action 'list' to see available components.`,
                  },
                ],
                isError: true,
              };
            }

            const resolveResult = resolveNode(component, nref);
            const resolved = requireSingleNode(resolveResult, nref);
            // No default maxDepth for subtree (targeted drill-down); -1 means unlimited
            const effectiveMaxDepth = maxDepth === -1 ? undefined : maxDepth;
            const effectiveMaxChars = maxChars === -1 ? undefined : (maxChars ?? 15000);
            let tree = readSubtree(
              resolved.node,
              {
                maxDepth: effectiveMaxDepth,
                excludeStyles: excludeStyles || undefined,
                styleTokens: session.site.styleTokens,
              }
            );
            const totalNodes = tree ? countTreeNodes(tree) : 0;
            let nodesShown = totalNodes;
            let charTruncated = false;

            // Apply character-budget truncation
            if (effectiveMaxChars !== undefined && tree) {
              const truncResult = truncateTreeToCharBudget(tree, effectiveMaxChars);
              tree = truncResult.tree;
              nodesShown = truncResult.nodesShown;
              charTruncated = truncResult.wasTruncated;
            }

            // Apply concise format transformation (after truncation, before serialization)
            const outputTree = format === "concise" && tree ? toConciseFormat(tree) : tree;

            const result: Record<string, unknown> = {
              component: component.name,
              componentUuid: component.uuid,
              subtreeRoot: resolved.name ?? resolved.uuid,
              path: resolved.path,
              nodeCount: nodesShown,
              totalNodes,
              tree: outputTree,
            };

            if (charTruncated) {
              result.truncated = true;
              result.nodesShown = nodesShown;
              result.hint = `Response truncated at ${effectiveMaxChars} chars. Use inspect.subtree with a deeper nodeRef to see specific sections.`;
            }

            return inspectResult(result);
          }

          case "export": {
            const cuuid = requireParam(componentUuid, "componentUuid", "inspect.export");
            const session = requireSession();
            const component = session.site.components?.find(
              (c: any) => c.uuid === cuuid
            );

            if (!component) {
              return {
                content: [
                  {
                    type: "text" as const,
                    text: `Component UUID "${cuuid}" not found in project. Use component tool with action 'list' to see available components.`,
                  },
                ],
                isError: true,
              };
            }

            // Full tree for the file (with token resolution)
            const fullTree = readComponentTree(component, {
              styleTokens: session.site.styleTokens,
            });
            const fullData = {
              name: component.name,
              uuid: component.uuid,
              path: component.pageMeta?.path,
              tree: fullTree,
            };

            // Write to temp file (overwrite per component UUID)
            // Sanitize UUID to prevent path traversal — only allow alphanumeric, hyphens, underscores
            const safeCuuid = cuuid.replace(/[^a-zA-Z0-9_-]/g, "_");
            const filePath = path.join(
              os.tmpdir(),
              `plasmic-tree-${safeCuuid}.json`
            );
            fs.writeFileSync(filePath, JSON.stringify(fullData, null, 2), "utf-8");

            // Compact summary for the response
            const summaryTree = readComponentSummary(component);
            const nodeCount = countTreeNodes(fullTree);

            return inspectResult({
              name: component.name,
              uuid: component.uuid,
              path: component.pageMeta?.path,
              filePath,
              nodeCount,
              tree: summaryTree,
            });
          }

          case "style-properties": {
            const allProps = getValidStylePropertyNames();
            let props = allProps;
            if (filter) {
              const lower = filter.toLowerCase();
              props = allProps.filter((p) => p.includes(lower));
            }
            return inspectResult({
              total: props.length,
              properties: props,
              ...(filter ? { filter } : {}),
            });
          }

          case "preview-url": {
            const cuuid = requireParam(componentUuid, "componentUuid", "inspect.preview-url");
            const session = requireSession();
            const component = session.site.components?.find(
              (c: any) => c.uuid === cuuid
            );

            if (!component) {
              return {
                content: [
                  {
                    type: "text" as const,
                    text: `Component UUID "${cuuid}" not found. Use component tool with action 'list' to see available components.`,
                  },
                ],
                isError: true,
              };
            }

            const host = auth.host.replace(/\/$/, ""); // Normalize trailing slash
            const studioUrl = `${host}/projects/${session.projectId}`;

            const result: Record<string, string> = { studioUrl };

            if (component.pageMeta?.path) {
              result.previewUrl = `${host}/projects/${session.projectId}/preview${component.pageMeta.path}`;
            }

            return inspectResult(result);
          }

          case "page-meta": {
            const cuuid = requireParam(componentUuid, "componentUuid", "inspect.page-meta");
            const session = requireSession();
            const component = session.site.components?.find(
              (c: any) => c.uuid === cuuid
            );

            if (!component) {
              return {
                content: [
                  {
                    type: "text" as const,
                    text: `Component UUID "${cuuid}" not found. Use component tool with action 'list' to see available components.`,
                  },
                ],
                isError: true,
              };
            }

            if (!component.pageMeta) {
              return {
                content: [
                  {
                    type: "text" as const,
                    text: `Component "${component.name}" is not a page — no page metadata available.`,
                  },
                ],
                isError: true,
              };
            }

            const pm = component.pageMeta;

            // Extract text from pageMeta fields that may be strings or TemplatedStrings
            const extractText = (value: any): string | null => {
              if (value === null || value === undefined) return null;
              if (typeof value === "string") return value;
              // TemplatedString: text is an array of parts
              if (Array.isArray(value?.text)) {
                return value.text
                  .map((part: any) => (typeof part === "string" ? part : ""))
                  .join("");
              }
              // RawText or similar with .text as a string
              if (typeof value?.text === "string") return value.text;
              return String(value);
            };

            const meta = {
              name: component.name,
              uuid: component.uuid,
              path: pm.path,
              title: extractText(pm.title),
              description: extractText(pm.description),
              openGraphImage: extractText(pm.openGraphImage),
              canonical: extractText(pm.canonical),
              params: pm.params ?? {},
              query: pm.query ?? {},
              roleId: pm.roleId ?? null,
            };

            return inspectResult(meta);
          }

          case "list-design-system": {
            const session = requireSession();
            const allTokens = getAllStyleTokens(session.site);
            const tokensResult = readTokens(allTokens);
            const mixins = listMixins();
            const themes = listThemes();

            const result: Record<string, unknown> = {
              tokenCount: tokensResult.tokenCount,
              tokens: tokensResult.tokens,
              mixinCount: mixins.length,
              mixins,
              themeCount: themes.length,
              themes,
            };

            if (tokensResult.tokenCount === 0 && mixins.length === 0 && themes.length === 0) {
              result.note = "No design system tokens, mixins, or themes defined. You can create them with the design tool, or use raw CSS values directly.";
            }

            return inspectResult(result);
          }

          case "list-patterns": {
            const patterns = listPatternsMeta();
            return inspectResult({ patternCount: patterns.length, patterns });
          }

          case "capture-screenshot": {
            const session = requireSession();
            const cuuid = componentUuid;
            if (!cuuid) {
              return inspectResult({ error: "componentUuid is required for capture-screenshot" });
            }
            const component = session.site.components?.find(
              (c: any) => c.uuid === cuuid
            );
            if (!component) {
              return inspectResult({ error: `Component ${cuuid} not found` });
            }
            if (!session.hostUrl) {
              return inspectResult({
                error: "No dev host URL configured. Set PLASMIC_DEV_HOST_URL environment variable or configure hostUrl in project settings.",
              });
            }

            const tree = readComponentTree(component);
            if (!tree) {
              return inspectResult({ error: `Component "${component.name}" has no template tree` });
            }

            const result = await captureScreenshot({
              devHostUrl: session.hostUrl,
              componentName: component.name,
              tree,
            });

            return {
              content: [
                {
                  type: "image" as const,
                  data: result.imageData,
                  mimeType: "image/png",
                },
                {
                  type: "text" as const,
                  text: JSON.stringify({
                    component: component.name,
                    componentUuid: cuuid,
                    width: result.width,
                    height: result.height,
                  }),
                },
              ],
              structuredContent: {
                component: component.name,
                componentUuid: cuuid,
                width: result.width,
                height: result.height,
              },
            };
          }

          default:
            throw new Error(`Unknown action '${action}' for inspect tool. Available: tree, summary, node, subtree, export, style-properties, preview-url, page-meta, list-design-system, list-patterns, capture-screenshot`);
        }
      } catch (err: unknown) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error in inspect.${action}: ${errorMessage(err)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  // ========================================================================
  // DOMAIN 3: component (18 actions)
  // ========================================================================

  server.registerTool(
    "component",
    {
      description: "Component and page lifecycle, props, and states.\n" +
        "Actions: list, create-page, create, clone, rename, delete, extract, convert-to-page, convert-to-component, update-page-meta, list-props, add-prop, update-prop, remove-prop, list-states, add-state, update-state, remove-state.\n" +
        "- list: List all pages and components. Example: {action:\"list\"} → {pages:[{name:\"Home\",uuid:\"abc\",path:\"/\"}],components:[{name:\"Button\",uuid:\"def\"}]}\n" +
        "- create-page: Create a new page with PlasmicElement tree. Example: {action:\"create-page\",name:\"About\",path:\"/about\"} → {success:true,uuid:\"new-uuid\",path:\"/about\"}\n" +
        "- create: Create a new reusable component. Example: {action:\"create\",name:\"Card\"} → {success:true,uuid:\"new-uuid\",name:\"Card\"}\n" +
        "- clone: Duplicate an existing page or component. Example: {action:\"clone\",sourceUuid:\"abc\",name:\"Home Copy\"} → {success:true,uuid:\"new-uuid\"}\n" +
        "- rename: Rename a page or component. Example: {action:\"rename\",componentUuid:\"abc\",newName:\"Hero Section\"} → {success:true}\n" +
        "- delete: Delete a page or component. Example: {action:\"delete\",componentUuid:\"abc\"} → {success:true}\n" +
        "- extract: Extract a subtree into a new component, replacing it with a component instance. Example: {action:\"extract\",componentUuid:\"abc\",nodeRef:\"card\",name:\"CardComponent\"} → {newComponentUuid:\"new-uuid\",instanceUuid:\"inst-uuid\"}\n" +
        "- convert-to-page/convert-to-component: Convert between page and component\n" +
        "- update-page-meta: Set page SEO metadata. Example: {action:\"update-page-meta\",componentUuid:\"abc\",title:\"About Us\",description:\"Learn more\"} → {success:true}\n" +
        "- list-props/add-prop/update-prop/remove-prop: Manage component props. Example: {action:\"add-prop\",componentUuid:\"abc\",name:\"label\",type:\"string\",defaultValue:\"Click me\"} → {success:true}\n" +
        "- list-states/add-state/update-state/remove-state: Manage component states. Example: {action:\"add-state\",componentUuid:\"abc\",name:\"isOpen\",variableType:\"boolean\",initialValue:\"false\"} → {success:true}",
      inputSchema: {
      action: z.enum([
        "list", "create-page", "create", "clone", "rename", "delete", "extract",
        "convert-to-page", "convert-to-component", "update-page-meta",
        "list-props", "add-prop", "update-prop", "remove-prop",
        "list-states", "add-state", "update-state", "remove-state",
      ]),
      componentUuid: z.string().optional().describe("UUID of the component"),
      name: z.string().optional().describe("Name for create/rename/add-prop/add-state actions"),
      path: z.string().optional().describe("URL path for pages"),
      body: PlasmicElementSchema.optional().describe("PlasmicElement JSON tree for create-page/create"),
      sourceUuid: z.string().optional().describe("UUID of source for clone"),
      newName: z.string().optional().describe("New name for rename"),
      newPath: z.string().optional().describe("New URL path for rename"),
      force: z.boolean().optional().describe("Force deletion even with references"),
      nodeRef: z.string().optional().describe("Node reference for extract (UUID, name, path, or index)"),
      title: z.string().optional().describe("Page title for SEO"),
      description: z.string().optional().describe("Page description for SEO (update-page-meta) or prop description (add-prop/update-prop)"),
      openGraphImage: z.string().optional().describe("Open Graph image URL"),
      canonical: z.string().optional().describe("Canonical URL for SEO"),
      propRef: z.string().optional().describe("Prop reference (name or UUID)"),
      type: z.string().optional().describe("Type for add-prop or add-state"),
      defaultValue: z.string().optional().describe("Default value for prop or initial value for state"),
      stateRef: z.string().optional().describe("State reference (name or UUID)"),
      variableType: z.string().optional().describe("State variable type"),
      accessType: z.string().optional().describe("State access type"),
      initialValue: z.string().optional().describe("State initial value"),
      includeImplicit: z.boolean().optional().describe("Include implicit states in list-states (default: false)"),
      dryRun: z.boolean().optional().describe("Preview changes without persisting"),
      },
      annotations: { destructiveHint: true },
    },
    async (params) => {
      const { action } = params;
      const callId = randomUUID();
      registerCall(callId);
      setCurrentCallId(callId);
      try {
        // Emit presence for component-level operations
        if (params.componentUuid) {
          emitEditPresence(params.componentUuid, params.nodeRef);
        }

        switch (action) {
          case "list": {
            const session = requireSession();
            const components = session.site.components ?? [];
            const result = components.map((c: any) => ({
              uuid: c.uuid,
              name: c.name,
              type: c.pageMeta?.path ? "page" : "component",
              path: c.pageMeta?.path ?? undefined,
            }));

            return {
              content: [
                { type: "text" as const, text: JSON.stringify(result) },
              ],
            };
          }

          case "create-page": {
            if (params.dryRun) {
              return {
                content: [{ type: "text" as const, text: JSON.stringify({ error: true, message: "Dry run is not supported for component.create-page. This action creates a server-side component via the API and cannot be previewed." }) }],
                isError: true,
              };
            }
            const pageName = requireParam(params.name, "name", "component.create-page");
            const pagePath = requireParam(params.path, "path", "component.create-page");
            const session = requireSession();

            const apiResponse = await apiClient.updateProject(session.projectId, {
              newComponents: [{ name: pageName, path: pagePath, body: params.body }],
            });

            // Extract UUID from API response if available
            let uuid: string | null =
              apiResponse?.result?.newComponents?.[0]?.uuid ?? null;

            // Reload model so the new page is visible in subsequent queries
            try {
              disposeChangeTracker();
              clearNodeCache();
              const {
                site,
                bundler,
                projectName,
                revisionNum: newRevisionNum,
                modelVersion: newModelVersion,
                hostlessDataVersion: newHostlessDataVersion,
                hostUrl: reloadedHostUrl,
                bundleVersion: newBundleVersion,
              } = await loadProject(apiClient, session.projectId);

              // Re-sync code component variants from the dev host (non-fatal)
              const syncResult = await syncFromDevHost(site, reloadedHostUrl);

              setSession({
                projectId: session.projectId,
                projectName,
                site,
                bundler,
                revisionNum: newRevisionNum,
                modelVersion: newModelVersion,
                hostlessDataVersion: newHostlessDataVersion,
                bundleVersion: newBundleVersion,
                projectUuid: session.projectId,
                hostUrl: reloadedHostUrl,
                devHostSynced: syncResult.devHostSynced,
                syncedVariantComponents: syncResult.syncedVariantComponents,
                registryData: syncResult.registryData,
              });
              initChangeTracker(site);

              // Fallback: look up UUID from reloaded model if API didn't provide it
              if (!uuid) {
                const newComp = site.components?.find(
                  (c: any) => c.name === pageName && c.pageMeta?.path === pagePath
                );
                if (newComp) {
                  uuid = newComp.uuid;
                }
              }

              console.error(
                "[plasmic-mcp] Model reloaded after page creation"
              );
            } catch (reloadErr) {
              console.error(
                "[plasmic-mcp] Warning: Could not reload model after page creation:",
                reloadErr
              );
              // Re-initialize change tracker on the existing session site so
              // subsequent mutations don't fail with "not initialized"
              try {
                initChangeTracker(session.site);
              } catch { /* best-effort */ }
            }

            return {
              content: [
                {
                  type: "text" as const,
                  text: JSON.stringify(
                    {
                      success: true,
                      name: pageName,
                      uuid,
                      path: pagePath,
                      message: `Page "${pageName}" created at ${pagePath}`,
                    }
                  ),
                },
              ],
            };
          }

          case "create": {
            if (params.dryRun) {
              return {
                content: [{ type: "text" as const, text: JSON.stringify({ error: true, message: "Dry run is not supported for component.create. This action creates a server-side component via the API and cannot be previewed." }) }],
                isError: true,
              };
            }
            const compName = requireParam(params.name, "name", "component.create");
            if (compName.length < 1) throw new Error("Component name is required");
            const session = requireSession();

            const apiResponse = await apiClient.updateProject(session.projectId, {
              newComponents: [{ name: compName, body: params.body }],
            });

            // Extract UUID from API response if available
            let uuid: string | null =
              apiResponse?.result?.newComponents?.[0]?.uuid ?? null;

            // Reload model so the new component is visible in subsequent queries
            try {
              disposeChangeTracker();
              clearNodeCache();
              const {
                site,
                bundler,
                projectName,
                revisionNum: newRevisionNum,
                modelVersion: newModelVersion,
                hostlessDataVersion: newHostlessDataVersion,
                hostUrl: reloadedHostUrl,
                bundleVersion: newBundleVersion,
              } = await loadProject(apiClient, session.projectId);

              // Re-sync code component variants from the dev host (non-fatal)
              const syncResult = await syncFromDevHost(site, reloadedHostUrl);

              setSession({
                projectId: session.projectId,
                projectName,
                site,
                bundler,
                revisionNum: newRevisionNum,
                modelVersion: newModelVersion,
                hostlessDataVersion: newHostlessDataVersion,
                bundleVersion: newBundleVersion,
                projectUuid: session.projectId,
                hostUrl: reloadedHostUrl,
                devHostSynced: syncResult.devHostSynced,
                syncedVariantComponents: syncResult.syncedVariantComponents,
                registryData: syncResult.registryData,
              });
              initChangeTracker(site);

              // Fallback: look up UUID from reloaded model if API didn't provide it
              if (!uuid) {
                const newComp = site.components?.find(
                  (c: any) => c.name === compName
                );
                if (newComp) {
                  uuid = newComp.uuid;
                }
              }

              console.error(
                "[plasmic-mcp] Model reloaded after component creation"
              );
            } catch (reloadErr) {
              console.error(
                "[plasmic-mcp] Warning: Could not reload model after component creation:",
                reloadErr
              );
              // Re-initialize change tracker on the existing session site so
              // subsequent mutations don't fail with "not initialized"
              try {
                initChangeTracker(session.site);
              } catch { /* best-effort */ }
            }

            return {
              content: [
                {
                  type: "text" as const,
                  text: JSON.stringify(
                    {
                      success: true,
                      name: compName,
                      uuid,
                      message: `Component "${compName}" created`,
                    }
                  ),
                },
              ],
            };
          }

          case "clone": {
            if (params.dryRun) {
              return {
                content: [{ type: "text" as const, text: JSON.stringify({ error: true, message: "Dry run is not supported for component.clone. This action creates a server-side component via the API and cannot be previewed." }) }],
                isError: true,
              };
            }
            const srcUuid = requireParam(params.sourceUuid, "sourceUuid", "component.clone");
            if (srcUuid.length < 1) throw new Error("Source UUID is required");
            const cloneName = requireParam(params.name, "name", "component.clone");
            if (cloneName.length < 1) throw new Error("Clone name is required");
            const session = requireSession();

            // Verify source exists
            const source = session.site.components?.find(
              (c: any) => c.uuid === srcUuid
            );
            if (!source) {
              return {
                content: [
                  {
                    type: "text" as const,
                    text: JSON.stringify({ error: true, message: `Source component UUID "${srcUuid}" not found. Use component tool with action 'list' to see available components.` }),
                  },
                ],
                isError: true,
              };
            }

            const req: any = {
              name: cloneName,
              cloneFrom: { uuid: srcUuid },
            };
            if (params.path) {
              req.path = params.path;
            }

            const apiResponse = await apiClient.updateProject(session.projectId, {
              newComponents: [req],
            });

            // Extract UUID from API response if available
            let uuid: string | null =
              apiResponse?.result?.newComponents?.[0]?.uuid ?? null;

            // Reload model so the clone is visible in subsequent queries
            try {
              disposeChangeTracker();
              clearNodeCache();
              const {
                site,
                bundler,
                projectName,
                revisionNum: newRevisionNum,
                modelVersion: newModelVersion,
                hostlessDataVersion: newHostlessDataVersion,
                hostUrl: reloadedHostUrl,
                bundleVersion: newBundleVersion,
              } = await loadProject(apiClient, session.projectId);

              // Re-sync code component variants from the dev host (non-fatal)
              const syncResult = await syncFromDevHost(site, reloadedHostUrl);

              setSession({
                projectId: session.projectId,
                projectName,
                site,
                bundler,
                revisionNum: newRevisionNum,
                modelVersion: newModelVersion,
                hostlessDataVersion: newHostlessDataVersion,
                bundleVersion: newBundleVersion,
                projectUuid: session.projectId,
                hostUrl: reloadedHostUrl,
                devHostSynced: syncResult.devHostSynced,
                syncedVariantComponents: syncResult.syncedVariantComponents,
                registryData: syncResult.registryData,
              });
              initChangeTracker(site);

              // Fallback: look up UUID from reloaded model if API didn't provide it
              if (!uuid) {
                const newComp = site.components?.find(
                  (c: any) => c.name === cloneName
                );
                if (newComp) {
                  uuid = newComp.uuid;
                }
              }

              console.error(
                "[plasmic-mcp] Model reloaded after component cloning"
              );
            } catch (reloadErr) {
              console.error(
                "[plasmic-mcp] Warning: Could not reload model after component cloning:",
                reloadErr
              );
              // Re-initialize change tracker on the existing session site so
              // subsequent mutations don't fail with "not initialized"
              try {
                initChangeTracker(session.site);
              } catch { /* best-effort */ }
            }

            return {
              content: [
                {
                  type: "text" as const,
                  text: JSON.stringify(
                    {
                      success: true,
                      name: cloneName,
                      uuid,
                      clonedFrom: source.name,
                      clonedFromUuid: srcUuid,
                      path: params.path,
                      message: `Component "${cloneName}" cloned from "${source.name}"${params.path ? ` at ${params.path}` : ""}`,
                    }
                  ),
                },
              ],
            };
          }

          case "rename": {
            const cuuid = requireParam(params.componentUuid, "componentUuid", "component.rename");
            const nn = requireParam(params.newName, "newName", "component.rename");
            if (nn.length < 1) throw new Error("New name is required");

            if (params.dryRun) {
              const result = await withDryRun(() =>
                renameComponent(apiClient, cuuid, nn, params.newPath)
              );
              return {
                content: [
                  {
                    type: "text" as const,
                    text: JSON.stringify(
                      {
                        dryRun: true,
                        oldName: result.oldName,
                        newName: result.newName,
                        uuid: result.componentUuid,
                        path: result.newPath,
                        message: "Dry run: no changes persisted",
                      }
                    ),
                  },
                ],
              };
            }

            const result = await renameComponent(apiClient, cuuid, nn, params.newPath);
            return {
              content: [
                {
                  type: "text" as const,
                  text: JSON.stringify(
                    {
                      success: true,
                      oldName: result.oldName,
                      newName: result.newName,
                      uuid: result.componentUuid,
                      path: result.newPath,
                      revision: result.save.revisionNum,
                      message: `Renamed "${result.oldName}" → "${result.newName}"`,
                    }
                  ),
                },
              ],
            };
          }

          case "delete": {
            const cuuid = requireParam(params.componentUuid, "componentUuid", "component.delete");

            if (params.dryRun) {
              const result = await withDryRun(() =>
                deleteComponent(apiClient, cuuid, params.force)
              );
              return {
                content: [
                  {
                    type: "text" as const,
                    text: JSON.stringify(
                      {
                        dryRun: true,
                        deletedName: result.deletedName,
                        deletedUuid: result.deletedUuid,
                        message: "Dry run: no changes persisted",
                      }
                    ),
                  },
                ],
              };
            }

            const result = await deleteComponent(apiClient, cuuid, params.force);
            return {
              content: [
                {
                  type: "text" as const,
                  text: JSON.stringify(
                    {
                      success: true,
                      deletedName: result.deletedName,
                      deletedUuid: result.deletedUuid,
                      revision: result.save.revisionNum,
                      message: `Deleted "${result.deletedName}"`,
                    }
                  ),
                },
              ],
            };
          }

          case "extract": {
            const cuuid = requireParam(params.componentUuid, "componentUuid", "component.extract");
            const nRef = requireParam(params.nodeRef, "nodeRef", "component.extract");
            const eName = requireParam(params.name, "name", "component.extract");
            if (eName.length < 1) throw new Error("Component name is required for component.extract");

            if (params.dryRun) {
              const result = await withDryRun(() =>
                extractToComponent(apiClient, cuuid, nRef, eName)
              );
              return {
                content: [
                  {
                    type: "text" as const,
                    text: JSON.stringify(
                      {
                        dryRun: true,
                        newComponentUuid: result.newComponentUuid,
                        newComponentName: result.newComponentName,
                        instanceUuid: result.instanceUuid,
                        containingComponentUuid: result.containingComponentUuid,
                        message: "Dry run: no changes persisted",
                      }
                    ),
                  },
                ],
              };
            }

            const result = await extractToComponent(apiClient, cuuid, nRef, eName);
            clearNodeCache();
            return {
              content: [
                {
                  type: "text" as const,
                  text: JSON.stringify(
                    {
                      success: true,
                      newComponentUuid: result.newComponentUuid,
                      newComponentName: result.newComponentName,
                      instanceUuid: result.instanceUuid,
                      containingComponentUuid: result.containingComponentUuid,
                      revision: result.save.revisionNum,
                      message: `Extracted "${result.newComponentName}" from component`,
                    }
                  ),
                },
              ],
            };
          }

          case "convert-to-page": {
            const cuuid = requireParam(params.componentUuid, "componentUuid", "component.convert-to-page");

            if (params.dryRun) {
              const result = await withDryRun(() =>
                convertToPage(apiClient, cuuid, params.path)
              );
              return {
                content: [
                  {
                    type: "text" as const,
                    text: JSON.stringify(
                      {
                        dryRun: true,
                        componentName: result.componentName,
                        path: result.path,
                        message: "Dry run: no changes persisted",
                      }
                    ),
                  },
                ],
              };
            }

            const result = await convertToPage(apiClient, cuuid, params.path);
            return {
              content: [
                {
                  type: "text" as const,
                  text: JSON.stringify(
                    {
                      success: true,
                      componentName: result.componentName,
                      path: result.path,
                      revision: result.save.revisionNum,
                      message: `Converted "${result.componentName}" to page at ${result.path}`,
                    }
                  ),
                },
              ],
            };
          }

          case "convert-to-component": {
            const cuuid = requireParam(params.componentUuid, "componentUuid", "component.convert-to-component");

            if (params.dryRun) {
              const result = await withDryRun(() =>
                convertToComponent(apiClient, cuuid)
              );
              return {
                content: [
                  {
                    type: "text" as const,
                    text: JSON.stringify(
                      {
                        dryRun: true,
                        componentName: result.componentName,
                        message: "Dry run: no changes persisted",
                      }
                    ),
                  },
                ],
              };
            }

            const result = await convertToComponent(apiClient, cuuid);
            return {
              content: [
                {
                  type: "text" as const,
                  text: JSON.stringify(
                    {
                      success: true,
                      componentName: result.componentName,
                      revision: result.save.revisionNum,
                      message: `Converted "${result.componentName}" to component`,
                    }
                  ),
                },
              ],
            };
          }

          case "update-page-meta": {
            const cuuid = requireParam(params.componentUuid, "componentUuid", "component.update-page-meta");
            const meta = {
              title: params.title,
              description: params.description,
              openGraphImage: params.openGraphImage,
              canonical: params.canonical,
              path: params.path,
            };

            if (params.dryRun) {
              const result = await withDryRun(() =>
                updatePageMeta(apiClient, cuuid, meta)
              );
              return {
                content: [
                  {
                    type: "text" as const,
                    text: JSON.stringify(
                      {
                        dryRun: true,
                        component: result.componentName,
                        uuid: result.componentUuid,
                        updatedFields: result.updatedFields,
                        message: "Dry run: no changes persisted",
                      }
                    ),
                  },
                ],
              };
            }

            const result = await updatePageMeta(apiClient, cuuid, meta);
            return {
              content: [
                {
                  type: "text" as const,
                  text: JSON.stringify(
                    {
                      success: true,
                      component: result.componentName,
                      uuid: result.componentUuid,
                      updatedFields: result.updatedFields,
                      revision: result.save.revisionNum,
                      message: `Updated page metadata: ${result.updatedFields.join(", ")}`,
                    }
                  ),
                },
              ],
            };
          }

          case "list-props": {
            const cuuid = requireParam(params.componentUuid, "componentUuid", "component.list-props");
            const session = requireSession();
            const component = session.site.components?.find(
              (c: any) => c.uuid === cuuid
            );

            if (!component) {
              return {
                content: [
                  {
                    type: "text" as const,
                    text: `Component UUID "${cuuid}" not found. Use component tool with action 'list' to see available components.`,
                  },
                ],
                isError: true,
              };
            }

            const props = listProps(component);
            return {
              content: [
                {
                  type: "text" as const,
                  text: JSON.stringify(
                    {
                      component: component.name,
                      componentUuid: component.uuid,
                      propCount: props.length,
                      props,
                    }
                  ),
                },
              ],
            };
          }

          case "add-prop": {
            const cuuid = requireParam(params.componentUuid, "componentUuid", "component.add-prop");
            const propName = requireParam(params.name, "name", "component.add-prop");
            const propType = requireParam(params.type, "type", "component.add-prop");

            if (params.dryRun) {
              const result = await withDryRun(() =>
                addProp(apiClient, cuuid, propName, propType, params.defaultValue, params.description)
              );
              return {
                content: [
                  {
                    type: "text" as const,
                    text: JSON.stringify(
                      {
                        dryRun: true,
                        paramUuid: result.paramUuid,
                        name: result.name,
                        propType: result.type,
                        message: "Dry run: no changes persisted",
                      }
                    ),
                  },
                ],
              };
            }

            const result = await addProp(
              apiClient, cuuid, propName, propType, params.defaultValue, params.description
            );
            return {
              content: [
                {
                  type: "text" as const,
                  text: JSON.stringify(
                    {
                      success: true,
                      paramUuid: result.paramUuid,
                      name: result.name,
                      propType: result.type,
                      revision: result.save.revisionNum,
                    }
                  ),
                },
              ],
            };
          }

          case "update-prop": {
            const cuuid = requireParam(params.componentUuid, "componentUuid", "component.update-prop");
            const pRef = requireParam(params.propRef, "propRef", "component.update-prop");

            if (!params.name && params.defaultValue === undefined && params.description === undefined) {
              return {
                content: [
                  {
                    type: "text" as const,
                    text: JSON.stringify(
                      {
                        error: true,
                        message:
                          "At least one of 'name', 'defaultValue', or 'description' must be provided.",
                      }
                    ),
                  },
                ],
                isError: true,
              };
            }

            if (params.dryRun) {
              const result = await withDryRun(() =>
                updateProp(apiClient, cuuid, pRef, params.name, params.defaultValue, params.description)
              );
              return {
                content: [
                  {
                    type: "text" as const,
                    text: JSON.stringify(
                      {
                        dryRun: true,
                        paramUuid: result.paramUuid,
                        name: result.name,
                        previousName: result.previousName,
                        updatedFields: result.updatedFields,
                        message: "Dry run: no changes persisted",
                      }
                    ),
                  },
                ],
              };
            }

            const result = await updateProp(
              apiClient, cuuid, pRef, params.name, params.defaultValue, params.description
            );
            return {
              content: [
                {
                  type: "text" as const,
                  text: JSON.stringify(
                    {
                      success: true,
                      paramUuid: result.paramUuid,
                      name: result.name,
                      previousName: result.previousName,
                      updatedFields: result.updatedFields,
                      revision: result.save.revisionNum,
                    }
                  ),
                },
              ],
            };
          }

          case "remove-prop": {
            const cuuid = requireParam(params.componentUuid, "componentUuid", "component.remove-prop");
            const pRef = requireParam(params.propRef, "propRef", "component.remove-prop");

            if (params.dryRun) {
              const result = await withDryRun(() =>
                removeProp(apiClient, cuuid, pRef)
              );
              return {
                content: [
                  {
                    type: "text" as const,
                    text: JSON.stringify(
                      {
                        dryRun: true,
                        removedName: result.removedName,
                        removedUuid: result.removedUuid,
                        cleanedArgCount: result.cleanedArgCount,
                        message: "Dry run: no changes persisted",
                      }
                    ),
                  },
                ],
              };
            }

            const result = await removeProp(apiClient, cuuid, pRef);
            return {
              content: [
                {
                  type: "text" as const,
                  text: JSON.stringify(
                    {
                      success: true,
                      removedName: result.removedName,
                      removedUuid: result.removedUuid,
                      cleanedArgCount: result.cleanedArgCount,
                      revision: result.save.revisionNum,
                    }
                  ),
                },
              ],
            };
          }

          case "list-states": {
            const cuuid = requireParam(params.componentUuid, "componentUuid", "component.list-states");
            const session = requireSession();
            const component = session.site.components?.find(
              (c: any) => c.uuid === cuuid
            );

            if (!component) {
              return {
                content: [
                  {
                    type: "text" as const,
                    text: `Component UUID "${cuuid}" not found. Use component tool with action 'list' to see available components.`,
                  },
                ],
                isError: true,
              };
            }

            const states = listStates(component, params.includeImplicit);
            return {
              content: [
                {
                  type: "text" as const,
                  text: JSON.stringify(
                    {
                      componentUuid: cuuid,
                      componentName: component.name,
                      stateCount: states.length,
                      states,
                    }
                  ),
                },
              ],
            };
          }

          case "add-state": {
            const cuuid = requireParam(params.componentUuid, "componentUuid", "component.add-state");
            const stateName = requireParam(params.name, "name", "component.add-state");
            const varType = requireParam(params.variableType, "variableType", "component.add-state");
            const accType = params.accessType ?? "private";

            if (params.dryRun) {
              const result = await withDryRun(() =>
                addState(apiClient, cuuid, stateName, varType, accType, params.initialValue)
              );
              return {
                content: [
                  {
                    type: "text" as const,
                    text: JSON.stringify(
                      {
                        dryRun: true,
                        stateUuid: result.stateUuid,
                        paramUuid: result.paramUuid,
                        name: result.name,
                        variableType: result.variableType,
                        accessType: result.accessType,
                        message: "Dry run: no changes persisted",
                      }
                    ),
                  },
                ],
              };
            }

            const result = await addState(
              apiClient, cuuid, stateName, varType, accType, params.initialValue
            );
            return {
              content: [
                {
                  type: "text" as const,
                  text: JSON.stringify(
                    {
                      success: true,
                      stateUuid: result.stateUuid,
                      paramUuid: result.paramUuid,
                      name: result.name,
                      variableType: result.variableType,
                      accessType: result.accessType,
                      revision: result.save.revisionNum,
                    }
                  ),
                },
              ],
            };
          }

          case "update-state": {
            const cuuid = requireParam(params.componentUuid, "componentUuid", "component.update-state");
            const sRef = requireParam(params.stateRef, "stateRef", "component.update-state");

            if (!params.name && params.accessType === undefined && params.initialValue === undefined) {
              return {
                content: [
                  {
                    type: "text" as const,
                    text: JSON.stringify(
                      {
                        error: true,
                        message:
                          "At least one of 'name', 'accessType', or 'initialValue' must be provided.",
                      }
                    ),
                  },
                ],
                isError: true,
              };
            }

            if (params.dryRun) {
              const result = await withDryRun(() =>
                updateState(apiClient, cuuid, sRef, params.name, params.accessType, params.initialValue)
              );
              return {
                content: [
                  {
                    type: "text" as const,
                    text: JSON.stringify(
                      {
                        dryRun: true,
                        stateUuid: result.stateUuid,
                        name: result.name,
                        previousName: result.previousName,
                        updatedFields: result.updatedFields,
                        message: "Dry run: no changes persisted",
                      }
                    ),
                  },
                ],
              };
            }

            const result = await updateState(
              apiClient, cuuid, sRef, params.name, params.accessType, params.initialValue
            );
            return {
              content: [
                {
                  type: "text" as const,
                  text: JSON.stringify(
                    {
                      success: true,
                      stateUuid: result.stateUuid,
                      name: result.name,
                      previousName: result.previousName,
                      updatedFields: result.updatedFields,
                      revision: result.save.revisionNum,
                    }
                  ),
                },
              ],
            };
          }

          case "remove-state": {
            const cuuid = requireParam(params.componentUuid, "componentUuid", "component.remove-state");
            const sRef = requireParam(params.stateRef, "stateRef", "component.remove-state");

            if (params.dryRun) {
              const result = await withDryRun(() =>
                removeState(apiClient, cuuid, sRef)
              );
              return {
                content: [
                  {
                    type: "text" as const,
                    text: JSON.stringify(
                      {
                        dryRun: true,
                        removedName: result.removedName,
                        removedUuid: result.removedUuid,
                        cleanedArgCount: result.cleanedArgCount,
                        message: "Dry run: no changes persisted",
                      }
                    ),
                  },
                ],
              };
            }

            const result = await removeState(apiClient, cuuid, sRef);
            return {
              content: [
                {
                  type: "text" as const,
                  text: JSON.stringify(
                    {
                      success: true,
                      removedName: result.removedName,
                      removedUuid: result.removedUuid,
                      cleanedArgCount: result.cleanedArgCount,
                      revision: result.save.revisionNum,
                    }
                  ),
                },
              ],
            };
          }

          default:
            throw new Error(`Unknown action '${action}' for component tool.`);
        }
      } catch (err: unknown) {
        if (["create-page", "create", "clone", "rename", "delete", "extract", "convert-to-page", "convert-to-component", "update-page-meta",
             "add-prop", "update-prop", "remove-prop", "add-state", "update-state", "remove-state"].includes(action)) {
          return handleMutationError(`component.${action}`, err, callId);
        }
        return {
          content: [
            {
              type: "text" as const,
              text: `Error in component.${action}: ${errorMessage(err)}`,
            },
          ],
          isError: true,
        };
      } finally {
        setCurrentCallId(null);
        if (!isCallSettled(callId)) failCall(callId);
        clearEditPresence();
      }
    }
  );

  // ========================================================================
  // DOMAIN 4: node (16 actions)
  // ========================================================================

  server.registerTool(
    "node",
    {
      description: "Element mutations within a component.\n" +
        "Actions: add, remove, move, clone, reorder, update-styles, update-text, update-rich-text, update-attrs, update-props, set-visibility, set-image, apply-mixin, detach-mixin, add-animation, remove-animation, apply-pattern.\n" +
        "- add/remove/move/clone/reorder: Structural changes to element tree. Example: {action:\"add\",componentUuid:\"abc\",parentRef:\"root\",tag:\"div\"} → {uuid:\"new-uuid\"}\n" +
        "- update-styles: Set CSS styles on an element. Example: {action:\"update-styles\",componentUuid:\"abc\",nodeRef:\"uuid\",styles:{display:\"flex\",flexDirection:\"column\",gap:\"16px\"}}\n" +
        "- update-text: Set text content. Example: {action:\"update-text\",componentUuid:\"abc\",nodeRef:\"heading\",text:\"Welcome\"} → {success:true,previousText:\"Hello\",newText:\"Welcome\"}\n" +
        "- update-rich-text: Set text with formatting marks. Example: {action:\"update-rich-text\",componentUuid:\"abc\",nodeRef:\"desc\",text:\"Bold intro here\",marks:[{start:0,end:4,type:\"bold\"}]}\n" +
        "- update-attrs: Set HTML attributes on TplTag elements. Example: {action:\"update-attrs\",componentUuid:\"abc\",nodeRef:\"link\",attrs:{href:\"/about\",target:\"_blank\"}} → {success:true}\n" +
        "- update-props: Set component props on TplComponent instances (scalar, dynamic, slot). Example: {action:\"update-props\",componentUuid:\"abc\",nodeRef:\"btn\",props:{label:\"Submit\",onClick:\"$expr:handleClick\"}} → {success:true}\n" +
        "- set-visibility: Show/hide elements per variant. visible: true (show), false (not rendered — removed from DOM), 'hidden' (CSS display:none — stays in DOM). For responsive hiding use 'hidden'. Example: {action:\"set-visibility\",componentUuid:\"abc\",nodeRef:\"sidebar\",visible:\"hidden\",variant:\"mobile\"} → {success:true,newVisibility:\"displayNone\"}\n" +
        "- set-image: Set image source (asset or URL). Example: {action:\"set-image\",componentUuid:\"abc\",nodeRef:\"hero-img\",src:\"https://example.com/photo.jpg\"} → {success:true}\n" +
        "- apply-mixin/detach-mixin: Apply or remove style mixins. Example: {action:\"apply-mixin\",componentUuid:\"abc\",nodeRef:\"card\",mixinRef:\"Card Shadow\"} → {success:true}\n" +
        "- add-animation/remove-animation: Apply or remove animations. Example: {action:\"add-animation\",componentUuid:\"abc\",nodeRef:\"banner\",seqRef:\"fadeIn\",duration:\"0.3s\"} → {success:true}\n" +
        "- apply-pattern: Insert a named UI pattern (hero, card, navbar, etc.) into the tree. Use inspect.list-patterns to see available patterns. Supports text customisations. Example: {action:\"apply-pattern\",componentUuid:\"abc\",parentRef:\"root\",patternName:\"hero-centered\",customisations:{headingText:\"Ship faster\",ctaLabel:\"Get started\"}}\n" +
        "Layout guidance: use flexDirection:column for vertical stacks, flexDirection:row for horizontal layouts, display:grid + gridTemplateColumns for equal-width columns or complex 2D layouts. Prefer flex for single-axis flow, grid for multi-column/row alignment. Consider using a reusable component instead of raw tags for repeated patterns.\n" +
        "Use inspect tool for read-only queries.",
      inputSchema: {
      action: z.enum([
        "add", "remove", "move", "clone", "reorder",
        "update-styles", "update-text", "update-rich-text", "update-attrs", "update-props",
        "set-visibility", "set-image", "apply-mixin", "detach-mixin",
        "add-animation", "remove-animation", "apply-pattern",
      ]),
      componentUuid: z.string().optional().describe("UUID of the component"),
      nodeRef: z.string().optional().describe("Node reference: UUID, name, path, or index"),
      parentRef: z.string().optional().describe("Parent node reference (for add, reorder, clone)"),
      newParentRef: z.string().optional().describe("New parent reference (for move)"),
      child: PlasmicElementSchema.optional().describe("PlasmicElement JSON for add action"),
      position: z.union([z.string(), z.number()]).optional().describe("Insert position: 'first', 'last', or index"),
      slot: z.string().optional().describe("Target slot name on component instance"),
      newName: z.string().optional().describe("Name for cloned node"),
      childRefs: z.array(z.string()).optional().describe("Ordered child refs for reorder"),
      styles: z.record(z.string()).optional().describe("CSS styles in camelCase"),
      text: z.string().optional().describe("Text content or expression"),
      marks: z.array(z.object({
        start: z.number(),
        end: z.number(),
        type: z.enum(["bold", "italic", "underline", "strikethrough", "link", "code"]),
        href: z.string().optional(),
      })).optional().describe("Rich text formatting marks"),
      attrs: z.record(z.any()).optional().describe("HTML attributes to set"),
      props: z.record(z.any()).optional().describe("Component props to set (scalar, $expr, {{expr}}, PlasmicElement for slots, null to remove)"),
      variant: z.string().optional().describe("Target variant by name, UUID, or selector"),
      dynamic: z.boolean().optional().describe("Create dynamic text expression"),
      fallback: z.string().optional().describe("Fallback for dynamic text"),
      html: z.boolean().optional().describe("Render dynamic text as HTML"),
      visible: z.union([z.boolean(), z.literal("displayNone"), z.literal("hidden")]).optional().describe("Visibility: true (visible), false (not rendered — removed from DOM), 'hidden' or 'displayNone' (CSS display:none — hidden but stays in DOM)"),
      assetRef: z.string().optional().describe("Image asset reference for set-image"),
      src: z.string().optional().describe("Raw image URL for set-image"),
      mixinRef: z.string().optional().describe("Mixin reference for apply/detach"),
      seqRef: z.string().optional().describe("Animation sequence reference"),
      duration: z.string().optional().describe("Animation duration"),
      delay: z.string().optional().describe("Animation delay"),
      timingFunction: z.string().optional().describe("Animation timing function"),
      iterationCount: z.string().optional().describe("Animation iteration count"),
      direction: z.enum(["normal", "reverse", "alternate", "alternate-reverse"]).optional().describe("Animation direction"),
      fillMode: z.enum(["none", "forwards", "backwards", "both"]).optional().describe("Animation fill mode"),
      playState: z.enum(["paused", "running"]).optional().describe("Animation play state"),
      animationIndex: z.number().optional().describe("Animation index for removal"),
      patternName: z.string().optional().describe("Pattern name for apply-pattern action (use inspect.list-patterns to see available patterns)"),
      customisations: z.record(z.string()).optional().describe("Text customisations for apply-pattern (e.g. {headingText:\"Ship faster\"})"),
      dryRun: z.boolean().optional().describe("Preview changes without persisting"),
      },
      annotations: { destructiveHint: true },
    },
    async (params) => {
      const { action } = params;
      const callId = randomUUID();
      registerCall(callId);
      setCurrentCallId(callId);
      try {
        // Emit presence for node-level operations (arena + selection)
        if (params.componentUuid) {
          emitEditPresence(params.componentUuid, params.nodeRef ?? params.parentRef);
        }

        switch (action) {
          case "add": {
            const cuuid = requireParam(params.componentUuid, "componentUuid", "node.add");
            const pRef = requireParam(params.parentRef, "parentRef", "node.add");
            const childBody = requireParam(params.child, "child", "node.add");

            if (params.dryRun) {
              const result = await withDryRun(() =>
                addChild(apiClient, cuuid, pRef, childBody, params.position, params.slot)
              );
              return {
                content: [
                  {
                    type: "text" as const,
                    text: JSON.stringify(
                      {
                        dryRun: true,
                        parent: result.parentName ?? result.parentUuid,
                        ...(result.slotName ? { slot: result.slotName } : {}),
                        position: result.position,
                        message: "Dry run: no changes persisted",
                        ...(result.warnings?.length ? { warnings: result.warnings } : {}),
                        ...(result.note ? { note: result.note } : {}),
                        ...(result.defaults ? { defaults: result.defaults } : {}),
                      }
                    ),
                  },
                ],
              };
            }

            const result = await addChild(
              apiClient, cuuid, pRef, childBody, params.position, params.slot
            );
            // Structural edit: invalidate node resolver cache for this component
            invalidateNodeCache(cuuid);
            return {
              content: [
                {
                  type: "text" as const,
                  text: JSON.stringify(
                    {
                      success: true,
                      parent: result.parentName ?? result.parentUuid,
                      ...(result.slotName ? { slot: result.slotName } : {}),
                      position: result.position,
                      revision: result.save.revisionNum,
                      ...(result.warnings?.length ? { warnings: result.warnings } : {}),
                      ...(result.note ? { note: result.note } : {}),
                      ...(result.defaults ? { defaults: result.defaults } : {}),
                    }
                  ),
                },
              ],
            };
          }

          case "remove": {
            const cuuid = requireParam(params.componentUuid, "componentUuid", "node.remove");
            const nref = requireParam(params.nodeRef, "nodeRef", "node.remove");

            if (params.dryRun) {
              const result = await withDryRun(() =>
                removeChild(apiClient, cuuid, nref)
              );
              return {
                content: [
                  {
                    type: "text" as const,
                    text: JSON.stringify(
                      {
                        dryRun: true,
                        removed: result.removedName ?? result.removedUuid,
                        message: "Dry run: no changes persisted",
                      }
                    ),
                  },
                ],
              };
            }

            const result = await removeChild(apiClient, cuuid, nref);
            invalidateNodeCache(cuuid);
            return {
              content: [
                {
                  type: "text" as const,
                  text: JSON.stringify(
                    {
                      success: true,
                      removed: result.removedName ?? result.removedUuid,
                      revision: result.save.revisionNum,
                    }
                  ),
                },
              ],
            };
          }

          case "move": {
            const cuuid = requireParam(params.componentUuid, "componentUuid", "node.move");
            const nref = requireParam(params.nodeRef, "nodeRef", "node.move");
            const npRef = requireParam(params.newParentRef, "newParentRef", "node.move");

            if (params.dryRun) {
              const result = await withDryRun(() =>
                moveChild(apiClient, cuuid, nref, npRef, params.position, params.slot)
              );
              return {
                content: [
                  {
                    type: "text" as const,
                    text: JSON.stringify(
                      {
                        dryRun: true,
                        moved: result.movedName ?? result.movedUuid,
                        newParent: result.newParentName ?? result.newParentUuid,
                        ...(result.slotName ? { slot: result.slotName } : {}),
                        position: result.position,
                        message: "Dry run: no changes persisted",
                      }
                    ),
                  },
                ],
              };
            }

            const result = await moveChild(
              apiClient, cuuid, nref, npRef, params.position, params.slot
            );
            invalidateNodeCache(cuuid);
            return {
              content: [
                {
                  type: "text" as const,
                  text: JSON.stringify(
                    {
                      success: true,
                      moved: result.movedName ?? result.movedUuid,
                      newParent: result.newParentName ?? result.newParentUuid,
                      ...(result.slotName ? { slot: result.slotName } : {}),
                      position: result.position,
                      revision: result.save.revisionNum,
                    }
                  ),
                },
              ],
            };
          }

          case "clone": {
            const cuuid = requireParam(params.componentUuid, "componentUuid", "node.clone");
            const nref = requireParam(params.nodeRef, "nodeRef", "node.clone");

            if (params.dryRun) {
              const result = await withDryRun(() =>
                cloneChild(apiClient, cuuid, nref, params.newName, params.parentRef, params.position, params.slot)
              );
              return {
                content: [
                  {
                    type: "text" as const,
                    text: JSON.stringify(
                      {
                        dryRun: true,
                        cloned: result.clonedName ?? result.clonedUuid,
                        clonedUuid: result.clonedUuid,
                        originalUuid: result.originalUuid,
                        ...(result.slotName ? { slot: result.slotName } : {}),
                        message: "Dry run: no changes persisted",
                      }
                    ),
                  },
                ],
              };
            }

            const result = await cloneChild(
              apiClient, cuuid, nref, params.newName, params.parentRef, params.position, params.slot
            );
            invalidateNodeCache(cuuid);
            return {
              content: [
                {
                  type: "text" as const,
                  text: JSON.stringify(
                    {
                      success: true,
                      cloned: result.clonedName ?? result.clonedUuid,
                      clonedUuid: result.clonedUuid,
                      originalUuid: result.originalUuid,
                      ...(result.slotName ? { slot: result.slotName } : {}),
                      revision: result.save.revisionNum,
                    }
                  ),
                },
              ],
            };
          }

          case "reorder": {
            const cuuid = requireParam(params.componentUuid, "componentUuid", "node.reorder");
            const pRef = requireParam(params.parentRef, "parentRef", "node.reorder");
            const cRefs = requireParam(params.childRefs, "childRefs", "node.reorder");

            if (params.dryRun) {
              const result = await withDryRun(() =>
                reorderChildren(apiClient, cuuid, pRef, cRefs)
              );
              return {
                content: [
                  {
                    type: "text" as const,
                    text: JSON.stringify(
                      {
                        dryRun: true,
                        newOrder: result.newOrder,
                        message: "Dry run: no changes persisted",
                      }
                    ),
                  },
                ],
              };
            }

            const result = await reorderChildren(apiClient, cuuid, pRef, cRefs);
            invalidateNodeCache(cuuid);
            return {
              content: [
                {
                  type: "text" as const,
                  text: JSON.stringify(
                    {
                      success: true,
                      parentName: result.parentName,
                      parentUuid: result.parentUuid,
                      newOrder: result.newOrder,
                      revision: result.save.revisionNum,
                    }
                  ),
                },
              ],
            };
          }

          case "update-styles": {
            const cuuid = requireParam(params.componentUuid, "componentUuid", "node.update-styles");
            const nref = requireParam(params.nodeRef, "nodeRef", "node.update-styles");
            const sty = requireParam(params.styles, "styles", "node.update-styles");

            if (params.dryRun) {
              const result = await withDryRun(() =>
                updateStyles(apiClient, cuuid, nref, sty, params.variant)
              );
              return {
                content: [
                  {
                    type: "text" as const,
                    text: JSON.stringify(
                      {
                        dryRun: true,
                        node: result.nodeName ?? result.nodeUuid,
                        updatedProperties: result.updatedProperties,
                        message: "Dry run: no changes persisted",
                        ...(result.note ? { note: result.note } : {}),
                      }
                    ),
                  },
                ],
              };
            }

            const result = await updateStyles(
              apiClient, cuuid, nref, sty, params.variant
            );
            return {
              content: [
                {
                  type: "text" as const,
                  text: JSON.stringify(
                    {
                      success: true,
                      node: result.nodeName ?? result.nodeUuid,
                      updatedProperties: result.updatedProperties,
                      revision: result.save.revisionNum,
                      ...(result.note ? { note: result.note } : {}),
                    }
                  ),
                },
              ],
            };
          }

          case "update-text": {
            const cuuid = requireParam(params.componentUuid, "componentUuid", "node.update-text");
            const nref = requireParam(params.nodeRef, "nodeRef", "node.update-text");
            const txt = requireParam(params.text, "text", "node.update-text");

            if (params.dryRun) {
              const result = await withDryRun(() =>
                updateText(apiClient, cuuid, nref, txt, params.variant, params.dynamic, params.fallback, params.html)
              );
              return {
                content: [
                  {
                    type: "text" as const,
                    text: JSON.stringify(
                      {
                        dryRun: true,
                        node: result.nodeName ?? result.nodeUuid,
                        previousText: result.previousText,
                        newText: result.newText,
                        ...(result.dynamic ? { dynamic: true } : {}),
                        ...(result.fallback != null ? { fallback: result.fallback } : {}),
                        message: "Dry run: no changes persisted",
                      }
                    ),
                  },
                ],
              };
            }

            const result = await updateText(apiClient, cuuid, nref, txt, params.variant, params.dynamic, params.fallback, params.html);
            return {
              content: [
                {
                  type: "text" as const,
                  text: JSON.stringify(
                    {
                      success: true,
                      node: result.nodeName ?? result.nodeUuid,
                      previousText: result.previousText,
                      newText: result.newText,
                      ...(result.dynamic ? { dynamic: true } : {}),
                      ...(result.fallback != null ? { fallback: result.fallback } : {}),
                      revision: result.save.revisionNum,
                    }
                  ),
                },
              ],
            };
          }

          case "update-rich-text": {
            const cuuid = requireParam(params.componentUuid, "componentUuid", "node.update-rich-text");
            const nref = requireParam(params.nodeRef, "nodeRef", "node.update-rich-text");
            const txt = requireParam(params.text, "text", "node.update-rich-text");
            const mrks = requireParam(params.marks, "marks", "node.update-rich-text");

            if (params.dryRun) {
              const result = await withDryRun(() =>
                updateRichText(apiClient, cuuid, nref, txt, mrks, params.variant)
              );
              return {
                content: [
                  {
                    type: "text" as const,
                    text: JSON.stringify(
                      {
                        dryRun: true,
                        node: result.nodeName ?? result.nodeUuid,
                        previousText: result.previousText,
                        newText: result.newText,
                        markCount: result.markCount,
                        message: "Dry run: no changes persisted",
                      }
                    ),
                  },
                ],
              };
            }

            const result = await updateRichText(apiClient, cuuid, nref, txt, mrks, params.variant);
            return {
              content: [
                {
                  type: "text" as const,
                  text: JSON.stringify(
                    {
                      success: true,
                      node: result.nodeName ?? result.nodeUuid,
                      previousText: result.previousText,
                      newText: result.newText,
                      markCount: result.markCount,
                      revision: result.save.revisionNum,
                    }
                  ),
                },
              ],
            };
          }

          case "update-attrs": {
            const cuuid = requireParam(params.componentUuid, "componentUuid", "node.update-attrs");
            const nref = requireParam(params.nodeRef, "nodeRef", "node.update-attrs");
            const at = requireParam(params.attrs, "attrs", "node.update-attrs");

            if (params.dryRun) {
              const result = await withDryRun(() =>
                updateAttrs(apiClient, cuuid, nref, at, params.variant)
              );
              return {
                content: [
                  {
                    type: "text" as const,
                    text: JSON.stringify(
                      {
                        dryRun: true,
                        node: result.nodeName ?? result.nodeUuid,
                        updatedAttributes: result.updatedAttributes,
                        removedAttributes: result.removedAttributes,
                        message: "Dry run: no changes persisted",
                        ...(result.warnings?.length ? { warnings: result.warnings } : {}),
                      }
                    ),
                  },
                ],
              };
            }

            const result = await updateAttrs(
              apiClient, cuuid, nref, at, params.variant
            );
            return {
              content: [
                {
                  type: "text" as const,
                  text: JSON.stringify(
                    {
                      success: true,
                      node: result.nodeName ?? result.nodeUuid,
                      updatedAttributes: result.updatedAttributes,
                      removedAttributes: result.removedAttributes,
                      revision: result.save.revisionNum,
                      ...(result.warnings?.length ? { warnings: result.warnings } : {}),
                    }
                  ),
                },
              ],
            };
          }

          case "update-props": {
            const cuuid = requireParam(params.componentUuid, "componentUuid", "node.update-props");
            const nref = requireParam(params.nodeRef, "nodeRef", "node.update-props");
            const pr = requireParam(params.props, "props", "node.update-props");

            if (params.dryRun) {
              const result = await withDryRun(() =>
                updateProps(apiClient, cuuid, nref, pr, params.variant)
              );
              return {
                content: [
                  {
                    type: "text" as const,
                    text: JSON.stringify(
                      {
                        dryRun: true,
                        node: result.nodeName ?? result.nodeUuid,
                        updatedProps: result.updatedProps,
                        removedProps: result.removedProps,
                        message: "Dry run: no changes persisted",
                        ...(result.warnings?.length ? { warnings: result.warnings } : {}),
                      }
                    ),
                  },
                ],
              };
            }

            const result = await updateProps(
              apiClient, cuuid, nref, pr, params.variant
            );
            return {
              content: [
                {
                  type: "text" as const,
                  text: JSON.stringify(
                    {
                      success: true,
                      node: result.nodeName ?? result.nodeUuid,
                      updatedProps: result.updatedProps,
                      removedProps: result.removedProps,
                      revision: result.save.revisionNum,
                      ...(result.warnings?.length ? { warnings: result.warnings } : {}),
                    }
                  ),
                },
              ],
            };
          }

          case "set-visibility": {
            const cuuid = requireParam(params.componentUuid, "componentUuid", "node.set-visibility");
            const nref = requireParam(params.nodeRef, "nodeRef", "node.set-visibility");
            const vis = requireParam(params.visible, "visible", "node.set-visibility");

            if (params.dryRun) {
              const result = await withDryRun(() =>
                setVisibility(apiClient, cuuid, nref, vis, params.variant)
              );
              return {
                content: [
                  {
                    type: "text" as const,
                    text: JSON.stringify(
                      {
                        dryRun: true,
                        node: result.nodeName ?? result.nodeUuid,
                        previousVisibility: result.previousVisibility,
                        newVisibility: result.newVisibility,
                        message: "Dry run: no changes persisted",
                        ...(result.note ? { note: result.note } : {}),
                      }
                    ),
                  },
                ],
              };
            }

            const result = await setVisibility(
              apiClient, cuuid, nref, vis, params.variant
            );
            return {
              content: [
                {
                  type: "text" as const,
                  text: JSON.stringify(
                    {
                      success: true,
                      node: result.nodeName ?? result.nodeUuid,
                      previousVisibility: result.previousVisibility,
                      newVisibility: result.newVisibility,
                      revision: result.save.revisionNum,
                      ...(result.note ? { note: result.note } : {}),
                    }
                  ),
                },
              ],
            };
          }

          case "set-image": {
            const cuuid = requireParam(params.componentUuid, "componentUuid", "node.set-image");
            const nref = requireParam(params.nodeRef, "nodeRef", "node.set-image");

            if (!params.assetRef && !params.src) {
              return {
                content: [
                  {
                    type: "text" as const,
                    text: JSON.stringify(
                      {
                        error: true,
                        message:
                          "At least one of 'assetRef' or 'src' must be provided.",
                      }
                    ),
                  },
                ],
                isError: true,
              };
            }

            if (params.dryRun) {
              const result = await withDryRun(() =>
                setImage(apiClient, cuuid, nref, { assetRef: params.assetRef, src: params.src }, params.variant)
              );
              return {
                content: [
                  {
                    type: "text" as const,
                    text: JSON.stringify(
                      {
                        dryRun: true,
                        node: result.nodeName ?? result.nodeUuid,
                        imageSource: result.imageSource,
                        message: "Dry run: no changes persisted",
                      }
                    ),
                  },
                ],
              };
            }

            const result = await setImage(
              apiClient, cuuid, nref,
              { assetRef: params.assetRef, src: params.src },
              params.variant
            );
            return {
              content: [
                {
                  type: "text" as const,
                  text: JSON.stringify(
                    {
                      success: true,
                      node: result.nodeName ?? result.nodeUuid,
                      imageSource: result.imageSource,
                      revision: result.save.revisionNum,
                    }
                  ),
                },
              ],
            };
          }

          case "apply-mixin": {
            const cuuid = requireParam(params.componentUuid, "componentUuid", "node.apply-mixin");
            const nref = requireParam(params.nodeRef, "nodeRef", "node.apply-mixin");
            const mref = requireParam(params.mixinRef, "mixinRef", "node.apply-mixin");

            if (params.dryRun) {
              const result = await withDryRun(() =>
                applyMixin(apiClient, cuuid, nref, mref)
              );
              return {
                content: [
                  {
                    type: "text" as const,
                    text: JSON.stringify(
                      {
                        dryRun: true,
                        mixinName: result.mixinName,
                        nodeUuid: result.nodeUuid,
                        message: "Dry run: no changes persisted",
                      }
                    ),
                  },
                ],
              };
            }

            const result = await applyMixin(apiClient, cuuid, nref, mref);
            return {
              content: [
                {
                  type: "text" as const,
                  text: JSON.stringify(
                    {
                      success: true,
                      mixinName: result.mixinName,
                      nodeUuid: result.nodeUuid,
                      revision: result.save.revisionNum,
                    }
                  ),
                },
              ],
            };
          }

          case "detach-mixin": {
            const cuuid = requireParam(params.componentUuid, "componentUuid", "node.detach-mixin");
            const nref = requireParam(params.nodeRef, "nodeRef", "node.detach-mixin");
            const mref = requireParam(params.mixinRef, "mixinRef", "node.detach-mixin");

            if (params.dryRun) {
              const result = await withDryRun(() =>
                detachMixin(apiClient, cuuid, nref, mref)
              );
              return {
                content: [
                  {
                    type: "text" as const,
                    text: JSON.stringify(
                      {
                        dryRun: true,
                        mixinName: result.mixinName,
                        nodeUuid: result.nodeUuid,
                        message: "Dry run: no changes persisted",
                      }
                    ),
                  },
                ],
              };
            }

            const result = await detachMixin(apiClient, cuuid, nref, mref);
            return {
              content: [
                {
                  type: "text" as const,
                  text: JSON.stringify(
                    {
                      success: true,
                      mixinName: result.mixinName,
                      nodeUuid: result.nodeUuid,
                      revision: result.save.revisionNum,
                    }
                  ),
                },
              ],
            };
          }

          case "add-animation": {
            const cuuid = requireParam(params.componentUuid, "componentUuid", "node.add-animation");
            const nref = requireParam(params.nodeRef, "nodeRef", "node.add-animation");
            const sref = requireParam(params.seqRef, "seqRef", "node.add-animation");

            if (params.dryRun) {
              const result = await withDryRun(() =>
                addNodeAnimation(apiClient, cuuid, nref, sref,
                  params.duration, params.delay, params.timingFunction,
                  params.iterationCount, params.direction, params.fillMode, params.playState)
              );
              return {
                content: [
                  {
                    type: "text" as const,
                    text: JSON.stringify(
                      {
                        dryRun: true,
                        sequenceName: result.sequenceName,
                        nodeUuid: result.nodeUuid,
                        message: "Dry run: no changes persisted",
                      }
                    ),
                  },
                ],
              };
            }

            const result = await addNodeAnimation(
              apiClient, cuuid, nref, sref,
              params.duration, params.delay, params.timingFunction,
              params.iterationCount, params.direction, params.fillMode, params.playState
            );
            return {
              content: [
                {
                  type: "text" as const,
                  text: JSON.stringify(
                    {
                      success: true,
                      sequenceName: result.sequenceName,
                      nodeUuid: result.nodeUuid,
                      revision: result.save.revisionNum,
                    }
                  ),
                },
              ],
            };
          }

          case "remove-animation": {
            const cuuid = requireParam(params.componentUuid, "componentUuid", "node.remove-animation");
            const nref = requireParam(params.nodeRef, "nodeRef", "node.remove-animation");

            if (params.dryRun) {
              const result = await withDryRun(() =>
                removeNodeAnimation(apiClient, cuuid, nref, params.seqRef, params.animationIndex)
              );
              return {
                content: [
                  {
                    type: "text" as const,
                    text: JSON.stringify(
                      {
                        dryRun: true,
                        removedCount: result.removedCount,
                        nodeUuid: result.nodeUuid,
                        message: "Dry run: no changes persisted",
                      }
                    ),
                  },
                ],
              };
            }

            const result = await removeNodeAnimation(apiClient, cuuid, nref, params.seqRef, params.animationIndex);
            return {
              content: [
                {
                  type: "text" as const,
                  text: JSON.stringify(
                    {
                      success: true,
                      removedCount: result.removedCount,
                      nodeUuid: result.nodeUuid,
                      revision: result.save.revisionNum,
                    }
                  ),
                },
              ],
            };
          }

          case "apply-pattern": {
            const cuuid = requireParam(params.componentUuid, "componentUuid", "node.apply-pattern");
            const pRef = requireParam(params.parentRef, "parentRef", "node.apply-pattern");
            const pName = requireParam(params.patternName, "patternName", "node.apply-pattern");

            const result = await applyPattern(
              apiClient, cuuid, pRef, pName, params.customisations, params.position
            );

            if (result.error) {
              return {
                content: [
                  {
                    type: "text" as const,
                    text: JSON.stringify(
                      {
                        success: false,
                        error: result.error,
                        nodesCreated: result.nodesCreated,
                        ...(result.warnings.length ? { warnings: result.warnings } : {}),
                      }
                    ),
                  },
                ],
              };
            }

            invalidateNodeCache(cuuid);
            return {
              content: [
                {
                  type: "text" as const,
                  text: JSON.stringify(
                    {
                      success: true,
                      rootNodeUuid: result.rootNodeUuid,
                      nodesCreated: result.nodesCreated,
                      ...(result.warnings.length ? { warnings: result.warnings } : {}),
                    }
                  ),
                },
              ],
            };
          }

          default:
            throw new Error(`Unknown action '${action}' for node tool.`);
        }
      } catch (err: unknown) {
        return handleMutationError(`node.${action}`, err, callId);
      } finally {
        setCurrentCallId(null);
        if (!isCallSettled(callId)) failCall(callId);
        clearEditPresence();
      }
    }
  );

  // ========================================================================
  // DOMAIN 5: variant (12 actions)
  // ========================================================================

  server.registerTool(
    "variant",
    {
      description: "Variant management for components and global variant groups.\n" +
        "Actions: list, create-style, create-group, list-global-groups, create-global-group, add-global, remove-global-group, rename-global, create-screen, update-screen, rename, remove.\n" +
        "- list: List all variants for a component. Example: {action:\"list\",componentUuid:\"abc\"} → {variants:[{uuid:\"v1\",name:\":hover\",type:\"style\"},{uuid:\"v2\",name:\"Small\",type:\"group\"}]}\n" +
        "- create-style: Create hover/focus/etc. style variant. Example: {action:\"create-style\",componentUuid:\"abc\",selector:\":hover\"} → {variantUuid:\"v1\",selector:\":hover\",scope:\"component\"}\n" +
        "- create-group: Create named variant group (Size, Theme, etc.). Example: {action:\"create-group\",componentUuid:\"abc\",name:\"Size\",type:\"single\",initialVariants:[\"Small\",\"Large\"]} → {groupUuid:\"g1\",variants:[{name:\"Small\"},{name:\"Large\"}]}\n" +
        "- list-global-groups: List global variant groups. Example: {action:\"list-global-groups\"} → {groups:[{uuid:\"gg1\",name:\"Screen\",variants:[...]}]}\n" +
        "- create-global-group: Create a global variant group. Example: {action:\"create-global-group\",name:\"Theme\",type:\"single\",initialVariants:[\"Light\",\"Dark\"]} → {groupUuid:\"gg1\"}\n" +
        "- add-global: Add variant to a global group. Example: {action:\"add-global\",groupRef:\"Theme\",name:\"High Contrast\"} → {variantUuid:\"gv1\"}\n" +
        "- remove-global-group: Remove entire global variant group\n" +
        "- rename-global: Rename a global variant\n" +
        "- create-screen: Create a screen variant (responsive breakpoint). Example: {action:\"create-screen\",name:\"Mobile\",maxWidth:768} → {variantUuid:\"sv1\",mediaQuery:\"(max-width:768px)\"}\n" +
        "- update-screen: Update screen variant breakpoint dimensions. Example: {action:\"update-screen\",variantRef:\"Mobile\",maxWidth:640} → {success:true}\n" +
        "- rename: Rename a variant (component or global). Example: {action:\"rename\",componentUuid:\"abc\",variantRef:\"v1\",newName:\":focus\"} → {success:true}\n" +
        "- remove: Remove a single variant (component or global). Example: {action:\"remove\",componentUuid:\"abc\",variantRef:\"v1\"} → {success:true}",
      inputSchema: {
      action: z.enum([
        "list", "create-style", "create-group",
        "list-global-groups", "create-global-group", "add-global",
        "remove-global-group", "rename-global",
        "create-screen", "update-screen", "rename", "remove",
      ]),
      componentUuid: z.string().optional().describe("UUID of the component"),
      selector: z.string().optional().describe("CSS pseudo-class selector for create-style"),
      nodeRef: z.string().optional().describe("Node reference to scope style variant"),
      name: z.string().optional().describe("Name for variant group or variant"),
      type: z.enum(["single", "multi", "toggle"]).optional().describe("Group type"),
      initialVariants: z.array(z.string()).optional().describe("Initial variant names"),
      groupRef: z.string().optional().describe("Group reference (UUID or name)"),
      variantRef: z.string().optional().describe("Variant reference (UUID or name)"),
      newName: z.string().optional().describe("New name for rename"),
      minWidth: z.number().optional().describe("Minimum viewport width in pixels for screen variants"),
      maxWidth: z.number().optional().describe("Maximum viewport width in pixels for screen variants"),
      },
      annotations: { destructiveHint: true },
    },
    async (params) => {
      const { action } = params;
      const callId = randomUUID();
      registerCall(callId);
      setCurrentCallId(callId);
      try {
        // Emit presence for variant operations on a specific component
        if (params.componentUuid) {
          emitEditPresence(params.componentUuid);
        }

        switch (action) {
          case "list": {
            const cuuid = requireParam(params.componentUuid, "componentUuid", "variant.list");
            const session = requireSession();
            const component = session.site.components?.find(
              (c: any) => c.uuid === cuuid
            );

            if (!component) {
              return {
                content: [
                  {
                    type: "text" as const,
                    text: `Component UUID "${cuuid}" not found. Use component tool with action 'list' to see available components.`,
                  },
                ],
                isError: true,
              };
            }

            const result = listVariants(session.site, component);

            return {
              content: [
                {
                  type: "text" as const,
                  text: JSON.stringify({
                    componentUuid: cuuid,
                    componentName: component.name,
                    ...result,
                  }),
                },
              ],
            };
          }

          case "create-style": {
            const cuuid = requireParam(params.componentUuid, "componentUuid", "variant.create-style");
            const sel = requireParam(params.selector, "selector", "variant.create-style");

            const result = await createStyleVariant(
              apiClient, cuuid, sel, params.nodeRef
            );
            return {
              content: [
                {
                  type: "text" as const,
                  text: JSON.stringify(
                    {
                      success: true,
                      variantUuid: result.variantUuid,
                      selector: result.selector,
                      scope: result.scope,
                      ...(result.forTplName
                        ? { element: result.forTplName }
                        : {}),
                      ...(result.forTplUuid
                        ? { elementUuid: result.forTplUuid }
                        : {}),
                      revision: result.save.revisionNum,
                      message: `Created ${result.selector} variant (${result.scope}-level)${result.forTplName ? ` on ${result.forTplName}` : ""}. Use update-styles with variant: "${result.selector}" to apply styles.`,
                    }
                  ),
                },
              ],
            };
          }

          case "create-group": {
            const cuuid = requireParam(params.componentUuid, "componentUuid", "variant.create-group");
            const gname = requireParam(params.name, "name", "variant.create-group");
            if (gname.length < 1) throw new Error("Group name is required");

            const result = await createVariantGroup(
              apiClient, cuuid, gname, params.type, params.initialVariants
            );
            return {
              content: [
                {
                  type: "text" as const,
                  text: JSON.stringify(
                    {
                      success: true,
                      groupUuid: result.groupUuid,
                      groupName: result.groupName,
                      type: result.type,
                      variants: result.variants,
                      ...(result.linkedState ? { linkedState: result.linkedState } : {}),
                      revision: result.save.revisionNum,
                      message: result.linkedState
                        ? `Created toggle variant group "${result.groupName}" with linked state "${result.linkedState.name}". Use interaction.add with updateVariable targeting "${result.linkedState.name}" to toggle this variant.`
                        : `Created variant group "${result.groupName}" (${result.type}) with ${result.variants.length} variant(s). Use update-styles/update-text with variant names to apply overrides.`,
                    }
                  ),
                },
              ],
            };
          }

          case "list-global-groups": {
            const result = listGlobalVariantGroups();
            return {
              content: [
                {
                  type: "text" as const,
                  text: JSON.stringify(result),
                },
              ],
            };
          }

          case "create-global-group": {
            const gname = requireParam(params.name, "name", "variant.create-global-group");
            if (params.type === "toggle") {
              throw new Error(
                `Invalid type "toggle" for variant.create-global-group. Global variant groups support "single" or "multi" only.`
              );
            }
            const result = await createGlobalVariantGroup(apiClient, gname, params.type, params.initialVariants);
            return {
              content: [
                {
                  type: "text" as const,
                  text: JSON.stringify(
                    {
                      success: true,
                      group: result.group,
                      revision: result.save.revisionNum,
                    }
                  ),
                },
              ],
            };
          }

          case "add-global": {
            const gref = requireParam(params.groupRef, "groupRef", "variant.add-global");
            const vname = requireParam(params.name, "name", "variant.add-global");
            const result = await addGlobalVariant(apiClient, gref, vname);
            return {
              content: [
                {
                  type: "text" as const,
                  text: JSON.stringify(
                    {
                      success: true,
                      variant: result.variant,
                      revision: result.save.revisionNum,
                    }
                  ),
                },
              ],
            };
          }

          case "remove-global-group": {
            const gref = requireParam(params.groupRef, "groupRef", "variant.remove-global-group");
            const result = await removeGlobalVariantGroup(apiClient, gref);
            return {
              content: [
                {
                  type: "text" as const,
                  text: JSON.stringify(
                    {
                      success: true,
                      removedName: result.removedName,
                      removedUuid: result.removedUuid,
                      revision: result.save.revisionNum,
                    }
                  ),
                },
              ],
            };
          }

          case "rename-global": {
            const vref = requireParam(params.variantRef, "variantRef", "variant.rename-global");
            const nn = requireParam(params.newName, "newName", "variant.rename-global");
            const result = await renameGlobalVariant(apiClient, vref, nn);
            return {
              content: [
                {
                  type: "text" as const,
                  text: JSON.stringify(
                    {
                      success: true,
                      oldName: result.oldName,
                      newName: result.newName,
                      revision: result.save.revisionNum,
                    }
                  ),
                },
              ],
            };
          }

          case "create-screen": {
            const screenName = requireParam(params.name, "name", "variant.create-screen");
            const result = await createScreenVariantAction(
              apiClient, screenName, params.minWidth, params.maxWidth
            );
            return {
              content: [
                {
                  type: "text" as const,
                  text: JSON.stringify(
                    {
                      success: true,
                      variantUuid: result.variantUuid,
                      name: result.name,
                      mediaQuery: result.mediaQuery,
                      revision: result.save.revisionNum,
                      message: `Created screen variant "${result.name}" with breakpoint ${result.mediaQuery}.`,
                    }
                  ),
                },
              ],
            };
          }

          case "update-screen": {
            const vref = requireParam(params.variantRef, "variantRef", "variant.update-screen");
            const result = await updateScreenVariant(apiClient, vref, params.minWidth, params.maxWidth);
            return {
              content: [
                {
                  type: "text" as const,
                  text: JSON.stringify(
                    {
                      success: true,
                      variantUuid: result.variantUuid,
                      name: result.name,
                      mediaQuery: result.mediaQuery,
                      revision: result.save.revisionNum,
                      message: `Updated screen variant "${result.name}" to ${result.mediaQuery}.`,
                    }
                  ),
                },
              ],
            };
          }

          case "rename": {
            const vref = requireParam(params.variantRef, "variantRef", "variant.rename");
            const nn = requireParam(params.newName, "newName", "variant.rename");
            const result = await renameVariantAction(apiClient, vref, nn, params.componentUuid);
            return {
              content: [
                {
                  type: "text" as const,
                  text: JSON.stringify(
                    {
                      success: true,
                      oldName: result.oldName,
                      newName: result.newName,
                      variantUuid: result.variantUuid,
                      revision: result.save.revisionNum,
                    }
                  ),
                },
              ],
            };
          }

          case "remove": {
            const vref = requireParam(params.variantRef, "variantRef", "variant.remove");
            const result = await removeVariantAction(apiClient, vref, params.componentUuid);
            return {
              content: [
                {
                  type: "text" as const,
                  text: JSON.stringify(
                    {
                      success: true,
                      removedName: result.removedName,
                      removedUuid: result.removedUuid,
                      revision: result.save.revisionNum,
                    }
                  ),
                },
              ],
            };
          }

          default:
            throw new Error(`Unknown action '${action}' for variant tool.`);
        }
      } catch (err: unknown) {
        if (["create-style", "create-group", "create-global-group", "add-global", "remove-global-group", "rename-global", "create-screen", "update-screen", "rename", "remove"].includes(action)) {
          return handleMutationError(`variant.${action}`, err, callId);
        }
        return {
          content: [
            {
              type: "text" as const,
              text: `Error in variant.${action}: ${errorMessage(err)}`,
            },
          ],
          isError: true,
        };
      } finally {
        setCurrentCallId(null);
        if (!isCallSettled(callId)) failCall(callId);
        clearEditPresence();
      }
    }
  );

  // ========================================================================
  // DOMAIN 6: design (22 actions)
  // ========================================================================

  server.registerTool(
    "design",
    {
      description: "Site-level design system management: tokens, mixins, animations, themes, assets.\n" +
        "Actions: list-tokens, create-token, update-token, remove-token, duplicate-token, " +
        "list-mixins, create-mixin, update-mixin, remove-mixin, " +
        "list-animations, create-animation, update-animation, remove-animation, " +
        "list-themes, create-theme, update-theme, remove-theme, set-active-theme, " +
        "list-assets, upload-asset, rename-asset, remove-asset.\n" +
        "Tokens: design system values (colors, spacing, fonts). Example: {action:\"list-tokens\"} → {tokenCount:5,tokens:{Color:[{name:\"Primary\",value:\"#3B82F6\"},...]}}\n" +
        "- create-token: Example: {action:\"create-token\",name:\"Primary\",tokenType:\"Color\",value:\"#3B82F6\"} → {tokenUuid:\"t1\",name:\"Primary\",tokenType:\"Color\",value:\"#3B82F6\"}\n" +
        "- update-token: Example: {action:\"update-token\",tokenRef:\"Primary\",value:\"#2563EB\"} → {success:true}\n" +
        "- remove-token: Example: {action:\"remove-token\",tokenRef:\"Primary\"} → {success:true}\n" +
        "Mixins: reusable style bundles. Example: {action:\"list-mixins\"} → {mixins:[{uuid:\"m1\",name:\"Card Shadow\",styles:{boxShadow:\"0 2px 4px rgba(0,0,0,0.1)\"}}]}\n" +
        "- create-mixin: Example: {action:\"create-mixin\",name:\"Card Shadow\",styles:{boxShadow:\"0 2px 4px rgba(0,0,0,0.1)\"}} → {mixinUuid:\"m1\",name:\"Card Shadow\"}\n" +
        "Animations: @keyframes definitions. Example: {action:\"create-animation\",name:\"fadeIn\",keyframes:[{percentage:0,styles:{opacity:\"0\"}},{percentage:100,styles:{opacity:\"1\"}}]} → {seqUuid:\"a1\"}\n" +
        "Themes: typography defaults and per-tag overrides. Example: {action:\"create-theme\",name:\"Base\",defaultStyles:{fontFamily:\"Inter\",fontSize:\"16px\"},setActive:true} → {themeIndex:0}\n" +
        "Assets: image and icon management. Example: {action:\"upload-asset\",name:\"logo\",url:\"https://example.com/logo.png\",assetType:\"picture\"} → {assetUuid:\"img1\"}\n" +
        "Design System First: before setting raw CSS values, call inspect.list-design-system or list-tokens to check for existing design tokens. Prefer token references (token:TokenName in update-styles) over raw values when matching tokens exist. Raw CSS values are always valid — tokens are preferred, not required.",
      inputSchema: {
      action: z.enum([
        "list-tokens", "create-token", "update-token", "remove-token", "duplicate-token",
        "list-mixins", "create-mixin", "update-mixin", "remove-mixin",
        "list-animations", "create-animation", "update-animation", "remove-animation",
        "list-themes", "create-theme", "update-theme", "remove-theme", "set-active-theme",
        "list-assets", "upload-asset", "rename-asset", "remove-asset",
      ]),
      // Token params
      tokenRef: z.string().optional().describe("Token reference (name or UUID)"),
      tokenType: z.enum(["Color", "Spacing", "Opacity", "LineHeight", "FontFamily", "FontSize"]).optional().describe("Token type filter or creation type"),
      value: z.string().optional().describe("Token value or CSS value"),
      name: z.string().optional().describe("Name for create/rename operations"),
      newName: z.string().optional().describe("New name for update/rename operations"),
      // Mixin params
      mixinRef: z.string().optional().describe("Mixin reference (name or UUID)"),
      styles: z.record(z.string()).optional().describe("CSS styles in camelCase format"),
      // Animation params
      seqRef: z.string().optional().describe("Animation sequence reference (name or UUID)"),
      keyframes: z.array(z.object({
        percentage: z.number().describe("Keyframe stop percentage (0-100)"),
        styles: z.record(z.string()).describe("CSS styles at this keyframe stop"),
      })).optional().describe("Keyframes array for animation sequences"),
      // Theme params
      themeIndex: z.number().nullable().optional().describe("Theme index (from list-themes)"),
      defaultStyles: z.record(z.string()).optional().describe("Default typography CSS styles"),
      themeStyles: z.array(z.object({
        selector: z.string().describe("HTML tag selector"),
        styles: z.record(z.string()).describe("CSS styles for selector"),
      })).optional().describe("Per-tag style overrides"),
      setActive: z.boolean().optional().describe("Set new theme as active"),
      // Asset params
      assetRef: z.string().optional().describe("Asset reference (UUID or name)"),
      assetType: z.enum(["picture", "icon"]).optional().describe("Asset type filter or creation type"),
      url: z.string().optional().describe("URL to fetch image from"),
      dataUri: z.string().optional().describe("Inline data URI"),
      width: z.number().optional().describe("Image width in pixels"),
      height: z.number().optional().describe("Image height in pixels"),
      // Common
      dryRun: z.boolean().optional().describe("Preview changes without persisting"),
      },
      annotations: { destructiveHint: true },
    },
    async (params) => {
      const { action } = params;
      const callId = randomUUID();
      registerCall(callId);
      setCurrentCallId(callId);
      try {
        switch (action) {
          // ── Tokens ──

          case "list-tokens": {
            const session = requireSession();
            const tokensResult = readTokens(session.site.styleTokens, params.tokenType);

            // Enrich with dev host registered tokens when available
            const regTokens = session.registryData?.tokens;
            let devHostTokens: Array<Record<string, unknown>> | undefined;
            if (Array.isArray(regTokens) && regTokens.length > 0) {
              const filtered = params.tokenType
                ? regTokens.filter((t) => t.type === params.tokenType)
                : regTokens;
              if (filtered.length > 0) {
                devHostTokens = filtered.map((t) => ({
                  name: t.name,
                  value: t.value,
                  type: t.type,
                  ...(t.displayName && { displayName: t.displayName }),
                  ...(t.selector && { selector: t.selector }),
                }));
              }
            }

            const result = devHostTokens
              ? { ...tokensResult, devHostTokens }
              : tokensResult;

            return {
              content: [
                { type: "text" as const, text: JSON.stringify(result) },
              ],
            };
          }

          case "create-token": {
            const tName = requireParam(params.name, "name", "design.create-token");
            const tType = requireParam(params.tokenType, "tokenType", "design.create-token");
            const tValue = requireParam(params.value, "value", "design.create-token");

            if (params.dryRun) {
              const result = await withDryRun(() =>
                createToken(apiClient, tName, tType, tValue)
              );
              return {
                content: [
                  {
                    type: "text" as const,
                    text: JSON.stringify(
                      {
                        dryRun: true,
                        name: result.name,
                        tokenType: result.type,
                        value: result.value,
                        message: "Dry run: no changes persisted",
                      }
                    ),
                  },
                ],
              };
            }

            const result = await createToken(apiClient, tName, tType, tValue);
            return {
              content: [
                {
                  type: "text" as const,
                  text: JSON.stringify(
                    {
                      success: true,
                      tokenUuid: result.tokenUuid,
                      name: result.name,
                      tokenType: result.type,
                      value: result.value,
                      revision: result.save.revisionNum,
                    }
                  ),
                },
              ],
            };
          }

          case "update-token": {
            const tRef = requireParam(params.tokenRef, "tokenRef", "design.update-token");

            if (params.value === undefined && !params.name) {
              return {
                content: [
                  {
                    type: "text" as const,
                    text: JSON.stringify(
                      {
                        error: true,
                        message:
                          "At least one of 'value' or 'name' must be provided.",
                      }
                    ),
                  },
                ],
                isError: true,
              };
            }

            if (params.dryRun) {
              const result = await withDryRun(() =>
                updateToken(apiClient, tRef, params.value, params.name)
              );
              return {
                content: [
                  {
                    type: "text" as const,
                    text: JSON.stringify(
                      {
                        dryRun: true,
                        tokenUuid: result.tokenUuid,
                        name: result.name,
                        previousName: result.previousName,
                        previousValue: result.previousValue,
                        value: result.value,
                        message: "Dry run: no changes persisted",
                      }
                    ),
                  },
                ],
              };
            }

            const result = await updateToken(apiClient, tRef, params.value, params.name);
            return {
              content: [
                {
                  type: "text" as const,
                  text: JSON.stringify(
                    {
                      success: true,
                      tokenUuid: result.tokenUuid,
                      name: result.name,
                      previousName: result.previousName,
                      previousValue: result.previousValue,
                      value: result.value,
                      revision: result.save.revisionNum,
                    }
                  ),
                },
              ],
            };
          }

          case "remove-token": {
            const tRef = requireParam(params.tokenRef, "tokenRef", "design.remove-token");

            if (params.dryRun) {
              const result = await withDryRun(() =>
                removeToken(apiClient, tRef)
              );
              return {
                content: [
                  {
                    type: "text" as const,
                    text: JSON.stringify(
                      {
                        dryRun: true,
                        tokenUuid: result.tokenUuid,
                        name: result.name,
                        inlinedCount: result.inlinedCount,
                        message: "Dry run: no changes persisted",
                      }
                    ),
                  },
                ],
              };
            }

            const result = await removeToken(apiClient, tRef);
            return {
              content: [
                {
                  type: "text" as const,
                  text: JSON.stringify(
                    {
                      success: true,
                      tokenUuid: result.tokenUuid,
                      name: result.name,
                      inlinedCount: result.inlinedCount,
                      revision: result.save.revisionNum,
                    }
                  ),
                },
              ],
            };
          }

          case "duplicate-token": {
            const tRef = requireParam(params.tokenRef, "tokenRef", "design.duplicate-token");

            if (params.dryRun) {
              const result = await withDryRun(() =>
                duplicateToken(apiClient, tRef, params.newName)
              );
              return {
                content: [
                  {
                    type: "text" as const,
                    text: JSON.stringify(
                      {
                        dryRun: true,
                        tokenUuid: result.tokenUuid,
                        name: result.name,
                        sourceUuid: result.sourceUuid,
                        sourceName: result.sourceName,
                        value: result.value,
                        message: "Dry run: no changes persisted",
                      }
                    ),
                  },
                ],
              };
            }

            const result = await duplicateToken(apiClient, tRef, params.newName);
            return {
              content: [
                {
                  type: "text" as const,
                  text: JSON.stringify(
                    {
                      success: true,
                      tokenUuid: result.tokenUuid,
                      name: result.name,
                      sourceUuid: result.sourceUuid,
                      sourceName: result.sourceName,
                      value: result.value,
                      revision: result.save.revisionNum,
                    }
                  ),
                },
              ],
            };
          }

          // ── Mixins ──

          case "list-mixins": {
            const mixins = listMixins();
            return {
              content: [
                {
                  type: "text" as const,
                  text: JSON.stringify(
                    { mixinCount: mixins.length, mixins }
                  ),
                },
              ],
            };
          }

          case "create-mixin": {
            const mName = requireParam(params.name, "name", "design.create-mixin");

            if (params.dryRun) {
              const result = await withDryRun(() =>
                createMixin(apiClient, mName, params.styles)
              );
              return {
                content: [
                  {
                    type: "text" as const,
                    text: JSON.stringify(
                      {
                        dryRun: true,
                        mixinUuid: result.mixinUuid,
                        name: result.name,
                        message: "Dry run: no changes persisted",
                      }
                    ),
                  },
                ],
              };
            }

            const result = await createMixin(apiClient, mName, params.styles);
            return {
              content: [
                {
                  type: "text" as const,
                  text: JSON.stringify(
                    {
                      success: true,
                      mixinUuid: result.mixinUuid,
                      name: result.name,
                      revision: result.save.revisionNum,
                    }
                  ),
                },
              ],
            };
          }

          case "update-mixin": {
            const mRef = requireParam(params.mixinRef, "mixinRef", "design.update-mixin");
            if (params.newName === undefined && params.styles === undefined) {
              throw new Error("At least one of newName or styles must be provided for design.update-mixin");
            }

            if (params.dryRun) {
              const result = await withDryRun(() =>
                updateMixin(apiClient, mRef, params.newName, params.styles)
              );
              return {
                content: [
                  {
                    type: "text" as const,
                    text: JSON.stringify(
                      {
                        dryRun: true,
                        mixinUuid: result.mixinUuid,
                        name: result.name,
                        updatedFields: result.updatedFields,
                        message: "Dry run: no changes persisted",
                      }
                    ),
                  },
                ],
              };
            }

            const result = await updateMixin(apiClient, mRef, params.newName, params.styles);
            return {
              content: [
                {
                  type: "text" as const,
                  text: JSON.stringify(
                    {
                      success: true,
                      mixinUuid: result.mixinUuid,
                      name: result.name,
                      updatedFields: result.updatedFields,
                      revision: result.save.revisionNum,
                    }
                  ),
                },
              ],
            };
          }

          case "remove-mixin": {
            const mRef = requireParam(params.mixinRef, "mixinRef", "design.remove-mixin");

            if (params.dryRun) {
              const result = await withDryRun(() =>
                removeMixin(apiClient, mRef)
              );
              return {
                content: [
                  {
                    type: "text" as const,
                    text: JSON.stringify(
                      {
                        dryRun: true,
                        removedName: result.removedName,
                        removedUuid: result.removedUuid,
                        message: "Dry run: no changes persisted",
                      }
                    ),
                  },
                ],
              };
            }

            const result = await removeMixin(apiClient, mRef);
            return {
              content: [
                {
                  type: "text" as const,
                  text: JSON.stringify(
                    {
                      success: true,
                      removedName: result.removedName,
                      removedUuid: result.removedUuid,
                      revision: result.save.revisionNum,
                    }
                  ),
                },
              ],
            };
          }

          // ── Animations ──

          case "list-animations": {
            const sequences = listAnimationSequences();
            return {
              content: [
                {
                  type: "text" as const,
                  text: JSON.stringify(
                    { sequenceCount: sequences.length, sequences }
                  ),
                },
              ],
            };
          }

          case "create-animation": {
            const aName = requireParam(params.name, "name", "design.create-animation");

            if (params.dryRun) {
              const result = await withDryRun(() =>
                createAnimationSequence(apiClient, aName, params.keyframes)
              );
              return {
                content: [
                  {
                    type: "text" as const,
                    text: JSON.stringify(
                      {
                        dryRun: true,
                        sequenceUuid: result.sequenceUuid,
                        name: result.name,
                        message: "Dry run: no changes persisted",
                      }
                    ),
                  },
                ],
              };
            }

            const result = await createAnimationSequence(apiClient, aName, params.keyframes);
            return {
              content: [
                {
                  type: "text" as const,
                  text: JSON.stringify(
                    {
                      success: true,
                      sequenceUuid: result.sequenceUuid,
                      name: result.name,
                      revision: result.save.revisionNum,
                    }
                  ),
                },
              ],
            };
          }

          case "update-animation": {
            const sRef = requireParam(params.seqRef, "seqRef", "design.update-animation");
            if (params.newName === undefined && params.keyframes === undefined) {
              throw new Error("At least one of newName or keyframes must be provided for design.update-animation");
            }

            if (params.dryRun) {
              const result = await withDryRun(() =>
                updateAnimationSequence(apiClient, sRef, params.newName, params.keyframes)
              );
              return {
                content: [
                  {
                    type: "text" as const,
                    text: JSON.stringify(
                      {
                        dryRun: true,
                        sequenceUuid: result.sequenceUuid,
                        name: result.name,
                        updatedFields: result.updatedFields,
                        message: "Dry run: no changes persisted",
                      }
                    ),
                  },
                ],
              };
            }

            const result = await updateAnimationSequence(apiClient, sRef, params.newName, params.keyframes);
            return {
              content: [
                {
                  type: "text" as const,
                  text: JSON.stringify(
                    {
                      success: true,
                      sequenceUuid: result.sequenceUuid,
                      name: result.name,
                      updatedFields: result.updatedFields,
                      revision: result.save.revisionNum,
                    }
                  ),
                },
              ],
            };
          }

          case "remove-animation": {
            const sRef = requireParam(params.seqRef, "seqRef", "design.remove-animation");

            if (params.dryRun) {
              const result = await withDryRun(() =>
                removeAnimationSequence(apiClient, sRef)
              );
              return {
                content: [
                  {
                    type: "text" as const,
                    text: JSON.stringify(
                      {
                        dryRun: true,
                        removedName: result.removedName,
                        removedUuid: result.removedUuid,
                        message: "Dry run: no changes persisted",
                      }
                    ),
                  },
                ],
              };
            }

            const result = await removeAnimationSequence(apiClient, sRef);
            return {
              content: [
                {
                  type: "text" as const,
                  text: JSON.stringify(
                    {
                      success: true,
                      removedName: result.removedName,
                      removedUuid: result.removedUuid,
                      revision: result.save.revisionNum,
                    }
                  ),
                },
              ],
            };
          }

          // ── Themes ──

          case "list-themes": {
            const themes = listThemes();
            return {
              content: [
                {
                  type: "text" as const,
                  text: JSON.stringify(
                    { themeCount: themes.length, themes }
                  ),
                },
              ],
            };
          }

          case "create-theme": {
            if (params.dryRun) {
              const result = await withDryRun(() =>
                createTheme(apiClient, params.defaultStyles, params.themeStyles, params.setActive)
              );
              return {
                content: [
                  {
                    type: "text" as const,
                    text: JSON.stringify(
                      {
                        dryRun: true,
                        themeIndex: result.themeIndex,
                        message: "Dry run: no changes persisted",
                      }
                    ),
                  },
                ],
              };
            }

            const result = await createTheme(apiClient, params.defaultStyles, params.themeStyles, params.setActive);
            return {
              content: [
                {
                  type: "text" as const,
                  text: JSON.stringify(
                    {
                      success: true,
                      themeIndex: result.themeIndex,
                      revision: result.save.revisionNum,
                    }
                  ),
                },
              ],
            };
          }

          case "update-theme": {
            const tIdx = requireParam(params.themeIndex, "themeIndex", "design.update-theme");

            if (params.dryRun) {
              const result = await withDryRun(() =>
                updateTheme(apiClient, tIdx as number, params.defaultStyles, params.themeStyles)
              );
              return {
                content: [
                  {
                    type: "text" as const,
                    text: JSON.stringify(
                      {
                        dryRun: true,
                        themeIndex: result.themeIndex,
                        updatedFields: result.updatedFields,
                        message: "Dry run: no changes persisted",
                      }
                    ),
                  },
                ],
              };
            }

            const result = await updateTheme(apiClient, tIdx as number, params.defaultStyles, params.themeStyles);
            return {
              content: [
                {
                  type: "text" as const,
                  text: JSON.stringify(
                    {
                      success: true,
                      themeIndex: result.themeIndex,
                      updatedFields: result.updatedFields,
                      revision: result.save.revisionNum,
                    }
                  ),
                },
              ],
            };
          }

          case "remove-theme": {
            const tIdx = requireParam(params.themeIndex, "themeIndex", "design.remove-theme");

            if (params.dryRun) {
              const result = await withDryRun(() =>
                removeTheme(apiClient, tIdx as number)
              );
              return {
                content: [
                  {
                    type: "text" as const,
                    text: JSON.stringify(
                      {
                        dryRun: true,
                        removedIndex: result.removedIndex,
                        message: "Dry run: no changes persisted",
                      }
                    ),
                  },
                ],
              };
            }

            const result = await removeTheme(apiClient, tIdx as number);
            return {
              content: [
                {
                  type: "text" as const,
                  text: JSON.stringify(
                    {
                      success: true,
                      removedIndex: result.removedIndex,
                      revision: result.save.revisionNum,
                    }
                  ),
                },
              ],
            };
          }

          case "set-active-theme": {
            // themeIndex can be null (deactivate) or number
            if (params.themeIndex === undefined) {
              throw new Error("Missing required parameter 'themeIndex' for 'design.set-active-theme' action");
            }

            if (params.dryRun) {
              const result = await withDryRun(() =>
                setActiveTheme(apiClient, params.themeIndex as number | null)
              );
              return {
                content: [
                  {
                    type: "text" as const,
                    text: JSON.stringify(
                      {
                        dryRun: true,
                        activeThemeIndex: result.activeThemeIndex,
                        message: "Dry run: no changes persisted",
                      }
                    ),
                  },
                ],
              };
            }

            const result = await setActiveTheme(apiClient, params.themeIndex as number | null);
            return {
              content: [
                {
                  type: "text" as const,
                  text: JSON.stringify(
                    {
                      success: true,
                      activeThemeIndex: result.activeThemeIndex,
                      revision: result.save.revisionNum,
                    }
                  ),
                },
              ],
            };
          }

          // ── Assets ──

          case "list-assets": {
            const result = listAssets(params.assetType);
            return {
              content: [
                { type: "text" as const, text: JSON.stringify(result) },
              ],
            };
          }

          case "upload-asset": {
            const aName = requireParam(params.name, "name", "design.upload-asset");
            const aType = requireParam(params.assetType, "assetType", "design.upload-asset");

            if (params.dryRun) {
              const result = await withDryRun(() =>
                uploadAsset(apiClient, aName, aType, { url: params.url, dataUri: params.dataUri, width: params.width, height: params.height })
              );
              return {
                content: [
                  {
                    type: "text" as const,
                    text: JSON.stringify(
                      {
                        dryRun: true,
                        name: result.name,
                        assetType: result.type,
                        message: "Dry run: no changes persisted",
                      }
                    ),
                  },
                ],
              };
            }

            const result = await uploadAsset(apiClient, aName, aType, { url: params.url, dataUri: params.dataUri, width: params.width, height: params.height });
            return {
              content: [
                {
                  type: "text" as const,
                  text: JSON.stringify(
                    {
                      success: true,
                      assetUuid: result.assetUuid,
                      name: result.name,
                      assetType: result.type,
                      revision: result.save.revisionNum,
                    }
                  ),
                },
              ],
            };
          }

          case "rename-asset": {
            const aRef = requireParam(params.assetRef, "assetRef", "design.rename-asset");
            const nn = requireParam(params.newName, "newName", "design.rename-asset");

            if (params.dryRun) {
              const result = await withDryRun(() =>
                renameAsset(apiClient, aRef, nn)
              );
              return {
                content: [
                  {
                    type: "text" as const,
                    text: JSON.stringify(
                      {
                        dryRun: true,
                        oldName: result.oldName,
                        newName: result.newName,
                        message: "Dry run: no changes persisted",
                      }
                    ),
                  },
                ],
              };
            }

            const result = await renameAsset(apiClient, aRef, nn);
            return {
              content: [
                {
                  type: "text" as const,
                  text: JSON.stringify(
                    {
                      success: true,
                      assetUuid: result.assetUuid,
                      oldName: result.oldName,
                      newName: result.newName,
                      revision: result.save.revisionNum,
                    }
                  ),
                },
              ],
            };
          }

          case "remove-asset": {
            const aRef = requireParam(params.assetRef, "assetRef", "design.remove-asset");

            if (params.dryRun) {
              const result = await withDryRun(() =>
                removeAsset(apiClient, aRef)
              );
              return {
                content: [
                  {
                    type: "text" as const,
                    text: JSON.stringify(
                      {
                        dryRun: true,
                        removedName: result.removedName,
                        removedUuid: result.removedUuid,
                        message: "Dry run: no changes persisted",
                      }
                    ),
                  },
                ],
              };
            }

            const result = await removeAsset(apiClient, aRef);
            return {
              content: [
                {
                  type: "text" as const,
                  text: JSON.stringify(
                    {
                      success: true,
                      removedName: result.removedName,
                      removedUuid: result.removedUuid,
                      revision: result.save.revisionNum,
                    }
                  ),
                },
              ],
            };
          }

          default:
            throw new Error(`Unknown action '${action}' for design tool.`);
        }
      } catch (err: unknown) {
        if (["list-tokens", "list-mixins", "list-animations", "list-themes", "list-assets"].includes(action)) {
          return {
            content: [{ type: "text" as const, text: `Error in design.${action}: ${errorMessage(err)}` }],
            isError: true,
          };
        }
        return handleMutationError(`design.${action}`, err, callId);
      } finally {
        setCurrentCallId(null);
        if (!isCallSettled(callId)) failCall(callId);
      }
    }
  );

  // ========================================================================
  // DOMAIN 7: data (16 actions)
  // ========================================================================

  server.registerTool(
    "data",
    {
      description: "Data flow: conditions, repetition, queries, data tokens, splits, code introspection.\n" +
        "Actions: set-data-cond, set-data-rep, list-queries, add-query, update-query, remove-query, " +
        "list-data-tokens, create-data-token, update-data-token, remove-data-token, " +
        "list-splits, create-split, update-split, remove-split, get-code-meta, list-functions.\n" +
        "- set-data-cond: Conditional rendering expression (null to remove). Example: {action:\"set-data-cond\",componentUuid:\"abc\",nodeRef:\"banner\",condition:\"$ctx.showBanner === true\"} → {success:true}\n" +
        "- set-data-rep: Repeat element for each item in collection (null to remove). Example: {action:\"set-data-rep\",componentUuid:\"abc\",nodeRef:\"card\",collection:\"$ctx.items\",elementVariable:\"item\",indexVariable:\"idx\"} → {success:true}\n" +
        "- Queries: Manage component data queries. Example: {action:\"add-query\",componentUuid:\"abc\",name:\"fetchUsers\",queryType:\"dataQuery\"} → {success:true,queryUuid:\"q1\"}\n" +
        "- Data tokens: Site-level JSON values ($ctx.tokenName). Example: {action:\"create-data-token\",name:\"apiUrl\",value:\"\\\"https://api.example.com\\\"\"} → {success:true}\n" +
        "- Splits: A/B tests and segments. Example: {action:\"create-split\",name:\"CTATest\",splitType:\"experiment\",slices:[{name:\"Control\",prob:50},{name:\"Variant\",prob:50}]} → {success:true}\n" +
        "- get-code-meta/list-functions: Code component introspection. Example: {action:\"list-functions\",componentUuid:\"abc\"} → {functions:[{name:\"handleSubmit\",params:[...]}]}",
      inputSchema: {
      action: z.enum([
        "set-data-cond", "set-data-rep",
        "list-queries", "add-query", "update-query", "remove-query",
        "list-data-tokens", "create-data-token", "update-data-token", "remove-data-token",
        "list-splits", "create-split", "update-split", "remove-split",
        "get-code-meta", "list-functions",
      ]),
      componentUuid: z.string().optional().describe("UUID of the component"),
      nodeRef: z.string().optional().describe("Node reference"),
      condition: z.string().nullable().optional().describe("JS condition expression or null to remove"),
      collection: z.string().nullable().optional().describe("JS array expression or null to remove repetition"),
      elementVariable: z.string().optional().describe("Loop variable name for each item"),
      indexVariable: z.string().nullable().optional().describe("Loop variable name for index"),
      variant: z.string().optional().describe("Target variant"),
      name: z.string().optional().describe("Name for create/rename operations"),
      queryRef: z.string().optional().describe("Query reference (name or UUID)"),
      queryType: z.enum(["dataQuery", "serverQuery"]).optional().describe("Query type"),
      tokenRef: z.string().optional().describe("Data token reference (UUID or name)"),
      value: z.string().optional().describe("Value for data token or token update"),
      splitRef: z.string().optional().describe("Split reference (UUID or name)"),
      splitType: z.enum(["experiment", "segment"]).optional().describe("Split type"),
      slices: z.array(z.object({
        name: z.string(),
        prob: z.number().optional(),
        cond: z.string().optional(),
      })).optional().describe("Slice definitions for splits"),
      status: z.enum(["new", "running", "stopped"]).optional().describe("Split status"),
      dryRun: z.boolean().optional().describe("Preview changes without persisting"),
      },
      annotations: { destructiveHint: true },
    },
    async (params) => {
      const { action } = params;
      const callId = randomUUID();
      registerCall(callId);
      setCurrentCallId(callId);
      try {
        // Emit presence for data operations targeting a component
        if (params.componentUuid) {
          emitEditPresence(params.componentUuid, params.nodeRef);
        }

        switch (action) {
          case "set-data-cond": {
            const cuuid = requireParam(params.componentUuid, "componentUuid", "data.set-data-cond");
            const nref = requireParam(params.nodeRef, "nodeRef", "data.set-data-cond");
            // condition can be null (to remove), so we check for undefined specifically
            if (params.condition === undefined) {
              throw new Error("Missing required parameter 'condition' for 'data.set-data-cond' action");
            }

            if (params.dryRun) {
              const result = await withDryRun(() =>
                setDataCond(apiClient, cuuid, nref, params.condition!, params.variant)
              );
              return {
                content: [
                  {
                    type: "text" as const,
                    text: JSON.stringify(
                      {
                        dryRun: true,
                        node: result.nodeName ?? result.nodeUuid,
                        previousCondition: result.previousCondition,
                        newCondition: result.newCondition,
                        message: "Dry run: no changes persisted",
                      }
                    ),
                  },
                ],
              };
            }

            const result = await setDataCond(
              apiClient, cuuid, nref, params.condition!, params.variant
            );
            return {
              content: [
                {
                  type: "text" as const,
                  text: JSON.stringify(
                    {
                      success: true,
                      node: result.nodeName ?? result.nodeUuid,
                      previousCondition: result.previousCondition,
                      newCondition: result.newCondition,
                      revision: result.save.revisionNum,
                    }
                  ),
                },
              ],
            };
          }

          case "set-data-rep": {
            const cuuid = requireParam(params.componentUuid, "componentUuid", "data.set-data-rep");
            const nref = requireParam(params.nodeRef, "nodeRef", "data.set-data-rep");
            // collection can be null (to remove), so we check for undefined specifically
            if (params.collection === undefined) {
              throw new Error("Missing required parameter 'collection' for 'data.set-data-rep' action");
            }

            if (params.dryRun) {
              const result = await withDryRun(() =>
                setDataRep(
                  apiClient, cuuid, nref, params.collection!,
                  params.elementVariable, params.indexVariable, params.variant
                )
              );
              return {
                content: [
                  {
                    type: "text" as const,
                    text: JSON.stringify(
                      {
                        dryRun: true,
                        node: result.nodeName ?? result.nodeUuid,
                        previousDataRep: result.previousDataRep,
                        newDataRep: result.newDataRep,
                        message: "Dry run: no changes persisted",
                      }
                    ),
                  },
                ],
              };
            }

            const result = await setDataRep(
              apiClient, cuuid, nref, params.collection!,
              params.elementVariable, params.indexVariable, params.variant
            );
            return {
              content: [
                {
                  type: "text" as const,
                  text: JSON.stringify(
                    {
                      success: true,
                      node: result.nodeName ?? result.nodeUuid,
                      previousDataRep: result.previousDataRep,
                      newDataRep: result.newDataRep,
                      revision: result.save.revisionNum,
                    }
                  ),
                },
              ],
            };
          }

          case "list-queries": {
            const cuuid = requireParam(params.componentUuid, "componentUuid", "data.list-queries");
            const session = requireSession();
            const component = session.site.components?.find(
              (c: any) => c.uuid === cuuid
            );
            if (!component) {
              return {
                content: [
                  {
                    type: "text" as const,
                    text: `Component UUID "${cuuid}" not found. Use component tool with action 'list' to see available components.`,
                  },
                ],
                isError: true,
              };
            }

            const queries = listQueries(component);
            return {
              content: [
                {
                  type: "text" as const,
                  text: JSON.stringify(
                    {
                      componentUuid: cuuid,
                      componentName: component.name,
                      queryCount: queries.length,
                      queries,
                    }
                  ),
                },
              ],
            };
          }

          case "add-query": {
            const cuuid = requireParam(params.componentUuid, "componentUuid", "data.add-query");
            const qName = requireParam(params.name, "name", "data.add-query");
            const qType = params.queryType ?? "dataQuery";

            if (params.dryRun) {
              const result = await withDryRun(() =>
                addQuery(apiClient, cuuid, qName, qType)
              );
              return {
                content: [
                  {
                    type: "text" as const,
                    text: JSON.stringify(
                      {
                        dryRun: true,
                        queryUuid: result.queryUuid,
                        name: result.name,
                        queryType: result.queryType,
                        message: "Dry run: no changes persisted",
                      }
                    ),
                  },
                ],
              };
            }

            const result = await addQuery(apiClient, cuuid, qName, qType);
            return {
              content: [
                {
                  type: "text" as const,
                  text: JSON.stringify(
                    {
                      success: true,
                      queryUuid: result.queryUuid,
                      name: result.name,
                      queryType: result.queryType,
                      revision: result.save.revisionNum,
                    }
                  ),
                },
              ],
            };
          }

          case "update-query": {
            const cuuid = requireParam(params.componentUuid, "componentUuid", "data.update-query");
            const qRef = requireParam(params.queryRef, "queryRef", "data.update-query");
            const qName = requireParam(params.name, "name", "data.update-query");

            if (params.dryRun) {
              const result = await withDryRun(() =>
                updateQuery(apiClient, cuuid, qRef, qName)
              );
              return {
                content: [
                  {
                    type: "text" as const,
                    text: JSON.stringify(
                      {
                        dryRun: true,
                        queryUuid: result.queryUuid,
                        name: result.name,
                        queryType: result.queryType,
                        message: "Dry run: no changes persisted",
                      }
                    ),
                  },
                ],
              };
            }

            const result = await updateQuery(apiClient, cuuid, qRef, qName);
            return {
              content: [
                {
                  type: "text" as const,
                  text: JSON.stringify(
                    {
                      success: true,
                      queryUuid: result.queryUuid,
                      name: result.name,
                      queryType: result.queryType,
                      revision: result.save.revisionNum,
                    }
                  ),
                },
              ],
            };
          }

          case "remove-query": {
            const cuuid = requireParam(params.componentUuid, "componentUuid", "data.remove-query");
            const qRef = requireParam(params.queryRef, "queryRef", "data.remove-query");

            if (params.dryRun) {
              const result = await withDryRun(() =>
                removeQuery(apiClient, cuuid, qRef)
              );
              return {
                content: [
                  {
                    type: "text" as const,
                    text: JSON.stringify(
                      {
                        dryRun: true,
                        removedName: result.removedName,
                        removedUuid: result.removedUuid,
                        queryType: result.queryType,
                        message: "Dry run: no changes persisted",
                      }
                    ),
                  },
                ],
              };
            }

            const result = await removeQuery(apiClient, cuuid, qRef);
            return {
              content: [
                {
                  type: "text" as const,
                  text: JSON.stringify(
                    {
                      success: true,
                      removedName: result.removedName,
                      removedUuid: result.removedUuid,
                      queryType: result.queryType,
                      revision: result.save.revisionNum,
                    }
                  ),
                },
              ],
            };
          }

          case "list-data-tokens": {
            const result = listDataTokens();
            return {
              content: [
                { type: "text" as const, text: JSON.stringify(result) },
              ],
            };
          }

          case "create-data-token": {
            const dtName = requireParam(params.name, "name", "data.create-data-token");

            if (params.dryRun) {
              const result = await withDryRun(() =>
                createDataToken(apiClient, dtName, params.value)
              );
              return {
                content: [
                  {
                    type: "text" as const,
                    text: JSON.stringify(
                      {
                        dryRun: true,
                        token: result.token,
                        message: "Dry run: no changes persisted",
                      }
                    ),
                  },
                ],
              };
            }

            const result = await createDataToken(apiClient, dtName, params.value);
            return {
              content: [
                {
                  type: "text" as const,
                  text: JSON.stringify(
                    {
                      success: true,
                      token: result.token,
                      revision: result.save.revisionNum,
                    }
                  ),
                },
              ],
            };
          }

          case "update-data-token": {
            const dtRef = requireParam(params.tokenRef, "tokenRef", "data.update-data-token");
            if (params.name === undefined && params.value === undefined) {
              throw new Error("At least one of name or value must be provided for data.update-data-token");
            }

            if (params.dryRun) {
              const result = await withDryRun(() =>
                updateDataToken(apiClient, dtRef, params.name, params.value)
              );
              return {
                content: [
                  {
                    type: "text" as const,
                    text: JSON.stringify(
                      {
                        dryRun: true,
                        token: result.token,
                        message: "Dry run: no changes persisted",
                      }
                    ),
                  },
                ],
              };
            }

            const result = await updateDataToken(apiClient, dtRef, params.name, params.value);
            return {
              content: [
                {
                  type: "text" as const,
                  text: JSON.stringify(
                    {
                      success: true,
                      token: result.token,
                      revision: result.save.revisionNum,
                    }
                  ),
                },
              ],
            };
          }

          case "remove-data-token": {
            const dtRef = requireParam(params.tokenRef, "tokenRef", "data.remove-data-token");

            if (params.dryRun) {
              const result = await withDryRun(() =>
                removeDataToken(apiClient, dtRef)
              );
              return {
                content: [
                  {
                    type: "text" as const,
                    text: JSON.stringify(
                      {
                        dryRun: true,
                        removedName: result.removedName,
                        removedUuid: result.removedUuid,
                        message: "Dry run: no changes persisted",
                      }
                    ),
                  },
                ],
              };
            }

            const result = await removeDataToken(apiClient, dtRef);
            return {
              content: [
                {
                  type: "text" as const,
                  text: JSON.stringify(
                    {
                      success: true,
                      removedName: result.removedName,
                      removedUuid: result.removedUuid,
                      revision: result.save.revisionNum,
                    }
                  ),
                },
              ],
            };
          }

          case "list-splits": {
            const result = listSplits();
            return {
              content: [
                { type: "text" as const, text: JSON.stringify(result) },
              ],
            };
          }

          case "create-split": {
            const sName = requireParam(params.name, "name", "data.create-split");
            const sType = requireParam(params.splitType, "splitType", "data.create-split");
            const sSlices = requireParam(params.slices, "slices", "data.create-split");

            if (params.dryRun) {
              const result = await withDryRun(() =>
                createSplit(apiClient, sName, sType, sSlices)
              );
              return {
                content: [
                  {
                    type: "text" as const,
                    text: JSON.stringify(
                      {
                        dryRun: true,
                        split: result.split,
                        message: "Dry run: no changes persisted",
                      }
                    ),
                  },
                ],
              };
            }

            const result = await createSplit(apiClient, sName, sType, sSlices);
            return {
              content: [
                {
                  type: "text" as const,
                  text: JSON.stringify(
                    {
                      success: true,
                      split: result.split,
                      revision: result.save.revisionNum,
                    }
                  ),
                },
              ],
            };
          }

          case "update-split": {
            const sRef = requireParam(params.splitRef, "splitRef", "data.update-split");
            if (params.name === undefined && params.status === undefined && params.slices === undefined) {
              throw new Error("At least one of name, status, or slices must be provided for data.update-split");
            }

            if (params.dryRun) {
              const result = await withDryRun(() =>
                updateSplit(apiClient, sRef, params.name, params.status, params.slices)
              );
              return {
                content: [
                  {
                    type: "text" as const,
                    text: JSON.stringify(
                      {
                        dryRun: true,
                        split: result.split,
                        message: "Dry run: no changes persisted",
                      }
                    ),
                  },
                ],
              };
            }

            const result = await updateSplit(apiClient, sRef, params.name, params.status, params.slices);
            return {
              content: [
                {
                  type: "text" as const,
                  text: JSON.stringify(
                    {
                      success: true,
                      split: result.split,
                      revision: result.save.revisionNum,
                    }
                  ),
                },
              ],
            };
          }

          case "remove-split": {
            const sRef = requireParam(params.splitRef, "splitRef", "data.remove-split");

            if (params.dryRun) {
              const result = await withDryRun(() =>
                removeSplit(apiClient, sRef)
              );
              return {
                content: [
                  {
                    type: "text" as const,
                    text: JSON.stringify(
                      {
                        dryRun: true,
                        removedName: result.removedName,
                        removedUuid: result.removedUuid,
                        message: "Dry run: no changes persisted",
                      }
                    ),
                  },
                ],
              };
            }

            const result = await removeSplit(apiClient, sRef);
            return {
              content: [
                {
                  type: "text" as const,
                  text: JSON.stringify(
                    {
                      success: true,
                      removedName: result.removedName,
                      removedUuid: result.removedUuid,
                      revision: result.save.revisionNum,
                    }
                  ),
                },
              ],
            };
          }

          case "get-code-meta": {
            const cuuid = requireParam(params.componentUuid, "componentUuid", "data.get-code-meta");
            const metaResult = getCodeComponentMeta(cuuid);

            // Enrich with dev host registry component data when available
            const session = requireSession();
            const regComponents = session.registryData?.components;
            let devHostMeta: Record<string, unknown> | undefined;
            if (metaResult.isCodeComponent && metaResult.componentName &&
                Array.isArray(regComponents) && regComponents.length > 0) {
              const compName = metaResult.componentName;
              const siteName = compName.endsWith("$dev") ? compName.slice(0, -4) : compName;
              const matched = regComponents.find((c) => {
                if (!c?.name) return false;
                const regName = c.name.endsWith("$dev") ? c.name.slice(0, -4) : c.name;
                return regName === siteName;
              });
              if (matched) {
                // Surface all registry fields except name (already known) as devHostMeta
                const { name: _name, ...rest } = matched;
                devHostMeta = rest;
              }
            }

            const result = devHostMeta
              ? { ...metaResult, devHostMeta }
              : metaResult;

            return {
              content: [
                { type: "text" as const, text: JSON.stringify(result) },
              ],
            };
          }

          case "list-functions": {
            const session = requireSession();
            const functionsResult = listCustomFunctions();

            // Enrich with dev host registered functions when available
            const regFunctions = session.registryData?.functions;
            const devHostFunctions = Array.isArray(regFunctions) && regFunctions.length > 0
              ? regFunctions.map((f) => ({
                  name: f.name,
                  ...(f.namespace && { namespace: f.namespace }),
                  ...(f.displayName && { displayName: f.displayName }),
                  ...(f.description && { description: f.description }),
                  ...(f.importPath && { importPath: f.importPath }),
                  ...(f.isDefaultExport !== undefined && { isDefaultExport: f.isDefaultExport }),
                  ...(f.isQuery !== undefined && { isQuery: f.isQuery }),
                  ...(f.typescriptDeclaration && { typescriptDeclaration: f.typescriptDeclaration }),
                  ...(Array.isArray(f.params) && f.params.length > 0 && { params: f.params }),
                  ...(f.returnValue && { returnValue: f.returnValue }),
                }))
              : undefined;

            const result = devHostFunctions
              ? { ...functionsResult, devHostFunctions }
              : functionsResult;

            return {
              content: [
                { type: "text" as const, text: JSON.stringify(result) },
              ],
            };
          }

          default:
            throw new Error(`Unknown action '${action}' for data tool.`);
        }
      } catch (err: unknown) {
        // Read-only actions should not cancel batch on error
        if (["list-queries", "list-data-tokens", "list-splits", "get-code-meta", "list-functions"].includes(action)) {
          return {
            content: [{ type: "text" as const, text: `Error in data.${action}: ${errorMessage(err)}` }],
            isError: true,
          };
        }
        return handleMutationError(`data.${action}`, err, callId);
      } finally {
        setCurrentCallId(null);
        if (!isCallSettled(callId)) failCall(callId);
        clearEditPresence();
      }
    }
  );

  // ========================================================================
  // DOMAIN 8: interaction (4 actions)
  // ========================================================================

  server.registerTool(
    "interaction",
    {
      description: "Event handler interactions on elements.\n" +
        "Actions: list, add, update, remove.\n" +
        "- list: List all interactions on an element. Example: {action:\"list\",componentUuid:\"abc\",nodeRef:\"btn\"} → {interactions:[{event:\"onClick\",actionName:\"navigation\",args:{destination:\"/about\"}}]}\n" +
        "- add: Add an event handler (navigation, updateVariable, customFunction). customFunction code has access to: event (DOM event object), $state, $props, $ctx, $steps. Example: {action:\"add\",componentUuid:\"abc\",nodeRef:\"btn\",event:\"onClick\",actionName:\"navigation\",args:{destination:\"/about\"}} → {interactionUuid:\"i1\"}\n" +
        "- update: Modify an existing interaction's action, args, or condition. Example: {action:\"update\",componentUuid:\"abc\",nodeRef:\"btn\",interactionIndex:0,args:{destination:\"/home\"}} → {success:true}\n" +
        "- remove: Remove interaction(s) from an element. Example: {action:\"remove\",componentUuid:\"abc\",nodeRef:\"btn\",interactionIndex:0} → {success:true}",
      inputSchema: {
      action: z.enum(["list", "add", "update", "remove"]),
      componentUuid: z.string().optional().describe("UUID of the component"),
      nodeRef: z.string().optional().describe("Element reference"),
      event: z.string().optional().describe("Event name (e.g., onClick, onChange)"),
      actionName: z.string().optional().describe("Action: navigation, updateVariable, customFunction"),
      args: z.record(z.string()).optional().describe("Action arguments as key-value pairs"),
      interactionName: z.string().optional().describe("Human-readable step name"),
      condition: z.string().optional().describe("JS expression for conditional execution"),
      interactionIndex: z.number().optional().describe("Index of interaction to remove"),
      dryRun: z.boolean().optional().describe("Preview changes without persisting"),
      },
      annotations: { destructiveHint: true },
    },
    async (params) => {
      const { action } = params;
      const callId = randomUUID();
      registerCall(callId);
      setCurrentCallId(callId);
      try {
        // Emit presence for interaction operations (arena + selection)
        if (params.componentUuid) {
          emitEditPresence(params.componentUuid, params.nodeRef);
        }

        switch (action) {
          case "list": {
            const cuuid = requireParam(params.componentUuid, "componentUuid", "interaction.list");
            const nref = requireParam(params.nodeRef, "nodeRef", "interaction.list");
            const session = requireSession();
            const component = session.site.components?.find(
              (c: any) => c.uuid === cuuid
            );
            if (!component) {
              return {
                content: [
                  {
                    type: "text" as const,
                    text: `Component UUID "${cuuid}" not found.`,
                  },
                ],
                isError: true,
              };
            }

            const interactions = listInteractions(component, nref);
            return {
              content: [
                {
                  type: "text" as const,
                  text: JSON.stringify(
                    {
                      componentUuid: cuuid,
                      nodeRef: nref,
                      interactionCount: interactions.length,
                      interactions,
                    }
                  ),
                },
              ],
            };
          }

          case "add": {
            const cuuid = requireParam(params.componentUuid, "componentUuid", "interaction.add");
            const nref = requireParam(params.nodeRef, "nodeRef", "interaction.add");
            const evt = requireParam(params.event, "event", "interaction.add");
            const actName = requireParam(params.actionName, "actionName", "interaction.add");
            const argz = requireParam(params.args, "args", "interaction.add");

            if (params.dryRun) {
              const result = await withDryRun(() =>
                addInteraction(apiClient, cuuid, nref, evt, actName, argz, params.interactionName, params.condition)
              );
              return {
                content: [
                  {
                    type: "text" as const,
                    text: JSON.stringify(
                      {
                        dryRun: true,
                        interactionUuid: result.interactionUuid,
                        event: result.event,
                        actionName: result.actionName,
                        interactionName: result.interactionName,
                        message: "Dry run: no changes persisted",
                      }
                    ),
                  },
                ],
              };
            }

            const result = await addInteraction(
              apiClient, cuuid, nref, evt, actName, argz, params.interactionName, params.condition
            );
            return {
              content: [
                {
                  type: "text" as const,
                  text: JSON.stringify(
                    {
                      success: true,
                      interactionUuid: result.interactionUuid,
                      event: result.event,
                      actionName: result.actionName,
                      interactionName: result.interactionName,
                      revision: result.save.revisionNum,
                      ...(result.warnings?.length ? { warnings: result.warnings } : {}),
                    }
                  ),
                },
              ],
            };
          }

          case "update": {
            const cuuid = requireParam(params.componentUuid, "componentUuid", "interaction.update");
            const nref = requireParam(params.nodeRef, "nodeRef", "interaction.update");
            const evt = requireParam(params.event, "event", "interaction.update");
            const idx = requireParam(params.interactionIndex, "interactionIndex", "interaction.update");

            const updates: Record<string, any> = {};
            if (params.actionName !== undefined) updates.actionName = params.actionName;
            if (params.args !== undefined) updates.args = params.args;
            if (params.condition !== undefined) updates.condition = params.condition;
            if (params.interactionName !== undefined) updates.interactionName = params.interactionName;

            if (Object.keys(updates).length === 0) {
              throw new Error("At least one of actionName, args, condition, or interactionName must be provided for interaction.update");
            }

            if (params.dryRun) {
              const result = await withDryRun(() =>
                updateInteraction(apiClient, cuuid, nref, evt, idx, updates)
              );
              return {
                content: [
                  {
                    type: "text" as const,
                    text: JSON.stringify(
                      {
                        dryRun: true,
                        event: result.event,
                        interactionIndex: result.interactionIndex,
                        actionName: result.actionName,
                        interactionName: result.interactionName,
                        message: "Dry run: no changes persisted",
                      }
                    ),
                  },
                ],
              };
            }

            const result = await updateInteraction(apiClient, cuuid, nref, evt, idx, updates);
            return {
              content: [
                {
                  type: "text" as const,
                  text: JSON.stringify(
                    {
                      success: true,
                      event: result.event,
                      interactionIndex: result.interactionIndex,
                      actionName: result.actionName,
                      interactionName: result.interactionName,
                      revision: result.save.revisionNum,
                    }
                  ),
                },
              ],
            };
          }

          case "remove": {
            const cuuid = requireParam(params.componentUuid, "componentUuid", "interaction.remove");
            const nref = requireParam(params.nodeRef, "nodeRef", "interaction.remove");
            const evt = requireParam(params.event, "event", "interaction.remove");

            if (params.dryRun) {
              const result = await withDryRun(() =>
                removeInteraction(apiClient, cuuid, nref, evt, params.interactionIndex)
              );
              return {
                content: [
                  {
                    type: "text" as const,
                    text: JSON.stringify(
                      {
                        dryRun: true,
                        removedCount: result.removedCount,
                        event: result.event,
                        message: "Dry run: no changes persisted",
                      }
                    ),
                  },
                ],
              };
            }

            const result = await removeInteraction(
              apiClient, cuuid, nref, evt, params.interactionIndex
            );
            return {
              content: [
                {
                  type: "text" as const,
                  text: JSON.stringify(
                    {
                      success: true,
                      removedCount: result.removedCount,
                      event: result.event,
                      revision: result.save.revisionNum,
                    }
                  ),
                },
              ],
            };
          }

          default:
            throw new Error(`Unknown action '${action}' for interaction tool.`);
        }
      } catch (err: unknown) {
        // Read-only list action should not cancel batch on error
        if (action === "list") {
          return {
            content: [{ type: "text" as const, text: `Error in interaction.${action}: ${errorMessage(err)}` }],
            isError: true,
          };
        }
        return handleMutationError(`interaction.${action}`, err, callId);
      } finally {
        setCurrentCallId(null);
        if (!isCallSettled(callId)) failCall(callId);
        clearEditPresence();
      }
    }
  );

  return server;
}
