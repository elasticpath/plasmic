/**
 * Scenario schema validation and YAML loader.
 *
 * Reads YAML scenario files from evals/scenarios/, validates them against
 * the EvalScenario schema, and applies CLI filters (tier, domain, scenario ID).
 *
 * Why YAML: scenarios are declarative test definitions that non-engineers should
 * be able to read and write. YAML avoids TypeScript compilation and keeps
 * scenario authoring accessible.
 */

import { readFileSync, readdirSync, statSync } from "fs";
import { resolve, dirname, extname } from "path";
import { fileURLToPath } from "url";
import { parse as parseYaml } from "yaml";
import type { EvalScenario, EvalOptions } from "./types.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const SCENARIOS_DIR = resolve(__dirname, "../scenarios");

const VALID_DOMAINS = [
  "project",
  "inspect",
  "component",
  "node",
  "variant",
  "design",
  "data",
  "interaction",
];

const VALID_GRADER_TYPES = [
  "existence",
  "property",
  "structure",
  "count",
  "data",
  "tool-sequence",
  "tool-params",
  "no-errors",
];

/**
 * Load all scenarios from YAML files, validate, and apply filters.
 * Warns on invalid scenarios but continues loading (spec edge case EC6).
 */
export function loadScenarios(options?: EvalOptions): EvalScenario[] {
  const files = findYamlFiles(SCENARIOS_DIR);
  const scenarios: EvalScenario[] = [];
  const seenIds = new Set<string>();

  for (const file of files) {
    const content = readFileSync(file, "utf-8");
    const parsed = parseYaml(content);

    // YAML files contain a top-level `scenarios` array
    const items = Array.isArray(parsed)
      ? parsed
      : parsed?.scenarios ?? [parsed];

    for (const item of items) {
      if (!item || !item.id) continue;

      const warnings = validateScenario(item, seenIds);
      for (const w of warnings) {
        console.error(`[eval] WARNING: ${w}`);
      }

      seenIds.add(item.id);
      scenarios.push(normalizeScenario(item));
    }
  }

  return filterScenarios(scenarios, options);
}

function findYamlFiles(dir: string): string[] {
  const files: string[] = [];
  try {
    for (const entry of readdirSync(dir)) {
      const fullPath = resolve(dir, entry);
      const stat = statSync(fullPath);
      if (
        stat.isFile() &&
        (extname(entry) === ".yaml" || extname(entry) === ".yml")
      ) {
        files.push(fullPath);
      }
    }
  } catch {
    // Directory doesn't exist yet — return empty list
  }
  return files.sort();
}

function validateScenario(raw: any, seenIds: Set<string>): string[] {
  const warnings: string[] = [];

  if (seenIds.has(raw.id)) {
    warnings.push(`Duplicate scenario ID: "${raw.id}"`);
  }

  if (!raw.description) {
    warnings.push(`Scenario "${raw.id}" missing description`);
  }

  if (raw.domains) {
    for (const d of raw.domains) {
      if (!VALID_DOMAINS.includes(d)) {
        warnings.push(`Scenario "${raw.id}" has invalid domain: "${d}"`);
      }
    }
  }

  // Warn but don't error if no graders — track but don't affect pass rate (spec EC6)
  if (!raw.graders || raw.graders.length === 0) {
    warnings.push(`Scenario "${raw.id}" has no graders defined`);
  }

  if (raw.graders) {
    for (const g of raw.graders) {
      if (!VALID_GRADER_TYPES.includes(g.type)) {
        warnings.push(
          `Scenario "${raw.id}" has invalid grader type: "${g.type}"`
        );
      }
    }
  }

  return warnings;
}

function normalizeScenario(raw: any): EvalScenario {
  return {
    id: raw.id,
    description: raw.description ?? "",
    domains: raw.domains ?? [],
    tier: raw.tier ?? "simple",
    graders: (raw.graders ?? []).map((g: any) => ({
      type: g.type,
      params: g.params ?? {},
    })),
    timeout: raw.timeout ?? 60,
    setup: raw.setup?.map((s: any) => ({
      tool: s.tool,
      params: s.params ?? {},
    })),
    visual: raw.visual,
    requiredMode: raw.requiredMode,
  };
}

function filterScenarios(
  scenarios: EvalScenario[],
  options?: EvalOptions
): EvalScenario[] {
  const currentMode = options?.integration ? "integration" : "mock";
  return scenarios.filter((s) => {
    // Always filter by requiredMode, even when no options provided (defaults to mock)
    if (s.requiredMode && s.requiredMode !== currentMode) return false;
    if (options?.tier && s.tier !== options.tier) return false;
    if (options?.domain && !s.domains.includes(options.domain)) return false;
    if (options?.scenario && s.id !== options.scenario) return false;
    return true;
  });
}
