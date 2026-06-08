/**
 * Local HTTP preview server for rendering Plasmic components.
 *
 * Uses the same rendering approach as Studio's live preview:
 * 1. Proxies host.html and /static/* from the platform host server
 * 2. Generates component code via the codegen pipeline (same as Studio)
 * 3. Serves a preview page with an iframe that loads the host and renders
 *    the component via SystemJS module injection
 *
 * Lifecycle: starts on project.set, stops on project change or process shutdown.
 *
 * CRITICAL: All logging uses console.error() — stdout is the MCP transport.
 */

import * as http from "node:http";
import * as url from "node:url";
import type { PlasmicApiClient } from "./api-client.js";
import { getSession } from "./session.js";
import { getAuth } from "./auth.js";
import { deriveRendererOrigin } from "./renderer-origin.js";
import {
  exportReactPresentational,
  exportProjectConfig,
  exportStyleConfig,
  computeSerializerSiteContext,
} from "@/wab/shared/codegen/react-p";
import { SiteGenHelper, ComponentGenHelper } from "@/wab/shared/codegen/codegen-helpers";
import { CssVarResolver } from "@/wab/shared/core/styles";
import { exportGlobalVariantGroup } from "@/wab/shared/codegen/variants";
import { exportIconAsset, extractUsedIconAssetsForComponents } from "@/wab/shared/codegen/image-assets";
import { walkDependencyTree } from "@/wab/shared/core/project-deps";
import {
  isCodeComponent,
  isPageComponent,
  getCodeComponentImportName,
  getCodeComponentHelperImportName,
} from "@/wab/shared/core/components";
import { isCodeComponentWithHelpers } from "@/wab/shared/code-components/code-components";
import { componentToDeepReferenced } from "@/wab/shared/cached-selectors";
import { tryGetOwnerSite } from "@/wab/shared/core/tpls";
import { getSlotParams } from "@/wab/shared/SlotUtils";
import { jsLiteral, toVarName } from "@/wab/shared/codegen/util";
import {
  makeComponentSkeletonIdFileName,
  makeCodeComponentHelperSkeletonIdFileName,
  makeGlobalContextsImport,
  makeGlobalGroupImports,
  makePlasmicIsPreviewRootComponent,
  wrapGlobalProviderWithCustomValue,
} from "@/wab/shared/codegen/react-p/serialize-utils";
import { allGlobalVariantGroups } from "@/wab/shared/core/sites";
import { getRawCode, ExprCtx } from "@/wab/shared/core/exprs";
import { DEVFLAGS } from "@/wab/shared/devflags";
import { getPlumeEditorPlugin } from "@/wab/shared/plume/plume-registry";
import { isKnownPropParam } from "@/wab/shared/model/classes";
import {
  getMatchingPagePathParams,
  substituteUrlParams,
} from "@/wab/shared/utils/url-utils";
import type { ExportOpts, ComponentExportOutput } from "@/wab/shared/codegen/types";

let server: http.Server | null = null;
let serverPort: number | null = null;

/** Cached host.html content from the Studio platform (hostless fallback). */
let cachedHostHtml: string | null = null;

/** Cached app-host HTML rewritten for same-origin iframe embedding.
 *  Keyed by app host URL so switching projects doesn't reuse stale HTML. */
const cachedAppHostHtml = new Map<string, string>();

/** App host URL that was most recently served at /static/host.html. Used so
 *  our fallback static proxy can forward unresolved paths like /_next/* to
 *  the right upstream. */
let activeAppHostOrigin: string | null = null;

/** Last app-host fetch error (surfaced via /debug for diagnosis). */
let lastAppHostFetchError: string | null = null;

/** Commit hash extracted from host.html script URL. */
let commitHash: string | null = null;

/** Reference to the API client (kept for future use). */
let apiClientRef: PlasmicApiClient | null = null;

/** Renderer origin resolved at startup (see resolveRendererOrigin). */
let cachedRendererOrigin: string | null = null;

/** Cache of generated module content, keyed by filename. Served at /static/{filename}
 *  so SystemJS can fetch CSS/JS modules that the codegen output imports. */
const generatedModules = new Map<string, { content: string; contentType: string }>();

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Get the current preview server port, or null if not running. */
export function getPreviewPort(): number | null {
  return serverPort;
}

/**
 * Get the full preview URL for a component, or null if server not running.
 *
 * For page components, emits a Studio-style path URL: given route
 * `/product/[slug]` and pageParams `{slug: "test-product"}`, returns
 * `/preview/product/test-product`. Without explicit pageParams, substitutes
 * the component's `pageMeta.params` defaults (matches Studio's PreviewCtx
 * `mkPreviewRoute` behavior) — any unresolved `[x]` placeholders are kept.
 *
 * For non-page components, emits `/preview/<ComponentName>`.
 *
 * Query params are appended as `?key=value` when provided.
 */
export function getPreviewUrl(
  component: { name: string; pageMeta?: { path?: string; params?: Record<string, string>; query?: Record<string, string> } },
  opts?: { pageParams?: Record<string, string>; pageQuery?: Record<string, string> }
): string | null {
  if (!serverPort) return null;
  const base = `http://127.0.0.1:${serverPort}/preview`;

  let pathSuffix: string;
  if (component.pageMeta?.path) {
    const params = { ...(component.pageMeta.params ?? {}), ...(opts?.pageParams ?? {}) };
    const substituted = substituteUrlParams(component.pageMeta.path, params);
    // substituteUrlParams keeps leading `/`; our base URL has /preview so the
    // result is `/preview/<path>`. Strip the leading slash from the substituted
    // path to avoid double slashes.
    pathSuffix = substituted.replace(/^\/+/, "");
  } else {
    pathSuffix = encodeURIComponent(component.name);
  }

  const queryEntries = Object.entries({
    ...(component.pageMeta?.query ?? {}),
    ...(opts?.pageQuery ?? {}),
  });
  const queryString = queryEntries.length
    ? "?" +
      queryEntries
        .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
        .join("&")
    : "";
  return `${base}/${pathSuffix}${queryString}`;
}

/**
 * Start the preview HTTP server on a random available port.
 * Pre-fetches host.html from the Studio platform.
 * Stops any existing server first.
 */
export async function startPreviewServer(
  apiClient: PlasmicApiClient
): Promise<number> {
  await stopPreviewServer();

  apiClientRef = apiClient;

  // Resolve the renderer origin before fetching host.html — fetchAndCacheHostHtml
  // and the static proxy both read it.
  await resolveRendererOrigin();

  await fetchAndCacheHostHtml();

  return new Promise((resolve, reject) => {
    const srv = http.createServer(async (req, res) => {
      try {
        await handleRequest(req, res);
      } catch (err) {
        console.error("[plasmic-mcp] Preview server error:", err);
        if (!res.headersSent) {
          res.writeHead(500, { "Content-Type": "text/html" });
          res.end(errorPage("Internal Server Error", String(err)));
        }
      }
    });

    srv.listen(0, "127.0.0.1", () => {
      const addr = srv.address();
      if (addr && typeof addr === "object") {
        serverPort = addr.port;
        server = srv;
        console.error(
          `[plasmic-mcp] Preview server started on http://127.0.0.1:${serverPort} (host: ${getStudioOrigin()})`
        );
        resolve(serverPort);
      } else {
        reject(new Error("Failed to get server address"));
      }
    });

    srv.on("error", (err) => {
      console.error("[plasmic-mcp] Preview server listen error:", err);
      reject(err);
    });
  });
}

