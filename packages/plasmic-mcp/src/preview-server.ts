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

let server: http.Server | null = null;
let serverPort: number | null = null;

/** Resolved platform host URL (e.g., https://integration.host.elasticpathdev.com). */
let platformHostUrl: string | null = null;

/** Cached host.html content from the platform host. */
let cachedHostHtml: string | null = null;

/** Commit hash extracted from host.html script URL. */
let commitHash: string | null = null;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Get the current preview server port, or null if not running. */
export function getPreviewPort(): number | null {
  return serverPort;
}

/** Get the full preview URL for a component, or null if server not running. */
export function getPreviewUrl(componentName: string): string | null {
  if (!serverPort) return null;
  return `http://127.0.0.1:${serverPort}/preview/${encodeURIComponent(componentName)}`;
}

/**
 * Start the preview HTTP server on a random available port.
 * Resolves the platform host URL and caches host.html.
 * Stops any existing server first.
 */
export async function startPreviewServer(
  apiClient: PlasmicApiClient
): Promise<number> {
  await stopPreviewServer();

  // Resolve the platform host URL
  await resolveHostUrl(apiClient);

  // Pre-fetch and cache host.html
  if (platformHostUrl) {
    await fetchAndCacheHostHtml();
  }

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
          `[plasmic-mcp] Preview server started on http://127.0.0.1:${serverPort}` +
          (platformHostUrl ? ` (host: ${platformHostUrl})` : " (no host URL)")
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
      platformHostUrl = null;
      cachedHostHtml = null;
      commitHash = null;
      resolve();
    });
    setTimeout(() => {
      server = null;
      serverPort = null;
      platformHostUrl = null;
      cachedHostHtml = null;
      commitHash = null;
      resolve();
    }, 2000);
  });
}

/** Get the Studio origin URL (for getlibs.js loading). */
function getStudioOrigin(): string {
  const auth = getAuth();
  return auth.host.replace(/\/$/, "");
}

// ---------------------------------------------------------------------------
// Host URL resolution
// ---------------------------------------------------------------------------

/**
 * Resolve the platform host URL using the same logic as Studio's getHostUrl():
 * 1. session.hostUrl (custom host from project settings)
 * 2. appConfig.defaultHostUrl (platform default for hostless projects)
 * 3. PLASMIC_PREVIEW_HOST_URL env var (manual override)
 */
async function resolveHostUrl(apiClient: PlasmicApiClient): Promise<void> {
  const session = getSession();

  // Custom host projects already have the URL
  if (session?.hostUrl) {
    platformHostUrl = session.hostUrl.replace(/\/$/, "");
    console.error(`[plasmic-mcp] Preview host: ${platformHostUrl} (project hostUrl)`);
    return;
  }

  // Try env var override
  if (process.env.PLASMIC_PREVIEW_HOST_URL) {
    platformHostUrl = process.env.PLASMIC_PREVIEW_HOST_URL.replace(/\/$/, "");
    console.error(`[plasmic-mcp] Preview host: ${platformHostUrl} (env var)`);
    return;
  }

  // Fetch from app config (same as Studio's appConfig.defaultHostUrl)
  try {
    const appConfig = await apiClient.getAppConfig();
    const defaultHost = (appConfig?.config as any)?.defaultHostUrl;
    if (defaultHost) {
      // defaultHostUrl may include /static/host.html — strip to base URL
      const hostUrl = new URL(defaultHost);
      platformHostUrl = `${hostUrl.protocol}//${hostUrl.host}`;
      console.error(`[plasmic-mcp] Preview host: ${platformHostUrl} (appConfig.defaultHostUrl)`);
      return;
    }
  } catch (err) {
    console.error("[plasmic-mcp] Failed to fetch appConfig for defaultHostUrl:", err);
  }

  console.error("[plasmic-mcp] No platform host URL available for preview proxy");
}

/**
 * Fetch host.html from the platform host and cache it.
 * Extracts the commit hash from the script URL for use with other bundles.
 */
