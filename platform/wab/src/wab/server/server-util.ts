import { logger } from "@/wab/server/observability";
import { captureException } from "@/wab/server/observability/datadog";

export function logError(error: Error, eventName?: string) {
  logger().error("An error has occurred", error);
  captureException(error);
}
