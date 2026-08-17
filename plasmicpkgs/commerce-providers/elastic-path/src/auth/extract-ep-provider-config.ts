/**
 * Extracts EP Provider config (clientId, host) from a Plasmic loader
 * `ComponentRenderData` bundle. The values are the ones configured on the
 * EP Provider global context inside Studio — so the storefront gets
 * clientId/host from the project's own configuration rather than `.env.local`.
 *
 * Implementation: Plasmic's codegen inlines the global-context prop defaults
 * into the generated `global__<projectId>.js` module, using the shape
 *
 *     <propName>:<ident>&&"<propName>"in <ident>?<ident>.<propName>:<DEFAULT>
 *
 * for every prop. We scan the server bundle modules and regex-extract the
 * EP-Provider-specific props (clientId / host / customHost), grouped per
 * provider — see `propRegex` for how the grouping works.
 *
 * This is intentionally narrow — it only reads the props the storefront needs
 * to resolve a server session. If Plasmic's codegen output changes shape in a
 * future release, the regex stops matching and `extractEpProviderConfig`
 * returns `null`, letting callers fall through to whatever defaults / env
 * vars they prefer.
 */
import {
  DEFAULT_HOST_ALLOWLIST,
  isAllowedEpHost,
  reportRejectedEpHost,
} from "./host-allowlist";

export interface EpProviderBundleConfig {
  /** clientId configured on the EP Provider global context */
  clientId: string;
  /** Resolved API host — `customHost` when `host === "custom"`, else `host` */
  host: string;
}

type BundleModule = {
  type?: string;
  fileName?: string;
  code?: string;
};

type ServerBundleLike = {
  bundle?: {
    modules?: {
      server?: BundleModule[];
      browser?: BundleModule[];
    };
    projects?: Array<{
      globalContextsProviderFileName?: string;
    }>;
  };
};

type PropValue = string | boolean | undefined;

interface PropOccurrence {
  /** The props identifier this occurrence was read off. */
  ident: string;
  value: PropValue;
}

/**
 * Match: <propName>:<ident>&&"<propName>"in <ident>?<ident>.<propName>:VALUE
 * where VALUE is "string-literal" | !0 | !1 | void 0 | number.
 *
 * `<ident>` is the destructured props variable, and codegen binds a distinct
 * one per global context in the module (`cmsProps: l`, `strapiProps: m`,
 * `commerceProviderComponentProps: o`, …). Backreferencing it instead of
 * matching `\w+` three times over is what scopes a prop to the element it
 * belongs to: a module nesting CMS + Strapi + EP yields three separate `host`
 * occurrences, and only the one sharing EP's ident is EP's.
 */
function propRegex(propName: string): RegExp {
  return new RegExp(
    `${propName}\\s*:\\s*(\\w+)\\s*&&\\s*"${propName}"\\s*in\\s+\\1\\s*\\?\\s*\\1\\.${propName}\\s*:\\s*("((?:\\\\.|[^"\\\\])*)"|!0|!1|void\\s*0|-?\\d+(?:\\.\\d+)?)`,
    "g"
  );
}

function scanProp(code: string, propName: string): PropOccurrence[] {
  const re = propRegex(propName);
  const out: PropOccurrence[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(code)) !== null) {
    const raw = m[2];
    let value: PropValue;
    if (raw === "!0") value = true;
    else if (raw === "!1") value = false;
    else if (raw.startsWith("void")) value = undefined;
    else if (m[3] !== undefined) {
      // string literal: m[3] is the inner content, still escaped
      value = m[3].replace(/\\"/g, '"').replace(/\\\\/g, "\\");
    } else value = raw; // numeric
    out.push({ ident: m[1], value });
  }
  return out;
}

/** First occurrence per ident — a provider emits each prop once. */
function firstByIdent(occurrences: PropOccurrence[]): Map<string, PropValue> {
  const byIdent = new Map<string, PropValue>();
  for (const { ident, value } of occurrences) {
    if (!byIdent.has(ident)) byIdent.set(ident, value);
  }
  return byIdent;
}

interface ProviderCandidate {
  clientId: string;
  host: PropValue;
  customHost: PropValue;
}

