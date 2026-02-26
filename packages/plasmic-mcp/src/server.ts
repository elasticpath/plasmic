/**
 * MCP server setup and tool registration.
 *
 * Uses McpServer from @modelcontextprotocol/sdk with Zod schemas for input
 * validation. All tools are registered before the transport connects.
 *
 * STRAP architecture: 103 actions consolidated into 8 domain tools.
 * Each domain tool uses an `action` discriminator to route to the
 * appropriate handler function.
 *
 * Domains:
 *   - project (8 actions): session lifecycle, persistence, batch, undo
 *   - inspect (8 actions): read-only queries on component trees
 *   - component (18 actions): component/page lifecycle, props, states
 *   - node (15 actions): element mutations (structure, style, text, attrs)
 *   - variant (12 actions): variant management (component, global, style, screen)
 *   - design (22 actions): site-level design system (tokens, mixins, etc.)
 *   - data (16 actions): data flow (queries, data-tokens, splits, etc.)
 *   - interaction (4 actions): event handlers
 *
 * CRITICAL: Never use console.log() — stdout is the JSON-RPC transport.
 * All logging goes through console.error().
 */

import fs from "fs";
import os from "os";
import path from "path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { PlasmicApiClient } from "./api-client.js";
import { getAuth } from "./auth.js";
import { requireSession, setSession } from "./session.js";
import { loadProject } from "./model-loader.js";
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
import { readTokens } from "./token-reader.js";
import { resolveNode, requireSingleNode, invalidateNodeCache, clearNodeCache, getCacheMetrics } from "./node-resolver.js";
import { initChangeTracker, disposeChangeTracker, getChangeTracker } from "./change-tracker.js";
import {
  updateText,
  updateRichText,
  updateStyles,
  updateAttrs,
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
import { undo as undoOperation, clearUndoStack, getUndoDepth } from "./undo-manager.js";
import { SaveManager } from "./save-manager.js";
import { undoChanges } from "@/wab/shared/core/undo-util";
import type { TreeReadOptions } from "./types.js";

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

/**
 * Handle errors from mutation tool handlers. If a batch is active, cancels it
 * and rolls back all accumulated changes so the model stays clean.
 */
function handleMutationError(label: string, err: any) {
  let message = `Error ${label}: ${err.message}`;
  if (isBatchActive()) {
    cancelBatchWithRollback();
    message += " Batch cancelled and all accumulated changes rolled back.";
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

  server.tool(
    "project",
    "Project session lifecycle, persistence, batch operations, and undo.\n" +
      "Actions: set, list, get-meta, save, refresh, begin-batch, end-batch, undo.\n" +
      "- set: Load a project into memory (required before other tools)\n" +
      "- list: List all accessible projects\n" +
      "- get-meta: Get project metadata (name, counts, pages, components)\n" +
      "- save: Force full save to server\n" +
      "- refresh: Reload project from server\n" +
      "- begin-batch: Start accumulating edits\n" +
      "- end-batch: Save accumulated edits in one revision\n" +
      "- undo: Revert most recent edit",
    {
      action: z.enum(["set", "list", "get-meta", "save", "refresh", "begin-batch", "end-batch", "undo"]),
      projectId: z.string().optional().describe("The Plasmic project ID (required for 'set')"),
      batchId: z.string().optional().describe("Optional batch ID for verification (used by 'end-batch')"),
    },
    async ({ action, projectId, batchId }) => {
      try {
        switch (action) {
          case "set": {
            const pid = requireParam(projectId, "projectId", "project.set");
            // Clean up previous session state before loading new project
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
            } = await loadProject(apiClient, pid);

            setSession({
              projectId: pid,
              projectName,
              site,
              bundler,
              revisionNum,
              modelVersion,
              hostlessDataVersion,
              projectUuid: pid,
            });

            // Initialize change tracking for incremental saves (M2)
            initChangeTracker(site);

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
            } = await loadProject(apiClient, session.projectId);

            setSession({
              projectId: session.projectId,
              projectName,
              site,
              bundler,
              revisionNum,
              modelVersion,
              hostlessDataVersion,
              projectUuid: session.projectId,
            });

            // Re-initialize change tracking
            initChangeTracker(site);

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
            const result = await endBatch(apiClient, batchId);
            return {
              content: [
                {
                  type: "text" as const,
                  text: JSON.stringify(
                    {
                      success: true,
                      operationCount: result.operationCount,
                      revision: result.save.revisionNum,
                      message: `Batch saved: ${result.operationCount} operations in revision ${result.save.revisionNum}`,
                    }
                  ),
                },
              ],
            };
          }

          case "undo": {
            if (isBatchActive()) {
              throw new Error(
                "Cannot undo during a batch session. Call end-batch first, then undo."
              );
            }
            const result = await undoOperation(apiClient);
            return {
              content: [
                {
                  type: "text" as const,
                  text: JSON.stringify(
                    {
                      success: true,
                      undone: result.undone,
                      revision: result.save.revisionNum,
                      remainingUndos: getUndoDepth(),
                      message: `Undone: ${result.undone}`,
                    }
                  ),
                },
              ],
            };
          }

          default:
            throw new Error(`Unknown action '${action}' for project tool. Available: set, list, get-meta, save, refresh, begin-batch, end-batch, undo`);
        }
      } catch (err: any) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error in project.${action}: ${err.message}`,
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

  server.tool(
    "inspect",
    "Read-only queries on component trees, nodes, style properties, and page metadata.\n" +
      "Actions: tree, summary, node, subtree, export, style-properties, preview-url, page-meta.\n" +
      "- tree: Full element tree with styles, text, layout\n" +
      "- summary: Compact outline (type, tag, name, uuid, childCount)\n" +
      "- node: Full details for a single node\n" +
      "- subtree: Tree from a specific node downward\n" +
      "- export: Write full tree to temp file\n" +
      "- style-properties: List valid CSS property names\n" +
      "- preview-url: Get preview and studio URLs\n" +
      "- page-meta: Read page SEO metadata",
    {
      action: z.enum(["tree", "summary", "node", "subtree", "export", "style-properties", "preview-url", "page-meta"]),
      componentUuid: z.string().optional().describe("UUID of the component to inspect"),
      nodeRef: z.string().optional().describe("Node reference: UUID, name, path, or index"),
      maxDepth: z.number().optional().describe("Maximum tree depth to return. Defaults to 3 for tree, 2 for summary. Pass -1 for unlimited."),
      maxChars: z.number().optional().describe("Character budget for response JSON. Defaults to 15000 (~4000 tokens). Pass -1 for unlimited."),
      excludeStyles: z.boolean().optional().describe("Strip styles from output to reduce size"),
      summaryOnly: z.boolean().optional().describe("Return compact outline (same as summary action)"),
      format: z.enum(["concise", "full"]).optional().describe('Response format. "concise" strips UUIDs (except root), abbreviates keys (childCount→cc, componentName→comp), replaces detail fields with booleans. ~70% token reduction for orientation. Default: "full".'),
      filter: z.string().optional().describe("Filter string for style-properties action"),
    },
    async ({ action, componentUuid, nodeRef, maxDepth, maxChars, excludeStyles, summaryOnly, format, filter }) => {
      try {
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
                    text: `Component UUID "${cuuid}" not found in project. Use list-components to see available components.`,
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

            return {
              content: [
                {
                  type: "text" as const,
                  text: JSON.stringify(result),
                },
              ],
            };
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
                    text: `Component UUID "${cuuid}" not found in project. Use list-components to see available components.`,
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

            return {
              content: [
                {
                  type: "text" as const,
                  text: JSON.stringify(result),
                },
              ],
            };
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
                    text: `Component UUID "${cuuid}" not found in project. Use list-components to see available components.`,
                  },
                ],
                isError: true,
              };
            }

            const resolveResult = resolveNode(component, nref);
            const resolved = requireSingleNode(resolveResult, nref);
            const node = readNodeDetails(resolved.node, session.site.styleTokens);

            return {
              content: [
                {
                  type: "text" as const,
                  text: JSON.stringify({
                    path: resolved.path,
                    name: resolved.name,
                    uuid: resolved.uuid,
                    node,
                    _cache: getCacheMetrics(),
                  }),
                },
              ],
            };
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
                    text: `Component UUID "${cuuid}" not found in project. Use list-components to see available components.`,
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

            return {
              content: [
                {
                  type: "text" as const,
                  text: JSON.stringify(result),
                },
              ],
            };
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
                    text: `Component UUID "${cuuid}" not found in project. Use list-components to see available components.`,
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
            const filePath = path.join(
              os.tmpdir(),
              `plasmic-tree-${cuuid}.json`
            );
            fs.writeFileSync(filePath, JSON.stringify(fullData, null, 2), "utf-8");

            // Compact summary for the response
            const summaryTree = readComponentSummary(component);
            const nodeCount = countTreeNodes(fullTree);

            return {
              content: [
                {
                  type: "text" as const,
                  text: JSON.stringify({
                    name: component.name,
                    uuid: component.uuid,
                    path: component.pageMeta?.path,
                    filePath,
                    nodeCount,
                    tree: summaryTree,
                  }),
                },
              ],
            };
          }

          case "style-properties": {
            const allProps = getValidStylePropertyNames();
            let props = allProps;
            if (filter) {
              const lower = filter.toLowerCase();
              props = allProps.filter((p) => p.includes(lower));
            }
            return {
              content: [
                {
                  type: "text" as const,
                  text: JSON.stringify(
                    {
                      total: props.length,
                      properties: props,
                      ...(filter ? { filter } : {}),
                    }
                  ),
                },
              ],
            };
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
                    text: `Component UUID "${cuuid}" not found. Use list-components to see available components.`,
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

            return {
              content: [
                { type: "text" as const, text: JSON.stringify(result) },
              ],
            };
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
                    text: `Component UUID "${cuuid}" not found. Use list-components to see available components.`,
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

            return {
              content: [
                { type: "text" as const, text: JSON.stringify(meta) },
              ],
            };
          }

          default:
            throw new Error(`Unknown action '${action}' for inspect tool. Available: tree, summary, node, subtree, export, style-properties, preview-url, page-meta`);
        }
      } catch (err: any) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error in inspect.${action}: ${err.message}`,
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

  server.tool(
    "component",
    "Component and page lifecycle, props, and states.\n" +
      "Actions: list, create-page, create, clone, rename, delete, extract, convert-to-page, convert-to-component, update-page-meta, list-props, add-prop, update-prop, remove-prop, list-states, add-state, update-state, remove-state.\n" +
      "- list: List all pages and components\n" +
      "- create-page: Create a new page with PlasmicElement tree\n" +
      "- create: Create a new reusable component\n" +
      "- clone: Duplicate an existing page or component\n" +
      "- rename: Rename a page or component\n" +
      "- delete: Delete a page or component\n" +
      "- extract: Extract a subtree into a new component, replacing it with a component instance\n" +
      "- convert-to-page/convert-to-component: Convert between page and component\n" +
      "- update-page-meta: Set page SEO metadata\n" +
      "- list-props/add-prop/update-prop/remove-prop: Manage component props\n" +
      "- list-states/add-state/update-state/remove-state: Manage component states",
    {
      action: z.enum([
        "list", "create-page", "create", "clone", "rename", "delete", "extract",
        "convert-to-page", "convert-to-component", "update-page-meta",
        "list-props", "add-prop", "update-prop", "remove-prop",
        "list-states", "add-state", "update-state", "remove-state",
      ]),
      componentUuid: z.string().optional().describe("UUID of the component"),
      name: z.string().optional().describe("Name for create/rename/add-prop/add-state actions"),
      path: z.string().optional().describe("URL path for pages"),
      body: z.any().optional().describe("PlasmicElement JSON tree for create-page/create"),
      sourceUuid: z.string().optional().describe("UUID of source for clone"),
      newName: z.string().optional().describe("New name for rename"),
      newPath: z.string().optional().describe("New URL path for rename"),
      force: z.boolean().optional().describe("Force deletion even with references"),
      nodeRef: z.string().optional().describe("Node reference for extract (UUID, name, path, or index)"),
      title: z.string().optional().describe("Page title for SEO"),
      description: z.string().optional().describe("Page description for SEO"),
      openGraphImage: z.string().optional().describe("Open Graph image URL"),
      canonical: z.string().optional().describe("Canonical URL for SEO"),
      propRef: z.string().optional().describe("Prop reference (name or UUID)"),
      type: z.string().optional().describe("Type for add-prop or add-state"),
      defaultValue: z.string().optional().describe("Default value for prop or initial value for state"),
      stateRef: z.string().optional().describe("State reference (name or UUID)"),
      variableType: z.string().optional().describe("State variable type"),
      accessType: z.string().optional().describe("State access type"),
      initialValue: z.string().optional().describe("State initial value"),
      dryRun: z.boolean().optional().describe("Preview changes without persisting"),
    },
    async (params) => {
      const { action } = params;
      try {
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
              } = await loadProject(apiClient, session.projectId);
              setSession({
                projectId: session.projectId,
                projectName,
                site,
                bundler,
                revisionNum: newRevisionNum,
                modelVersion: newModelVersion,
                hostlessDataVersion: newHostlessDataVersion,
                projectUuid: session.projectId,
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
              } = await loadProject(apiClient, session.projectId);
              setSession({
                projectId: session.projectId,
                projectName,
                site,
                bundler,
                revisionNum: newRevisionNum,
                modelVersion: newModelVersion,
                hostlessDataVersion: newHostlessDataVersion,
                projectUuid: session.projectId,
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
                    text: `Error: Source component UUID "${srcUuid}" not found. Use list-components to see available components.`,
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
              } = await loadProject(apiClient, session.projectId);
              setSession({
                projectId: session.projectId,
                projectName,
                site,
                bundler,
                revisionNum: newRevisionNum,
                modelVersion: newModelVersion,
                hostlessDataVersion: newHostlessDataVersion,
                projectUuid: session.projectId,
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
                    }
                  ),
                },
              ],
            };
          }

          case "convert-to-component": {
            const cuuid = requireParam(params.componentUuid, "componentUuid", "component.convert-to-component");
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
                    }
                  ),
                },
              ],
            };
          }

          case "update-page-meta": {
            const cuuid = requireParam(params.componentUuid, "componentUuid", "component.update-page-meta");
            const result = await updatePageMeta(apiClient, cuuid, {
              title: params.title,
              description: params.description,
              openGraphImage: params.openGraphImage,
              canonical: params.canonical,
              path: params.path,
            });
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
                    text: `Component UUID "${cuuid}" not found. Use list-components to see available components.`,
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
            const propType = requireParam(params.type, "type", "component.add-prop") as any;

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
                    text: `Component UUID "${cuuid}" not found. Use list-components to see available components.`,
                  },
                ],
                isError: true,
              };
            }

            const states = listStates(component);
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
            const varType = requireParam(params.variableType, "variableType", "component.add-state") as any;
            const accType = (params.accessType ?? "private") as any;

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
                updateState(apiClient, cuuid, sRef, params.name, params.accessType as any, params.initialValue)
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
              apiClient, cuuid, sRef, params.name, params.accessType as any, params.initialValue
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
      } catch (err: any) {
        if (["create-page", "create", "clone", "rename", "delete", "extract", "convert-to-page", "convert-to-component", "update-page-meta",
             "add-prop", "update-prop", "remove-prop", "add-state", "update-state", "remove-state"].includes(action)) {
          return handleMutationError(`component.${action}`, err);
        }
        return {
          content: [
            {
              type: "text" as const,
              text: `Error in component.${action}: ${err.message}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  // ========================================================================
  // DOMAIN 4: node (15 actions)
  // ========================================================================

  server.tool(
    "node",
    "Element mutations within a component.\n" +
      "Actions: add, remove, move, clone, reorder, update-styles, update-text, update-rich-text, update-attrs, set-visibility, set-image, apply-mixin, detach-mixin, add-animation, remove-animation.\n" +
      "- add/remove/move/clone/reorder: Structural changes to element tree\n" +
      "- update-styles: Set CSS styles on an element\n" +
      "- update-text/update-rich-text: Set text content\n" +
      "- update-attrs: Set HTML attributes\n" +
      "- set-visibility: Show/hide elements per variant\n" +
      "- set-image: Set image source (asset or URL)\n" +
      "- apply-mixin/detach-mixin: Apply or remove style mixins\n" +
      "- add-animation/remove-animation: Apply or remove animations\n" +
      "Use inspect tool for read-only queries.",
    {
      action: z.enum([
        "add", "remove", "move", "clone", "reorder",
        "update-styles", "update-text", "update-rich-text", "update-attrs",
        "set-visibility", "set-image", "apply-mixin", "detach-mixin",
        "add-animation", "remove-animation",
      ]),
      componentUuid: z.string().optional().describe("UUID of the component"),
      nodeRef: z.string().optional().describe("Node reference: UUID, name, path, or index"),
      parentRef: z.string().optional().describe("Parent node reference (for add, reorder, clone)"),
      newParentRef: z.string().optional().describe("New parent reference (for move)"),
      child: z.any().optional().describe("PlasmicElement JSON for add action"),
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
      variant: z.string().optional().describe("Target variant by name, UUID, or selector"),
      dynamic: z.boolean().optional().describe("Create dynamic text expression"),
      fallback: z.string().optional().describe("Fallback for dynamic text"),
      html: z.boolean().optional().describe("Render dynamic text as HTML"),
      visible: z.union([z.boolean(), z.literal("displayNone")]).optional().describe("Visibility state"),
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
      dryRun: z.boolean().optional().describe("Preview changes without persisting"),
    },
    async (params) => {
      const { action } = params;
      try {
        switch (action) {
          case "add": {
            const cuuid = requireParam(params.componentUuid, "componentUuid", "node.add");
            const pRef = requireParam(params.parentRef, "parentRef", "node.add");

            if (params.dryRun) {
              const result = await withDryRun(() =>
                addChild(apiClient, cuuid, pRef, params.child, params.position, params.slot)
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
                      }
                    ),
                  },
                ],
              };
            }

            const result = await addChild(
              apiClient, cuuid, pRef, params.child, params.position, params.slot
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
                    }
                  ),
                },
              ],
            };
          }

          case "set-image": {
            const cuuid = requireParam(params.componentUuid, "componentUuid", "node.set-image");
            const nref = requireParam(params.nodeRef, "nodeRef", "node.set-image");

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

          default:
            throw new Error(`Unknown action '${action}' for node tool.`);
        }
      } catch (err: any) {
        return handleMutationError(`node.${action}`, err);
      }
    }
  );

  // ========================================================================
  // DOMAIN 5: variant (12 actions)
  // ========================================================================

  server.tool(
    "variant",
    "Variant management for components and global variant groups.\n" +
      "Actions: list, create-style, create-group, list-global-groups, create-global-group, add-global, remove-global-group, rename-global, create-screen, update-screen, rename, remove.\n" +
      "- list: List all variants for a component\n" +
      "- create-style: Create hover/focus/etc. style variant\n" +
      "- create-group: Create named variant group (Size, Theme, etc.)\n" +
      "- list-global-groups: List global variant groups\n" +
      "- create-global-group: Create a global variant group\n" +
      "- add-global: Add variant to a global group\n" +
      "- remove-global-group: Remove entire global variant group\n" +
      "- rename-global: Rename a global variant\n" +
      "- create-screen: Create a screen variant (responsive breakpoint)\n" +
      "- update-screen: Update screen variant breakpoint dimensions\n" +
      "- rename: Rename a variant (component or global)\n" +
      "- remove: Remove a single variant (component or global)",
    {
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
    async (params) => {
      const { action } = params;
      try {
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
                    text: `Component UUID "${cuuid}" not found. Use list-components to see available components.`,
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
                  text: JSON.stringify(result),
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
                      revision: result.save.revisionNum,
                      message: `Created variant group "${result.groupName}" (${result.type}) with ${result.variants.length} variant(s). Use update-styles/update-text with variant names to apply overrides.`,
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
            const result = await createGlobalVariantGroup(apiClient, gname, params.type as any, params.initialVariants);
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
      } catch (err: any) {
        if (["create-style", "create-group", "create-global-group", "add-global", "remove-global-group", "rename-global", "create-screen", "update-screen", "rename", "remove"].includes(action)) {
          return handleMutationError(`variant.${action}`, err);
        }
        return {
          content: [
            {
              type: "text" as const,
              text: `Error in variant.${action}: ${err.message}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  // ========================================================================
  // DOMAIN 6: design (22 actions)
  // ========================================================================

  server.tool(
    "design",
    "Site-level design system management: tokens, mixins, animations, themes, assets.\n" +
      "Actions: list-tokens, create-token, update-token, remove-token, duplicate-token, " +
      "list-mixins, create-mixin, update-mixin, remove-mixin, " +
      "list-animations, create-animation, update-animation, remove-animation, " +
      "list-themes, create-theme, update-theme, remove-theme, set-active-theme, " +
      "list-assets, upload-asset, rename-asset, remove-asset.\n" +
      "Tokens: design system values (colors, spacing, fonts)\n" +
      "Mixins: reusable style bundles\n" +
      "Animations: @keyframes definitions\n" +
      "Themes: typography defaults and per-tag overrides\n" +
      "Assets: image and icon management",
    {
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
    async (params) => {
      const { action } = params;
      try {
        switch (action) {
          // ── Tokens ──

          case "list-tokens": {
            const session = requireSession();
            const result = readTokens(session.site.styleTokens, params.tokenType);
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

            if (!params.value && !params.name) {
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
      } catch (err: any) {
        if (["list-tokens", "list-mixins", "list-animations", "list-themes", "list-assets"].includes(action)) {
          return {
            content: [{ type: "text" as const, text: `Error in design.${action}: ${err.message}` }],
            isError: true,
          };
        }
        return handleMutationError(`design.${action}`, err);
      }
    }
  );

  // ========================================================================
  // DOMAIN 7: data (16 actions)
  // ========================================================================

  server.tool(
    "data",
    "Data flow: conditions, repetition, queries, data tokens, splits, code introspection.\n" +
      "Actions: set-data-cond, set-data-rep, list-queries, add-query, update-query, remove-query, " +
      "list-data-tokens, create-data-token, update-data-token, remove-data-token, " +
      "list-splits, create-split, update-split, remove-split, get-code-meta, list-functions.\n" +
      "- set-data-cond: Conditional rendering expression\n" +
      "- set-data-rep: Repeat element for each item in collection\n" +
      "- Queries: Manage component data queries\n" +
      "- Data tokens: Site-level JSON values ($ctx.tokenName)\n" +
      "- Splits: A/B tests and segments\n" +
      "- get-code-meta/list-functions: Code component introspection",
    {
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
    async (params) => {
      const { action } = params;
      try {
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
                    text: `Component not found: ${cuuid}`,
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

            if (params.dryRun) {
              const result = await withDryRun(() =>
                updateSplit(apiClient, sRef, params.name, params.status)
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

            const result = await updateSplit(apiClient, sRef, params.name, params.status);
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
            const result = getCodeComponentMeta(cuuid);
            return {
              content: [
                { type: "text" as const, text: JSON.stringify(result) },
              ],
            };
          }

          case "list-functions": {
            const result = listCustomFunctions();
            return {
              content: [
                { type: "text" as const, text: JSON.stringify(result) },
              ],
            };
          }

          default:
            throw new Error(`Unknown action '${action}' for data tool.`);
        }
      } catch (err: any) {
        // Read-only actions should not cancel batch on error
        if (["list-queries", "list-data-tokens", "list-splits", "get-code-meta", "list-functions"].includes(action)) {
          return {
            content: [{ type: "text" as const, text: `Error in data.${action}: ${err.message}` }],
            isError: true,
          };
        }
        return handleMutationError(`data.${action}`, err);
      }
    }
  );

  // ========================================================================
  // DOMAIN 8: interaction (4 actions)
  // ========================================================================

  server.tool(
    "interaction",
    "Event handler interactions on elements.\n" +
      "Actions: list, add, update, remove.\n" +
      "- list: List all interactions on an element\n" +
      "- add: Add an event handler (navigation, updateVariable, customFunction)\n" +
      "- update: Modify an existing interaction's action, args, or condition\n" +
      "- remove: Remove interaction(s) from an element",
    {
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
    async (params) => {
      const { action } = params;
      try {
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
      } catch (err: any) {
        // Read-only list action should not cancel batch on error
        if (action === "list") {
          return {
            content: [{ type: "text" as const, text: `Error in interaction.${action}: ${err.message}` }],
            isError: true,
          };
        }
        return handleMutationError(`interaction.${action}`, err);
      }
    }
  );

  return server;
}