/** Stop the preview server gracefully. */
export async function stopPreviewServer(): Promise<void> {
  if (!server) return;

  return new Promise((resolve) => {
    server!.close(() => {
      console.error("[plasmic-mcp] Preview server stopped");
      server = null;
      serverPort = null;
      cachedHostHtml = null;
      cachedAppHostHtml.clear();
      activeAppHostOrigin = null;
      commitHash = null;
      apiClientRef = null;
      cachedRendererOrigin = null;
      generatedModules.clear();
      resolve();
    });
    setTimeout(() => {
      server = null;
      serverPort = null;
      cachedHostHtml = null;
      cachedAppHostHtml.clear();
      activeAppHostOrigin = null;
      commitHash = null;
      apiClientRef = null;
      cachedRendererOrigin = null;
      generatedModules.clear();
      resolve();
    }, 2000);
  });
}

/** Get the Studio origin URL (for getlibs.js loading). */
function getStudioOrigin(): string {
  const auth = getAuth();
  if (!auth) {
    throw new Error("Cannot determine Studio origin: no authentication configured");
  }
  return auth.host.replace(/\/$/, "");
}

/**
 * Resolve the renderer origin once and cache it. Priority: PLASMIC_RENDERER_ORIGIN
 * env override → origin of the Studio `appConfig.defaultHostUrl` (the same value
 * Studio's own getHostUrl() uses, so it tracks the deployment — including any
 * environment/region prefix on a self-hosted host) → fallback.
 */
async function resolveRendererOrigin(): Promise<void> {
  const envOverride = process.env.PLASMIC_RENDERER_ORIGIN;
  let appConfigHostUrl: string | undefined;

  if (!envOverride && apiClientRef) {
    try {
      const { config } = await apiClientRef.getAppConfig();
      appConfigHostUrl = config?.defaultHostUrl as string | undefined;
    } catch (err) {
      console.error(
        `[plasmic-mcp] Could not derive renderer origin from Studio app-config (${err}); ` +
          `set PLASMIC_RENDERER_ORIGIN to override.`
      );
    }
  }

  cachedRendererOrigin = deriveRendererOrigin(envOverride, appConfigHostUrl);
  console.error(`[plasmic-mcp] Renderer origin: ${cachedRendererOrigin}`);
}

/**
 * Origin that serves Plasmic's renderer assets — the lightweight renderer
 * `host.html` and the `sub` / `react-web-bundle` / `live-frame` bundles.
 * Populated by resolveRendererOrigin() at startup; before that resolves we
 * fall back to the env override or default so the getter stays synchronous.
 */
function getRendererOrigin(): string {
  if (cachedRendererOrigin) {
    return cachedRendererOrigin;
  }
  return deriveRendererOrigin(process.env.PLASMIC_RENDERER_ORIGIN, undefined);
}

// ---------------------------------------------------------------------------
// Host.html fetch
// ---------------------------------------------------------------------------

/**
 * Fetch the host page HTML and cache it. Also fetch Studio's host.html for
 * the commit hash (shared across bundles).
 *
 * We always need Studio's commit hash so we can load `react-web-bundle` and
 * `live-frame` bundles from the Studio origin. When a project has an app
 * host, we additionally fetch and serve the app-host HTML — rewritten to be
 * same-origin with our preview server so the outer page can inject scripts
 * into the iframe directly (browsers block cross-origin frame access).
 */
async function fetchAndCacheHostHtml(): Promise<void> {
  // Renderer host.html — used for the commit hash and as hostless fallback.
  const studioHostUrl = `${getRendererOrigin()}/static/host.html`;
  try {
    const response = await fetch(studioHostUrl, { redirect: "follow" });
    if (!response.ok) {
      console.error(`[plasmic-mcp] Failed to fetch host.html: HTTP ${response.status}`);
      return;
    }
    cachedHostHtml = await response.text();

    // Extract commit hash from script URL: /static/sub/build/client.{hash}.js
    const hashMatch = cachedHostHtml.match(/\/static\/sub\/build\/client\.([a-f0-9]+)\.js/);
    if (hashMatch) {
      commitHash = hashMatch[1];
      console.error(`[plasmic-mcp] Host commit hash: ${commitHash}`);
    } else {
      console.error("[plasmic-mcp] Could not extract commit hash from host.html");
    }
  } catch (err) {
    console.error(`[plasmic-mcp] Failed to fetch host.html from ${studioHostUrl}:`, err);
  }
}

/**
 * Fetch the user's app-host page (e.g. http://localhost:3456/plasmic-host)
 * server-side and rewrite it to be served from our preview origin without
 * breaking relative URLs in the HTML.
 *
 * Strategy: inject `<base href="${upstreamOrigin}/">` at the top of <head>,
 * so `/_next/static/chunks/*.js` and other relative URLs resolve against the
 * user's dev server. Script tags load cross-origin without CORS because
 * `<script src>` is exempt from same-origin policy. But `iframe.contentDocument`
 * access from our outer page is now same-origin (iframe is at our origin),
 * so script injection via `doc.head.appendChild(...)` works — matching the
 * approach Studio uses in CanvasFrame.tsx (doc.open / doc.write into a
 * sourceless iframe).
 */
