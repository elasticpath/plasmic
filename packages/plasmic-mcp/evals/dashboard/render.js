/**
 * Eval dashboard server — reads JSON reports from evals/results/ and serves
 * a local dashboard with Chart.js visualizations.
 *
 * Why a local server instead of a static file generator: the dashboard reads
 * fresh reports on every page load, so it always shows the latest data without
 * a rebuild step. The server is lightweight (Node.js built-in http) with zero
 * extra dependencies.
 *
 * Usage:
 *   npm run eval:dashboard              # Start on default port 3847
 *   EVAL_DASHBOARD_PORT=8080 npm run eval:dashboard  # Custom port
 */

import { createServer } from "http";
import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync } from "fs";
import { resolve, dirname, join } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const RESULTS_DIR = resolve(__dirname, "../results");
const DASHBOARD_HTML = resolve(__dirname, "index.html");
const OVERRIDES_PATH = resolve(RESULTS_DIR, "overrides.json");
const RETENTION_DAYS = 90;
const PORT = parseInt(process.env.EVAL_DASHBOARD_PORT || "3847", 10);

/**
 * Load all JSON reports from evals/results/, filtered by the 90-day retention
 * policy. Malformed files are skipped with a warning — one bad file shouldn't
 * break the dashboard.
 */
function loadReports() {
  if (!existsSync(RESULTS_DIR)) return [];

  const cutoff = Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000;
  const files = readdirSync(RESULTS_DIR).filter(
    (f) => f.endsWith(".json") && f !== "overrides.json"
  );

  const reports = [];
  for (const file of files) {
    try {
      const content = readFileSync(join(RESULTS_DIR, file), "utf-8");
      const report = JSON.parse(content);

      // Validate minimal structure
      if (!report.timestamp || !report.aggregate) {
        console.error(`Warning: ${file} missing required fields, skipping`);
        continue;
      }

      // Apply 90-day retention policy (spec GE7)
      const reportDate = new Date(report.timestamp).getTime();
      if (reportDate >= cutoff) {
        reports.push(report);
      }
    } catch (e) {
      console.error(`Warning: could not parse ${file}: ${e.message}`);
    }
  }

  // Sort by timestamp ascending for trend lines
  reports.sort(
    (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
  );

  return reports;
}

const server = createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);

  if (url.pathname === "/" || url.pathname === "/index.html") {
    try {
      const html = readFileSync(DASHBOARD_HTML, "utf-8");
      res.writeHead(200, {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-cache",
      });
      res.end(html);
    } catch (e) {
      res.writeHead(500, { "Content-Type": "text/plain" });
      res.end(`Error loading dashboard: ${e.message}`);
    }
  } else if (url.pathname === "/api/reports") {
    const reports = loadReports();
    res.writeHead(200, {
      "Content-Type": "application/json",
      "Cache-Control": "no-cache",
    });
    // Strip transcripts to reduce payload size — they're large and the
    // dashboard only needs aggregate metrics. Full transcripts remain in
    // the JSON files for detailed inspection.
    const slim = reports.map((r) => ({
      ...r,
      scenarios: r.scenarios.map((s) => ({
        ...s,
        transcript: undefined,
        graderResults: s.graderResults,
      })),
    }));
    res.end(JSON.stringify(slim));
  } else if (url.pathname === "/api/overrides" && req.method === "GET") {
    // Read overrides.json — human review annotations that persist across runs
    let overrides = {};
    if (existsSync(OVERRIDES_PATH)) {
      try {
        overrides = JSON.parse(readFileSync(OVERRIDES_PATH, "utf-8"));
      } catch {
        // Malformed file — return empty
      }
    }
    res.writeHead(200, {
      "Content-Type": "application/json",
      "Cache-Control": "no-cache",
    });
    res.end(JSON.stringify(overrides));
  } else if (url.pathname === "/api/overrides" && req.method === "POST") {
    // Save a single override annotation: { scenarioId, overrideSuccess?, notes?, reviewedBy? }
    let body = "";
    req.on("data", (chunk) => { body += chunk; });
    req.on("end", () => {
      try {
        const { scenarioId, ...override } = JSON.parse(body);
        if (!scenarioId || typeof scenarioId !== "string") {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "scenarioId is required" }));
          return;
        }

        mkdirSync(RESULTS_DIR, { recursive: true });
        let existing = {};
        if (existsSync(OVERRIDES_PATH)) {
          try {
            existing = JSON.parse(readFileSync(OVERRIDES_PATH, "utf-8"));
          } catch {
            // Start fresh if malformed
          }
        }
        existing[scenarioId] = {
          ...override,
          reviewedAt: new Date().toISOString(),
        };
        writeFileSync(OVERRIDES_PATH, JSON.stringify(existing, null, 2));

        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true }));
      } catch (e) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: `Invalid JSON: ${e.message}` }));
      }
    });
  } else {
    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("Not found");
  }
});

server.listen(PORT, () => {
  console.log(`\nEval Dashboard`);
  console.log(`  URL:        http://localhost:${PORT}`);
  console.log(`  Reports:    ${RESULTS_DIR}`);
  console.log(`  Retention:  ${RETENTION_DAYS} days\n`);

  const reportCount = existsSync(RESULTS_DIR)
    ? readdirSync(RESULTS_DIR).filter((f) => f.endsWith(".json") && f !== "overrides.json").length
    : 0;
  console.log(`  Found ${reportCount} report(s)\n`);
});
