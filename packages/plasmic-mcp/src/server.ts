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
  updateStyles,
  addChild,
  removeChild,
  moveChild,
  listVariants,
  renameComponent,
  updatePageMeta,
  deleteComponent,
} from "./edit-tools.js";
import { beginBatch, endBatch, isBatchActive, cancelBatch, getAccumulatedChanges } from "./batch-manager.js";
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

        // Build options only when optional params are provided (backward compatible)
        const hasOptions =
          maxDepth !== undefined || excludeStyles || summaryOnly;
        const tree = hasOptions
          ? readComponentTree(component, {
              maxDepth,
              excludeStyles: excludeStyles || undefined,
              summaryOnly: summaryOnly || undefined,
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
        const node = readNodeDetails(resolved.node);

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

        // Full tree for the file
        const fullTree = readComponentTree(component);
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
        const hasOptions = maxDepth !== undefined || excludeStyles;
        const tree = readSubtree(
          resolved.node,
          hasOptions
            ? {
                maxDepth,
                excludeStyles: excludeStyles || undefined,
              }
            : undefined
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

  // --- update-text ---
  // Updates text content on a TplTag node. Targets the base variant by default;
  // when `variant` is provided, targets that specific variant's VariantSetting.
  // Uses node-resolver to find the target, ChangeRecorder for mutation tracking,
  // and SaveManager for incremental save. Supports dry-run mode.
  server.tool(
    "update-text",
    "Update the text content of an element in a component. Finds the node by UUID, name, path, or index.",
    {
      componentUuid: z
        .string()
        .describe("UUID of the component containing the node"),
      nodeRef: z
        .string()
        .describe(
          'Node reference: UUID, name (e.g., "Hero Title"), path (e.g., "HeroSection.Title"), or index (e.g., "#2")'
        ),
      text: z.string().describe("The new text content"),
      variant: z
        .string()
        .optional()
        .describe('Target variant by name (e.g., "Mobile"), UUID, or selector (e.g., ":hover"). Omit for base variant.'),
      dryRun: z
        .boolean()
        .optional()
        .describe("When true, shows what would change without persisting. Model is left unchanged."),
    },
    async ({ componentUuid, nodeRef, text, variant, dryRun }) => {
      try {
        if (dryRun) {
          const result = await withDryRun(() =>
            updateText(apiClient, componentUuid, nodeRef, text, variant)
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
                    message: "Dry run: no changes persisted",
                  },
                  null,
                  2
                ),
              },
            ],
          };
        }

        const result = await updateText(apiClient, componentUuid, nodeRef, text, variant);
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
                  revision: result.save.revisionNum,
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
              text: `Error updating text: ${err.message}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  // --- update-styles ---
  // Updates CSS styles on a TplTag node. Targets the base variant by default;
  // when `variant` is provided, targets that specific variant's VariantSetting.
  // Supports dry-run mode.
  server.tool(
    "update-styles",
    "Update CSS styles on an element in a component. Uses camelCase property names (e.g., fontSize, backgroundColor).",
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
        return {
          content: [
            {
              type: "text" as const,
              text: `Error updating styles: ${err.message}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  // --- add-child ---
  // Converts PlasmicElement JSON to TplTag nodes and inserts into parent.
  // M3: invalidates node resolver cache for the component (structural edit).
  // Supports dry-run mode (no cache invalidation in dry-run).
  server.tool(
    "add-child",
    "Add a new child element to a container node. Accepts PlasmicElement JSON (vbox, text, img, button types).",
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
      dryRun: z
        .boolean()
        .optional()
        .describe("When true, shows what would change without persisting. Model is left unchanged."),
    },
    async ({ componentUuid, parentRef, child, position, dryRun }) => {
      try {
        if (dryRun) {
          const result = await withDryRun(() =>
            addChild(apiClient, componentUuid, parentRef, child, position)
          );
          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify(
                  {
                    dryRun: true,
                    parent: result.parentName ?? result.parentUuid,
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
                  parent: result.parentName ?? result.parentUuid,
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
        return {
          content: [
            {
              type: "text" as const,
              text: `Error adding child: ${err.message}`,
            },
          ],
          isError: true,
        };
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
        return {
          content: [
            {
              type: "text" as const,
              text: `Error removing child: ${err.message}`,
            },
          ],
          isError: true,
        };
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
        return {
          content: [
            {
              type: "text" as const,
              text: `Error moving child: ${err.message}`,
            },
          ],
          isError: true,
        };
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
        return {
          content: [
            {
              type: "text" as const,
              text: `Error renaming component: ${err.message}`,
            },
          ],
          isError: true,
        };
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
        return {
          content: [
            {
              type: "text" as const,
              text: `Error updating page metadata: ${err.message}`,
            },
          ],
          isError: true,
        };
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
        return {
          content: [
            {
              type: "text" as const,
              text: `Error deleting component: ${err.message}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  return server;
}
