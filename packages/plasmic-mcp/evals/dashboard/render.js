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
import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync, unlinkSync, statSync, rmSync } from "fs";
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

/**
 * Delete result JSON files and screenshot directories older than 90 days.
 * Prevents unbounded disk usage from accumulated eval runs. Invoked on
 * dashboard server startup and available standalone via `npm run eval:cleanup`.
 */
function cleanupOldResults() {
  if (!existsSync(RESULTS_DIR)) return;

  const cutoff = Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000;
  let deletedFiles = 0;
  let deletedDirs = 0;

  // Clean up JSON report files older than 90 days
  const jsonFiles = readdirSync(RESULTS_DIR).filter(
    (f) => f.endsWith(".json") && f !== "overrides.json"
  );
  for (const file of jsonFiles) {
    const filePath = join(RESULTS_DIR, file);
    try {
      const content = readFileSync(filePath, "utf-8");
      const report = JSON.parse(content);
      if (report.timestamp) {
        const reportDate = new Date(report.timestamp).getTime();
        if (reportDate < cutoff) {
          unlinkSync(filePath);
          deletedFiles++;
        }
      }
    } catch {
      // Can't parse — check file modification time as fallback
      try {
        const stat = statSync(filePath);
        if (stat.mtimeMs < cutoff) {
          unlinkSync(filePath);
          deletedFiles++;
        }
      } catch {
        // Skip files we can't stat
      }
    }
  }

  // Clean up screenshot directories older than 90 days (by mtime)
  const screenshotsDir = join(RESULTS_DIR, "screenshots");
  if (existsSync(screenshotsDir)) {
    const runDirs = readdirSync(screenshotsDir);
    for (const dir of runDirs) {
      const dirPath = join(screenshotsDir, dir);
      try {
        const stat = statSync(dirPath);
        if (stat.isDirectory() && stat.mtimeMs < cutoff) {
          rmSync(dirPath, { recursive: true, force: true });
          deletedDirs++;
        }
      } catch {
        // Skip directories we can't stat
      }
    }
  }

  if (deletedFiles > 0 || deletedDirs > 0) {
    console.log(
      `[cleanup] Removed ${deletedFiles} report(s) and ${deletedDirs} screenshot dir(s) older than ${RETENTION_DAYS} days`
    );
  }
}

// Standalone cleanup mode: `node render.js --cleanup-only`
if (process.argv.includes("--cleanup-only")) {
  cleanupOldResults();
  process.exit(0);
}

// Run cleanup on server startup
cleanupOldResults();

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
        const parsed = JSON.parse(body);
        if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Request body must be a JSON object" }));
          return;
        }

        const { scenarioId, overrideSuccess, notes, reviewedBy } = parsed;

        // Validate scenarioId: required, string, kebab-case pattern
        if (!scenarioId || typeof scenarioId !== "string") {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "scenarioId is required and must be a string" }));
          return;
        }
        if (!/^[a-zA-Z0-9_-]+$/.test(scenarioId)) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "scenarioId must contain only alphanumeric characters, hyphens, and underscores" }));
          return;
        }

        // Reject unexpected fields — only allow known override properties
        const ALLOWED_FIELDS = new Set(["scenarioId", "overrideSuccess", "notes", "reviewedBy"]);
        const unexpected = Object.keys(parsed).filter((k) => !ALLOWED_FIELDS.has(k));
        if (unexpected.length > 0) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: `Unexpected fields: ${unexpected.join(", ")}` }));
          return;
        }

        // Validate field types
        if (overrideSuccess !== undefined && typeof overrideSuccess !== "boolean") {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "overrideSuccess must be a boolean" }));
          return;
        }
        if (notes !== undefined && typeof notes !== "string") {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "notes must be a string" }));
          return;
        }
        if (reviewedBy !== undefined && typeof reviewedBy !== "string") {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "reviewedBy must be a string" }));
          return;
        }

        // Build sanitized override object — only include explicitly set fields
        const override = { reviewedAt: new Date().toISOString() };
        if (overrideSuccess !== undefined) override.overrideSuccess = overrideSuccess;
        if (notes) override.notes = notes.slice(0, 2000); // cap length
        if (reviewedBy) override.reviewedBy = reviewedBy.slice(0, 200); // cap length

        mkdirSync(RESULTS_DIR, { recursive: true });
        let existing = {};
        if (existsSync(OVERRIDES_PATH)) {
          try {
            existing = JSON.parse(readFileSync(OVERRIDES_PATH, "utf-8"));
          } catch {
            // Start fresh if malformed
          }
        }
        existing[scenarioId] = override;
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
