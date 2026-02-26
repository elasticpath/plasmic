/**
 * State-based graders — validate project state via MCP inspect calls.
 *
 * These graders query the MCP server's current model state to verify that
 * Claude's tool calls actually produced the expected results. They work
 * identically in mock and integration tiers since they use the same MCP
 * protocol to query state.
 *
 * - existence: Entity exists (component, page, node, token, variant, mixin)
 * - property: Node has expected styles, text, or attributes
 * - structure: Child count, nesting depth, node types
 * - data: Data bindings, queries, interactions configured
 *
 * Extra output tolerance (spec SE2): if Claude creates extra nodes beyond
 * what's asked, we pass as long as required entities exist.
 */

import type { GraderConfig, GraderResult } from "../harness/types.js";
import type { McpEvalClient } from "../harness/mcp-client.js";

export async function runStateGrader(
  config: GraderConfig,
  mcpClient: McpEvalClient
): Promise<GraderResult> {
  switch (config.type) {
    case "existence":
      return gradeExistence(config.params, mcpClient);
    case "property":
      return gradeProperty(config.params, mcpClient);
    case "structure":
      return gradeStructure(config.params, mcpClient);
    case "data":
      return gradeData(config.params, mcpClient);
    default:
      return {
        graderType: config.type,
        passed: false,
        message: `Unknown state grader: ${config.type}`,
      };
  }
}

/**
 * existence: Check that an entity exists.
 * params.entityType: "component" | "page" | "node" | "token" | "variant" | "mixin"
 * params.name: string — expected name (case-insensitive substring match)
 * params.componentUuid: string — required for node/variant checks
 */
async function gradeExistence(
  params: Record<string, unknown>,
  mcpClient: McpEvalClient
): Promise<GraderResult> {
  const entityType = params.entityType as string;
  const name = params.name as string;

  try {
    switch (entityType) {
      case "component":
      case "page": {
        const result = await mcpClient.callTool("component", {
          action: "list",
        });
        if (result.isError) {
          return {
            graderType: "existence",
            passed: false,
            message: `Failed to list components: ${result.content}`,
          };
        }
        const data = JSON.parse(result.content);
        const items = [...(data.pages ?? []), ...(data.components ?? [])];
        const found = items.some((item: any) =>
          item.name?.toLowerCase().includes(name.toLowerCase())
        );
        return {
          graderType: "existence",
          passed: found,
          message: found
            ? `Found ${entityType} matching "${name}"`
            : `No ${entityType} found matching "${name}"`,
          details: {
            entityType,
            name,
            availableNames: items.map((i: any) => i.name),
          },
        };
      }

      case "node": {
        const componentUuid = params.componentUuid as string;
        if (!componentUuid) {
          return {
            graderType: "existence",
            passed: false,
            message: "node existence check requires componentUuid",
          };
        }
        const result = await mcpClient.callTool("inspect", {
          action: "summary",
          componentUuid,
          maxDepth: -1,
        });
        if (result.isError) {
          return {
            graderType: "existence",
            passed: false,
            message: `Failed to inspect: ${result.content}`,
          };
        }
        const tree = JSON.parse(result.content);
        const found = findNodeByName(tree, name);
        return {
          graderType: "existence",
          passed: !!found,
          message: found
            ? `Found node matching "${name}"`
            : `No node found matching "${name}"`,
        };
      }

      case "token": {
        const result = await mcpClient.callTool("design", {
          action: "list-tokens",
          ...(params.tokenType ? { tokenType: params.tokenType } : {}),
        });
        if (result.isError) {
          return {
            graderType: "existence",
            passed: false,
            message: `Failed to list tokens: ${result.content}`,
          };
        }
        const tokens = JSON.parse(result.content);
        const tokenList = Array.isArray(tokens)
          ? tokens
          : tokens.tokens ?? [];
        const found = tokenList.some((t: any) =>
          t.name?.toLowerCase().includes(name.toLowerCase())
        );
        return {
          graderType: "existence",
          passed: found,
          message: found
            ? `Found token matching "${name}"`
            : `No token found matching "${name}"`,
        };
      }

      case "variant": {
        const componentUuid = params.componentUuid as string;
        if (!componentUuid) {
          return {
            graderType: "existence",
            passed: false,
            message: "variant existence check requires componentUuid",
          };
        }
        const result = await mcpClient.callTool("variant", {
          action: "list",
          componentUuid,
        });
        if (result.isError) {
          return {
            graderType: "existence",
            passed: false,
            message: `Failed to list variants: ${result.content}`,
          };
        }
        const variants = JSON.parse(result.content);
        const allVariants = [
          ...(variants.styleVariants ?? []),
          ...(variants.variantGroups ?? []).flatMap(
            (g: any) => g.variants ?? []
          ),
        ];
        const found = allVariants.some((v: any) =>
          v.name?.toLowerCase().includes(name.toLowerCase())
        );
        return {
          graderType: "existence",
          passed: found,
          message: found
            ? `Found variant matching "${name}"`
            : `No variant found matching "${name}"`,
        };
      }

      case "mixin": {
        const result = await mcpClient.callTool("design", {
          action: "list-mixins",
        });
        if (result.isError) {
          return {
            graderType: "existence",
            passed: false,
            message: `Failed to list mixins: ${result.content}`,
          };
        }
        const mixins = JSON.parse(result.content);
        const mixinList = Array.isArray(mixins)
          ? mixins
          : mixins.mixins ?? [];
        const found = mixinList.some((m: any) =>
          m.name?.toLowerCase().includes(name.toLowerCase())
        );
        return {
          graderType: "existence",
          passed: found,
          message: found
            ? `Found mixin matching "${name}"`
            : `No mixin found matching "${name}"`,
        };
      }

      default:
        return {
          graderType: "existence",
          passed: false,
          message: `Unknown entity type: "${entityType}"`,
        };
    }
  } catch (err: any) {
    return {
      graderType: "existence",
      passed: false,
      message: `Existence check failed: ${err.message}`,
    };
  }
}

