/**
 * Production guards. Enforced everywhere except `development`/`test`, and
 * stood down during `next build` so build-then-inject-env pipelines still
 * build — the throw then lands on the first request served.
 */

/** Itself a sentinel, so it cannot survive into production. */
export const DEV_FALLBACK_SECRET =
  "ep-dev-insecure-secret-not-for-production-0000000000";

/** Public placeholders shipped in example code. */
export const DEV_SECRET_SENTINELS: readonly string[] = [
  "dev-secret-min-48-chars-long-enough-for-better-auth-jwe-cache",
  "dev-secret-min-16-chars",
  DEV_FALLBACK_SECRET,
];

export const MIN_PRODUCTION_SECRET_LENGTH = 32;

export function isProduction(): boolean {
  return process.env.NODE_ENV === "production";
}

/** Fail closed: an unset or bespoke NODE_ENV counts as production. */
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

/** Throws in production on a missing, sentinel, or too-short secret. */
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

/** Sentinel check only, for secrets that keep their own length rule. */
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

/** Asserts, then returns the secret or the dev fallback. */
export function resolveAuthSecret(
  secret: string | undefined,
  opts: { label: string }
): string {
  assertProductionSecret(secret, opts);
  return secret || DEV_FALLBACK_SECRET;
}
