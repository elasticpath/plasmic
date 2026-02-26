/**
 * Standalone scenario validator — comprehensive checks beyond basic loading.
 *
 * Validates all scenario YAML files against the full set of invariants:
 *   - Unique IDs across all files
 *   - Valid STRAP domain names
 *   - Implemented grader types
 *   - Setup step tool names are valid domains
 *   - Required grader params are present
 *   - Scenario counts by tier match targets
 *
 * Why a separate validator: the loader (scenario-loader.ts) does minimal
 * validation during loading — it warns but doesn't block. This validator
 * provides a stricter check for CI and pre-commit hooks, catching issues
 * that would only surface as confusing runtime failures.
 *
 * Can be run standalone: `npx tsx evals/harness/scenario-validator.ts`
 */

import { loadScenarios } from "./scenario-loader.js";
import type { EvalScenario, GraderConfig } from "./types.js";

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

// Required params by grader type (soft check — missing params may still work
// if the grader has defaults, but are likely mistakes)
const GRADER_REQUIRED_PARAMS: Record<string, string[]> = {
  existence: ["entityType", "name"],
  property: ["componentUuid", "nodeRef"],
  structure: ["componentUuid"],
  data: ["componentUuid", "checkType"],
  "tool-sequence": ["tools"],
  "tool-params": ["tool"],
  count: [],
  "no-errors": [],
};

// Spec targets for scenario counts by tier
const TIER_TARGETS: Record<string, { min: number; label: string }> = {
  simple: { min: 15, label: "~20" },
  medium: { min: 15, label: "~20" },
  complex: { min: 10, label: "~15-20" },
};

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  stats: {
    totalScenarios: number;
    byTier: Record<string, number>;
    byDomain: Record<string, number>;
    uniqueIds: number;
    duplicateIds: string[];
  };
}