/**
 * property: Check specific style/text/attr values on a node.
 * params.componentUuid: string
 * params.nodeRef: string — node reference (name, UUID, or path)
 * params.styles: Record<string, string> — expected CSS styles (subset match)
 * params.text: string — expected text content (substring match)
 * params.attrs: Record<string, string> — expected HTML attributes
 */
async function gradeProperty(
  params: Record<string, unknown>,
  mcpClient: McpEvalClient
): Promise<GraderResult> {
  const componentUuid = params.componentUuid as string;
  const nodeRef = params.nodeRef as string;

  if (!componentUuid || !nodeRef) {
    return {
      graderType: "property",
      passed: false,
      message: "property check requires componentUuid and nodeRef",
    };
  }

  try {
    const result = await mcpClient.callTool("inspect", {
      action: "node",
      componentUuid,
      nodeRef,
    });
    if (result.isError) {
      return {
        graderType: "property",
        passed: false,
        message: `Failed to inspect node: ${result.content}`,
      };
    }

    const node = JSON.parse(result.content);
    const failures: string[] = [];

    // Check styles (subset match)
    if (params.styles) {
      const expectedStyles = params.styles as Record<string, string>;
      for (const [prop, value] of Object.entries(expectedStyles)) {
        const actual = node.styles?.[prop];
        if (
          !actual ||
          !actual.toLowerCase().includes(value.toLowerCase())
        ) {
          failures.push(
            `Style "${prop}": expected "${value}", got "${actual ?? "undefined"}"`
          );
        }
      }
    }

    // Check text (substring match)
    if (params.text !== undefined) {
      const expectedText = params.text as string;
      const actualText = node.text ?? "";
      if (!actualText.toLowerCase().includes(expectedText.toLowerCase())) {
        failures.push(`Text: expected "${expectedText}", got "${actualText}"`);
      }
    }

    // Check attrs (subset match)
    if (params.attrs) {
      const expectedAttrs = params.attrs as Record<string, string>;
      for (const [attr, value] of Object.entries(expectedAttrs)) {
        const actual = node.attrs?.[attr];
        if (
          !actual ||
          !actual.toLowerCase().includes(value.toLowerCase())
        ) {
          failures.push(
            `Attr "${attr}": expected "${value}", got "${actual ?? "undefined"}"`
          );
        }
      }
    }

    return {
      graderType: "property",
      passed: failures.length === 0,
      message:
        failures.length === 0
          ? "All property checks passed"
          : `Property check failures: ${failures.join("; ")}`,
      details: {
        failures,
        node: { styles: node.styles, text: node.text, attrs: node.attrs },
      },
    };
  } catch (err: any) {
    return {
      graderType: "property",
      passed: false,
      message: `Property check failed: ${err.message}`,
    };
  }
}

/**
 * structure: Check child count, node types, nesting.
 * params.componentUuid: string
 * params.nodeRef: string — optional, defaults to root
 * params.minChildren: number
 * params.maxChildren: number
 * params.childTags: string[] — expected child tag names
 */
