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
 * This is intentionally narrow — it only reads the four props the storefront
 * needs to resolve a server session. If Plasmic's codegen output changes
 * shape in a future release, the regex stops matching and
 * `extractEpProviderConfig` returns `null`, letting callers fall through to
 * whatever defaults / env vars they prefer.
 */

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

function extractProp(
  code: string,
  propName: string
): string | boolean | undefined {
  // Match: <propName>:<ident>&&"<propName>"in <ident>?<ident>.<propName>:VALUE
  // where VALUE is "string-literal" | !0 | !1 | void 0 | number.
  const re = new RegExp(
    `${propName}\\s*:\\s*\\w+\\s*&&\\s*"${propName}"\\s*in\\s+\\w+\\s*\\?\\s*\\w+\\.${propName}\\s*:\\s*("((?:\\\\.|[^"\\\\])*)"|!0|!1|void\\s*0|-?\\d+(?:\\.\\d+)?)`
  );
  const m = code.match(re);
  if (!m) return undefined;
  const raw = m[1];
  if (raw === "!0") return true;
  if (raw === "!1") return false;
  if (raw.startsWith("void")) return undefined;
  // string literal: m[2] is the unescaped inner content
  if (m[2] !== undefined) return m[2].replace(/\\"/g, '"').replace(/\\\\/g, "\\");
  // numeric
  return raw;
}

export function extractEpProviderConfig(
  prefetchedData: ServerBundleLike | null | undefined
): EpProviderBundleConfig | null {
  const allMods: BundleModule[] = [
    ...(prefetchedData?.bundle?.modules?.server ?? []),
    ...(prefetchedData?.bundle?.modules?.browser ?? []),
  ];
  if (allMods.length === 0) return null;

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
    const hostChoice = extractProp(code, "host");
    const customHost = extractProp(code, "customHost");
    const serverCartMode = extractProp(code, "serverCartMode");

    const resolvedHost =
      hostChoice === "custom"
        ? typeof customHost === "string" && customHost !== ""
          ? customHost
          : undefined
        : typeof hostChoice === "string"
          ? hostChoice
          : undefined;
    if (!resolvedHost) continue;

    return {
      clientId,
      host: resolvedHost,
      serverCartMode: serverCartMode === true,
    };
  }

  return null;
}
