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
 * EP-Provider-specific props (clientId / host / customHost / serverCartMode).
 *
 * Global-contexts modules often nest several providers in one file (Plasmic
 * CMS, Strapi, Shopify, EP, …). Each contributes its own `host:` default —
 * CMS uses `https://data.plasmic.app` — so we must not take the first `host`
 * match. Prefer EP's `host === "custom"` + `customHost`, else any allowlisted
 * host string.
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
  /** `serverCartMode` flag from the EP Provider */
  serverCartMode: boolean;
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

function propRegex(propName: string): RegExp {
  // Match: <propName>:<ident>&&"<propName>"in <ident>?<ident>.<propName>:VALUE
  // where VALUE is "string-literal" | !0 | !1 | void 0 | number.
  return new RegExp(
    `${propName}\\s*:\\s*\\w+\\s*&&\\s*"${propName}"\\s*in\\s+\\w+\\s*\\?\\s*\\w+\\.${propName}\\s*:\\s*("((?:\\\\.|[^"\\\\])*)"|!0|!1|void\\s*0|-?\\d+(?:\\.\\d+)?)`,
    "g"
  );
}

function parsePropMatch(
  m: RegExpExecArray
): string | boolean | undefined {
  const raw = m[1];
  if (raw === "!0") return true;
  if (raw === "!1") return false;
  if (raw.startsWith("void")) return undefined;
  // string literal: m[2] is the unescaped inner content
  if (m[2] !== undefined) return m[2].replace(/\\"/g, '"').replace(/\\\\/g, "\\");
  // numeric
  return raw;
}

function extractProp(
  code: string,
  propName: string
): string | boolean | undefined {
  const re = propRegex(propName);
  const m = re.exec(code);
  if (!m) return undefined;
  return parsePropMatch(m);
}

function extractAllProps(
  code: string,
  propName: string
): Array<string | boolean> {
  const re = propRegex(propName);
  const out: Array<string | boolean> = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(code)) !== null) {
    const v = parsePropMatch(m);
    if (v !== undefined) out.push(v);
  }
  return out;
}

/**
 * Resolve the EP API host from a global-contexts module that may also
 * embed other providers (Plasmic CMS, Strapi, Shopify, …). Those each
 * contribute their own `host:` default — CMS defaults to
 * `https://data.plasmic.app` — so taking the first `host` match picks
 * the wrong one. Prefer the EP shape (`host === "custom"` + `customHost`)
 * or any allowlisted host string.
 */
function resolveEpHost(
  code: string,
  hostAllowlist: readonly string[]
): string | undefined {
  const customHost = extractProp(code, "customHost");
  const hosts = extractAllProps(code, "host").filter(
    (v): v is string => typeof v === "string"
  );

  if (
    hosts.includes("custom") &&
    typeof customHost === "string" &&
    customHost !== ""
  ) {
    return customHost;
  }

  for (const host of hosts) {
    if (host !== "custom" && isAllowedEpHost(host, hostAllowlist)) {
      return host;
    }
  }

  // Fall back to the first concrete host so callers still get the
  // allowlist rejection log naming the ignored value.
  return hosts.find((h) => h !== "custom");
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

  for (const mod of ordered) {
    const code = mod.code ?? "";
    const clientId = extractProp(code, "clientId");
    if (typeof clientId !== "string" || clientId === "") continue;
    const serverCartMode = extractProp(code, "serverCartMode");
    const resolvedHost = resolveEpHost(code, hostAllowlist);
    if (!resolvedHost) continue;

    if (!isAllowedEpHost(resolvedHost, hostAllowlist)) {
      reportRejectedEpHost(
        resolvedHost,
        "extractEpProviderConfig",
        hostAllowlist
      );
      continue;
    }

    return {
      clientId,
      host: resolvedHost,
      serverCartMode: serverCartMode === true,
    };
  }

  console.error(
    "[ep-commerce] extractEpProviderConfig: no usable EP Provider config " +
      "found in the Plasmic bundle. Confirm the project has an EP Commerce " +
      "Provider global context configured in Studio with a clientId and host."
  );
  return null;
}
