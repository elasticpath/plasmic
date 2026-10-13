import { Config } from "@/wab/server/config";
import { logger } from "@/wab/server/observability";
import { trackWorkerPool } from "@/wab/server/promstats";
import { TraceCarrier, withSpan } from "@/wab/server/util/apm-util";
import type { workerBuildAssets } from "@/wab/server/workers/build-loader-assets";
import type { workerGenCode } from "@/wab/server/workers/codegen";
import type { workerLocalizationStrings } from "@/wab/server/workers/localization-worker";
import { context, propagation } from "@opentelemetry/api";
import path from "path";
import { WorkerPool, pool as createPool } from "workerpool";

// Setting a pool task timeout of 6 minutes
const TIMEOUT_MS = 6 * 60 * 1000;

export interface PlasmicWorkerPool {
  // We explicit specify exec overrides to allow type-checking,
  // since we are calling exec with a string and not a typed function
  exec(
    method: "codegen",
    params: Parameters<typeof workerGenCode>
  ): ReturnType<typeof workerGenCode>;
  exec(
    method: "loader-assets",
    params: Parameters<typeof workerBuildAssets>
  ): ReturnType<typeof workerBuildAssets>;
  exec(
    method: "localization-strings",
    params: Parameters<typeof workerLocalizationStrings>
  ): ReturnType<typeof workerLocalizationStrings>;
}

class WorkerPoolWrapper {
  constructor(
    private loaderPool: WorkerPool,
    private genericPool: WorkerPool
  ) {}

  exec(method: string, params: any) {
    return withSpan(`workerpool-exec-${method}`, async () => {
      const pool =
        method === "loader-assets" ? this.loaderPool : this.genericPool;
      const stats = pool.stats();
      logger().info("worker-pool-task-queued", {
        workerPoolMethod: method,
        workerPoolPendingTasks: stats.pendingTasks,
        workerPoolActiveTasks: stats.activeTasks,
      });
      const start = Date.now();
      const traceCarrier: TraceCarrier = {};
      propagation.inject(context.active(), traceCarrier);
      try {
        return await pool
          .exec(method, [...params, traceCarrier])
          .timeout(TIMEOUT_MS);
      } finally {
        logger().info("worker-pool-task-done", {
          workerPoolMethod: method,
          workerPoolWaitMs: Date.now() - start,
        });
      }
    });
  }
}

export function createWorkerPool(config: Config) {
  const loaderPool = createPool(path.join(__dirname, "worker.js"), {
    workerType: "thread",
    maxWorkers: config.loaderWorkerPoolSize,
  });
  const genericPool = createPool(path.join(__dirname, "worker.js"), {
    workerType: "thread",
    maxWorkers: config.genericWorkerPoolSize,
  });
  trackWorkerPool("loader", loaderPool);
  trackWorkerPool("generic", genericPool);

  const wrapper = new WorkerPoolWrapper(loaderPool, genericPool);
  return wrapper as any as PlasmicWorkerPool;
}
