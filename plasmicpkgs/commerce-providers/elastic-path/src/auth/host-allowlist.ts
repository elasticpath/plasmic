// The EP API host comes from the Plasmic bundle, so it is untrusted input.
import { hasWildcard, matchesGlob } from "../utils/glob-pattern";
import { isProduction } from "./ep-plugin/production-guard";

export const DEFAULT_HOST_ALLOWLIST: readonly string[] = [
  "*.elasticpath.com",
  "elasticpath.com",
  "epcc-integration.global.ssl.fastly.net",
];

const LOOPBACK_HOSTS: readonly string[] = ["localhost", "127.0.0.1", "::1"];

function normalizeHost(value: string): string | null {
  const withoutScheme = value.trim().replace(/^[a-zA-Z][\w+.-]*:\/\//, "");
  const hostOnly = withoutScheme.split("/")[0];
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
