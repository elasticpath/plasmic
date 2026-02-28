import tracer from "dd-trace";

tracer.init({
  service: process.env.DD_SERVICE || "plasmic-wab",
  env: process.env.DD_ENV || process.env.NODE_ENV || "development",
  version: process.env.DD_VERSION,
  logInjection: true,
  runtimeMetrics: true,
});

// Replicate what @sentry/node did automatically: intercept unhandled rejections
// (like the upstream `spawn(async () => throw)` pattern in bundles.ts) and
// report them instead of letting Node.js v24 terminate the process.
process.on("unhandledRejection", (reason: unknown) => {
  // Lazy-import to avoid circular dependency during startup
  const { captureException } = require("@/wab/server/observability/datadog");
  captureException(
    reason instanceof Error ? reason : new Error(String(reason)),
    { source: "unhandledRejection" }
  );
});