/**
 * One candidate per props identifier carrying a non-empty `clientId`. Reading
 * all three props off the same identifier is what keeps a neighbouring
 * provider's host, clientId or customHost from being paired with EP's.
 * Candidates that aren't EP (another commerce provider also registers a
 * `clientId`) fail the host allowlist downstream.
 */
function collectProviderCandidates(code: string): ProviderCandidate[] {
  const clientIds = scanProp(code, "clientId").filter(
    (o): o is PropOccurrence & { value: string } =>
      typeof o.value === "string" && o.value !== ""
  );
  if (clientIds.length === 0) return [];

  const hostOccurrences = scanProp(code, "host");
  const hosts = firstByIdent(hostOccurrences);
  // Only worth a second pass over the module when something selected Custom.
  const customHosts = hostOccurrences.some((o) => o.value === "custom")
    ? firstByIdent(scanProp(code, "customHost"))
    : new Map<string, PropValue>();

  const seen = new Set<string>();
  const candidates: ProviderCandidate[] = [];
  for (const { ident, value } of clientIds) {
    if (seen.has(ident)) continue;
    seen.add(ident);
    candidates.push({
      clientId: value,
      host: hosts.get(ident),
      customHost: customHosts.get(ident),
    });
  }
  return candidates;
}

function resolveCandidateHost(c: ProviderCandidate): string | undefined {
  if (c.host === "custom") {
    return typeof c.customHost === "string" && c.customHost !== ""
      ? c.customHost
      : undefined;
  }
  return typeof c.host === "string" ? c.host : undefined;
}

export interface ExtractEpProviderConfigOptions {
  hostAllowlist?: readonly string[];
}

export function extractEpProviderConfig(
  prefetchedData: ServerBundleLike | null | undefined,
  opts?: ExtractEpProviderConfigOptions
): EpProviderBundleConfig | null {
  const hostAllowlist = opts?.hostAllowlist ?? DEFAULT_HOST_ALLOWLIST;
  const allMods: BundleModule[] = [
    ...(prefetchedData?.bundle?.modules?.server ?? []),
    ...(prefetchedData?.bundle?.modules?.browser ?? []),
  ];
  if (allMods.length === 0) {
    console.error(
      "[ep-commerce] extractEpProviderConfig: the Plasmic bundle carried no " +
        "modules, so no EP Provider config could be read. Check that " +
        "prefetchedData was fetched for a page in the project."
    );
    return null;
  }

  // Prefer modules that match a project's globalContextsProviderFileName, but
  // fall back to scanning all server modules — some projects place context
  // definitions inside imported dep-project bundles rather than in their own
  // globalContexts module.
  const projectGcFiles = new Set(
    (prefetchedData!.bundle!.projects ?? [])
      .map((p) => p.globalContextsProviderFileName)
      .filter((f): f is string => !!f)
  );
  const candidates = allMods.filter((m) => m.type === "code" && m.code);
  const ordered = [
    ...candidates.filter((m) => m.fileName && projectGcFiles.has(m.fileName)),
    ...candidates.filter((m) => !m.fileName || !projectGcFiles.has(m.fileName)),
  ];

  // Rejections are reported only if no candidate works out — a project that
  // also uses another commerce provider would otherwise log an allowlist
  // error for that provider's host on every render of a working storefront.
  const rejectedHosts: string[] = [];

  for (const mod of ordered) {
    for (const candidate of collectProviderCandidates(mod.code ?? "")) {
      const resolvedHost = resolveCandidateHost(candidate);
      if (!resolvedHost) continue;

      if (!isAllowedEpHost(resolvedHost, hostAllowlist)) {
        rejectedHosts.push(resolvedHost);
        continue;
      }

      return {
        clientId: candidate.clientId,
        host: resolvedHost,
      };
    }
  }

  if (rejectedHosts.length > 0) {
    for (const host of rejectedHosts) {
      reportRejectedEpHost(host, "extractEpProviderConfig", hostAllowlist);
    }
    return null;
  }

  console.error(
    "[ep-commerce] extractEpProviderConfig: no usable EP Provider config " +
      "found in the Plasmic bundle. Confirm the project has an EP Commerce " +
      "Provider global context configured in Studio with a clientId and host."
  );
  return null;
}
