/**
 * Production guards.
 *
 * Keyed on `NODE_ENV === "production"` with no opt-out flag — preview
 * deployments are deliberately held to production standards. Guards throw
 * at factory construction so a misconfigured deployment fails on boot
 * rather than serving forgeable sessions, but they stand down during
 * `next build` (`NEXT_PHASE === "phase-production-build"`) so
 * build-once/inject-env-at-runtime pipelines still build; the throw then
 * lands on the first server that actually has to serve.
 */

/**
 * Placeholder used when no secret is configured outside production. It is
 * itself a sentinel, so a deployment that reaches production still carrying
 * it is rejected.
 */
export const DEV_FALLBACK_SECRET =
  "ep-dev-insecure-secret-not-for-production-0000000000";

/**
 * Public placeholders that have shipped in example code. A copied sentinel
 * in production makes session cookies forgeable, so these are rejected
 * outright rather than merely warned about.
 */
export const DEV_SECRET_SENTINELS: readonly string[] = [
  "dev-secret-min-48-chars-long-enough-for-better-auth-jwe-cache",
  "dev-secret-min-16-chars",
  DEV_FALLBACK_SECRET,
];

export const MIN_PRODUCTION_SECRET_LENGTH = 32;

export function isProduction(): boolean {
  return process.env.NODE_ENV === "production";
}

/**
 * The only environments treated as non-production. Everything else — an
 * unset `NODE_ENV`, `staging`, a bespoke value — is held to production
 * standards, because a deployment serving real shoppers under an
 * unrecognised `NODE_ENV` is the case a `=== "production"` test misses.
 */
const DEV_ENVIRONMENTS = new Set(["development", "test"]);

export function isTrustedDevEnvironment(): boolean {
  return DEV_ENVIRONMENTS.has(process.env.NODE_ENV ?? "");
}

export function isProductionBuildPhase(): boolean {
  return process.env.NEXT_PHASE === "phase-production-build";
}

function guardsEnforced(): boolean {
  return !isTrustedDevEnvironment() && !isProductionBuildPhase();
}

function describeSecretProblem(secret: string | undefined): string | null {
  if (!secret) {
    return "no secret is configured.";
  }
  if (DEV_SECRET_SENTINELS.includes(secret)) {
    return "the configured secret is a public example placeholder, which makes session cookies forgeable.";
  }
  if (secret.length < MIN_PRODUCTION_SECRET_LENGTH) {
    return `the configured secret is ${secret.length} characters; production requires at least ${MIN_PRODUCTION_SECRET_LENGTH}.`;
  }
  return null;
}

/**
 * Throws in production when `secret` is missing, a known sentinel, or too
 * short. Elsewhere the same finding is a warning.
 */
export function assertProductionSecret(
  secret: string | undefined,
  opts: { label: string }
): void {
  const problem = describeSecretProblem(secret);
  if (!problem) return;
  const message =
    `${opts.label}: ${problem} Supply a unique random value of at least ` +
    `${MIN_PRODUCTION_SECRET_LENGTH} characters (\`openssl rand -base64 32\`).`;
  if (guardsEnforced()) {
    throw new Error(message);
  }
  console.warn(`[ep-commerce] ${message}`);
}

/**
 * Sentinel check only, for secrets that carry their own length rule.
 * `checkout.sessionSecret` keeps its ≥16-character minimum, but a published
 * placeholder there makes checkout sessions forgeable just as surely as it
 * does auth sessions — and the sentinel list contains the very value the
 * example used to pass for it.
 */
export function assertNonSentinelSecret(
  secret: string | undefined,
  opts: { label: string }
): void {
  if (!secret || !DEV_SECRET_SENTINELS.includes(secret)) return;
  const message =
    `${opts.label}: the configured secret is a public example placeholder, ` +
    `which makes the values it protects forgeable. Supply a unique random value.`;
  if (guardsEnforced()) {
    throw new Error(message);
  }
  console.warn(`[ep-commerce] ${message}`);
}

/**
 * Runs {@link assertProductionSecret} and returns a usable secret, falling
 * back to {@link DEV_FALLBACK_SECRET} where the guard did not throw.
 */
export function resolveAuthSecret(
  secret: string | undefined,
  opts: { label: string }
): string {
  assertProductionSecret(secret, opts);
  return secret || DEV_FALLBACK_SECRET;
}
