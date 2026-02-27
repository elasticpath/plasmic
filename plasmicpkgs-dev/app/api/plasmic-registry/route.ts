import "../../../plasmic-init-server";
import { getComponentRegistry } from "@elasticpath/plasmic-registry";

export function GET() {
  try {
    return Response.json({ components: getComponentRegistry() });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return Response.json({ error: message }, { status: 500 });
  }
}
