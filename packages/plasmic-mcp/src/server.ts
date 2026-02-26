/**
 * MCP server setup and tool registration.
 *
 * Uses McpServer from @modelcontextprotocol/sdk with Zod schemas for input
 * validation. All tools are registered before the transport connects.
 *
 * Tools use three patterns:
 *   - HTTP-only (list-projects, create-page): call Plasmic REST API directly
 *   - Model-read (list-components, get-component-tree, get-component-summary,
 *     get-node-details, export-component-tree, get-project-meta): read from
 *     the in-memory Site model (requires set-project first)
 *   - Session-setup (set-project): fetch bundle → unbundle → store in session
 *
 * M3 additions:
 *   - get-component-summary: compact tree outline (~2KB vs ~15KB)
 *   - get-node-details: full details for a single node (~300B)
 *   - export-component-tree: full tree to temp file, returns path + summary
 *   - get-component-tree enhanced with maxDepth, excludeStyles, summaryOnly
 *   - Node resolver cache invalidation on structural edits / project reload
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
} from "./edit-tools.js";
import { beginBatch, endBatch, isBatchActive, cancelBatch, cancelBatchWithRollback, getAccumulatedChanges } from "./batch-manager.js";
import { undo as undoOperation, clearUndoStack, getUndoDepth } from "./undo-manager.js";
import { SaveManager } from "./save-manager.js";
import { undoChanges } from "@/wab/shared/core/undo-util";
import type { TreeReadOptions } from "./types.js";

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
      } catch (_) {
        // Best-effort undo on error path
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

  // --- set-project ---
  // Fetches the project bundle from the Plasmic API, unbundles it into a live
  // in-memory Site model, and stores it as the active session. Must be called
  // before any model-reading tools.
  server.tool(
    "set-project",
    "Load a Plasmic project into memory for reading and editing. Must be called before model-reading tools.",
    { projectId: z.string().describe("The Plasmic project ID") },
    async ({ projectId }) => {
      try {
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
        } = await loadProject(apiClient, projectId);

        setSession({
          projectId,
          projectName,
          site,
          bundler,
          revisionNum,
          modelVersion,
          hostlessDataVersion,
          projectUuid: projectId,
        });

        // Initialize change tracking for incremental saves (M2)
        initChangeTracker(site);

        const components = site.components ?? [];
        const pages = components.filter((c: any) => c.pageMeta?.path);

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                {
                  projectId,
                  projectName,
                  componentCount: components.length,
                  pageCount: pages.length,
                },
                null,
                2
              ),
            },
          ],
        };
      } catch (err: any) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error loading project: ${err.message}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  // --- list-projects ---
  // HTTP call to list all projects accessible with current credentials.
  // No active project required.
  server.tool(
    "list-projects",
    "List all Plasmic projects accessible with current credentials",
    {},
    async () => {
      try {
        const response = await apiClient.listProjects();
        const projects = response.projects.map((p) => ({
          id: p.id,
          name: p.name,
        }));
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(projects, null, 2),
            },
          ],
        };
      } catch (err: any) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error listing projects: ${err.message}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  // --- get-project-meta ---
  // Reads project metadata from the in-memory model. Requires active project.
  server.tool(
    "get-project-meta",
    "Get metadata about the active Plasmic project (name, counts, pages, components, tokens)",
    {},
    async () => {
      try {
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
            { type: "text" as const, text: JSON.stringify(meta, null, 2) },
          ],
        };
      } catch (err: any) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error getting project meta: ${err.message}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  // --- list-components ---
  // Reads component list from in-memory model. Requires active project.
  server.tool(
    "list-components",
    "List all pages and components in the active project with UUIDs and paths",
    {},
    async () => {
      try {
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
            { type: "text" as const, text: JSON.stringify(result, null, 2) },
          ],
        };
      } catch (err: any) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error listing components: ${err.message}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  // --- get-component-tree ---
  // Reads a component's element tree directly from the in-memory Tpl model.
  // Uses the custom tree reader (NOT the degraded tplToPlasmicElements function).
  // M3: enhanced with optional params for context-efficient querying.
  server.tool(
    "get-component-tree",
    "Get the full element tree of a component with HTML tags, CSS styles, text, images, and layout",
    {
      componentUuid: z
        .string()
        .describe("UUID of the component to inspect"),
      maxDepth: z
        .number()
        .optional()
        .describe("Stop recursing after N levels. Deeper children replaced with childCount."),
      excludeStyles: z
        .boolean()
        .optional()
        .describe("Strip styles from output to reduce size."),
      summaryOnly: z
        .boolean()
        .optional()
        .describe("Return compact outline (same as get-component-summary)."),
    },
    async ({ componentUuid, maxDepth, excludeStyles, summaryOnly }) => {
      try {
        const session = requireSession();
        const component = session.site.components?.find(
          (c: any) => c.uuid === componentUuid
        );

        if (!component) {
          return {
            content: [
              {
                type: "text" as const,
                text: `Component UUID "${componentUuid}" not found in project. Use list-components to see available components.`,
              },
            ],
            isError: true,
          };
        }

        // Build options — always pass styleTokens for token reference resolution
        const styleTokens = session.site.styleTokens;
        const hasOptions =
          maxDepth !== undefined || excludeStyles || summaryOnly || styleTokens?.length > 0;
        const tree = hasOptions
          ? readComponentTree(component, {
              maxDepth,
              excludeStyles: excludeStyles || undefined,
              summaryOnly: summaryOnly || undefined,
              styleTokens,
            } as TreeReadOptions)
          : readComponentTree(component);

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                {
                  name: component.name,
                  uuid: component.uuid,
                  path: component.pageMeta?.path,
                  tree,
                },
                null,
                2
              ),
            },
          ],
        };
      } catch (err: any) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error reading component tree: ${err.message}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  // --- get-component-summary ---
  // M3: Returns a compact outline (~2KB) of a component's node tree.
  // Contains type, tag, name, uuid, and childCount per node — no styles,
  // attrs, or text. Use get-node-details to inspect specific nodes.
  server.tool(
    "get-component-summary",
    "Get a compact outline of a component's node tree (type, tag, name, uuid, childCount). No styles or text. Use get-node-details for specific nodes.",
    {
      componentUuid: z
        .string()
        .describe("UUID of the component to inspect"),
      maxDepth: z
        .number()
        .optional()
        .describe("Maximum tree depth to return. Omit for full outline."),
    },
    async ({ componentUuid, maxDepth }) => {
      try {
        const session = requireSession();
        const component = session.site.components?.find(
          (c: any) => c.uuid === componentUuid
        );

        if (!component) {
          return {
            content: [
              {
                type: "text" as const,
                text: `Component UUID "${componentUuid}" not found in project. Use list-components to see available components.`,
              },
            ],
            isError: true,
          };
        }

        const tree = readComponentSummary(component, maxDepth);

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                {
                  name: component.name,
                  uuid: component.uuid,
                  path: component.pageMeta?.path,
                  tree,
                },
                null,
                2
              ),
            },
          ],
        };
      } catch (err: any) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error reading component summary: ${err.message}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  // --- get-node-details ---
  // M3: Returns full details for a single node (~300B), with immediate
  // children shown as summaries. Uses existing node-resolver for targeting.
  server.tool(
    "get-node-details",
    "Get full details (styles, text, attrs) for a single node. Children shown as summaries. Use node UUID, name, path, or index.",
    {
      componentUuid: z
        .string()
        .describe("UUID of the component containing the node"),
      nodeRef: z
        .string()
        .describe(
          'Node reference: UUID, name (e.g., "Hero Title"), path (e.g., "HeroSection.Title"), or index (e.g., "#2")'
        ),
    },
    async ({ componentUuid, nodeRef }) => {
      try {
        const session = requireSession();
        const component = session.site.components?.find(
          (c: any) => c.uuid === componentUuid
        );

        if (!component) {
          return {
            content: [
              {
                type: "text" as const,
                text: `Component UUID "${componentUuid}" not found in project. Use list-components to see available components.`,
              },
            ],
            isError: true,
          };
        }

        const resolveResult = resolveNode(component, nodeRef);
        const resolved = requireSingleNode(resolveResult, nodeRef);
        const node = readNodeDetails(resolved.node, session.site.styleTokens);

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                {
                  path: resolved.path,
                  name: resolved.name,
                  uuid: resolved.uuid,
                  node,
                  _cache: getCacheMetrics(),
                },
                null,
                2
              ),
            },
          ],
        };
      } catch (err: any) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error reading node details: ${err.message}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  // --- export-component-tree ---
  // M3: Writes the full tree JSON to a temp file and returns the file path
  // plus a compact summary. Same UUID always maps to the same file path
  // (overwrites previous export). For complex restructuring where the
  // developer needs full accuracy available via Read tool.
  server.tool(
    "export-component-tree",
    "Write full component tree JSON to a temp file. Returns file path + compact summary. Use Read tool to inspect sections.",
    {
      componentUuid: z
        .string()
        .describe("UUID of the component to export"),
    },
    async ({ componentUuid }) => {
      try {
        const session = requireSession();
        const component = session.site.components?.find(
          (c: any) => c.uuid === componentUuid
        );

        if (!component) {
          return {
            content: [
              {
                type: "text" as const,
                text: `Component UUID "${componentUuid}" not found in project. Use list-components to see available components.`,
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
          `plasmic-tree-${componentUuid}.json`
        );
        fs.writeFileSync(filePath, JSON.stringify(fullData, null, 2), "utf-8");

        // Compact summary for the response
        const summaryTree = readComponentSummary(component);
        const nodeCount = countTreeNodes(fullTree);

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                {
                  name: component.name,
                  uuid: component.uuid,
                  path: component.pageMeta?.path,
                  filePath,
                  nodeCount,
                  tree: summaryTree,
                },
                null,
                2
              ),
            },
          ],
        };
      } catch (err: any) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error exporting component tree: ${err.message}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  // --- get-subtree ---
  // Returns the full tree from a specific node downward, identified by UUID,
  // name, path, or index. Useful when the developer knows which section they
  // need and wants to avoid the full component tree. Supports maxDepth to
  // limit how deep the subtree goes.
  server.tool(
    "get-subtree",
    "Get the full tree from a specific node downward. Use node UUID, name, path, or index to target the subtree root.",
    {
      componentUuid: z
        .string()
        .describe("UUID of the component containing the node"),
      nodeRef: z
        .string()
        .describe(
          'Node reference: UUID, name (e.g., "Hero"), path (e.g., "Root.Hero"), or index (e.g., "#0")'
        ),
      maxDepth: z
        .number()
        .optional()
        .describe("Maximum depth below the target node. Omit for full subtree."),
      excludeStyles: z
        .boolean()
        .optional()
        .describe("Strip styles from output to reduce size."),
    },
    async ({ componentUuid, nodeRef, maxDepth, excludeStyles }) => {
      try {
        const session = requireSession();
        const component = session.site.components?.find(
          (c: any) => c.uuid === componentUuid
        );

        if (!component) {
          return {
            content: [
              {
                type: "text" as const,
                text: `Component UUID "${componentUuid}" not found in project. Use list-components to see available components.`,
              },
            ],
            isError: true,
          };
        }

        const resolveResult = resolveNode(component, nodeRef);
        const resolved = requireSingleNode(resolveResult, nodeRef);
        const tree = readSubtree(
          resolved.node,
          {
            maxDepth,
            excludeStyles: excludeStyles || undefined,
            styleTokens: session.site.styleTokens,
          }
        );
        const nodeCount = tree ? countTreeNodes(tree) : 0;

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                {
                  component: component.name,
                  componentUuid: component.uuid,
                  subtreeRoot: resolved.name ?? resolved.uuid,
                  path: resolved.path,
                  nodeCount,
                  tree,
                },
                null,
                2
              ),
            },
          ],
        };
      } catch (err: any) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error reading subtree: ${err.message}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  // --- get-tokens ---
  // Reads design tokens (colors, spacing, typography, etc.) from the in-memory
  // model. Returns token names, types, and values so Claude can use the project's
  // design system when creating pages. Resolves token references to final values.
  server.tool(
    "get-tokens",
    "Get design tokens (colors, spacing, fonts) from the active project's design system",
    {
      type: z
        .enum(["Color", "Spacing", "Opacity", "LineHeight", "FontFamily", "FontSize"])
        .optional()
        .describe("Filter by token type. Omit to get all tokens."),
    },
    async ({ type: tokenType }) => {
      try {
        const session = requireSession();
        const result = readTokens(session.site.styleTokens, tokenType);

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      } catch (err: any) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error getting tokens: ${err.message}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  // --- create-page ---
  // Creates a new page via REST API (POST /api/v1/projects/:projectId).
  // The body is a PlasmicElement tree which the server converts to Tpl nodes
  // via elementSchemaToTpl. After creation, reloads the model so the new
  // page appears in subsequent list-components / get-component-tree calls.
  server.tool(
    "create-page",
    "Create a new page in the active Plasmic project with a PlasmicElement tree",
    {
      name: z
        .string()
        .describe("Page name in PascalCase (e.g., 'ProductListing')"),
      path: z
        .string()
        .describe("URL path with leading slash (e.g., '/products')"),
      body: z.any().describe("PlasmicElement JSON tree defining the page structure"),
    },
    async ({ name, path: pagePath, body }) => {
      try {
        const session = requireSession();

        const apiResponse = await apiClient.updateProject(session.projectId, {
          newComponents: [{ name, path: pagePath, body }],
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
              (c: any) => c.name === name && c.pageMeta?.path === pagePath
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
                  name,
                  uuid,
                  path: pagePath,
                  message: `Page "${name}" created at ${pagePath}`,
                },
                null,
                2
              ),
            },
          ],
        };
      } catch (err: any) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error creating page: ${err.message}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  // --- create-component ---
  // Creates a new reusable component (not a page) via REST API.
  // Same pattern as create-page but without the path parameter.
  // Without a path, the server creates ComponentType.Plain instead of ComponentType.Page.
  server.tool(
    "create-component",
    "Create a new reusable component in the active Plasmic project with a PlasmicElement tree",
    {
      name: z
        .string()
        .min(1, "Component name is required")
        .describe("Component name in PascalCase (e.g., 'HeroSection')"),
      body: z
        .any()
        .describe("PlasmicElement JSON tree defining the component structure"),
    },
    async ({ name, body }) => {
      try {
        const session = requireSession();

        const apiResponse = await apiClient.updateProject(session.projectId, {
          newComponents: [{ name, body }],
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
              (c: any) => c.name === name
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
                  name,
                  uuid,
                  message: `Component "${name}" created`,
                },
                null,
                2
              ),
            },
          ],
        };
      } catch (err: any) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error creating component: ${err.message}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  // --- clone-component ---
  // Duplicates an existing component or page via REST API.
  // Uses the cloneFrom field on NewComponentReq to deep-clone the source.
  // The server's tplMgr.cloneComponent() copies the entire Tpl tree.
  server.tool(
    "clone-component",
    "Duplicate an existing page or component. Creates a deep copy with a new name.",
    {
      sourceUuid: z
        .string()
        .min(1, "Source UUID is required")
        .describe("UUID of the component or page to clone (from list-components)"),
      name: z
        .string()
        .min(1, "Clone name is required")
        .describe("Name for the cloned component in PascalCase (e.g., 'HeroSectionV2')"),
      path: z
        .string()
        .optional()
        .describe("URL path for the clone if it should be a page (e.g., '/products-v2'). Omit to create a non-page component."),
    },
    async ({ sourceUuid, name, path: clonePath }) => {
      try {
        const session = requireSession();

        // Verify source exists
        const source = session.site.components?.find(
          (c: any) => c.uuid === sourceUuid
        );
        if (!source) {
          return {
            content: [
              {
                type: "text" as const,
                text: `Error: Source component UUID "${sourceUuid}" not found. Use list-components to see available components.`,
              },
            ],
            isError: true,
          };
        }

        const req: any = {
          name,
          cloneFrom: { uuid: sourceUuid },
        };
        if (clonePath) {
          req.path = clonePath;
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
              (c: any) => c.name === name
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
                  name,
                  uuid,
                  clonedFrom: source.name,
                  clonedFromUuid: sourceUuid,
                  path: clonePath,
                  message: `Component "${name}" cloned from "${source.name}"${clonePath ? ` at ${clonePath}` : ""}`,
                },
                null,
                2
              ),
            },
          ],
        };
      } catch (err: any) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error cloning component: ${err.message}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  // --- list-variants ---
  // Returns all variant groups and variants for a component and the project.
  // Organized into: global variants (screen breakpoints, user-defined),
  // component variants (custom groups), and style variants (hover, focus, etc.).
  server.tool(
    "list-variants",
    "List all variants for a component: global (breakpoints), component (custom), and style (hover/focus). Use variant names or UUIDs with update-styles/update-text.",
    {
      componentUuid: z
        .string()
        .describe("UUID of the component to list variants for"),
    },
    async ({ componentUuid }) => {
      try {
        const session = requireSession();
        const component = session.site.components?.find(
          (c: any) => c.uuid === componentUuid
        );

        if (!component) {
          return {
            content: [
              {
                type: "text" as const,
                text: `Component UUID "${componentUuid}" not found. Use list-components to see available components.`,
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
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      } catch (err: any) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error listing variants: ${err.message}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  // --- create-style-variant ---
  // Creates a new CSS interaction state variant (hover, focus, pressed, etc.)
  // on a component or scoped to a specific element. Required before applying
  // styles to interaction states that don't exist yet. After creation, use
  // update-styles with the variant selector to apply styles.
  server.tool(
    "create-style-variant",
    "Create a new interaction state variant (hover, focus, pressed, etc.). Use on a component or scoped to a specific element. After creation, use update-styles with the variant selector.",
    {
      componentUuid: z
        .string()
        .describe("UUID of the component to add the style variant to"),
      selector: z
        .string()
        .describe(
          'CSS pseudo-class selector: ":hover", ":active", ":focus", ":focus-visible", ":focus-within", ":disabled", ":visited", ":link", or "::placeholder"'
        ),
      nodeRef: z
        .string()
        .optional()
        .describe(
          "Node reference (UUID, name, path, or index) to scope the variant to a specific element. Omit for a component-level variant."
        ),
    },
    async ({ componentUuid, selector, nodeRef }) => {
      try {
        const result = await createStyleVariant(
          apiClient,
          componentUuid,
          selector,
          nodeRef
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
                },
                null,
                2
              ),
            },
          ],
        };
      } catch (err: any) {
        return handleMutationError("creating style variant", err);
      }
    }
  );

  // --- create-variant-group ---
  // Creates a named variant group on a component with optional initial variants.
  // Variant groups define custom component states (e.g., Size: Small/Medium/Large).
  // Three types: single-choice, multi-choice, and toggle (standalone boolean).
  server.tool(
    "create-variant-group",
    'Create a named variant group on a component (e.g., "Size" with "Small"/"Large" variants). Supports single-choice, multi-choice, and toggle types.',
    {
      componentUuid: z
        .string()
        .describe("UUID of the component to add the variant group to"),
      name: z
        .string()
        .min(1, "Group name is required")
        .describe(
          'Name for the variant group (e.g., "Size", "Theme", "State")'
        ),
      type: z
        .enum(["single", "multi", "toggle"])
        .optional()
        .describe(
          'Group type: "single" (one active at a time, default), "multi" (multiple active), or "toggle" (boolean on/off, auto-creates one variant)'
        ),
      initialVariants: z
        .array(z.string().min(1))
        .optional()
        .describe(
          'Names of variants to create immediately (e.g., ["Small", "Medium", "Large"])'
        ),
    },
    async ({ componentUuid, name, type: groupType, initialVariants }) => {
      try {
        const result = await createVariantGroup(
          apiClient,
          componentUuid,
          name,
          groupType,
          initialVariants
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
                },
                null,
                2
              ),
            },
          ],
        };
      } catch (err: any) {
        return handleMutationError("creating variant group", err);
      }
    }
  );

  // --- update-text ---
  // Updates text content on a TplTag node. Targets the base variant by default;
  // when `variant` is provided, targets that specific variant's VariantSetting.
  // When `dynamic` is true, creates an ExprText with CustomCode expression for
  // data-bound text (e.g., "$ctx.product.name"). Supports dry-run mode.
  server.tool(
    "update-text",
    "Update the text content of an element in a component. Finds the node by UUID, name, path, or index. " +
    "Set dynamic: true to bind text to a JavaScript expression (e.g., \"$ctx.product.name\").",
    {
      componentUuid: z
        .string()
        .describe("UUID of the component containing the node"),
      nodeRef: z
        .string()
        .describe(
          'Node reference: UUID, name (e.g., "Hero Title"), path (e.g., "HeroSection.Title"), or index (e.g., "#2")'
        ),
      text: z.string().describe("The new text content. When dynamic is true, this is a JavaScript expression string (e.g., \"$ctx.product.name\")."),
      variant: z
        .string()
        .optional()
        .describe('Target variant by name (e.g., "Mobile"), UUID, or selector (e.g., ":hover"). Omit for base variant.'),
      dynamic: z
        .boolean()
        .optional()
        .describe("When true, creates an ExprText with a CustomCode expression instead of static RawText. The text value is treated as a JavaScript expression."),
      fallback: z
        .string()
        .optional()
        .describe("Fallback text displayed when the dynamic expression evaluates to null/undefined. Only used when dynamic is true."),
      html: z
        .boolean()
        .optional()
        .describe("When true with dynamic text, the expression result is rendered as HTML. Defaults to false."),
      dryRun: z
        .boolean()
        .optional()
        .describe("When true, shows what would change without persisting. Model is left unchanged."),
    },
    async ({ componentUuid, nodeRef, text, variant, dynamic, fallback, html, dryRun }) => {
      try {
        if (dryRun) {
          const result = await withDryRun(() =>
            updateText(apiClient, componentUuid, nodeRef, text, variant, dynamic, fallback, html)
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
                  },
                  null,
                  2
                ),
              },
            ],
          };
        }

        const result = await updateText(apiClient, componentUuid, nodeRef, text, variant, dynamic, fallback, html);
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
                },
                null,
                2
              ),
            },
          ],
        };
      } catch (err: any) {
        return handleMutationError("updating text", err);
      }
    }
  );

  // --- update-rich-text ---
  // Updates text content with inline formatting marks (bold, italic, links, etc.).
  // Creates RawText with StyleMarkers and NodeMarkers for rich text content.
  // Supports dry-run mode.
  server.tool(
    "update-rich-text",
    "Update the text content of an element with inline formatting marks (bold, italic, underline, strikethrough, link, code). " +
    "Provide a flat text string and an array of marks with start/end positions and type. " +
    "Link marks require an 'href' property. Overlapping marks are allowed (e.g., bold + link on same range).",
    {
      componentUuid: z
        .string()
        .describe("UUID of the component containing the node"),
      nodeRef: z
        .string()
        .describe(
          'Node reference: UUID, name (e.g., "Hero Title"), path (e.g., "HeroSection.Title"), or index (e.g., "#2")'
        ),
      text: z.string().describe("The plain text content (without formatting). Mark positions refer to this text."),
      marks: z
        .array(
          z.object({
            start: z.number().describe("Start position in the text (0-indexed, inclusive)"),
            end: z.number().describe("End position in the text (0-indexed, exclusive)"),
            type: z
              .enum(["bold", "italic", "underline", "strikethrough", "link", "code"])
              .describe("The mark type"),
            href: z
              .string()
              .optional()
              .describe("URL for link marks (required when type is 'link')"),
          })
        )
        .describe("Array of inline formatting marks to apply to the text"),
      variant: z
        .string()
        .optional()
        .describe('Target variant by name (e.g., "Mobile"), UUID, or selector (e.g., ":hover"). Omit for base variant.'),
      dryRun: z
        .boolean()
        .optional()
        .describe("When true, shows what would change without persisting. Model is left unchanged."),
    },
    async ({ componentUuid, nodeRef, text, marks, variant, dryRun }) => {
      try {
        if (dryRun) {
          const result = await withDryRun(() =>
            updateRichText(apiClient, componentUuid, nodeRef, text, marks, variant)
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
                  },
                  null,
                  2
                ),
              },
            ],
          };
        }

        const result = await updateRichText(apiClient, componentUuid, nodeRef, text, marks, variant);
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
                },
                null,
                2
              ),
            },
          ],
        };
      } catch (err: any) {
        return handleMutationError("updating rich text", err);
      }
    }
  );

  // --- update-styles ---
  // Updates CSS styles on a TplTag node. Targets the base variant by default;
  // when `variant` is provided, targets that specific variant's VariantSetting.
  // Supports dry-run mode.
  server.tool(
    "update-styles",
    "Update CSS styles on an element in a component. Uses camelCase property names (e.g., fontSize, backgroundColor). " +
    "Note: backgroundColor maps to the background shorthand internally. Border/outline shorthands are expanded to longhands. " +
    "Use list-style-properties to see all valid property names. " +
    "Values can reference design tokens with \"token:TokenName\" or \"token:uuid\" (e.g., {\"color\": \"token:Primary Blue\"}).",
    {
      componentUuid: z
        .string()
        .describe("UUID of the component containing the node"),
      nodeRef: z
        .string()
        .describe(
          'Node reference: UUID, name, path, or index'
        ),
      styles: z
        .record(z.string())
        .describe(
          'CSS properties in camelCase format (e.g., {"fontSize": "24px", "backgroundColor": "#ff0000"})'
        ),
      variant: z
        .string()
        .optional()
        .describe('Target variant by name (e.g., "Mobile"), UUID, or selector (e.g., ":hover"). Omit for base variant.'),
      dryRun: z
        .boolean()
        .optional()
        .describe("When true, shows what would change without persisting. Model is left unchanged."),
    },
    async ({ componentUuid, nodeRef, styles, variant, dryRun }) => {
      try {
        if (dryRun) {
          const result = await withDryRun(() =>
            updateStyles(apiClient, componentUuid, nodeRef, styles, variant)
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
                  },
                  null,
                  2
                ),
              },
            ],
          };
        }

        const result = await updateStyles(
          apiClient,
          componentUuid,
          nodeRef,
          styles,
          variant
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
                },
                null,
                2
              ),
            },
          ],
        };
      } catch (err: any) {
        return handleMutationError("updating styles", err);
      }
    }
  );

  // --- update-attrs ---
  // Updates HTML attributes on a TplTag node. Targets the base variant by default;
  // when `variant` is provided, targets that specific variant's VariantSetting.
  // Supports standard HTML, ARIA, and data-* attributes. Rejects event handlers.
  // Pass null as value to remove an attribute.
  server.tool(
    "update-attrs",
    "Update HTML attributes on an element. Supports standard HTML attrs (id, class, href, etc.), ARIA attrs (role, aria-label, etc.), and data-* attrs. Pass null to remove an attribute. Dynamic values: prefix with $ or wrap in {{...}}.",
    {
      componentUuid: z
        .string()
        .describe("UUID of the component containing the node"),
      nodeRef: z
        .string()
        .describe(
          'Node reference: UUID, name (e.g., "Hero Title"), path (e.g., "HeroSection.Title"), or index (e.g., "#2")'
        ),
      attrs: z
        .record(z.any())
        .describe(
          'HTML attributes to set. Static values: {"href": "/about", "aria-label": "Nav"}. Dynamic: {"href": "$props.url"} or {"href": "{{props.url}}"}. Remove: {"title": null}'
        ),
      variant: z
        .string()
        .optional()
        .describe('Target variant by name (e.g., "Mobile"), UUID, or selector (e.g., ":hover"). Omit for base variant.'),
      dryRun: z
        .boolean()
        .optional()
        .describe("When true, shows what would change without persisting. Model is left unchanged."),
    },
    async ({ componentUuid, nodeRef, attrs, variant, dryRun }) => {
      try {
        if (dryRun) {
          const result = await withDryRun(() =>
            updateAttrs(apiClient, componentUuid, nodeRef, attrs, variant)
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
                  },
                  null,
                  2
                ),
              },
            ],
          };
        }

        const result = await updateAttrs(
          apiClient,
          componentUuid,
          nodeRef,
          attrs,
          variant
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
                },
                null,
                2
              ),
            },
          ],
        };
      } catch (err: any) {
        return handleMutationError("updating attributes", err);
      }
    }
  );

  // --- add-child ---
  // Converts PlasmicElement JSON to TplTag nodes and inserts into parent.
  // Supports slot targeting: when parentRef is a TplComponent, use the `slot`
  // field to specify which named slot to add content to (defaults to "children").
  // M3: invalidates node resolver cache for the component (structural edit).
  // Supports dry-run mode (no cache invalidation in dry-run).
  server.tool(
    "add-child",
    "Add a new child element to a container node or a named slot on a component instance. " +
      "Accepts PlasmicElement JSON (vbox, text, img, button, component types). " +
      "When parentRef is a component instance, use the `slot` field to target a specific slot (defaults to \"children\").",
    {
      componentUuid: z
        .string()
        .describe("UUID of the component containing the parent node"),
      parentRef: z
        .string()
        .describe("Reference to the parent node (UUID, name, path, or index)"),
      child: z.any().describe("PlasmicElement JSON defining the new child"),
      position: z
        .union([z.string(), z.number()])
        .optional()
        .describe(
          'Where to insert: "first", "last" (default), or a numeric index'
        ),
      slot: z
        .string()
        .optional()
        .describe(
          "Target slot name on a component instance (e.g., \"header\", \"footer\"). " +
            "Only valid when parentRef is a TplComponent. Defaults to \"children\" if omitted."
        ),
      dryRun: z
        .boolean()
        .optional()
        .describe("When true, shows what would change without persisting. Model is left unchanged."),
    },
    async ({ componentUuid, parentRef, child, position, slot, dryRun }) => {
      try {
        if (dryRun) {
          const result = await withDryRun(() =>
            addChild(apiClient, componentUuid, parentRef, child, position, slot)
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
                  },
                  null,
                  2
                ),
              },
            ],
          };
        }

        const result = await addChild(
          apiClient,
          componentUuid,
          parentRef,
          child,
          position,
          slot
        );
        // Structural edit: invalidate node resolver cache for this component
        invalidateNodeCache(componentUuid);
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
                },
                null,
                2
              ),
            },
          ],
        };
      } catch (err: any) {
        return handleMutationError("adding child", err);
      }
    }
  );

  // --- remove-child ---
  // Removes a node from its parent's children array.
  // M3: invalidates node resolver cache for the component (structural edit).
  // Supports dry-run mode (no cache invalidation in dry-run).
  server.tool(
    "remove-child",
    "Remove an element from a component. Cannot remove the component's root node.",
    {
      componentUuid: z
        .string()
        .describe("UUID of the component containing the node"),
      nodeRef: z
        .string()
        .describe("Reference to the node to remove (UUID, name, path, or index)"),
      dryRun: z
        .boolean()
        .optional()
        .describe("When true, shows what would change without persisting. Model is left unchanged."),
    },
    async ({ componentUuid, nodeRef, dryRun }) => {
      try {
        if (dryRun) {
          const result = await withDryRun(() =>
            removeChild(apiClient, componentUuid, nodeRef)
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
                  },
                  null,
                  2
                ),
              },
            ],
          };
        }

        const result = await removeChild(apiClient, componentUuid, nodeRef);
        // Structural edit: invalidate node resolver cache for this component
        invalidateNodeCache(componentUuid);
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                {
                  success: true,
                  removed: result.removedName ?? result.removedUuid,
                  revision: result.save.revisionNum,
                },
                null,
                2
              ),
            },
          ],
        };
      } catch (err: any) {
        return handleMutationError("removing child", err);
      }
    }
  );

  // --- move-child ---
  // Moves a node from its current parent to a new parent.
  // M3: invalidates node resolver cache for the component (structural edit).
  // Supports dry-run mode (no cache invalidation in dry-run).
  server.tool(
    "move-child",
    "Move an element to a new parent within the same component. Detects and prevents cycles.",
    {
      componentUuid: z
        .string()
        .describe("UUID of the component containing the nodes"),
      nodeRef: z
        .string()
        .describe("Reference to the node to move (UUID, name, path, or index)"),
      newParentRef: z
        .string()
        .describe("Reference to the new parent node"),
      position: z
        .union([z.string(), z.number()])
        .optional()
        .describe(
          'Where to insert: "first", "last" (default), or a numeric index'
        ),
      dryRun: z
        .boolean()
        .optional()
        .describe("When true, shows what would change without persisting. Model is left unchanged."),
    },
    async ({ componentUuid, nodeRef, newParentRef, position, dryRun }) => {
      try {
        if (dryRun) {
          const result = await withDryRun(() =>
            moveChild(apiClient, componentUuid, nodeRef, newParentRef, position)
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
                    position: result.position,
                    message: "Dry run: no changes persisted",
                  },
                  null,
                  2
                ),
              },
            ],
          };
        }

        const result = await moveChild(
          apiClient,
          componentUuid,
          nodeRef,
          newParentRef,
          position
        );
        // Structural edit: invalidate node resolver cache for this component
        invalidateNodeCache(componentUuid);
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                {
                  success: true,
                  moved: result.movedName ?? result.movedUuid,
                  newParent: result.newParentName ?? result.newParentUuid,
                  position: result.position,
                  revision: result.save.revisionNum,
                },
                null,
                2
              ),
            },
          ],
        };
      } catch (err: any) {
        return handleMutationError("moving child", err);
      }
    }
  );

  // --- clone-child ---
  // Duplicates a node and all its descendants within a component.
  // By default the clone is inserted as the next sibling of the original.
  // Supports dry-run mode (no persistence or cache invalidation in dry-run).
  server.tool(
    "clone-child",
    "Duplicate an existing element and all its descendants. Creates a deep copy with new UUIDs. Clone is inserted as a sibling after the original by default.",
    {
      componentUuid: z
        .string()
        .describe("UUID of the component containing the node"),
      nodeRef: z
        .string()
        .describe(
          "Reference to the node to clone (UUID, name, path, or index)"
        ),
      newName: z
        .string()
        .optional()
        .describe(
          'Name for the cloned node. Defaults to "Original Name (copy)" if the original has a name.'
        ),
      parentRef: z
        .string()
        .optional()
        .describe(
          "Reference to a different parent to insert the clone into. If omitted, clone is inserted as a sibling of the original."
        ),
      position: z
        .union([z.string(), z.number()])
        .optional()
        .describe(
          'Where to insert the clone: "first", "last" (default), or a numeric index. Only used with parentRef.'
        ),
      dryRun: z
        .boolean()
        .optional()
        .describe(
          "When true, shows what would change without persisting. Model is left unchanged."
        ),
    },
    async ({ componentUuid, nodeRef, newName, parentRef, position, dryRun }) => {
      try {
        if (dryRun) {
          const result = await withDryRun(() =>
            cloneChild(apiClient, componentUuid, nodeRef, newName, parentRef, position)
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
                    message: "Dry run: no changes persisted",
                  },
                  null,
                  2
                ),
              },
            ],
          };
        }

        const result = await cloneChild(
          apiClient,
          componentUuid,
          nodeRef,
          newName,
          parentRef,
          position
        );
        // Structural edit: invalidate node resolver cache for this component
        invalidateNodeCache(componentUuid);
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
                  revision: result.save.revisionNum,
                },
                null,
                2
              ),
            },
          ],
        };
      } catch (err: any) {
        return handleMutationError("cloning child", err);
      }
    }
  );

  // --- begin-batch ---
  // Starts a batch edit session. Subsequent edit operations accumulate changes
  // without saving. Use end-batch to save all changes in a single revision.
  server.tool(
    "begin-batch",
    "Start a batch edit session. Edits will be accumulated and saved together when end-batch is called.",
    {},
    async () => {
      try {
        requireSession();
        const batchId = beginBatch();
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                {
                  success: true,
                  batchId,
                  message:
                    "Batch session started. Edits will accumulate until end-batch is called.",
                },
                null,
                2
              ),
            },
          ],
        };
      } catch (err: any) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error starting batch: ${err.message}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  // --- end-batch ---
  // Saves all accumulated changes from a batch session in a single revision.
  server.tool(
    "end-batch",
    "End a batch edit session and save all accumulated changes in a single revision.",
    {
      batchId: z
        .string()
        .optional()
        .describe("Optional batch ID for verification"),
    },
    async ({ batchId }) => {
      try {
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
                },
                null,
                2
              ),
            },
          ],
        };
      } catch (err: any) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error ending batch: ${err.message}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  // --- undo ---
  // Reverts the most recent edit operation by applying inverse mutations.
  server.tool(
    "undo",
    "Undo the most recent edit operation. Reverts the model change and saves.",
    {},
    async () => {
      try {
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
                },
                null,
                2
              ),
            },
          ],
        };
      } catch (err: any) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error undoing: ${err.message}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  // --- list-style-properties ---
  // Returns the full list of valid CSS property names accepted by update-styles.
  // Helps Claude discover correct property names and avoid trial-and-error.
  server.tool(
    "list-style-properties",
    "Returns all valid CSS property names accepted by update-styles. Use this to discover correct property names when styling elements.",
    {
      filter: z
        .string()
        .optional()
        .describe('Optional filter to search property names (e.g., "border", "flex"). Returns only matching properties.'),
    },
    async ({ filter }) => {
      try {
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
                },
                null,
                2
              ),
            },
          ],
        };
      } catch (err: any) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error listing style properties: ${err.message}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  // --- save-project ---
  // Force a full (non-incremental) save of the current in-memory model.
  // Useful as a checkpoint after a series of incremental saves, when the
  // developer suspects drift between in-memory model and server, or as a
  // "force sync" operation. Unlike incremental saves (which only send deltas),
  // this sends the complete model state.
  server.tool(
    "save-project",
    "Force a full save of the current in-memory model to the server. Useful as a checkpoint or to reconcile drift after incremental saves.",
    {},
    async () => {
      try {
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
                },
                null,
                2
              ),
            },
          ],
        };
      } catch (err: any) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error saving project: ${err.message}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  // --- refresh-project ---
  // Re-fetches the project bundle to sync with server state.
  // Useful after 412 conflicts or when another user has made changes.
  // M3: clears node resolver cache (model is fully replaced).
  server.tool(
    "refresh-project",
    "Reload the project from the server to sync with latest changes. Clears undo history.",
    {},
    async () => {
      try {
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
                },
                null,
                2
              ),
            },
          ],
        };
      } catch (err: any) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error refreshing project: ${err.message}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  // --- rename-component ---
  // Renames a page or component. Uses TplMgr.renameComponent() which
  // handles name deduplication automatically. Optionally updates the page
  // URL path. Client-side model mutation + save.
  server.tool(
    "rename-component",
    "Rename a page or component. Handles name deduplication automatically. Optionally update the page URL path.",
    {
      componentUuid: z
        .string()
        .describe("UUID of the component or page to rename"),
      newName: z
        .string()
        .min(1, "New name is required")
        .describe("New name for the component (PascalCase recommended)"),
      newPath: z
        .string()
        .optional()
        .describe("New URL path for pages (e.g., '/landing'). Only applies to page components."),
    },
    async ({ componentUuid, newName, newPath }) => {
      try {
        const result = await renameComponent(
          apiClient,
          componentUuid,
          newName,
          newPath
        );
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
                },
                null,
                2
              ),
            },
          ],
        };
      } catch (err: any) {
        return handleMutationError("renaming component", err);
      }
    }
  );

  // --- update-page-meta ---
  // Sets page-level SEO metadata (title, description, OG image, canonical,
  // path). Only fields explicitly provided are updated. Throws if the target
  // component is not a page.
  server.tool(
    "update-page-meta",
    "Set page SEO metadata: title, description, Open Graph image, canonical URL, and/or page path. Only provided fields are updated.",
    {
      componentUuid: z
        .string()
        .describe("UUID of the page component"),
      title: z
        .string()
        .optional()
        .describe("Page title for SEO (e.g., 'Welcome to My Site')"),
      description: z
        .string()
        .optional()
        .describe("Page description for SEO meta tag"),
      openGraphImage: z
        .string()
        .optional()
        .describe("Open Graph image URL for social sharing"),
      canonical: z
        .string()
        .optional()
        .describe("Canonical URL for SEO"),
      path: z
        .string()
        .optional()
        .describe("Update the page URL path (e.g., '/about-us')"),
    },
    async ({ componentUuid, title, description, openGraphImage, canonical, path: pagePath }) => {
      try {
        const result = await updatePageMeta(apiClient, componentUuid, {
          title,
          description,
          openGraphImage,
          canonical,
          path: pagePath,
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
                },
                null,
                2
              ),
            },
          ],
        };
      } catch (err: any) {
        return handleMutationError("updating page metadata", err);
      }
    }
  );

  // --- get-page-meta ---
  // Reads page-level metadata including SEO fields. Unlike get-project-meta
  // which only shows path, this surfaces title, description, OG image, etc.
  server.tool(
    "get-page-meta",
    "Read page metadata including SEO fields (title, description, Open Graph image, canonical URL). Only works on page components.",
    {
      componentUuid: z
        .string()
        .describe("UUID of the page component"),
    },
    async ({ componentUuid }) => {
      try {
        const session = requireSession();
        const component = session.site.components?.find(
          (c: any) => c.uuid === componentUuid
        );

        if (!component) {
          return {
            content: [
              {
                type: "text" as const,
                text: `Component UUID "${componentUuid}" not found. Use list-components to see available components.`,
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
            { type: "text" as const, text: JSON.stringify(meta, null, 2) },
          ],
        };
      } catch (err: any) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error reading page metadata: ${err.message}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  // --- get-preview-url ---
  // Constructs preview and studio URLs from the auth host, project ID, and
  // page path. No server call needed — purely computed from session state.
  server.tool(
    "get-preview-url",
    "Get preview and studio URLs for a page or component. No server call needed.",
    {
      componentUuid: z
        .string()
        .describe("UUID of the component or page"),
    },
    async ({ componentUuid }) => {
      try {
        const session = requireSession();
        const component = session.site.components?.find(
          (c: any) => c.uuid === componentUuid
        );

        if (!component) {
          return {
            content: [
              {
                type: "text" as const,
                text: `Component UUID "${componentUuid}" not found. Use list-components to see available components.`,
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
            { type: "text" as const, text: JSON.stringify(result, null, 2) },
          ],
        };
      } catch (err: any) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error getting preview URL: ${err.message}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  // --- delete-component ---
  // Deletes a component or page from the project. Checks for references
  // from other components; if references exist and force is not true, throws
  // an error listing the referencing components. Uses TplMgr.removeComponent()
  // for the actual deletion.
  server.tool(
    "delete-component",
    "Delete a page or component. Checks for references from other components. Use force: true to override reference check.",
    {
      componentUuid: z
        .string()
        .describe("UUID of the component or page to delete"),
      force: z
        .boolean()
        .optional()
        .describe("Override reference check and force deletion"),
    },
    async ({ componentUuid, force }) => {
      try {
        const result = await deleteComponent(apiClient, componentUuid, force);
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
                },
                null,
                2
              ),
            },
          ],
        };
      } catch (err: any) {
        return handleMutationError("deleting component", err);
      }
    }
  );

  // --- set-visibility ---
  // Controls element visibility per variant: show, hide (not rendered), or
  // display:none (CSS hidden). Uses dataCond + PLASMIC_DISPLAY_NONE marker
  // on the VariantSetting to match Studio's internal visibility model.
  server.tool(
    "set-visibility",
    "Set element visibility per variant. Use to hide/show elements for responsive layouts " +
      "or conditional rendering. visible=true shows element, visible=false removes from render, " +
      'visible="displayNone" hides via CSS display:none.',
    {
      componentUuid: z
        .string()
        .describe("UUID of the component containing the node"),
      nodeRef: z
        .string()
        .describe(
          'Node reference: UUID, name (e.g., "Hero Title"), path (e.g., "HeroSection.Title"), or index (e.g., "#2")'
        ),
      visible: z
        .union([z.boolean(), z.literal("displayNone")])
        .describe(
          'Visibility state: true (show), false (not rendered), or "displayNone" (CSS hidden)'
        ),
      variant: z
        .string()
        .optional()
        .describe(
          'Target variant by name (e.g., "Mobile"), UUID, or selector (e.g., ":hover"). Omit for base variant.'
        ),
      dryRun: z
        .boolean()
        .optional()
        .describe(
          "When true, shows what would change without persisting. Model is left unchanged."
        ),
    },
    async ({ componentUuid, nodeRef, visible, variant, dryRun }) => {
      try {
        if (dryRun) {
          const result = await withDryRun(() =>
            setVisibility(apiClient, componentUuid, nodeRef, visible, variant)
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
                  },
                  null,
                  2
                ),
              },
            ],
          };
        }

        const result = await setVisibility(
          apiClient,
          componentUuid,
          nodeRef,
          visible,
          variant
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
                },
                null,
                2
              ),
            },
          ],
        };
      } catch (err: any) {
        return handleMutationError("setting visibility", err);
      }
    }
  );

  // --- set-data-cond ---
  // Sets or removes a JavaScript condition expression for conditional rendering.
  // The condition is evaluated at render time — the element only renders when truthy.
  // Separate from set-visibility: visibility is a simple tri-state toggle, while
  // data-cond enables arbitrary JS-based conditional logic.
  server.tool(
    "set-data-cond",
    "Set a data condition expression for conditional rendering on an element. " +
      'The condition is a JavaScript expression evaluated at render time (e.g., "$ctx.user.isLoggedIn"). ' +
      "Pass null to remove the condition.",
    {
      componentUuid: z
        .string()
        .describe("UUID of the component containing the node"),
      nodeRef: z
        .string()
        .describe(
          'Node reference: UUID, name (e.g., "Hero Title"), path (e.g., "HeroSection.Title"), or index (e.g., "#2")'
        ),
      condition: z
        .string()
        .nullable()
        .describe(
          'JavaScript condition expression (e.g., "$ctx.showBanner") or null to remove'
        ),
      variant: z
        .string()
        .optional()
        .describe(
          'Target variant by name (e.g., "Mobile"), UUID, or selector (e.g., ":hover"). Omit for base variant.'
        ),
      dryRun: z
        .boolean()
        .optional()
        .describe(
          "When true, shows what would change without persisting. Model is left unchanged."
        ),
    },
    async ({ componentUuid, nodeRef, condition, variant, dryRun }) => {
      try {
        if (dryRun) {
          const result = await withDryRun(() =>
            setDataCond(
              apiClient,
              componentUuid,
              nodeRef,
              condition,
              variant
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
                    previousCondition: result.previousCondition,
                    newCondition: result.newCondition,
                    message: "Dry run: no changes persisted",
                  },
                  null,
                  2
                ),
              },
            ],
          };
        }

        const result = await setDataCond(
          apiClient,
          componentUuid,
          nodeRef,
          condition,
          variant
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
                },
                null,
                2
              ),
            },
          ],
        };
      } catch (err: any) {
        return handleMutationError("setting data condition", err);
      }
    }
  );

  // --- create-token ---
  // Creates a new style token on the site's design system.
  server.tool(
    "create-token",
    "Create a new design token (color, spacing, font, etc.) on the site. " +
      'Example: name="Primary Blue", type="Color", value="#0066FF".',
    {
      name: z.string().describe("Token name (e.g., \"Primary Blue\", \"Space MD\")"),
      type: z
        .enum([
          "Color",
          "Spacing",
          "Opacity",
          "LineHeight",
          "FontFamily",
          "FontSize",
        ])
        .describe("Token type"),
      value: z
        .string()
        .describe(
          'CSS value for the token (e.g., "#0066FF", "16px", "Inter, sans-serif")'
        ),
      dryRun: z
        .boolean()
        .optional()
        .describe(
          "When true, shows what would change without persisting."
        ),
    },
    async ({ name, type, value, dryRun }) => {
      try {
        if (dryRun) {
          const result = await withDryRun(() =>
            createToken(apiClient, name, type, value)
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
                  },
                  null,
                  2
                ),
              },
            ],
          };
        }

        const result = await createToken(apiClient, name, type, value);
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
                },
                null,
                2
              ),
            },
          ],
        };
      } catch (err: any) {
        return handleMutationError("creating token", err);
      }
    }
  );

  // --- update-token ---
  // Updates a token's value and/or name.
  server.tool(
    "update-token",
    "Update an existing design token's value and/or name. " +
      "Provide tokenRef as the token name or UUID.",
    {
      tokenRef: z
        .string()
        .describe(
          'Token reference: name (e.g., "Primary Blue") or UUID'
        ),
      value: z
        .string()
        .optional()
        .describe(
          'New CSS value (e.g., "#FF0000", "24px"). Omit to keep current value.'
        ),
      name: z
        .string()
        .optional()
        .describe("New token name. Omit to keep current name."),
      dryRun: z
        .boolean()
        .optional()
        .describe(
          "When true, shows what would change without persisting."
        ),
    },
    async ({ tokenRef, value, name, dryRun }) => {
      try {
        if (!value && !name) {
          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify(
                  {
                    error: true,
                    message:
                      "At least one of 'value' or 'name' must be provided.",
                  },
                  null,
                  2
                ),
              },
            ],
            isError: true,
          };
        }

        if (dryRun) {
          const result = await withDryRun(() =>
            updateToken(apiClient, tokenRef, value, name)
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
                  },
                  null,
                  2
                ),
              },
            ],
          };
        }

        const result = await updateToken(apiClient, tokenRef, value, name);
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
                },
                null,
                2
              ),
            },
          ],
        };
      } catch (err: any) {
        return handleMutationError("updating token", err);
      }
    }
  );

  // --- remove-token ---
  // Removes a token from the site and inlines all references to its resolved value.
  server.tool(
    "remove-token",
    "Remove a design token from the site. All style references to this token " +
      "are inlined to the token's current resolved value before removal.",
    {
      tokenRef: z
        .string()
        .describe(
          'Token reference: name (e.g., "Primary Blue") or UUID'
        ),
      dryRun: z
        .boolean()
        .optional()
        .describe(
          "When true, shows what would change without persisting."
        ),
    },
    async ({ tokenRef, dryRun }) => {
      try {
        if (dryRun) {
          const result = await withDryRun(() =>
            removeToken(apiClient, tokenRef)
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
                  },
                  null,
                  2
                ),
              },
            ],
          };
        }

        const result = await removeToken(apiClient, tokenRef);
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
                },
                null,
                2
              ),
            },
          ],
        };
      } catch (err: any) {
        return handleMutationError("removing token", err);
      }
    }
  );

  // --- duplicate-token ---
  // Duplicates an existing token with an optional new name.
  server.tool(
    "duplicate-token",
    "Duplicate an existing design token. Creates a copy with a new UUID " +
      "and optionally a new name.",
    {
      tokenRef: z
        .string()
        .describe(
          'Token reference: name (e.g., "Primary Blue") or UUID'
        ),
      newName: z
        .string()
        .optional()
        .describe(
          'Name for the duplicated token. If omitted, auto-generated from source name.'
        ),
      dryRun: z
        .boolean()
        .optional()
        .describe(
          "When true, shows what would change without persisting."
        ),
    },
    async ({ tokenRef, newName, dryRun }) => {
      try {
        if (dryRun) {
          const result = await withDryRun(() =>
            duplicateToken(apiClient, tokenRef, newName)
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
                  },
                  null,
                  2
                ),
              },
            ],
          };
        }

        const result = await duplicateToken(apiClient, tokenRef, newName);
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
                },
                null,
                2
              ),
            },
          ],
        };
      } catch (err: any) {
        return handleMutationError("duplicating token", err);
      }
    }
  );

  // --- set-data-rep ---
  // Sets or removes data repetition on an element, enabling collection-based
  // rendering (e.g., repeating a card for each product in an array).
  // Creates a Rep object with element/index Var and a CustomCode collection expression.
  server.tool(
    "set-data-rep",
    "Set data repetition on an element to repeat it for each item in a collection. " +
      'Provide a JavaScript expression for the array (e.g., "$queries.products.data", "$ctx.items"). ' +
      "Loop variables are accessible in descendant elements as $ctx.<elementVariable>. " +
      "Pass collection as null to remove repetition.",
    {
      componentUuid: z
        .string()
        .describe("UUID of the component containing the node"),
      nodeRef: z
        .string()
        .describe(
          'Node reference: UUID, name (e.g., "ProductCard"), path (e.g., "Root.CardList"), or index (e.g., "#2")'
        ),
      collection: z
        .string()
        .nullable()
        .describe(
          'JavaScript expression for the array (e.g., "$queries.products.data", "$ctx.items", "[1,2,3]") or null to remove repetition'
        ),
      elementVariable: z
        .string()
        .optional()
        .describe(
          'Loop variable name for each item (default: "currentItem"). Accessible in descendants as $ctx.<name>.'
        ),
      indexVariable: z
        .string()
        .nullable()
        .optional()
        .describe(
          'Loop variable name for the index (default: "currentIndex"). Pass null to omit index variable.'
        ),
      variant: z
        .string()
        .optional()
        .describe(
          'Target variant by name (e.g., "Mobile"), UUID, or selector. Omit for base variant. Note: dataRep is conventionally only set on the base variant.'
        ),
      dryRun: z
        .boolean()
        .optional()
        .describe(
          "When true, shows what would change without persisting. Model is left unchanged."
        ),
    },
    async ({
      componentUuid,
      nodeRef,
      collection,
      elementVariable,
      indexVariable,
      variant,
      dryRun,
    }) => {
      try {
        if (dryRun) {
          const result = await withDryRun(() =>
            setDataRep(
              apiClient,
              componentUuid,
              nodeRef,
              collection,
              elementVariable,
              indexVariable,
              variant
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
                  },
                  null,
                  2
                ),
              },
            ],
          };
        }

        const result = await setDataRep(
          apiClient,
          componentUuid,
          nodeRef,
          collection,
          elementVariable,
          indexVariable,
          variant
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
                },
                null,
                2
              ),
            },
          ],
        };
      } catch (err: any) {
        return handleMutationError("setting data repetition", err);
      }
    }
  );

  // --- list-props ---
  // Lists all props (params) defined on a component. Read-only — no mutation.
  // Returns structured info including type, kind, metadata for each param.
  server.tool(
    "list-props",
    "List all props defined on a component: name, type, kind (prop/slot/state), " +
      "description, default value. Use this to understand a component's interface.",
    {
      componentUuid: z
        .string()
        .describe("UUID of the component to list props for"),
    },
    async ({ componentUuid }) => {
      try {
        const session = requireSession();
        const component = session.site.components?.find(
          (c: any) => c.uuid === componentUuid
        );

        if (!component) {
          return {
            content: [
              {
                type: "text" as const,
                text: `Component UUID "${componentUuid}" not found. Use list-components to see available components.`,
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
                },
                null,
                2
              ),
            },
          ],
        };
      } catch (err: any) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error listing props: ${err.message}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  // --- add-prop ---
  // Creates a new prop (PropParam) on a component definition.
  // Supported types: text, number, boolean, object, href, eventHandler.
  server.tool(
    "add-prop",
    "Add a prop to a component definition. The prop becomes part of the component's " +
      "interface and can be set on instances, used in dynamic text ($props.name), " +
      "or used in data conditions ($props.showIcon).",
    {
      componentUuid: z
        .string()
        .describe("UUID of the component to add the prop to"),
      name: z
        .string()
        .describe(
          'Prop name (valid JS identifier, e.g., "title", "showIcon", "itemCount")'
        ),
      type: z
        .enum(["text", "number", "boolean", "object", "href", "eventHandler"])
        .describe("Prop type"),
      defaultValue: z
        .string()
        .optional()
        .describe(
          'Default value for the prop. For text: the string value (e.g., "Untitled"). ' +
            'For number: numeric string (e.g., "42"). For boolean: "true" or "false".'
        ),
      description: z
        .string()
        .optional()
        .describe("Description of the prop shown in Studio"),
      dryRun: z
        .boolean()
        .optional()
        .describe(
          "When true, shows what would change without persisting."
        ),
    },
    async ({ componentUuid, name, type, defaultValue, description, dryRun }) => {
      try {
        if (dryRun) {
          const result = await withDryRun(() =>
            addProp(apiClient, componentUuid, name, type, defaultValue, description)
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
                  },
                  null,
                  2
                ),
              },
            ],
          };
        }

        const result = await addProp(
          apiClient, componentUuid, name, type, defaultValue, description
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
                },
                null,
                2
              ),
            },
          ],
        };
      } catch (err: any) {
        return handleMutationError("adding prop", err);
      }
    }
  );

  // --- remove-prop ---
  // Removes a prop from a component definition. Cleans up Args on instances.
  server.tool(
    "remove-prop",
    "Remove a prop from a component definition. All Arg overrides on instances " +
      "referencing this prop are cleaned up automatically.",
    {
      componentUuid: z
        .string()
        .describe("UUID of the component to remove the prop from"),
      propRef: z
        .string()
        .describe(
          'Prop reference: name (e.g., "title") or UUID'
        ),
      dryRun: z
        .boolean()
        .optional()
        .describe(
          "When true, shows what would change without persisting."
        ),
    },
    async ({ componentUuid, propRef, dryRun }) => {
      try {
        if (dryRun) {
          const result = await withDryRun(() =>
            removeProp(apiClient, componentUuid, propRef)
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
                  },
                  null,
                  2
                ),
              },
            ],
          };
        }

        const result = await removeProp(apiClient, componentUuid, propRef);
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
                },
                null,
                2
              ),
            },
          ],
        };
      } catch (err: any) {
        return handleMutationError("removing prop", err);
      }
    }
  );

  // --- update-prop ---
  // Updates a prop's name, default value, and/or description.
  server.tool(
    "update-prop",
    "Update an existing prop's name, default value, and/or description. " +
      "Type cannot be changed — use remove-prop + add-prop instead.",
    {
      componentUuid: z
        .string()
        .describe("UUID of the component containing the prop"),
      propRef: z
        .string()
        .describe(
          'Prop reference: name (e.g., "title") or UUID'
        ),
      name: z
        .string()
        .optional()
        .describe("New prop name. Omit to keep current name."),
      defaultValue: z
        .string()
        .optional()
        .describe(
          'New default value (same format as add-prop). Omit to keep current default.'
        ),
      description: z
        .string()
        .optional()
        .describe("New description. Omit to keep current. Pass empty string to clear."),
      dryRun: z
        .boolean()
        .optional()
        .describe(
          "When true, shows what would change without persisting."
        ),
    },
    async ({ componentUuid, propRef, name, defaultValue, description, dryRun }) => {
      try {
        if (!name && defaultValue === undefined && description === undefined) {
          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify(
                  {
                    error: true,
                    message:
                      "At least one of 'name', 'defaultValue', or 'description' must be provided.",
                  },
                  null,
                  2
                ),
              },
            ],
            isError: true,
          };
        }

        if (dryRun) {
          const result = await withDryRun(() =>
            updateProp(apiClient, componentUuid, propRef, name, defaultValue, description)
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
                  },
                  null,
                  2
                ),
              },
            ],
          };
        }

        const result = await updateProp(
          apiClient, componentUuid, propRef, name, defaultValue, description
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
                },
                null,
                2
              ),
            },
          ],
        };
      } catch (err: any) {
        return handleMutationError("updating prop", err);
      }
    }
  );

  // --- list-states ---
  // List all named states on a component.
  server.tool(
    "list-states",
    "List all named state variables on a component. " +
      "Returns name, variableType, accessType, and initialValue for each state.",
    {
      componentUuid: z
        .string()
        .describe("UUID of the component to list states for (from list-components)"),
    },
    async ({ componentUuid }) => {
      try {
        const session = requireSession();
        const component = session.site.components?.find(
          (c: any) => c.uuid === componentUuid
        );

        if (!component) {
          return {
            content: [
              {
                type: "text" as const,
                text: `Component UUID "${componentUuid}" not found. Use list-components to see available components.`,
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
                  componentUuid,
                  componentName: component.name,
                  stateCount: states.length,
                  states,
                },
                null,
                2
              ),
            },
          ],
        };
      } catch (err: any) {
        return handleMutationError("listing states", err);
      }
    }
  );

  // --- add-state ---
  // Create a new named state variable on a component.
  server.tool(
    "add-state",
    "Create a new named state variable on a component. " +
      "Supported variable types: text, number, boolean, array, object. " +
      "Access types: private (default), readonly, writable. " +
      "The state is usable in dynamic text ($state.name), data-cond, and interactions.",
    {
      componentUuid: z
        .string()
        .describe("UUID of the component to add the state to"),
      name: z
        .string()
        .describe('State variable name (e.g., "isOpen", "count", "searchQuery")'),
      variableType: z
        .enum(["text", "number", "boolean", "array", "object"])
        .describe("Type of the state variable"),
      accessType: z
        .enum(["private", "readonly", "writable"])
        .optional()
        .describe(
          'Access type: "private" (default, internal only), "readonly" (exposed as read-only prop), "writable" (exposed as read-write prop)'
        ),
      initialValue: z
        .string()
        .optional()
        .describe(
          'Initial value as a string: text is auto-quoted, number/boolean validated. E.g., "false", "0", "hello"'
        ),
      dryRun: z
        .boolean()
        .optional()
        .describe(
          "When true, shows what would change without persisting."
        ),
    },
    async ({ componentUuid, name, variableType, accessType, initialValue, dryRun }) => {
      try {
        if (dryRun) {
          const result = await withDryRun(() =>
            addState(apiClient, componentUuid, name, variableType, accessType ?? "private", initialValue)
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
                  },
                  null,
                  2
                ),
              },
            ],
          };
        }

        const result = await addState(
          apiClient, componentUuid, name, variableType, accessType ?? "private", initialValue
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
                },
                null,
                2
              ),
            },
          ],
        };
      } catch (err: any) {
        return handleMutationError("adding state", err);
      }
    }
  );

  // --- remove-state ---
  // Remove a named state from a component with cleanup.
  server.tool(
    "remove-state",
    "Remove a named state variable from a component. " +
      "Cleans up associated params and arg bindings on TplComponent instances.",
    {
      componentUuid: z
        .string()
        .describe("UUID of the component containing the state"),
      stateRef: z
        .string()
        .describe(
          'State reference: name (e.g., "isOpen") or param UUID'
        ),
      dryRun: z
        .boolean()
        .optional()
        .describe(
          "When true, shows what would change without persisting."
        ),
    },
    async ({ componentUuid, stateRef, dryRun }) => {
      try {
        if (dryRun) {
          const result = await withDryRun(() =>
            removeState(apiClient, componentUuid, stateRef)
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
                  },
                  null,
                  2
                ),
              },
            ],
          };
        }

        const result = await removeState(apiClient, componentUuid, stateRef);
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
                },
                null,
                2
              ),
            },
          ],
        };
      } catch (err: any) {
        return handleMutationError("removing state", err);
      }
    }
  );

  // --- update-state ---
  // Update a state's name, access type, and/or initial value.
  server.tool(
    "update-state",
    "Update a state variable's name, access type, and/or initial value. " +
      "Variable type cannot be changed — use remove-state + add-state instead.",
    {
      componentUuid: z
        .string()
        .describe("UUID of the component containing the state"),
      stateRef: z
        .string()
        .describe(
          'State reference: name (e.g., "isOpen") or param UUID'
        ),
      name: z
        .string()
        .optional()
        .describe("New state name. Omit to keep current name."),
      accessType: z
        .enum(["private", "readonly", "writable"])
        .optional()
        .describe(
          'New access type. Omit to keep current. When changed to "writable", the state param becomes an external prop.'
        ),
      initialValue: z
        .string()
        .optional()
        .describe(
          'New initial value (same format as add-state). Omit to keep current.'
        ),
      dryRun: z
        .boolean()
        .optional()
        .describe(
          "When true, shows what would change without persisting."
        ),
    },
    async ({ componentUuid, stateRef, name, accessType, initialValue, dryRun }) => {
      try {
        if (!name && accessType === undefined && initialValue === undefined) {
          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify(
                  {
                    error: true,
                    message:
                      "At least one of 'name', 'accessType', or 'initialValue' must be provided.",
                  },
                  null,
                  2
                ),
              },
            ],
            isError: true,
          };
        }

        if (dryRun) {
          const result = await withDryRun(() =>
            updateState(apiClient, componentUuid, stateRef, name, accessType, initialValue)
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
                  },
                  null,
                  2
                ),
              },
            ],
          };
        }

        const result = await updateState(
          apiClient, componentUuid, stateRef, name, accessType, initialValue
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
                },
                null,
                2
              ),
            },
          ],
        };
      } catch (err: any) {
        return handleMutationError("updating state", err);
      }
    }
  );

  // --- list-interactions ---
  // List all interactions on a TplTag element.
  server.tool(
    "list-interactions",
    "List all event handler interactions on an element. " +
      "Returns event name, action, args, and condition for each interaction.",
    {
      componentUuid: z
        .string()
        .describe("UUID of the component containing the element"),
      nodeRef: z
        .string()
        .describe(
          'Element reference: UUID, name, path (e.g., "Root.Button"), or index (e.g., "#2")'
        ),
    },
    async ({ componentUuid, nodeRef }) => {
      try {
        const session = requireSession();
        const component = session.site.components?.find(
          (c: any) => c.uuid === componentUuid
        );
        if (!component) {
          return {
            content: [
              {
                type: "text" as const,
                text: `Component UUID "${componentUuid}" not found.`,
              },
            ],
            isError: true,
          };
        }

        const interactions = listInteractions(component, nodeRef);
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                {
                  componentUuid,
                  nodeRef,
                  interactionCount: interactions.length,
                  interactions,
                },
                null,
                2
              ),
            },
          ],
        };
      } catch (err: any) {
        return handleMutationError("listing interactions", err);
      }
    }
  );

  // --- add-interaction ---
  // Add an event handler interaction to a TplTag element.
  server.tool(
    "add-interaction",
    "Add an event handler interaction to an element. " +
      "Supported actions: navigation (alias: navigateTo, goToPage), " +
      "updateVariable (alias: setState), customFunction (alias: runCode). " +
      "Events: onClick, onDoubleClick, onMouseEnter, onMouseLeave, " +
      "onFocus, onBlur, onChange, onSubmit, onKeyDown, onKeyUp, onScroll, onLoad.",
    {
      componentUuid: z
        .string()
        .describe("UUID of the component containing the element"),
      nodeRef: z
        .string()
        .describe('Element reference: UUID, name, path, or index'),
      event: z
        .string()
        .describe('Event name (e.g., "onClick", "onChange", "onMouseEnter")'),
      actionName: z
        .string()
        .describe(
          'Action to perform: "navigation" (or "navigateTo"), ' +
            '"updateVariable" (or "setState"), "customFunction" (or "runCode")'
        ),
      args: z
        .record(z.string())
        .describe(
          'Action arguments as key-value pairs. ' +
            'navigation: { "destination": "/about" }. ' +
            'updateVariable: { "variable": "isOpen", "value": "!$state.isOpen" }. ' +
            'customFunction: { "code": "console.log(\'clicked\')" }.'
        ),
      interactionName: z
        .string()
        .optional()
        .describe('Optional human-readable step name (auto-generated if omitted)'),
      condition: z
        .string()
        .optional()
        .describe('Optional JS expression for conditional execution (e.g., "$ctx.isEnabled")'),
      dryRun: z
        .boolean()
        .optional()
        .describe("When true, shows what would change without persisting."),
    },
    async ({ componentUuid, nodeRef, event, actionName, args, interactionName, condition, dryRun }) => {
      try {
        if (dryRun) {
          const result = await withDryRun(() =>
            addInteraction(apiClient, componentUuid, nodeRef, event, actionName, args, interactionName, condition)
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
                  },
                  null,
                  2
                ),
              },
            ],
          };
        }

        const result = await addInteraction(
          apiClient, componentUuid, nodeRef, event, actionName, args, interactionName, condition
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
                },
                null,
                2
              ),
            },
          ],
        };
      } catch (err: any) {
        return handleMutationError("adding interaction", err);
      }
    }
  );

  // --- remove-interaction ---
  // Remove interaction(s) from an element's event handler.
  server.tool(
    "remove-interaction",
    "Remove interaction(s) from an element's event handler. " +
      "Remove a specific interaction by index, or all interactions for an event.",
    {
      componentUuid: z
        .string()
        .describe("UUID of the component containing the element"),
      nodeRef: z
        .string()
        .describe('Element reference: UUID, name, path, or index'),
      event: z
        .string()
        .describe('Event name (e.g., "onClick")'),
      interactionIndex: z
        .number()
        .optional()
        .describe("Index of the interaction to remove. Omit to remove all interactions for the event."),
      dryRun: z
        .boolean()
        .optional()
        .describe("When true, shows what would change without persisting."),
    },
    async ({ componentUuid, nodeRef, event, interactionIndex, dryRun }) => {
      try {
        if (dryRun) {
          const result = await withDryRun(() =>
            removeInteraction(apiClient, componentUuid, nodeRef, event, interactionIndex)
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
                  },
                  null,
                  2
                ),
              },
            ],
          };
        }

        const result = await removeInteraction(
          apiClient, componentUuid, nodeRef, event, interactionIndex
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
                },
                null,
                2
              ),
            },
          ],
        };
      } catch (err: any) {
        return handleMutationError("removing interaction", err);
      }
    }
  );

  // --- list-queries ---
  // List all data queries on a component.
  server.tool(
    "list-queries",
    "List all data queries on a component. " +
      "Returns both client-side (dataQuery) and server-side (serverQuery) queries.",
    {
      componentUuid: z
        .string()
        .describe("UUID of the component to list queries for"),
    },
    async ({ componentUuid }) => {
      try {
        const session = requireSession();
        const component = session.site.components?.find(
          (c: any) => c.uuid === componentUuid
        );
        if (!component) {
          return {
            content: [
              {
                type: "text" as const,
                text: `Component not found: ${componentUuid}`,
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
                  componentUuid,
                  componentName: component.name,
                  queryCount: queries.length,
                  queries,
                },
                null,
                2
              ),
            },
          ],
        };
      } catch (err: any) {
        return handleMutationError("listing queries", err);
      }
    }
  );

  // --- add-query ---
  // Add a data query to a component.
  server.tool(
    "add-query",
    "Add a data query to a component. " +
      "Creates a ComponentDataQuery (client-side) or ComponentServerQuery (server-side). " +
      "Query results are accessible via $queries.queryName in expressions.",
    {
      componentUuid: z
        .string()
        .describe("UUID of the component to add the query to"),
      name: z
        .string()
        .describe('Query name (must be a valid JS identifier, e.g., "products", "userData")'),
      queryType: z
        .enum(["dataQuery", "serverQuery"])
        .optional()
        .describe('Type of query: "dataQuery" (client-side, default) or "serverQuery" (server-side)'),
      dryRun: z
        .boolean()
        .optional()
        .describe("When true, shows what would change without persisting."),
    },
    async ({ componentUuid, name, queryType, dryRun }) => {
      try {
        if (dryRun) {
          const result = await withDryRun(() =>
            addQuery(apiClient, componentUuid, name, queryType ?? "dataQuery")
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
                  },
                  null,
                  2
                ),
              },
            ],
          };
        }

        const result = await addQuery(
          apiClient, componentUuid, name, queryType ?? "dataQuery"
        );
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
                },
                null,
                2
              ),
            },
          ],
        };
      } catch (err: any) {
        return handleMutationError("adding query", err);
      }
    }
  );

  // --- remove-query ---
  // Remove a data query from a component.
  server.tool(
    "remove-query",
    "Remove a data query from a component. " +
      "Cleans up query invalidation references. " +
      "Expressions using $queries.queryName will break at runtime after removal.",
    {
      componentUuid: z
        .string()
        .describe("UUID of the component containing the query"),
      queryRef: z
        .string()
        .describe("Query reference: name or UUID"),
      dryRun: z
        .boolean()
        .optional()
        .describe("When true, shows what would change without persisting."),
    },
    async ({ componentUuid, queryRef, dryRun }) => {
      try {
        if (dryRun) {
          const result = await withDryRun(() =>
            removeQuery(apiClient, componentUuid, queryRef)
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
                  },
                  null,
                  2
                ),
              },
            ],
          };
        }

        const result = await removeQuery(apiClient, componentUuid, queryRef);
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
                },
                null,
                2
              ),
            },
          ],
        };
      } catch (err: any) {
        return handleMutationError("removing query", err);
      }
    }
  );

  // --- update-query ---
  // Rename a data query on a component.
  server.tool(
    "update-query",
    "Rename a data query on a component. " +
      "Updates the query name. Existing $queries.oldName references will need manual update.",
    {
      componentUuid: z
        .string()
        .describe("UUID of the component containing the query"),
      queryRef: z
        .string()
        .describe("Query reference: current name or UUID"),
      name: z
        .string()
        .describe("New query name (must be a valid JS identifier)"),
      dryRun: z
        .boolean()
        .optional()
        .describe("When true, shows what would change without persisting."),
    },
    async ({ componentUuid, queryRef, name, dryRun }) => {
      try {
        if (dryRun) {
          const result = await withDryRun(() =>
            updateQuery(apiClient, componentUuid, queryRef, name)
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
                  },
                  null,
                  2
                ),
              },
            ],
          };
        }

        const result = await updateQuery(apiClient, componentUuid, queryRef, name);
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
                },
                null,
                2
              ),
            },
          ],
        };
      } catch (err: any) {
        return handleMutationError("updating query", err);
      }
    }
  );

  // ─── Mixin tools ──────────────────────────────────────────────────────────

  server.tool(
    "list-mixins",
    "List all mixins (reusable style bundles) in the active project. " +
      "Returns name, UUID, styles, and forTheme flag for each mixin.",
    {},
    async () => {
      try {
        const mixins = listMixins();
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                { mixinCount: mixins.length, mixins },
                null,
                2
              ),
            },
          ],
        };
      } catch (err: any) {
        return {
          content: [{ type: "text" as const, text: `Error: ${err.message}` }],
          isError: true,
        };
      }
    }
  );

  server.tool(
    "create-mixin",
    "Create a new mixin (reusable style bundle). " +
      "Optionally provide initial CSS styles. Mixin can later be applied to elements with apply-mixin.",
    {
      name: z.string().describe("Name for the new mixin"),
      styles: z
        .record(z.string())
        .optional()
        .describe(
          "Optional CSS styles in camelCase format (e.g., {\"fontSize\": \"16px\", \"color\": \"#333\"})"
        ),
      dryRun: z
        .boolean()
        .optional()
        .describe("When true, shows what would change without persisting."),
    },
    async ({ name, styles, dryRun }) => {
      try {
        if (dryRun) {
          const result = await withDryRun(() =>
            createMixin(apiClient, name, styles)
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
                  },
                  null,
                  2
                ),
              },
            ],
          };
        }

        const result = await createMixin(apiClient, name, styles);
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
                },
                null,
                2
              ),
            },
          ],
        };
      } catch (err: any) {
        return handleMutationError("creating mixin", err);
      }
    }
  );

  server.tool(
    "update-mixin",
    "Update a mixin's name and/or styles. " +
      "At least one of newName or styles must be provided.",
    {
      mixinRef: z
        .string()
        .describe("Mixin reference: current name or UUID"),
      newName: z
        .string()
        .optional()
        .describe("New name for the mixin"),
      styles: z
        .record(z.string())
        .optional()
        .describe(
          "CSS styles to set/update in camelCase format (e.g., {\"fontSize\": \"18px\"})"
        ),
      dryRun: z
        .boolean()
        .optional()
        .describe("When true, shows what would change without persisting."),
    },
    async ({ mixinRef, newName, styles, dryRun }) => {
      try {
        if (dryRun) {
          const result = await withDryRun(() =>
            updateMixin(apiClient, mixinRef, newName, styles)
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
                  },
                  null,
                  2
                ),
              },
            ],
          };
        }

        const result = await updateMixin(apiClient, mixinRef, newName, styles);
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
                },
                null,
                2
              ),
            },
          ],
        };
      } catch (err: any) {
        return handleMutationError("updating mixin", err);
      }
    }
  );

  server.tool(
    "remove-mixin",
    "Remove a mixin from the project. The mixin will be detached from all elements that use it.",
    {
      mixinRef: z
        .string()
        .describe("Mixin reference: name or UUID"),
      dryRun: z
        .boolean()
        .optional()
        .describe("When true, shows what would change without persisting."),
    },
    async ({ mixinRef, dryRun }) => {
      try {
        if (dryRun) {
          const result = await withDryRun(() =>
            removeMixin(apiClient, mixinRef)
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
                  },
                  null,
                  2
                ),
              },
            ],
          };
        }

        const result = await removeMixin(apiClient, mixinRef);
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
                },
                null,
                2
              ),
            },
          ],
        };
      } catch (err: any) {
        return handleMutationError("removing mixin", err);
      }
    }
  );

  server.tool(
    "apply-mixin",
    "Apply a mixin to an element's base variant setting. " +
      "Idempotent — applying the same mixin twice is a no-op.",
    {
      componentUuid: z
        .string()
        .describe("UUID of the component containing the element"),
      nodeRef: z
        .string()
        .describe(
          "Node reference: UUID, name, path, or index"
        ),
      mixinRef: z
        .string()
        .describe("Mixin reference: name or UUID"),
      dryRun: z
        .boolean()
        .optional()
        .describe("When true, shows what would change without persisting."),
    },
    async ({ componentUuid, nodeRef, mixinRef, dryRun }) => {
      try {
        if (dryRun) {
          const result = await withDryRun(() =>
            applyMixin(apiClient, componentUuid, nodeRef, mixinRef)
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
                  },
                  null,
                  2
                ),
              },
            ],
          };
        }

        const result = await applyMixin(
          apiClient,
          componentUuid,
          nodeRef,
          mixinRef
        );
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
                },
                null,
                2
              ),
            },
          ],
        };
      } catch (err: any) {
        return handleMutationError("applying mixin", err);
      }
    }
  );

  server.tool(
    "detach-mixin",
    "Remove a mixin from an element's base variant setting. " +
      "Throws if the mixin is not currently applied to the element.",
    {
      componentUuid: z
        .string()
        .describe("UUID of the component containing the element"),
      nodeRef: z
        .string()
        .describe(
          "Node reference: UUID, name, path, or index"
        ),
      mixinRef: z
        .string()
        .describe("Mixin reference: name or UUID"),
      dryRun: z
        .boolean()
        .optional()
        .describe("When true, shows what would change without persisting."),
    },
    async ({ componentUuid, nodeRef, mixinRef, dryRun }) => {
      try {
        if (dryRun) {
          const result = await withDryRun(() =>
            detachMixin(apiClient, componentUuid, nodeRef, mixinRef)
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
                  },
                  null,
                  2
                ),
              },
            ],
          };
        }

        const result = await detachMixin(
          apiClient,
          componentUuid,
          nodeRef,
          mixinRef
        );
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
                },
                null,
                2
              ),
            },
          ],
        };
      } catch (err: any) {
        return handleMutationError("detaching mixin", err);
      }
    }
  );

  // ─── Animation tools ──────────────────────────────────────────────────────

  server.tool(
    "list-animation-sequences",
    "List all animation sequences (named @keyframes definitions) in the active project. " +
      "Returns name, UUID, and keyframe count for each.",
    {},
    async () => {
      try {
        const sequences = listAnimationSequences();
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                { sequenceCount: sequences.length, sequences },
                null,
                2
              ),
            },
          ],
        };
      } catch (err: any) {
        return {
          content: [{ type: "text" as const, text: `Error: ${err.message}` }],
          isError: true,
        };
      }
    }
  );

  server.tool(
    "create-animation-sequence",
    "Create a new animation sequence (@keyframes definition). " +
      "Optionally provide keyframes as an array of { percentage: 0-100, styles: {...} }.",
    {
      name: z.string().describe("Name for the animation sequence"),
      keyframes: z
        .array(
          z.object({
            percentage: z.number().min(0).max(100).describe("Keyframe stop percentage (0-100)"),
            styles: z.record(z.string()).describe("CSS styles at this keyframe stop"),
          })
        )
        .optional()
        .describe("Optional keyframes array. Each keyframe has a percentage (0-100) and styles."),
      dryRun: z
        .boolean()
        .optional()
        .describe("When true, shows what would change without persisting."),
    },
    async ({ name, keyframes, dryRun }) => {
      try {
        if (dryRun) {
          const result = await withDryRun(() =>
            createAnimationSequence(apiClient, name, keyframes)
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
                  },
                  null,
                  2
                ),
              },
            ],
          };
        }

        const result = await createAnimationSequence(apiClient, name, keyframes);
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
                },
                null,
                2
              ),
            },
          ],
        };
      } catch (err: any) {
        return handleMutationError("creating animation sequence", err);
      }
    }
  );

  server.tool(
    "update-animation-sequence",
    "Update an animation sequence's name and/or keyframes. " +
      "At least one of newName or keyframes must be provided. " +
      "Providing keyframes replaces all existing keyframes.",
    {
      seqRef: z
        .string()
        .describe("Animation sequence reference: current name or UUID"),
      newName: z
        .string()
        .optional()
        .describe("New name for the animation sequence"),
      keyframes: z
        .array(
          z.object({
            percentage: z.number().min(0).max(100).describe("Keyframe stop percentage (0-100)"),
            styles: z.record(z.string()).describe("CSS styles at this keyframe stop"),
          })
        )
        .optional()
        .describe("New keyframes (replaces existing). Each has percentage (0-100) and styles."),
      dryRun: z
        .boolean()
        .optional()
        .describe("When true, shows what would change without persisting."),
    },
    async ({ seqRef, newName, keyframes, dryRun }) => {
      try {
        if (dryRun) {
          const result = await withDryRun(() =>
            updateAnimationSequence(apiClient, seqRef, newName, keyframes)
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
                  },
                  null,
                  2
                ),
              },
            ],
          };
        }

        const result = await updateAnimationSequence(apiClient, seqRef, newName, keyframes);
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
                },
                null,
                2
              ),
            },
          ],
        };
      } catch (err: any) {
        return handleMutationError("updating animation sequence", err);
      }
    }
  );

  server.tool(
    "remove-animation-sequence",
    "Remove an animation sequence from the project. " +
      "All element animations referencing this sequence are automatically cleaned up.",
    {
      seqRef: z
        .string()
        .describe("Animation sequence reference: name or UUID"),
      dryRun: z
        .boolean()
        .optional()
        .describe("When true, shows what would change without persisting."),
    },
    async ({ seqRef, dryRun }) => {
      try {
        if (dryRun) {
          const result = await withDryRun(() =>
            removeAnimationSequence(apiClient, seqRef)
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
                  },
                  null,
                  2
                ),
              },
            ],
          };
        }

        const result = await removeAnimationSequence(apiClient, seqRef);
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
                },
                null,
                2
              ),
            },
          ],
        };
      } catch (err: any) {
        return handleMutationError("removing animation sequence", err);
      }
    }
  );

  server.tool(
    "add-node-animation",
    "Apply an animation sequence to an element with timing parameters. " +
      "Creates an Animation referencing the sequence and adds it to the element's base variant.",
    {
      componentUuid: z
        .string()
        .describe("UUID of the component containing the element"),
      nodeRef: z
        .string()
        .describe("Node reference: UUID, name, path, or index"),
      seqRef: z
        .string()
        .describe("Animation sequence reference: name or UUID"),
      duration: z.string().optional().describe("Animation duration (default: '1s')"),
      delay: z.string().optional().describe("Animation delay (default: '0s')"),
      timingFunction: z.string().optional().describe("Timing function (default: 'ease')"),
      iterationCount: z.string().optional().describe("Iteration count (default: '1', or 'infinite')"),
      direction: z
        .enum(["normal", "reverse", "alternate", "alternate-reverse"])
        .optional()
        .describe("Animation direction (default: 'normal')"),
      fillMode: z
        .enum(["none", "forwards", "backwards", "both"])
        .optional()
        .describe("Fill mode (default: 'none')"),
      playState: z
        .enum(["paused", "running"])
        .optional()
        .describe("Play state (default: 'running')"),
      dryRun: z
        .boolean()
        .optional()
        .describe("When true, shows what would change without persisting."),
    },
    async ({ componentUuid, nodeRef, seqRef, duration, delay, timingFunction, iterationCount, direction, fillMode, playState, dryRun }) => {
      try {
        if (dryRun) {
          const result = await withDryRun(() =>
            addNodeAnimation(apiClient, componentUuid, nodeRef, seqRef, duration, delay, timingFunction, iterationCount, direction, fillMode, playState)
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
                  },
                  null,
                  2
                ),
              },
            ],
          };
        }

        const result = await addNodeAnimation(
          apiClient, componentUuid, nodeRef, seqRef,
          duration, delay, timingFunction, iterationCount, direction, fillMode, playState
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
                },
                null,
                2
              ),
            },
          ],
        };
      } catch (err: any) {
        return handleMutationError("adding animation to element", err);
      }
    }
  );

  server.tool(
    "remove-node-animation",
    "Remove animation(s) from an element. " +
      "Specify seqRef to remove by sequence, animationIndex to remove by position, " +
      "or omit both to remove all animations.",
    {
      componentUuid: z
        .string()
        .describe("UUID of the component containing the element"),
      nodeRef: z
        .string()
        .describe("Node reference: UUID, name, path, or index"),
      seqRef: z
        .string()
        .optional()
        .describe("Remove animations referencing this sequence (name or UUID)"),
      animationIndex: z
        .number()
        .optional()
        .describe("Remove the animation at this index (0-based)"),
      dryRun: z
        .boolean()
        .optional()
        .describe("When true, shows what would change without persisting."),
    },
    async ({ componentUuid, nodeRef, seqRef, animationIndex, dryRun }) => {
      try {
        if (dryRun) {
          const result = await withDryRun(() =>
            removeNodeAnimation(apiClient, componentUuid, nodeRef, seqRef, animationIndex)
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
                  },
                  null,
                  2
                ),
              },
            ],
          };
        }

        const result = await removeNodeAnimation(apiClient, componentUuid, nodeRef, seqRef, animationIndex);
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
                },
                null,
                2
              ),
            },
          ],
        };
      } catch (err: any) {
        return handleMutationError("removing animation from element", err);
      }
    }
  );

  // ─── Theme tools ──────────────────────────────────────────────────────────

  server.tool(
    "list-themes",
    "List all themes in the active project. " +
      "Returns index, active status, default typography, and per-tag style overrides. " +
      "Themes are referenced by index (they have no name or UUID).",
    {},
    async () => {
      try {
        const themes = listThemes();
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                { themeCount: themes.length, themes },
                null,
                2
              ),
            },
          ],
        };
      } catch (err: any) {
        return {
          content: [{ type: "text" as const, text: `Error: ${err.message}` }],
          isError: true,
        };
      }
    }
  );

  server.tool(
    "create-theme",
    "Create a new theme with default typography styles and optional per-tag overrides. " +
      "Valid tag selectors: a, blockquote, code, em, h1-h6, i, li, ol, p, pre, strong, ul. " +
      "Pseudo-selectors like :hover can be appended (e.g., 'a:hover').",
    {
      defaultStyles: z
        .record(z.string())
        .optional()
        .describe("Default typography CSS styles (fontSize, fontFamily, color, etc.)"),
      themeStyles: z
        .array(
          z.object({
            selector: z.string().describe("HTML tag selector (e.g., 'h1', 'a:hover')"),
            styles: z.record(z.string()).describe("CSS styles for this selector"),
          })
        )
        .optional()
        .describe("Per-tag style overrides"),
      setActive: z
        .boolean()
        .optional()
        .describe("Set the new theme as active immediately"),
      dryRun: z
        .boolean()
        .optional()
        .describe("When true, shows what would change without persisting."),
    },
    async ({ defaultStyles, themeStyles, setActive, dryRun }) => {
      try {
        if (dryRun) {
          const result = await withDryRun(() =>
            createTheme(apiClient, defaultStyles, themeStyles, setActive)
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
                  },
                  null,
                  2
                ),
              },
            ],
          };
        }

        const result = await createTheme(apiClient, defaultStyles, themeStyles, setActive);
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                {
                  success: true,
                  themeIndex: result.themeIndex,
                  revision: result.save.revisionNum,
                },
                null,
                2
              ),
            },
          ],
        };
      } catch (err: any) {
        return handleMutationError("creating theme", err);
      }
    }
  );

  server.tool(
    "update-theme",
    "Update a theme's default typography and/or per-tag style overrides. " +
      "At least one of defaultStyles or themeStyles must be provided. " +
      "For themeStyles, existing selectors are updated, new selectors are added.",
    {
      themeIndex: z.number().describe("Index of the theme (from list-themes)"),
      defaultStyles: z
        .record(z.string())
        .optional()
        .describe("Default typography CSS styles to update"),
      themeStyles: z
        .array(
          z.object({
            selector: z.string().describe("HTML tag selector (e.g., 'h1', 'a:hover')"),
            styles: z.record(z.string()).describe("CSS styles for this selector"),
          })
        )
        .optional()
        .describe("Per-tag style overrides to update or add"),
      dryRun: z
        .boolean()
        .optional()
        .describe("When true, shows what would change without persisting."),
    },
    async ({ themeIndex, defaultStyles, themeStyles, dryRun }) => {
      try {
        if (dryRun) {
          const result = await withDryRun(() =>
            updateTheme(apiClient, themeIndex, defaultStyles, themeStyles)
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
                  },
                  null,
                  2
                ),
              },
            ],
          };
        }

        const result = await updateTheme(apiClient, themeIndex, defaultStyles, themeStyles);
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
                },
                null,
                2
              ),
            },
          ],
        };
      } catch (err: any) {
        return handleMutationError("updating theme", err);
      }
    }
  );

  server.tool(
    "remove-theme",
    "Remove a theme from the project. Cannot remove the active theme — " +
      "use set-active-theme first to switch to another theme.",
    {
      themeIndex: z.number().describe("Index of the theme to remove (from list-themes)"),
      dryRun: z
        .boolean()
        .optional()
        .describe("When true, shows what would change without persisting."),
    },
    async ({ themeIndex, dryRun }) => {
      try {
        if (dryRun) {
          const result = await withDryRun(() =>
            removeTheme(apiClient, themeIndex)
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
                  },
                  null,
                  2
                ),
              },
            ],
          };
        }

        const result = await removeTheme(apiClient, themeIndex);
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                {
                  success: true,
                  removedIndex: result.removedIndex,
                  revision: result.save.revisionNum,
                },
                null,
                2
              ),
            },
          ],
        };
      } catch (err: any) {
        return handleMutationError("removing theme", err);
      }
    }
  );

  server.tool(
    "set-active-theme",
    "Set the active theme by index. Pass themeIndex: null to deactivate all themes.",
    {
      themeIndex: z
        .number()
        .nullable()
        .describe("Index of the theme to activate, or null to deactivate all"),
      dryRun: z
        .boolean()
        .optional()
        .describe("When true, shows what would change without persisting."),
    },
    async ({ themeIndex, dryRun }) => {
      try {
        if (dryRun) {
          const result = await withDryRun(() =>
            setActiveTheme(apiClient, themeIndex)
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
                  },
                  null,
                  2
                ),
              },
            ],
          };
        }

        const result = await setActiveTheme(apiClient, themeIndex);
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                {
                  success: true,
                  activeThemeIndex: result.activeThemeIndex,
                  revision: result.save.revisionNum,
                },
                null,
                2
              ),
            },
          ],
        };
      } catch (err: any) {
        return handleMutationError("setting active theme", err);
      }
    }
  );

  // ========================================================================
  // reorder-children
  // ========================================================================

  server.tool(
    "reorder-children",
    "Reorder the children of a container element. Provide child refs in desired order; unlisted children are appended at end.",
    {
      componentUuid: z.string().describe("UUID of the component"),
      parentRef: z.string().describe("Reference to the parent container (UUID, name, path, or index)"),
      childRefs: z.array(z.string()).describe("Ordered array of child references (UUID, name, path, or index)"),
      dryRun: z.boolean().optional().describe("When true, preview changes without persisting"),
    },
    async ({ componentUuid, parentRef, childRefs, dryRun }) => {
      try {
        if (dryRun) {
          const result = await withDryRun(() =>
            reorderChildren(apiClient, componentUuid, parentRef, childRefs)
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
                  },
                  null,
                  2
                ),
              },
            ],
          };
        }

        const result = await reorderChildren(apiClient, componentUuid, parentRef, childRefs);
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
                },
                null,
                2
              ),
            },
          ],
        };
      } catch (err: any) {
        return handleMutationError("reordering children", err);
      }
    }
  );

  // ========================================================================
  // convert-to-page
  // ========================================================================

  server.tool(
    "convert-to-page",
    "Convert a component to a page. Optionally specify a URL path.",
    {
      componentUuid: z.string().describe("UUID of the component to convert"),
      path: z.string().optional().describe("URL path for the page (e.g., '/about'). Auto-generated from name if omitted."),
    },
    async ({ componentUuid, path }) => {
      try {
        const result = await convertToPage(apiClient, componentUuid, path);
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
                },
                null,
                2
              ),
            },
          ],
        };
      } catch (err: any) {
        return handleMutationError("converting to page", err);
      }
    }
  );

  // ========================================================================
  // convert-to-component
  // ========================================================================

  server.tool(
    "convert-to-component",
    "Convert a page back to a regular component. Removes pageMeta.",
    {
      componentUuid: z.string().describe("UUID of the page to convert"),
    },
    async ({ componentUuid }) => {
      try {
        const result = await convertToComponent(apiClient, componentUuid);
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                {
                  success: true,
                  componentName: result.componentName,
                  revision: result.save.revisionNum,
                },
                null,
                2
              ),
            },
          ],
        };
      } catch (err: any) {
        return handleMutationError("converting to component", err);
      }
    }
  );

  // ========================================================================
  // list-data-tokens
  // ========================================================================

  server.tool(
    "list-data-tokens",
    "List all data tokens in the project. Data tokens hold JSON values accessible as $ctx.tokenName in expressions.",
    {},
    async () => {
      try {
        const result = listDataTokens();
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      } catch (err: any) {
        return handleMutationError("listing data tokens", err);
      }
    }
  );

  // ========================================================================
  // create-data-token
  // ========================================================================

  server.tool(
    "create-data-token",
    "Create a new data token with a name and JSON value. Accessible in expressions as $ctx.tokenName.",
    {
      name: z.string().describe("Name for the data token"),
      value: z.string().optional().describe("JSON value (e.g., '\"hello\"', '42', '{\"key\": true}'). Defaults to 'null'."),
    },
    async ({ name, value }) => {
      try {
        const result = await createDataToken(apiClient, name, value);
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                {
                  success: true,
                  token: result.token,
                  revision: result.save.revisionNum,
                },
                null,
                2
              ),
            },
          ],
        };
      } catch (err: any) {
        return handleMutationError("creating data token", err);
      }
    }
  );

  // ========================================================================
  // update-data-token
  // ========================================================================

  server.tool(
    "update-data-token",
    "Update a data token's name and/or value.",
    {
      tokenRef: z.string().describe("Token reference (UUID or name)"),
      name: z.string().optional().describe("New name"),
      value: z.string().optional().describe("New JSON value"),
    },
    async ({ tokenRef, name, value }) => {
      try {
        const result = await updateDataToken(apiClient, tokenRef, name, value);
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                {
                  success: true,
                  token: result.token,
                  revision: result.save.revisionNum,
                },
                null,
                2
              ),
            },
          ],
        };
      } catch (err: any) {
        return handleMutationError("updating data token", err);
      }
    }
  );

  // ========================================================================
  // remove-data-token
  // ========================================================================

  server.tool(
    "remove-data-token",
    "Remove a data token from the project.",
    {
      tokenRef: z.string().describe("Token reference (UUID or name)"),
    },
    async ({ tokenRef }) => {
      try {
        const result = await removeDataToken(apiClient, tokenRef);
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
                },
                null,
                2
              ),
            },
          ],
        };
      } catch (err: any) {
        return handleMutationError("removing data token", err);
      }
    }
  );

  // ========================================================================
  // list-global-variant-groups
  // ========================================================================

  server.tool(
    "list-global-variant-groups",
    "List all global variant groups (custom and screen breakpoints) with their variants.",
    {},
    async () => {
      try {
        const result = listGlobalVariantGroups();
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      } catch (err: any) {
        return handleMutationError("listing global variant groups", err);
      }
    }
  );

  // ========================================================================
  // create-global-variant-group
  // ========================================================================

  server.tool(
    "create-global-variant-group",
    "Create a global variant group (e.g., 'Dark Mode', 'Language'). Optionally provide initial variant names.",
    {
      name: z.string().describe("Name for the variant group"),
      type: z.enum(["single", "multi"]).optional().describe("'single' (one active at a time, default) or 'multi' (multiple active)"),
      initialVariants: z.array(z.string()).optional().describe("Names of variants to create immediately"),
    },
    async ({ name, type, initialVariants }) => {
      try {
        const result = await createGlobalVariantGroup(apiClient, name, type, initialVariants);
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                {
                  success: true,
                  group: result.group,
                  revision: result.save.revisionNum,
                },
                null,
                2
              ),
            },
          ],
        };
      } catch (err: any) {
        return handleMutationError("creating global variant group", err);
      }
    }
  );

  // ========================================================================
  // add-global-variant
  // ========================================================================

  server.tool(
    "add-global-variant",
    "Add a variant to an existing global variant group.",
    {
      groupRef: z.string().describe("Group reference (UUID or name)"),
      name: z.string().describe("Name for the new variant"),
    },
    async ({ groupRef, name }) => {
      try {
        const result = await addGlobalVariant(apiClient, groupRef, name);
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                {
                  success: true,
                  variant: result.variant,
                  revision: result.save.revisionNum,
                },
                null,
                2
              ),
            },
          ],
        };
      } catch (err: any) {
        return handleMutationError("adding global variant", err);
      }
    }
  );

  // ========================================================================
  // remove-global-variant-group
  // ========================================================================

  server.tool(
    "remove-global-variant-group",
    "Remove an entire global variant group and all its variants.",
    {
      groupRef: z.string().describe("Group reference (UUID or name)"),
    },
    async ({ groupRef }) => {
      try {
        const result = await removeGlobalVariantGroup(apiClient, groupRef);
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
                },
                null,
                2
              ),
            },
          ],
        };
      } catch (err: any) {
        return handleMutationError("removing global variant group", err);
      }
    }
  );

  // ========================================================================
  // rename-global-variant
  // ========================================================================

  server.tool(
    "rename-global-variant",
    "Rename a global variant.",
    {
      variantRef: z.string().describe("Variant reference (UUID or name)"),
      newName: z.string().describe("New name for the variant"),
    },
    async ({ variantRef, newName }) => {
      try {
        const result = await renameGlobalVariant(apiClient, variantRef, newName);
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
                },
                null,
                2
              ),
            },
          ],
        };
      } catch (err: any) {
        return handleMutationError("renaming global variant", err);
      }
    }
  );

  return server;
}
