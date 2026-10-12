import { logger } from "@/wab/server/observability";
import { captureException } from "@/wab/server/observability/datadog";

export function logError(error: Error, eventName?: string) {
<<<<<<< HEAD
  logger().error("An error has occurred", error);
  captureException(error);
=======
  logger.error("An error has occurred", error);
  Sentry.captureException(error);
>>>>>>> upstream/master
}
