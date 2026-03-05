/**
 * devflags-remap.ts
 *
 * Remaps project IDs in a DevFlagOverrides JSON template for a new environment.
 * The devflags template is provided as a JSON file at bootstrap time (not
 * committed to the repo — it's environment-specific configuration).
 *
 * The template is typically exported from an existing environment (e.g.,
 * integration) and contains old project IDs that need to be replaced with
 * the IDs from the newly bootstrapped environment.
 */

import { logger } from "@/wab/server/observability";

/**
 * Entries that need explicit mapping from entry name → hostlessList.json
 * project name(s). These can't be auto-resolved by codeName because they
 * are synthetic, multi-project, or share a codeName with another entry.
 */
const ENTRY_PROJECT_MAP: Record<string, string | string[]> = {
  // Synthetic entries (no real hostless project)
  "Plume Customizable Components": [],
  "More HTML elements": [],

  // Commerce providers (array: commerce base + specific provider)
  "Elastic Path": ["commerce", "commerce-elastic-path"],
  Shopify: ["commerce", "commerce-shopify"],
  Swell: ["commerce", "commerce-swell"],
  Saleor: ["commerce", "commerce-saleor"],

  // Other multi-project entries
  "Ant Design Pro Components": ["antd5", "plasmic-rich-components"],

  // Shares codeName "plasmic-basic-components" with "Developer Components"
  "Loading State": "loading-boundary",
};

/**
 * codeName → hostlessList.json project name for codeNames that don't match
 * the project name directly.
 */
const CODENAME_MAP: Record<string, string> = {
  "plasmic-graph-cms": "plasmic-graphcms",
  "@faker-js/faker": "faker",
};

function lookupProjectId(
  projectName: string,
  projects: Record<string, string>
): string {
  const id = projects[projectName];
  if (!id) {
    throw new Error(
      `Cannot resolve project ID for "${projectName}" — not in created projects`
    );
  }
  return id;
}

/**
 * Resolve which hostlessList.json project name(s) a hostLessComponents
 * entry maps to.
 */
function resolveProjectNames(
  entry: { name?: string; codeName?: string; hidden?: boolean },
  projects: Record<string, string>
): string | string[] | null {
  const { name, codeName } = entry;

  // 1. Explicit name-based overrides
  if (name && name in ENTRY_PROJECT_MAP) {
    return ENTRY_PROJECT_MAP[name];
  }

  // 2. Two "Parallax Scroll" entries share codeName "react-scroll-parallax":
  //    hidden one → "react-scroll-parallax", visible one → "react-scroll-parallax-global"
  if (name === "Parallax Scroll" && !entry.hidden) {
    return "react-scroll-parallax-global";
  }

  // 3. codeName overrides for known mismatches
  if (codeName && codeName in CODENAME_MAP) {
    return CODENAME_MAP[codeName];
  }

  // 4. Direct codeName match against created projects
  if (codeName && codeName in projects) {
    return codeName;
  }

  return null;
}

export interface RemapOptions {
  hostlessWorkspaceId: string;
  /** Map from hostlessList.json project name → newly created project ID */
  projects: Record<string, string>;
}

/**
 * Remap a DevFlagOverrides JSON template for a newly bootstrapped environment.
 *
 * Replaces:
 * - `hostLessWorkspaceId` with the new workspace ID
 * - Every `projectId` in `hostLessComponents` entries with new project IDs
 *
 * Plexus/installable project IDs are deterministic (from the bundle) and
 * don't need remapping.
 */
export function remapDevFlagOverrides(
  input: Record<string, any>,
  opts: RemapOptions
): Record<string, any> {
  const result = JSON.parse(JSON.stringify(input)); // deep clone
  const { hostlessWorkspaceId, projects } = opts;

  // Replace hostless workspace ID
  result.hostLessWorkspaceId = hostlessWorkspaceId;

  // Remap hostLessComponents project IDs
  if (!Array.isArray(result.hostLessComponents)) {
    logger().warn("No hostLessComponents array in devflags template");
    return result;
  }

  let resolved = 0;
  let skipped = 0;

  for (const entry of result.hostLessComponents) {
    const projectNames = resolveProjectNames(entry, projects);

    if (projectNames === null) {
      logger().warn(
        `Unresolved hostLessComponents entry: "${entry.name}" ` +
          `(codeName="${entry.codeName}") — keeping original projectId`
      );
      skipped++;
      continue;
    }

    if (Array.isArray(projectNames)) {
      if (projectNames.length === 0) {
        // Synthetic entry
        entry.projectId = [];
      } else {
        entry.projectId = projectNames.map((n) =>
          lookupProjectId(n, projects)
        );
      }
    } else {
      const newId = lookupProjectId(projectNames, projects);
      // Preserve original shape: if original was array, keep as array
      if (Array.isArray(entry.projectId)) {
        entry.projectId = [newId];
      } else {
        entry.projectId = newId;
      }
    }
    resolved++;
  }

  logger().info(
    `Remapped ${resolved} hostLessComponents entries (${skipped} unresolved)`
  );

  return result;
}
