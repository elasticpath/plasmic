/**
 * Host allowlist for the Elastic Path API endpoint.
 *
 * The API host arrives from the Plasmic loader bundle rather than from the
 * deployment's own environment, so it is attacker-influenceable in the same
 * way any remotely-sourced config is. Every shopper token mint targets that
 * host, which makes an unchecked value a credential-exfiltration path.
 *
 * Normalization mirrors better-auth's public `matchesHostPattern` — strip
 * scheme, strip path, lowercase both sides — plus a port strip, so
 * `epcc.internal:8080` matches an `epcc.internal` entry. The function is
 * reimplemented rather than imported because this module is reachable from
 * Jest-side tests and better-auth is ESM-only.
 */
import { hasWildcard, matchesGlob } from "../utils/glob-pattern";
import { isProduction } from "./ep-plugin/production-guard";

/**
 * Elastic Path Composable Commerce regions plus the integration environment,
 * which is served from Fastly and so is listed by exact host rather than by
 * wildcard. Elastic Path Self Managed Commerce hosts are not knowable here
 * and must be supplied by the deployment via `hostAllowlist`.
 */
export const DEFAULT_HOST_ALLOWLIST: readonly string[] = [
  "*.elasticpath.com",
  "elasticpath.com",
  "epcc-integration.global.ssl.fastly.net",
];

/**
 * Permitted outside production only. A bundle that can name the API host can
 * otherwise point token minting at any local port — the exact tampering path
 * this module exists to close.
 */
const LOOPBACK_HOSTS: readonly string[] = ["localhost", "127.0.0.1", "::1"];

/** Strip scheme, path, port, and case, so comparisons are like-for-like. */
function normalizeHost(value: string): string | null {
  const withoutScheme = value.trim().replace(/^[a-zA-Z][\w+.-]*:\/\//, "");
  const hostOnly = withoutScheme.split("/")[0];
  // IPv6 literals keep their brackets; everything else drops a :port suffix.
  const withoutPort = hostOnly.startsWith("[")
    ? hostOnly.replace(/^\[([^\]]*)\](?::\d+)?$/, "$1")
    : hostOnly.replace(/:\d+$/, "");
  return withoutPort ? withoutPort.toLowerCase() : null;
}

export function isAllowedEpHost(
  host: string,
  allowlist: readonly string[] = DEFAULT_HOST_ALLOWLIST
): boolean {
  const hostname = normalizeHost(host);
  if (!hostname) return false;

  const patterns = isProduction()
    ? allowlist
    : [...allowlist, ...LOOPBACK_HOSTS];

  return patterns.some((pattern) => {
    const normalized = normalizeHost(pattern);
    if (!normalized) return false;
    return hasWildcard(normalized)
      ? matchesGlob(hostname, normalized)
      : normalized === hostname;
  });
}

/**
 * Logs the rejection at the point of failure — naming the host and the
 * option that fixes it — so a blocked host never presents downstream as the
 * generic "no EP Provider config" fallback.
 */
export function reportRejectedEpHost(
  host: string,
  source: string,
  allowlist: readonly string[]
): void {
  console.error(
    `[ep-commerce] ${source}: EP API host "${host}" is not in the host ` +
      `allowlist (${allowlist.join(", ")}), so it was ignored. Elastic Path ` +
      `Self Managed Commerce deployments must pass their host via the ` +
      `\`hostAllowlist\` option on createEpAuth, extractEpProviderConfig, ` +
      `and buildEpCtx.`
  );
}