async function fetchAndRewriteAppHost(appHostUrl: string): Promise<string | null> {
  // Fetch the app-host HTML and serve it from our origin AS-IS. Relative URLs
  // in the HTML (like `/_next/static/chunks/*.js`) will resolve against our
  // origin — our `handleUpstreamProxy` forwards those requests to the user's
  // dev server. This makes the iframe same-origin with our outer page (so
  // direct `iframe.contentDocument` access works) while still serving real
  // Next.js chunks from the user's dev server.
  //
  // We deliberately do NOT inject `<base href>`: that would break the History
  // API because Next.js's router calls `history.replaceState(...)` with URLs
  // resolved against baseURI, and the browser rejects cross-origin history
  // states.
  lastAppHostFetchError = null;
  try {
    const response = await fetch(appHostUrl, { redirect: "follow" });
    if (!response.ok) {
      lastAppHostFetchError = `HTTP ${response.status} ${response.statusText}`;
      console.error(`[plasmic-mcp] App-host fetch failed: ${lastAppHostFetchError}`);
      return null;
    }
    return await response.text();
  } catch (err) {
    lastAppHostFetchError = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
    console.error(`[plasmic-mcp] Failed to fetch app-host from ${appHostUrl}:`, err);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Dependent-component module helpers (replicated from Studio's live-syncer.ts)
// ---------------------------------------------------------------------------

/**
 * Walk all components this root transitively depends on (deep references +
 * super components + sub components). Excludes the root itself.
 * Mirrors live-syncer.ts:337-373.
 */
function extractDependentComponents(component: any): Set<any> {
  const referencedComps = new Set<any>();
  const seen = new Set<any>();

  const check = (comp: any) => {
    if (seen.has(comp)) return;
    seen.add(comp);

    for (const dep of componentToDeepReferenced(comp)) {
      check(dep);
      referencedComps.add(dep);
    }

    if (comp.superComp) {
      referencedComps.add(comp.superComp);
      check(comp.superComp);
    }

    for (const subComp of comp.subComps ?? []) {
      referencedComps.add(subComp);
      check(subComp);
    }
  };

  check(component);
  return referencedComps;
}

/**
 * Build a SystemJS module whose contents are a code component stub: the
 * exported symbol is a runtime lookup into __PlasmicComponentRegistry,
 * __PlasmicContextRegistry, and __PlasmicBuiltinRegistry. Matches the
 * non-ccStubs branch of live-syncer.ts:430-482.
 *
 * Registration happens via the iframe's origin page (the user's app host)
 * executing plasmic-init's registerComponent() calls, or (for builtins) via
 * Studio's live-frame bundle.
 */
function createCodeComponentModule(
  component: any,
  opts?: { idFileNames?: boolean }
): CodeModule {
  const importName = getCodeComponentImportName(component);
  const notFoundMsg = `[host-app-error] Code component '${component.name}' was not found in the current host app.`;
  const body = `ensure(
    ([
      ...(window).__PlasmicComponentRegistry,
      ...((window).__PlasmicContextRegistry ?? []),
      ...((window).__PlasmicBuiltinRegistry ?? [])
    ]).find(
      ({meta}) => meta.name === ${jsLiteral(component.name)}
    )
  , ${jsLiteral(notFoundMsg)}).component`;

  const source = `
  const ensure = (x, msg) => {
    if (x === undefined || x === null) {
      throw new Error(msg);
    }
    return x;
  };
  ${component.codeComponentMeta.defaultExport ? "" : "export "}const ${importName} = ${body};
  ${component.codeComponentMeta.defaultExport ? `export default ${importName}` : ""}
  `;
  const fileName = opts?.idFileNames
    ? makeComponentSkeletonIdFileName(component)
    : importName;
  return { name: `./${fileName}.tsx`, lang: "tsx", source };
}

/**
 * Companion to createCodeComponentModule for code components with helpers.
 * Mirrors live-syncer.ts:395-424.
 */
function createCodeComponentHelperModule(
  component: any,
  opts?: { idFileNames?: boolean }
): CodeModule {
  const importName = getCodeComponentHelperImportName(component);
  const body = `([...(window).__PlasmicComponentRegistry, ...((window).__PlasmicBuiltinRegistry ?? [])]).find(
    ({meta}) => meta.name === ${jsLiteral(component.name)}
  ).meta.componentHelpers?.helpers`;
  const defaultExport = component.codeComponentMeta.helpers?.defaultExport;
  const source = `
  ${defaultExport ? "" : "export "}const ${importName} = ${body};
  ${defaultExport ? `export default ${importName}` : ""}
  `;
  const fileName = opts?.idFileNames
    ? makeCodeComponentHelperSkeletonIdFileName(component)
    : importName;
  return { name: `./${fileName}.tsx`, lang: "tsx", source };
}

/**
 * Emit render + skeleton + css modules for a regular (non-code) component.
 * Mirrors live-syncer.ts:375-393 createComponentModules.
 */
function createComponentModules(output: ComponentExportOutput): CodeModule[] {
  const out: CodeModule[] = [
    { name: `./${output.renderModuleFileName}`, source: output.renderModule, lang: "tsx" },
    { name: `./${output.skeletonModuleFileName}`, source: output.skeletonModule, lang: "tsx" },
  ];
  if (output.cssRules) {
    out.push({ name: `./${output.cssFileName}`, source: output.cssRules, lang: "css" });
  }
  return out;
}

// ---------------------------------------------------------------------------
// In-memory codegen (matches Studio's live-syncer.ts createComponentOutput)
// ---------------------------------------------------------------------------

/**
 * Generate SystemJS-compatible modules for a component using the same codegen
 * pipeline as Studio's live preview (live-syncer.ts → createComponentOutput).
 *
 * Uses exportReactPresentational + SiteGenHelper + CssVarResolver directly
 * against the in-memory site model — no external API calls needed.
 */
/**
 * Resolve a URL-style path like `product/test-product` or a bare component
 * name / UUID to the page component + path params.
 *
 * Mirrors Studio's `getComponentByPath` at platform/wab/src/wab/client/
 * components/live/PreviewCtx.tsx:701-763. When multiple page routes match,
 * picks the one with fewest path params (so `/products/foo` wins over
 * `/products/[slug]` when both match). Returns `pageParams` extracted from
 * the path via `getMatchingPagePathParams` (shared with Studio).
 *
 * Falls through to component-name/UUID lookup for non-page components so
 * the preview works for reusable components too.
 */
function resolveComponentByPath(
  site: any,
  rawPath: string
): { component: any; pageParams: Record<string, string> } | null {
  const normalized = "/" + rawPath.replace(/^\/+/, "");

  const matches = (site.components ?? [])
    .filter(
      (c: any) =>
        c.uuid === rawPath ||
        (c.pageMeta &&
          getMatchingPagePathParams(c.pageMeta.path, normalized))
    )
    .map((c: any) => {
      const params = c.pageMeta
        ? getMatchingPagePathParams(c.pageMeta.path, normalized) || {}
        : {};
      return {
        component: c,
        paramCount: Object.keys(params).length,
        params,
      };
    })
    .sort(
      (a: any, b: any) => a.paramCount - b.paramCount
    );

  if (matches.length > 0) {
    const best = matches[0];
    return { component: best.component, pageParams: best.params };
  }

  // Not a page-path match — fall back to component name / UUID.
  const byName = (site.components ?? []).find(
    (c: any) => c.name === rawPath || c.uuid === rawPath
  );
  if (byName) {
    return { component: byName, pageParams: {} };
  }
  return null;
}

function generateComponentModules(
  component: any,
  opts?: { pageParams?: Record<string, string>; pageQuery?: Record<string, string> }
): CodeModule[] | { error: string } | null {
  const session = getSession();
  if (!session) return null;

  try {
    const site = session.site;

    // ExportOpts matching Studio's live preview mode (live-syncer.ts:798-831)
    const exportOpts: ExportOpts = {
      lang: "ts",
      platform: "react",
      forceAllProps: true,
      uncontrolledProps: true,
      shouldTransformWritableStates: true,
      forceRootDisabled: false,
      imageOpts: { scheme: "cdn" },
      stylesOpts: { scheme: "css" },
      codeOpts: { reactRuntime: "classic" },
      fontOpts: { scheme: "import" },
      codeComponentStubs: false,
      skinnyReactWeb: false,
      skinny: false,
      importHostFromReactWeb: false,
      idFileNames: true,
      hostLessComponentsConfig: "stub",
      includeImportedTokens: true,
      useComponentSubstitutionApi: false,
      useGlobalVariantsSubstitutionApi: false,
      useCodeComponentHelpersRegistry: false,
      useCustomFunctionsStub: true,
      isLivePreview: true,
      targetEnv: "preview",
      relPathFromManagedToImplDir: ".",
    };

    // Step 1: Project config (same as Studio's exportProjectConfig call)
    const projectConfig = exportProjectConfig(
      site,
      session.projectName,
      session.projectId,
      session.revisionNum ?? 0,
      "mcp-preview",
      "latest",
      exportOpts
    );

    // Step 2: Codegen helpers (same as Studio's createComponentOutput)
    const siteGenHelper = new SiteGenHelper(site, false);
    const cssVarResolver = new CssVarResolver(
      siteGenHelper.allStyleTokensAndOverrides(),
      siteGenHelper.allMixins(),
      siteGenHelper.allImageAssets(),
      site.activeTheme,
      { keepAssetRefs: false, useCssVariables: true }
    );
    const compGenHelper = new ComponentGenHelper(siteGenHelper, cssVarResolver);

    // Step 3: Serializer site context
    const siteCtx = computeSerializerSiteContext(site);

    // Step 4: Image asset URI map (HTTP-based CDN URLs)
    const imageAssetUriMap = Object.fromEntries(
      (site.imageAssets ?? [])
        .filter((asset: any) => asset.dataUri && asset.dataUri.startsWith("http"))
        .map((asset: any) => [asset.uuid, asset.dataUri as string])
    );

    // Step 5: Generate component code
    const output: ComponentExportOutput = exportReactPresentational(
      compGenHelper,
      component,
      site,
      projectConfig,
      imageAssetUriMap,
      false,  // isPlasmicHosted
      false,  // forceAllCsr
      undefined,  // appAuthProvider
      exportOpts,
      siteCtx
    );

    console.error(`[plasmic-mcp] Codegen complete for "${component.name}": ${output.renderModuleFileName}`);

    // Step 6: Convert to SystemJS modules — replicates live-syncer.ts autorun
    // (lines 144-249) module assembly order exactly.
    const modules: CodeModule[] = [];

    // 6a. Default style CSS (live-syncer:151)
    const styleOutput = exportStyleConfig({ targetEnv: "preview" });
    modules.push({
      name: `./${styleOutput.defaultStyleCssFileName}`,
      source: styleOutput.defaultStyleCssRules,
      lang: "css",
    });

    // 6b. Project mods: CSS + projectModuleBundle + styleTokensProvider + dataTokens (live-syncer:167, createProjectMods)
    const pushProjectMods = (pc: any) => {
      if (pc.cssRules) modules.push({ name: `./${pc.cssFileName}`, source: pc.cssRules, lang: "css" });
      if (pc.projectModuleBundle) modules.push({ name: `./${pc.projectModuleBundle.fileName}`, source: pc.projectModuleBundle.module, lang: "tsx" });
      if (pc.styleTokensProviderBundle) modules.push({ name: `./${pc.styleTokensProviderBundle.fileName}`, source: pc.styleTokensProviderBundle.module, lang: "tsx" });
      if (pc.dataTokensBundle) modules.push({ name: `./${pc.dataTokensBundle.fileName}`, source: pc.dataTokensBundle.module, lang: "tsx" });
    };
    pushProjectMods(projectConfig);

    // 6c. Dependency project mods (live-syncer:168, createDepsProjectMods).
    // Also build a site → projectConfig map so step 6g can codegen dependents
    // that live in imported projects with the right per-project CSS config.
    const depProjectConfigs = new Map<any, any>();
    try {
      for (const dep of walkDependencyTree(site, "all")) {
        const depConfig = exportProjectConfig(dep.site, dep.name, dep.projectId, 0, "dep", "latest", exportOpts);
        depProjectConfigs.set(dep.site, depConfig);
        pushProjectMods(depConfig);
      }
    } catch (e) {
      console.error("[plasmic-mcp] Dependency project mods failed (non-fatal):", e instanceof Error ? e.message : e);
    }

    // 6d. Component CSS + render + skeleton (live-syncer:185, createComponentModules)
    if (output.cssRules) modules.push({ name: `./${output.cssFileName}`, source: output.cssRules, lang: "css" });
    modules.push({ name: `./${output.renderModuleFileName}`, source: output.renderModule, lang: "tsx" });
    modules.push({ name: `./${output.skeletonModuleFileName}`, source: output.skeletonModule, lang: "tsx" });

    // 6e. Icon assets (live-syncer:214-220)
    try {
      const icons = extractUsedIconAssetsForComponents(site, [component]);
      for (const asset of icons) {
        if (asset.dataUri) {
          const iconBundle = exportIconAsset(asset, { idFileNames: true });
          modules.push({ name: `./${iconBundle.fileName}`, source: iconBundle.module, lang: "tsx" });
        }
      }
    } catch (e) {
      console.error("[plasmic-mcp] Icon asset export failed (non-fatal):", e instanceof Error ? e.message : e);
    }

    // 6f. Global variant groups (live-syncer:222-237)
    try {
      const groups = site.globalVariantGroups ?? [];
      for (const group of groups) {
        if (group.variants?.length > 0) {
          const bundle = exportGlobalVariantGroup(group, { idFileNames: true });
          modules.push({ name: `./${bundle.contextFileName}`, source: bundle.contextModule, lang: "tsx" });
        }
      }
    } catch (e) {
      console.error("[plasmic-mcp] Global variant export failed (non-fatal):", e instanceof Error ? e.message : e);
    }

    // 6g. Dependent components (live-syncer:192-230). For every component the
    // root transitively references, emit either a code-component stub (looks
    // up __PlasmicComponentRegistry at runtime) or full render+skeleton+css
    // modules for a regular Plasmic component.
    //
    // This is what unblocks `require("./comp__<uuid>")` resolution in the
    // generated render module — without these, SystemJS would try to fetch
    // them from the iframe origin (which has no such route) and fail.
    try {
      for (const dep of extractDependentComponents(component)) {
        if (isCodeComponent(dep)) {
          modules.push(createCodeComponentModule(dep, { idFileNames: true }));
          if (isCodeComponentWithHelpers(dep)) {
            modules.push(createCodeComponentHelperModule(dep, { idFileNames: true }));
          }
        } else {
          // Use the owning site's projectConfig so imported components
          // reference their own project's CSS (see live-syncer:205-210).
          const ownerSite = tryGetOwnerSite(dep);
          const depProjectConfig =
            ownerSite === site || !ownerSite
              ? projectConfig
              : depProjectConfigs.get(ownerSite) ?? projectConfig;
          const depOutput: ComponentExportOutput = exportReactPresentational(
            compGenHelper,
            dep,
            site,
            depProjectConfig,
            imageAssetUriMap,
            false,
            false,
            undefined,
            exportOpts,
            siteCtx
          );
          modules.push(...createComponentModules(depOutput));
        }
      }
    } catch (e) {
      console.error("[plasmic-mcp] Dependent component emission failed (non-fatal):", e instanceof Error ? e.message : e);
    }

    // 6h. Global contexts (live-syncer:320-335 processGlobalContexts).
    // Emit stubs for each global-context code component plus the bundle's
    // wrapper module. Uses the shared `makeGlobalContextsImport` conventions:
    // file is `./PlasmicGlobalContextsProvider.tsx`, default export is
    // `GlobalContextsProvider` (matches react-p/global-context/index.ts:190).
    const globalContextBundle = (projectConfig as any).globalContextBundle;
    try {
      if (globalContextBundle) {
        const globalContexts = (site.globalContexts ?? []).map((tpl: any) => tpl.component);
        for (const ctx of globalContexts) {
          modules.push(createCodeComponentModule(ctx, { idFileNames: true }));
        }
        modules.push({
          name: "./PlasmicGlobalContextsProvider.tsx",
          source: globalContextBundle.contextModule,
          lang: "tsx",
        });
      }
    } catch (e) {
      console.error("[plasmic-mcp] Global context emission failed (non-fatal):", e instanceof Error ? e.message : e);
    }

    // Entry module — mirrors Studio's createPreviewScript at
    // platform/wab/src/wab/client/components/live/live-syncer.ts:498-670.
    // SYNC POINT: on upstream merges, diff createPreviewScript and port any
    // changes here. MCP drops Studio's mobx `untracked()` wrapping and uses
    // empty defaults for variant/global/pageParams/currentAppUser.
    modules.push(buildPreviewEntryScript({
      output,
      site,
      component,
      styleTokensProviderBundle:
        (projectConfig as any).hasStyleTokenOverrides
          ? (projectConfig as any).styleTokensProviderBundle
          : undefined,
      globalContextBundle,
      projectConfig,
      pageParams: opts?.pageParams ?? {},
      pageQuery: opts?.pageQuery ?? {},
    }));

    return modules;
  } catch (err) {
    const msg = err instanceof Error ? err.stack ?? err.message : String(err);
    console.error(`[plasmic-mcp] Codegen failed for "${component.name}":`, msg);
    return { error: msg };
  }
}

/**
 * Build the preview entry module — mirror of Studio's `createPreviewScript`
 * (platform/wab/src/wab/client/components/live/live-syncer.ts:498-670).
 *
 * Studio's function takes `PreviewCtx`/`StudioCtx` (mobx-reactive); MCP has
 * neither, so we take primitive inputs and use empty defaults where Studio
 * would read user-selected state (variants, global variants, pageParams,
 * pageQuery, currentAppUser). `untracked()` is dropped — no mobx in MCP.
 *
 * Wrapping chain (outer → inner):
 *   StyleTokensProvider        — root project's token overrides
 *     global variant providers — theme/screen etc
 *       GlobalContextsProvider — EPCommerceProvider and other globalContexts
 *         PageParamsProvider   — $ctx.params/query for page components
 *           PlasmicDataSourceContextProvider — currentAppUser / authToken
 *             div.live-root-container(--centered) — layout frame
 *               Component(__plasmicIsPreviewRoot=true)
 *
 * Then optionally wraps in `<ph.DataProvider name="..."><Suspense>` when
 * React 18+ is detected (so async data-source integrations don't suspend
 * the whole iframe).
 *
 * SYNC POINT: on upstream merges, diff live-syncer.ts:498-670 and port any
 * changes here. See also memory: project_upstream_merge_runbook.md.
 */
function buildPreviewEntryScript(opts: {
  output: ComponentExportOutput;
  site: any;
  component: any;
  styleTokensProviderBundle?: { id: string; fileName: string };
  globalContextBundle?: any;
  projectConfig: any;
  pageParams: Record<string, string>;
  pageQuery: Record<string, string>;
}): CodeModule {
  const {
    output,
    site,
    component,
    styleTokensProviderBundle,
    globalContextBundle,
    projectConfig,
    pageParams,
    pageQuery,
  } = opts;
  const componentName = output.componentName;
  const componentPath = output.skeletonModuleFileName;

  // Build the component-wrapping expression inside-out, same order as
  // live-syncer.ts:507-565.
  let content = `React.createElement(${componentName}, {
    ...props,
    ${makePlasmicIsPreviewRootComponent()}: true
  })`;

  const containerClass = `live-root-container ${
    output.isPage ? "" : "live-root-container--centered"
  }`;
  content = `React.createElement("div", {className: "${containerClass}"}, ${content})`;

  if (styleTokensProviderBundle) {
    content = `<StyleTokensProvider>{${content}}</StyleTokensProvider>`;
  }

  const globalGroups = allGlobalVariantGroups(site, {
    includeDeps: "all",
    excludeEmpty: true,
    excludeMediaQuery: true,
  });
  const globalGroupImports = makeGlobalGroupImports(globalGroups, {
    idFileNames: true,
  });
  const globalContextsImports = globalContextBundle
    ? makeGlobalContextsImport(projectConfig)
    : "";

  if (globalContextBundle) {
    // Mirror of live-syncer.ts:1111-1117. Shared `wrapGlobalContexts` in
    // serialize-utils.ts:464 inlines content as JSX children (used by the
    // regular codegen pipeline where content is already a JSX element); here
    // content can be a JS expression string like `React.createElement(...)`,
    // so we wrap in `{...}` to keep Babel's JSX parser happy.
    content = `<GlobalContextsProvider>{${content}}</GlobalContextsProvider>`;
  }
  for (const vg of globalGroups) {
    content = wrapGlobalProviderWithCustomValue(
      vg,
      content,
      true,
      `global.${toVarName(vg.param.variable.name)}`
    );
  }

  if (isPageComponent(component)) {
    const path = JSON.stringify(component.pageMeta?.path ?? "/");
    const params = JSON.stringify(pageParams);
    const query = JSON.stringify(pageQuery);
    content = `ph.PageParamsProvider ? (
      <ph.PageParamsProvider route={${path}} params={${params}} query={${query}}>
        {(${content})}
      </ph.PageParamsProvider>
    ) : (${content})`;
  }

  // wrapContentWithCurrentUserContext (live-syncer.ts:1119-1132) — 6 lines,
  // inlined here because it's not shared.
  content = `
  <p.PlasmicDataSourceContextProvider value={${jsLiteral({
    user: undefined,
    userAuthToken: undefined,
  })}}>
    {(${content})}
  </p.PlasmicDataSourceContextProvider>
  `;

  // Serialize initial props from component.params previewExprs + Plume
  // plugin defaults (live-syncer.ts:571-602). Skip Studio's mobx untracked().
  const serializedInitialProps: Record<string, string> = {};
  const exprCtx: ExprCtx = {
    component: null,
    projectFlags: DEVFLAGS,
    inStudio: false,
  };
  for (const param of component.params ?? []) {
    if (!isKnownPropParam(param) || !param.previewExpr) continue;
    serializedInitialProps[toVarName(param.variable.name)] = getRawCode(
      param.previewExpr,
      exprCtx
    );
  }
  const plugin = getPlumeEditorPlugin(component);
  if (plugin?.getArtboardRootDefaultProps) {
    const defaults = plugin.getArtboardRootDefaultProps(component);
    if (defaults) {
      for (const [key, val] of Object.entries(defaults)) {
        serializedInitialProps[key] = JSON.stringify(val);
      }
    }
  }

  const source = `
      import React from "react";
      import ReactDOM from "react-dom";
      import * as ph from "@plasmicapp/host";
      import * as p from "@plasmicapp/react-web";
      ${globalGroupImports}
      ${globalContextsImports}
      ${
        styleTokensProviderBundle
          ? `import { StyleTokensProvider } from "./${styleTokensProviderBundle.fileName}";`
          : ""
      }
      import ${componentName} from "./${componentPath}";
      const Sub = (window as any).__Sub;

      function PlasmicPreviewWrapper() {
        const [props, setProps] = React.useState({
          ${Object.entries(serializedInitialProps)
            .map(([key, val]) => `${key}: ${val}`)
            .join(",\n          ")}
        });
        const [global, setGlobal] = React.useState({});
        (window as any).setPreviewComponentProps = (newProps) => {
          setProps({...props, ...newProps});
        };
        (window as any).setPreviewGlobalVariants = setGlobal;
        const reactMajorVersion = +React.version.split(".")[0];
        const content = (${content});
        if (reactMajorVersion >= 18 && !!ph.DataProvider) {
          return (
            <ph.DataProvider
              name="plasmicInternalEnableLoadingBoundary"
              hidden
              data={true}
            >
              <React.Suspense fallback="Loading...">
                {content}
              </React.Suspense>
            </ph.DataProvider>
          );
        }
        return content;
      }

      export function __run() {
        Sub.hostUtils.setPlasmicRootNode(React.createElement(PlasmicPreviewWrapper, {}));
        window.parent.postMessage({ source: "plasmic-preview", type: "rendered" }, "*");
      }
    `;

  return {
    name: `./script_${componentName}.tsx`,
    source,
    lang: "tsx",
    run: true,
  };
}

// ---------------------------------------------------------------------------
// Request handling
// ---------------------------------------------------------------------------

async function handleRequest(
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  const parsed = url.parse(req.url || "/", true);
  const pathname = parsed.pathname || "/";

  // GET /preview/<path-or-name>?key=value&... — Studio-style routing
  // (matches PreviewCtx.tsx:701-763 `getComponentByPath`). The segment after
  // `/preview/` is matched against every page's `pageMeta.path`: if the URL
  // is `/preview/product/test-product`, we extract `{slug: "test-product"}`
  // from the ProductDetail route `/product/[slug]`. Query string becomes
  // pageQuery. Falls back to component name/UUID for non-page components.
  const previewMatch = pathname.match(/^\/preview\/(.+)$/);
  if (req.method === "GET" && previewMatch) {
    const rawPath = decodeURIComponent(previewMatch[1]);
    const query = parsed.query as Record<string, string | string[] | undefined>;
    await handlePreview(rawPath, query, res);
    return;
  }

  // GET /static/host.html — serve cached host page (same origin for iframe access)
  // MUST be at /static/host.html because sub/index.tsx checks location.pathname === "/static/host.html"
  if (req.method === "GET" && pathname === "/static/host.html") {
    handleHostHtml(res);
    return;
  }

  // GET /static/{filename} — serve codegen-generated modules (CSS, JS) before
  // falling through to the platform proxy. SystemJS resolves imports like
  // "./plasmic__default_style.css" relative to the iframe URL (/static/host.html),
  // so they become /static/plasmic__default_style.css.
  if (req.method === "GET" && pathname.startsWith("/static/")) {
    const filename = pathname.slice("/static/".length);
    const generated = generatedModules.get(filename);
    if (generated) {
      res.writeHead(200, {
        "Content-Type": generated.contentType,
        "Cache-Control": "no-cache",
      });
      res.end(generated.content);
      return;
    }
    // Not a generated module — proxy to platform host
    await handleStaticProxy(pathname, res);
    return;
  }

  // GET /health
  if (req.method === "GET" && pathname === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "ok", port: serverPort, hostUrl: getStudioOrigin() }));
    return;
  }

  // GET /debug — internal state inspection (developer-only)
  if (req.method === "GET" && pathname === "/debug") {
    const sess = getSession();
    const appHostUrls = Array.from(cachedAppHostHtml.keys());
    const appHostSizes = appHostUrls.map(k => ({ origin: k, size: cachedAppHostHtml.get(k)?.length ?? 0 }));
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({
      sessionHostUrl: sess?.hostUrl ?? null,
      activeAppHostOrigin,
      cachedAppHosts: appHostSizes,
      lastAppHostFetchError,
      cachedHostHtmlLength: cachedHostHtml?.length ?? 0,
      commitHash,
    }, null, 2));
    return;
  }

  // GET / — component index
  if (req.method === "GET" && pathname === "/") {
    handleIndex(res);
    return;
  }

  // Catch-all: proxy anything else to the active app host (the user's dev
  // server). This covers `/_next/static/chunks/*.js` and other relative URLs
  // referenced inside the rewritten app-host HTML we serve at
  // /static/host.html. Without this the iframe 404s on every Next.js chunk.
  if (activeAppHostOrigin) {
    await handleUpstreamProxy(req, res, activeAppHostOrigin);
    return;
  }

  res.writeHead(404, { "Content-Type": "text/html" });
  res.end(errorPage("Not Found", `No route matches ${pathname}`));
}

