import { logger } from "@/wab/server/observability";
import { WabPromTimer } from "@/wab/server/promstats";
import { Properties } from "@/wab/shared/observability/Properties";
import { trace } from "@opentelemetry/api";

export async function withSpan<T>(
  name: string,
  f: () => Promise<T>,
  msg?: string,
  payload?: Properties
) {
  const suffix = msg ? `: ${msg}` : "";

  const start = new Date().getTime();
  logger().debug(`span "${name}" started at ${start}${suffix}`);

  const promTimer = new WabPromTimer(name);
  const tracer = trace.getTracer("app");
  return tracer.startActiveSpan(name, async (span) => {
    try {
      return await f();
    } finally {
      const durationMs = new Date().getTime() - start;
      const suffix = msg ? `: ${msg}` : "";
      logger().info(`${name} took ${durationMs}ms${suffix}`, {
        operation_name: name,
        duration_ms: durationMs,
        ...payload,
      });
      promTimer.end();
      span.end();
    }
  });
}

export async function withTimeSpent<T>(f: () => Promise<T>): Promise<{
  result: T;
  spentTime: number;
}> {
  const start = new Date().getTime();
  const result = await f();
  return {
    result,
    spentTime: new Date().getTime() - start,
  };
}
