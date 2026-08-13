import { Logger } from "@/wab/shared/observability/Logger";
import {
  mergeProperties,
  Properties,
} from "@/wab/shared/observability/Properties";
import { context, trace } from "@opentelemetry/api";
import { AsyncLocalStorage } from "async_hooks";
import pino, { Logger as PinoLog } from "pino";

const requestStorage = new AsyncLocalStorage<{ requestId: string }>();

export function runWithRequestId<T>(requestId: string, fn: () => T): T {
  return requestStorage.run({ requestId }, fn);
}

const SERVICE_NAME = process.env.OTEL_SERVICE_NAME || "unknown-service";
const ENVIRONMENT = process.env.DD_ENV || process.env.NODE_ENV || "development";
const PINO_LOGGER_LEVEL = process.env.PINO_LOGGER_LEVEL || "debug";

async function resolvePodName(): Promise<string> {
  const metadataUri = process.env.ECS_CONTAINER_METADATA_URI_V4;
  if (metadataUri) {
    try {
      const res = await fetch(`${metadataUri}/task`);
      const meta = await res.json();
      const taskArn: string = meta?.TaskARN ?? "";
      const taskFamily: string = meta?.Family ?? "";
      const taskId = taskArn.split("/").pop() ?? "";
      if (taskFamily && taskId) {
        return `${taskFamily}-${taskId}`;
      }
    } catch {
      // fall through to hostname fallback
    }
  }
  return process.env.HOSTNAME || "";
}

const POD_NAME: Promise<string> = resolvePodName();

export class PinoLogger implements Logger {
  private readonly pinoLogger: PinoLog;

  constructor(
    private readonly loggingContext?: Properties,
    podName?: string
  ) {
    this.pinoLogger = pino({
      level: PINO_LOGGER_LEVEL,
      formatters: {
        level: (label) => ({ level: label }),
        log: (logObj) => logObj,
      },
      timestamp: pino.stdTimeFunctions.isoTime,
      base: {
        serviceName: SERVICE_NAME,
        environment: ENVIRONMENT,
        pod_name: podName,
        ...loggingContext,
      },
    });
  }

  static async create(loggingContext?: Properties): Promise<PinoLogger> {
    return new PinoLogger(loggingContext, await POD_NAME);
  }

  private log(
    level: "info" | "error" | "warn" | "debug",
    message: string | Error,
    payload?: Record<string, any>
  ) {
    const { requestId } = requestStorage.getStore() ?? {};
    // An Error arrives here whenever a caller does `logger().error(err)` — the
    // `err` of a `.catch` is `any`, so the string signature doesn't stop it.
    // Error.message and .stack are non-enumerable, so serializing one as-is
    // drops the text and emits only `{"name":"..."}`.
    const err = message instanceof Error ? message : undefined;
    const text = err ? err.message || err.name : (message as string);
    const logEntry = {
      message: text,
      ...(err
        ? { error: { name: err.name, message: err.message, stack: err.stack } }
        : {}),
      ...(requestId ? { x_request_id: requestId } : {}),
      ...payload,
    };

    this.pinoLogger[level](logEntry);

    const span = trace.getSpan(context.active());
    if (span) {
      span.addEvent(text, {
        level,
        ...payload,
      });
    }
  }

  info(message: string, payload?: Properties) {
    this.log("info", message, payload);
  }
  error(message: string, payload?: Properties) {
    this.log("error", message, payload);
  }
  warn(message: string, payload?: Properties) {
    this.log("warn", message, payload);
  }
  debug(message: string, payload?: Properties) {
    this.log("debug", message, payload);
  }

  child(loggingContext: Properties): Logger {
    return new PinoLogger(mergeProperties(this.loggingContext, loggingContext));
  }
}
