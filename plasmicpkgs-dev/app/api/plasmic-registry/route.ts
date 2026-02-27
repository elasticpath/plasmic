import { PLASMIC } from "@/plasmic-init";
import { registerAllPackages } from "@/plasmic-register";
import {
  withRegistryCapture,
  getFullRegistry,
} from "@elasticpath/plasmic-mcp-registry";

// Re-register with captured PLASMIC so host's registration functions
// populate globalThis registries (the server loader's are noops).
registerAllPackages(withRegistryCapture(PLASMIC));

export function GET() {
  try {
    return Response.json(getFullRegistry());
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return Response.json({ error: message }, { status: 500 });
  }
}
