import { PLASMIC } from "@/plasmic-init";
import { registerAllPackages } from "@/plasmic-register";
import {
  withRegistryCapture,
  getFullRegistry,
} from "@elasticpath/plasmic-mcp-registry";

// Re-register with captured PLASMIC so host's registration functions
// populate globalThis registries (the server loader's are noops).
//
// `withRegistryCapture` describes a loader with `unknown`-parameter function
// properties, which the real loader's generic `registerComponent` cannot
// satisfy under `strictFunctionTypes` — the parameters are checked
// contravariantly. The capture wrapper only proxies calls and returns the
// same object, so the shapes agree at runtime. Casting at this boundary
// keeps the mismatch local; the durable fix is for the registry package to
// declare those members as methods (bivariant) or with `any` parameters.
const capturedPlasmic = withRegistryCapture(
  PLASMIC as unknown as Parameters<typeof withRegistryCapture>[0]
) as unknown as typeof PLASMIC;

registerAllPackages(capturedPlasmic);

export function GET() {
  try {
    return Response.json(getFullRegistry());
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return Response.json({ error: message }, { status: 500 });
  }
}
