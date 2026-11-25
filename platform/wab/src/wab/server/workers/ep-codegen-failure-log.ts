import { logger } from "@/wab/server/observability";

export function logCodegenFailure(
  event: string,
  fields: {
    project_id: string;
    project_version: string | undefined;
    indirect: boolean;
  }
) {
  return (err: unknown): never => {
    logger().error(event, { ...fields, err });
    throw err;
  };
}
