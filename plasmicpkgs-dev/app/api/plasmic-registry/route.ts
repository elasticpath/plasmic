import "../../../plasmic-init-server";
import { getFullRegistry } from "@elasticpath/plasmic-mcp-registry";

export function GET() {
  try {
    return Response.json(getFullRegistry());
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return Response.json({ error: message }, { status: 500 });
  }
}