export function validateAllScenarios(): ValidationResult {
  const scenarios = loadScenarios();
  const errors: string[] = [];
  const warnings: string[] = [];

  // Check for duplicate IDs
  const idCounts = new Map<string, number>();
  for (const s of scenarios) {
    idCounts.set(s.id, (idCounts.get(s.id) ?? 0) + 1);
  }
  const duplicateIds = [...idCounts.entries()]
    .filter(([, count]) => count > 1)
    .map(([id]) => id);
  if (duplicateIds.length > 0) {
    errors.push(`Duplicate scenario IDs: ${duplicateIds.join(", ")}`);
  }

  // Per-scenario validation
  for (const scenario of scenarios) {
    const prefix = `[${scenario.id}]`;

    // Check domains
    for (const d of scenario.domains) {
      if (!VALID_DOMAINS.includes(d)) {
        errors.push(`${prefix} Invalid domain: "${d}"`);
      }
    }
    if (scenario.domains.length === 0) {
      warnings.push(`${prefix} No domains specified`);
    }

    // Check graders
    if (scenario.graders.length === 0) {
      warnings.push(`${prefix} No graders defined — will auto-pass`);
    }
    for (const grader of scenario.graders) {
      if (!VALID_GRADER_TYPES.includes(grader.type)) {
        errors.push(`${prefix} Invalid grader type: "${grader.type}"`);
      }
      validateGraderParams(prefix, grader, warnings);
    }

    // Check setup steps
    if (scenario.setup) {
      for (const step of scenario.setup) {
        if (!VALID_DOMAINS.includes(step.tool)) {
          errors.push(
            `${prefix} Setup step uses invalid tool: "${step.tool}"`
          );
        }
        if (!step.params.action) {
          warnings.push(`${prefix} Setup step missing action param`);
        }
      }
    }

    // Check timeout is reasonable
    if (scenario.timeout < 10) {
      warnings.push(
        `${prefix} Very short timeout: ${scenario.timeout}s (may cause false negatives)`
      );
    }
    if (scenario.timeout > 300) {
      warnings.push(
        `${prefix} Very long timeout: ${scenario.timeout}s (consider reducing)`
      );
    }

    // Check tier
    if (!["simple", "medium", "complex"].includes(scenario.tier)) {
      errors.push(`${prefix} Invalid tier: "${scenario.tier}"`);
    }
  }

  // Aggregate stats
  const byTier: Record<string, number> = {};
  const byDomain: Record<string, number> = {};
  for (const s of scenarios) {
    byTier[s.tier] = (byTier[s.tier] ?? 0) + 1;
    for (const d of s.domains) {
      byDomain[d] = (byDomain[d] ?? 0) + 1;
    }
  }

  // Check tier targets
  for (const [tier, target] of Object.entries(TIER_TARGETS)) {
    const count = byTier[tier] ?? 0;
    if (count < target.min) {
      warnings.push(
        `${tier} tier: ${count} scenarios (target: ${target.label})`
      );
    }
  }

  // Check total (spec: 50-80)
  if (scenarios.length < 50) {
    warnings.push(
      `Total scenarios: ${scenarios.length} (spec target: 50-80)`
    );
  }

  // Check domain coverage
  for (const domain of VALID_DOMAINS) {
    if (!byDomain[domain]) {
      warnings.push(`No scenarios cover the "${domain}" domain`);
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    stats: {
      totalScenarios: scenarios.length,
      byTier,
      byDomain,
      uniqueIds: idCounts.size,
      duplicateIds,
    },
  };
}

function validateGraderParams(
  prefix: string,
  grader: GraderConfig,
  warnings: string[]
): void {
  const required = GRADER_REQUIRED_PARAMS[grader.type];
  if (!required) return;

  for (const param of required) {
    if (grader.params[param] === undefined) {
      warnings.push(
        `${prefix} Grader "${grader.type}" missing param: "${param}"`
      );
    }
  }
}

/**
 * Generate a scenario index — a summary of all scenarios for documentation.
 */
export function generateScenarioIndex(
  scenarios: EvalScenario[]
): string {
  const lines = [
    "# Eval Scenario Index",
    "",
    `Total: ${scenarios.length} scenarios`,
    "",
  ];

  for (const tier of ["simple", "medium", "complex"] as const) {
    const tierScenarios = scenarios.filter((s) => s.tier === tier);
    lines.push(`## ${tier.charAt(0).toUpperCase() + tier.slice(1)} (${tierScenarios.length})`);
    lines.push("");
    lines.push("| ID | Domains | Graders | Timeout |");
    lines.push("|---|---|---|---|");
    for (const s of tierScenarios) {
      const graderTypes = [...new Set(s.graders.map((g) => g.type))].join(
        ", "
      );
      lines.push(
        `| ${s.id} | ${s.domains.join(", ")} | ${graderTypes} | ${s.timeout}s |`
      );
    }
    lines.push("");
  }

  return lines.join("\n");
}

// Standalone execution
if (
  typeof process !== "undefined" &&
  process.argv[1] &&
  process.argv[1].includes("scenario-validator")
) {
  const result = validateAllScenarios();

  console.log("=== Scenario Validation ===\n");

  if (result.errors.length > 0) {
    console.log("ERRORS:");
    for (const e of result.errors) {
      console.log(`  ✗ ${e}`);
    }
    console.log("");
  }

  if (result.warnings.length > 0) {
    console.log("WARNINGS:");
    for (const w of result.warnings) {
      console.log(`  ! ${w}`);
    }
    console.log("");
  }

  console.log("STATS:");
  console.log(`  Total scenarios: ${result.stats.totalScenarios}`);
  console.log(`  Unique IDs: ${result.stats.uniqueIds}`);
  console.log(
    `  By tier: ${Object.entries(result.stats.byTier)
      .map(([t, n]) => `${t}=${n}`)
      .join(", ")}`
  );
  console.log(
    `  By domain: ${Object.entries(result.stats.byDomain)
      .map(([d, n]) => `${d}=${n}`)
      .join(", ")}`
  );

  if (result.valid) {
    console.log("\nResult: VALID");
    process.exit(0);
  } else {
    console.log("\nResult: INVALID");
    process.exit(1);
  }
}
