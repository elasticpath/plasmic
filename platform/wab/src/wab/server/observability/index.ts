import { methodForwarder } from "@/wab/commons/methodForwarder";
import { PinoLogger } from "@/wab/server/observability/PinoLogger";
import { Analytics } from "@/wab/shared/observability/Analytics";
import { Logger } from "@/wab/shared/observability/Logger";

let loggerInstance: Logger = new PinoLogger();

// Resolve ECS task metadata and upgrade the singleton once available.
// Logs emitted before resolution omit taskId; all subsequent logs include it.
PinoLogger.create().then((resolved) => {
  loggerInstance = resolved;
});

export function initAnalyticsFactory(opts: {
  production: boolean;
}): () => Analytics {
  return () => methodForwarder<Analytics>();
}

export function logger(): Logger {
  return loggerInstance;
}
