/**
 * MCP server setup and tool registration.
 *
 * Uses McpServer from @modelcontextprotocol/sdk with Zod schemas for input
 * validation. All tools are registered before the transport connects.
 *
 * Tools use three patterns:
 *   - HTTP-only (list-projects, create-page): call Plasmic REST API directly
 *   - Model-read (list-components, get-component-tree, get-project-meta): read
 *     from the in-memory Site model (requires set-project first)
 *   - Session-setup (set-project): fetch bundle → unbundle → store in session
 *
 * CRITICAL: Never use console.log() — stdout is the JSON-RPC transport.
 * All logging goes through console.error().
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { PlasmicApiClient } from "./api-client.js";
import { getAuth } from "./auth.js";
import { requireSession, setSession } from "./session.js";
import { loadProject } from "./model-loader.js";
import { readComponentTree } from "./tree-reader.js";
import { readTokens } from "./token-reader.js";
import { initChangeTracker, disposeChangeTracker } from "./change-tracker.js";

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
        // Dispose previous change tracker if switching projects
        disposeChangeTracker();

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
  // Reads a component's full element tree directly from the in-memory Tpl model.
  // Uses the custom tree reader (NOT the degraded tplToPlasmicElements function).
  // Returns tags, styles, text, images, layout types, children, component refs.
  server.tool(
    "get-component-tree",
    "Get the full element tree of a component with HTML tags, CSS styles, text, images, and layout",
    {
      componentUuid: z
        .string()
        .describe("UUID of the component to inspect"),
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

        const tree = readComponentTree(component);

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

        await apiClient.updateProject(session.projectId, {
          newComponents: [{ name, path: pagePath, body }],
        });

        // Reload model so the new page is visible in subsequent queries
        try {
          disposeChangeTracker();
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

  return server;
}