// ---------------------------------------------------------------------------
// Route handlers
// ---------------------------------------------------------------------------

function handleHostHtml(res: http.ServerResponse): void {
  // Prefer the project's app-host HTML (rewritten for same-origin embedding)
  // when one was fetched during the most recent /preview request. Fall back
  // to Studio's host.html for hostless projects.
  console.error(`[plasmic-mcp/host.html] activeAppHostOrigin=${activeAppHostOrigin} hasCached=${activeAppHostOrigin ? cachedAppHostHtml.has(activeAppHostOrigin) : "n/a"}`);
  const html = activeAppHostOrigin
    ? cachedAppHostHtml.get(activeAppHostOrigin) ?? cachedHostHtml
    : cachedHostHtml;
  if (!html) {
    res.writeHead(503, { "Content-Type": "text/html" });
    res.end(errorPage("Host Not Available", "host.html not loaded. Check platform host URL."));
    return;
  }

  res.writeHead(200, {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-cache",
  });
  res.end(html);
}

async function handleStaticProxy(
  pathname: string,
  res: http.ServerResponse
): Promise<void> {
  const targetUrl = `${getRendererOrigin()}${pathname}`;
  try {
    const proxyRes = await fetch(targetUrl, { redirect: "follow" });
    if (!proxyRes.ok) {
      res.writeHead(proxyRes.status, { "Content-Type": "text/plain" });
      res.end(`Proxy error: ${proxyRes.status} ${proxyRes.statusText}`);
      return;
    }

    // Forward content type and body
    const contentType = proxyRes.headers.get("content-type") || "application/octet-stream";
    const body = Buffer.from(await proxyRes.arrayBuffer());
    res.writeHead(200, {
      "Content-Type": contentType,
      "Cache-Control": "public, max-age=3600",
    });
    res.end(body);
  } catch (err: any) {
    console.error(`[plasmic-mcp] Static proxy error for ${pathname}:`, err.message);
    res.writeHead(502, { "Content-Type": "text/plain" });
    res.end(`Proxy fetch failed: ${err.message}`);
  }
}