async function gradeStructure(
  params: Record<string, unknown>,
  mcpClient: McpEvalClient
): Promise<GraderResult> {
  const componentUuid = params.componentUuid as string;

  if (!componentUuid) {
    return {
      graderType: "structure",
      passed: false,
      message: "structure check requires componentUuid",
    };
  }

  try {
    const inspectParams: Record<string, unknown> = {
      action: "summary",
      componentUuid,
      maxDepth: -1,
    };
    if (params.nodeRef) {
      inspectParams.action = "subtree";
      inspectParams.nodeRef = params.nodeRef;
    }

    const result = await mcpClient.callTool("inspect", inspectParams);
    if (result.isError) {
      return {
        graderType: "structure",
        passed: false,
        message: `Failed to inspect: ${result.content}`,
      };
    }

    const tree = JSON.parse(result.content);
    const children = tree.children ?? [];
    const failures: string[] = [];

    if (params.minChildren !== undefined) {
      const min = params.minChildren as number;
      if (children.length < min) {
        failures.push(
          `Expected at least ${min} children, got ${children.length}`
        );
      }
    }

    if (params.maxChildren !== undefined) {
      const max = params.maxChildren as number;
      if (children.length > max) {
        failures.push(
          `Expected at most ${max} children, got ${children.length}`
        );
      }
    }

    if (params.childTags) {
      const expectedTags = params.childTags as string[];
      const actualTags = children.map(
        (c: any) => c.tag ?? c.type ?? "unknown"
      );
      for (const tag of expectedTags) {
        if (
          !actualTags.some(
            (t: string) => t.toLowerCase() === tag.toLowerCase()
          )
        ) {
          failures.push(
            `Expected child with tag "${tag}", found: ${actualTags.join(", ")}`
          );
        }
      }
    }

    return {
      graderType: "structure",
      passed: failures.length === 0,
      message:
        failures.length === 0
          ? "Structure check passed"
          : `Structure check failures: ${failures.join("; ")}`,
      details: { failures, childCount: children.length },
    };
  } catch (err: any) {
    return {
      graderType: "structure",
      passed: false,
      message: `Structure check failed: ${err.message}`,
    };
  }
}

/**
 * data: Check data bindings, queries, interactions.
 * params.componentUuid: string
 * params.checkType: "queries" | "interactions"
 * params.minCount: number — minimum expected items
 * params.nodeRef: string — required for interactions check
 */
async function gradeData(
  params: Record<string, unknown>,
  mcpClient: McpEvalClient
): Promise<GraderResult> {
  const componentUuid = params.componentUuid as string;
  const checkType = params.checkType as string;

  if (!componentUuid) {
    return {
      graderType: "data",
      passed: false,
      message: "data check requires componentUuid",
    };
  }

  try {
    switch (checkType) {
      case "queries": {
        const result = await mcpClient.callTool("data", {
          action: "list-queries",
          componentUuid,
        });
        if (result.isError) {
          return {
            graderType: "data",
            passed: false,
            message: `Failed to list queries: ${result.content}`,
          };
        }
        const queries = JSON.parse(result.content);
        const minCount = (params.minCount as number) ?? 1;
        const queryList = Array.isArray(queries)
          ? queries
          : queries.queries ?? [];
        return {
          graderType: "data",
          passed: queryList.length >= minCount,
          message: `Found ${queryList.length} queries (expected >= ${minCount})`,
        };
      }

      case "interactions": {
        const nodeRef = params.nodeRef as string;
        if (!nodeRef) {
          return {
            graderType: "data",
            passed: false,
            message: "interactions check requires nodeRef",
          };
        }
        const result = await mcpClient.callTool("interaction", {
          action: "list",
          componentUuid,
          nodeRef,
        });
        if (result.isError) {
          return {
            graderType: "data",
            passed: false,
            message: `Failed to list interactions: ${result.content}`,
          };
        }
        const interactions = JSON.parse(result.content);
        const interactionList = Array.isArray(interactions)
          ? interactions
          : interactions.interactions ?? [];
        const minCount = (params.minCount as number) ?? 1;
        return {
          graderType: "data",
          passed: interactionList.length >= minCount,
          message: `Found ${interactionList.length} interactions (expected >= ${minCount})`,
        };
      }

      default:
        return {
          graderType: "data",
          passed: false,
          message: `Unknown data check type: "${checkType}"`,
        };
    }
  } catch (err: any) {
    return {
      graderType: "data",
      passed: false,
      message: `Data check failed: ${err.message}`,
    };
  }
}

/** Recursively find a node by name in a tree (case-insensitive substring) */
function findNodeByName(tree: any, name: string): any {
  if (tree.name?.toLowerCase().includes(name.toLowerCase())) return tree;
  if (tree.children) {
    for (const child of tree.children) {
      const found = findNodeByName(child, name);
      if (found) return found;
    }
  }
  return null;
}
