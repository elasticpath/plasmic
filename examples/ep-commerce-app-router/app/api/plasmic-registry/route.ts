import { PLASMIC } from "@/plasmic-init";
import { registerEpCustomFunctions } from "@elasticpath/plasmic-ep-commerce-elastic-path/server";
import {
  withRegistryCapture,
  getFullRegistry,
} from "@elasticpath/plasmic-mcp-registry";

// Re-register with captured PLASMIC so host's registration functions
// populate globalThis registries (the server loader's are noops).
registerEpCustomFunctions(withRegistryCapture(PLASMIC));

export function GET() {
  try {
    return Response.json(getFullRegistry());
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return Response.json({ error: message }, { status: 500 });
  }
}