/**
 * Transparent reverse proxy: forward a request to the user's dev server.
 * Used for `/_next/*` and any other path the rewritten app-host HTML
 * references relatively — those must come from the user's dev server but
 * be served at our origin to stay same-origin with the iframe.
 */
async function handleUpstreamProxy(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  upstreamOrigin: string
): Promise<void> {
  const target = `${upstreamOrigin}${req.url || "/"}`;
  try {
    const proxyRes = await fetch(target, {
      method: req.method,
      redirect: "follow",
      // Don't forward hop-by-hop or host-specific headers; let fetch set its own
    });
    const contentType = proxyRes.headers.get("content-type") || "application/octet-stream";
    const body = Buffer.from(await proxyRes.arrayBuffer());
    res.writeHead(proxyRes.status, {
      "Content-Type": contentType,
      "Cache-Control": proxyRes.headers.get("cache-control") || "no-cache",
    });
    res.end(body);
  } catch (err: any) {
    console.error(`[plasmic-mcp] Upstream proxy error for ${req.url}:`, err.message);
    res.writeHead(502, { "Content-Type": "text/plain" });
    res.end(`Upstream proxy failed: ${err.message}`);
  }
}

async function handlePreview(
  rawPath: string,
  rawQuery: Record<string, string | string[] | undefined>,
  res: http.ServerResponse
): Promise<void> {
  const session = getSession();
  if (!session) {
    res.writeHead(503, { "Content-Type": "text/html" });
    res.end(errorPage("No Active Project", "Load a project first using the project tool."));
    return;
  }

  if (!cachedHostHtml || !commitHash) {
    res.writeHead(503, { "Content-Type": "text/html" });
    res.end(errorPage("Preview Not Ready", "Host page not loaded. Check platform host URL configuration."));
    return;
  }

  // Resolve using Studio's path-matching rules. `rawPath` may be:
  //   - `product/test-product` → matches a page with pageMeta.path `/product/[slug]`
  //   - `ProductDetail`        → matches by component name
  //   - `03EbS1cxqctg`         → matches by UUID
  const resolved = resolveComponentByPath(session.site, rawPath);
  if (!resolved) {
    const names = (session.site.components || []).map((c: any) => c.name).join(", ");
    res.writeHead(404, { "Content-Type": "text/html" });
    res.end(errorPage("Component Not Found", `"${rawPath}" didn't match any page path or component. Available components: ${names}`));
    return;
  }
  const { component, pageParams: pathParams } = resolved;

  // Merge path-derived params with pageMeta defaults (path wins) and
  // derive pageQuery from the query string, falling back to pageMeta.query
  // defaults when a key is absent (mirrors Studio's PreviewCtx.tsx:390-395).
  const pageMetaParams: Record<string, string> = component.pageMeta?.params ?? {};
  const pageMetaQuery: Record<string, string> = component.pageMeta?.query ?? {};
  const pageParams: Record<string, string> = { ...pageMetaParams, ...pathParams };
  const pageQuery: Record<string, string> = { ...pageMetaQuery };
  for (const [k, v] of Object.entries(rawQuery)) {
    if (v === undefined) continue;
    pageQuery[k] = Array.isArray(v) ? (v[0] ?? "") : v;
  }

  // Generate component code using the same codegen pipeline as Studio's live preview
  let modules: CodeModule[];
  const result = generateComponentModules(component, { pageParams, pageQuery });

  if (result && !("error" in result)) {
    modules = result;
    // Cache generated modules so SystemJS can fetch them at /static/{filename}.
    // SystemJS resolves "./foo.css" relative to the iframe (/static/host.html)
    // → GET /static/foo.css, which we intercept and serve from this cache.
    generatedModules.clear();
    for (const mod of modules) {
      // Strip leading "./" to get the bare filename
      const filename = mod.name.replace(/^\.\//, "");
      const contentType = mod.lang === "css" ? "text/css; charset=utf-8" : "application/javascript; charset=utf-8";
      generatedModules.set(filename, { content: mod.source, contentType });
    }
  } else {
    // Fallback: show error details inline for debugging
    const errorMsg = result && "error" in result ? result.error : "Unknown error";
    const escapedError = JSON.stringify(errorMsg);
    modules = [
      {
        name: "./preview-entry.tsx",
        source: `
          var React = window.__Sub.React;
          var el = React.createElement;
          window.__Sub.hostUtils.setPlasmicRootNode(
            el("div", { style: { padding: "40px", fontFamily: "system-ui" } },
              el("h1", {}, ${JSON.stringify(component.name)}),
              el("p", { style: { color: "#c00" } }, "Codegen failed:"),
              el("pre", { style: { color: "#666", fontSize: "12px", whiteSpace: "pre-wrap", maxWidth: "800px" } }, ${escapedError})
            )
          );
          window.parent.postMessage({ source: "plasmic-preview", type: "rendered" }, "*");
        `,
        lang: "tsx",
        run: true,
      },
    ];
  }

  const studioOrigin = getRendererOrigin();

  // Track the active app host origin so the catch-all proxy forwards
  // `/_next/*` etc. to the right upstream. The iframe loads the user's host
  // page at its real pathname (e.g. `/plasmic-host`) through our origin,
  // which makes it same-origin with the outer preview page (so script
  // injection into the iframe works) while still hitting the real Next.js
  // app for HTML/JS/CSS. Hostless projects fall back to /static/host.html
  // (served from Studio's cached host.html).
  const appHostPathname =
    session.hostUrl != null ? new URL(session.hostUrl).pathname : null;
  activeAppHostOrigin =
    session.hostUrl != null ? new URL(session.hostUrl).origin : null;

  const previewHtml = generatePreviewPage(
    component.name,
    modules,
    commitHash,
    studioOrigin,
    appHostPathname
  );

  res.writeHead(200, {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-cache",
  });
  res.end(previewHtml);
}

function handleIndex(res: http.ServerResponse): void {
  const session = getSession();
  if (!session) {
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(errorPage("No Project", "No project loaded."));
    return;
  }

  const components = session.site.components || [];
  const links = components
    .map((c: any) => {
      const isPage = !!c.pageMeta?.path;
      return `<li><a href="/preview/${encodeURIComponent(c.name)}">${escapeHtml(c.name)}</a>${isPage ? " (page)" : ""}</li>`;
    })
    .join("\n");

  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  res.end(`<!DOCTYPE html>
<html><head><title>Plasmic Preview - ${escapeHtml(session.projectName)}</title></head>
<body style="font-family:system-ui;max-width:800px;margin:40px auto;padding:0 20px">
<h1>${escapeHtml(session.projectName)}</h1>
<p>${components.length} components</p>
<ul>${links}</ul>
</body></html>`);
}

// ---------------------------------------------------------------------------
// Preview page generation
// ---------------------------------------------------------------------------

interface CodeModule {
  name: string;
  source: string;
  lang: string;
  run?: boolean;
}

function generatePreviewPage(
  componentName: string,
  modules: CodeModule[],
  hash: string,
  studioOrigin: string,
  appHostPathname: string | null
): string {
  const modulesJson = JSON.stringify(modules);
  // Iframe loads the app host's pathname (e.g. `/plasmic-host`) or, for
  // hostless projects, Studio's `/static/host.html`. Either way the URL is on
  // OUR origin so the outer page can inject scripts directly into the iframe
  // document. The catch-all proxy forwards any unmatched paths (e.g.
  // `/_next/static/chunks/*.js`) to the upstream.
  const iframeBase = appHostPathname ?? "/static/host.html";
  const iframeSrc = `${iframeBase}#live=true&origin=${encodeURIComponent(studioOrigin)}`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Preview: ${escapeHtml(componentName)}</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; }
    html, body { margin: 0; padding: 0; width: 100%; height: 100%; overflow: hidden; }
    iframe { width: 100%; height: 100%; border: none; }
    #status { position: fixed; bottom: 8px; right: 8px; font: 12px system-ui; color: #999; z-index: 9999; }
  </style>
</head>
<body>
  <iframe id="preview-frame" src="${iframeSrc}"></iframe>
  <div id="status">Loading...</div>
  <script>
    (function() {
      var modules = ${modulesJson};
      var iframe = document.getElementById('preview-frame');
      var status = document.getElementById('status');
      var COMMIT_HASH = ${JSON.stringify(hash)};
      var STUDIO_ORIGIN = ${JSON.stringify(studioOrigin)};

      iframe.addEventListener('load', async function() {
        try {
          var win = iframe.contentWindow;
          var doc = iframe.contentDocument;

          status.textContent = 'Waiting for host...';

          // Step 1: Wait for __Sub (PlasmicCanvasHost sets this up on import)
          await waitFor(function() {
            return win.__Sub && win.__Sub.React;
          }, 10000);

          status.textContent = 'Waiting for SystemJS...';

          // Step 2: Wait for SystemJS (loaded by getlibs.js, injected by PlasmicCanvasHost in live mode)
          await waitFor(function() {
            return (win.System && win.System.refreshXModules) || (win.SystemJS && win.SystemJS.refreshXModules);
          }, 15000);

          status.textContent = 'Injecting bundles...';

          // Step 3: Inject react-web-bundle (like Studio onLoadInjectSystemJS step 2)
          if (!win.__PlasmicReactWebBundle) {
            await injectScript(doc, STUDIO_ORIGIN + '/static/react-web-bundle/build/client.' + COMMIT_HASH + '.js');
          }

          // Step 4: Inject live-frame client (like Studio onLoadInjectSystemJS step 7)
          // This registers React, react-web, etc. with SystemJS
          await injectScript(doc, STUDIO_ORIGIN + '/static/live-frame/build/client.' + COMMIT_HASH + '.js');

          status.textContent = 'Pushing modules...';

          // Step 5: Push generated code modules via SystemJS (like Studio updateModules)
          var script = doc.createElement('script');
          script.setAttribute('type', 'text/javascript');
          script.textContent = 'var _mods = ' + JSON.stringify(modules) + ';' +
            '(window.SystemJS || window.System).refreshXModules(_mods).then(function() {' +
            '  window.parent.postMessage({source:"plasmic-preview",type:"rendered"}, "*");' +
            '}).catch(function(err) {' +
            '  console.error("Module refresh error:", err);' +
            '  window.parent.postMessage({source:"plasmic-preview",type:"error",error:String(err)}, "*");' +
            '});';
          doc.body.append(script);

          // Listen for completion
          window.addEventListener('message', function(event) {
            if (event.data && event.data.source === 'plasmic-preview') {
              if (event.data.type === 'rendered') {
                status.textContent = '';
              } else if (event.data.type === 'error') {
                status.textContent = 'Error: ' + event.data.error;
                status.style.color = '#c00';
              }
            }
          });

        } catch (err) {
          status.textContent = 'Error: ' + err.message;
          status.style.color = '#c00';
          console.error('Preview init error:', err);
        }
      });

      function waitFor(predicate, timeoutMs) {
        return new Promise(function(resolve, reject) {
          var start = Date.now();
          var check = function() {
            if (predicate()) {
              resolve();
            } else if (Date.now() - start > timeoutMs) {
              reject(new Error('Timed out waiting for host to initialize'));
            } else {
              setTimeout(check, 50);
            }
          };
          check();
        });
      }

      function injectScript(doc, src) {
        return new Promise(function(resolve, reject) {
          var s = doc.createElement('script');
          s.src = src;
          s.onload = resolve;
          s.onerror = function() { reject(new Error('Failed to load: ' + src)); };
          doc.head.append(s);
        });
      }
    })();
  </script>
</body>
</html>`;
}

// ---------------------------------------------------------------------------
// HTML helpers
// ---------------------------------------------------------------------------

function errorPage(title: string, message: string): string {
  return `<!DOCTYPE html>
<html><head><title>Error: ${escapeHtml(title)}</title></head>
<body style="font-family:system-ui;max-width:600px;margin:80px auto;text-align:center">
<h1 style="color:#c00">${escapeHtml(title)}</h1>
<p>${escapeHtml(message)}</p>
</body></html>`;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