async function fetchAndCacheHostHtml(): Promise<void> {
  if (!platformHostUrl) return;

  const hostHtmlUrl = `${platformHostUrl}/static/host.html`;
  try {
    const response = await fetch(hostHtmlUrl, { redirect: "follow" });
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
    console.error(`[plasmic-mcp] Failed to fetch host.html from ${hostHtmlUrl}:`, err);
  }
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

  // GET /preview/:componentName
  const previewMatch = pathname.match(/^\/preview\/(.+)$/);
  if (req.method === "GET" && previewMatch) {
    const componentName = decodeURIComponent(previewMatch[1]);
    handlePreview(componentName, res);
    return;
  }

  // GET /static/host.html — serve cached host page (same origin for iframe access)
  // MUST be at /static/host.html because sub/index.tsx checks location.pathname === "/static/host.html"
  if (req.method === "GET" && pathname === "/static/host.html") {
    handleHostHtml(res);
    return;
  }

  // GET /static/* — proxy to platform host
  if (req.method === "GET" && pathname.startsWith("/static/")) {
    await handleStaticProxy(pathname, res);
    return;
  }

  // GET /health
  if (req.method === "GET" && pathname === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "ok", port: serverPort, hostUrl: platformHostUrl }));
    return;
  }

  // GET / — component index
  if (req.method === "GET" && pathname === "/") {
    handleIndex(res);
    return;
  }

  res.writeHead(404, { "Content-Type": "text/html" });
  res.end(errorPage("Not Found", `No route matches ${pathname}`));
}

// ---------------------------------------------------------------------------
// Route handlers
// ---------------------------------------------------------------------------

function handleHostHtml(res: http.ServerResponse): void {
  if (!cachedHostHtml) {
    res.writeHead(503, { "Content-Type": "text/html" });
    res.end(errorPage("Host Not Available", "host.html not loaded. Check platform host URL."));
    return;
  }

  res.writeHead(200, {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-cache",
  });
  res.end(cachedHostHtml);
}

async function handleStaticProxy(
  pathname: string,
  res: http.ServerResponse
): Promise<void> {
  if (!platformHostUrl) {
    res.writeHead(503, { "Content-Type": "text/plain" });
    res.end("No platform host URL configured");
    return;
  }

  const targetUrl = `${platformHostUrl}${pathname}`;
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

function handlePreview(
  componentName: string,
  res: http.ServerResponse
): void {
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

  // Resolve component by name or UUID
  const component = session.site.components?.find(
    (c: any) => c.name === componentName || c.uuid === componentName
  );
  if (!component) {
    const names = (session.site.components || []).map((c: any) => c.name).join(", ");
    res.writeHead(404, { "Content-Type": "text/html" });
    res.end(errorPage("Component Not Found", `"${componentName}" not found. Available: ${names}`));
    return;
  }

  // TODO: Replace with codegen-preview.ts generatePreviewModules()
  // For now, use a test module that renders the component name
  const modules = [
    {
      name: `./preview-entry.tsx`,
      source: `
        const React = window.__Sub.React;
        const el = React.createElement;
        window.__Sub.setPlasmicRootNode(
          el("div", { style: { padding: "40px", fontFamily: "system-ui" } },
            el("h1", {}, ${JSON.stringify(component.name)}),
            el("p", { style: { color: "#666" } }, "Preview rendering via codegen coming soon..."),
            el("p", { style: { color: "#999", fontSize: "14px" } },
              "Host: " + ${JSON.stringify(platformHostUrl)},
              el("br"),
              "Commit: " + ${JSON.stringify(commitHash)}
            )
          )
        );
        window.parent.postMessage({ source: "plasmic-preview", type: "rendered" }, "*");
      `,
      lang: "tsx",
      run: true,
    },
  ];

  // The origin param tells PlasmicCanvasHost where to load getlibs.js from.
  // Must point to the Studio host (where /static/js/getlibs.js lives).
  const studioOrigin = getStudioOrigin();
  const previewHtml = generatePreviewPage(component.name, modules, commitHash, studioOrigin);

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
  studioOrigin: string
): string {
  const modulesJson = JSON.stringify(modules);
  // The iframe src must be /static/host.html (sub/index.tsx checks location.pathname)
  // The origin param tells PlasmicCanvasHost where to load getlibs.js (SystemJS) from
  const iframeSrc = `/static/host.html#live=true&origin=${encodeURIComponent(studioOrigin)}`;

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
