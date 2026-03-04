# @elasticpath/plasmic-mcp-registry

Reads all five Plasmic `globalThis` registries (components, contexts, functions, tokens, traits) and serializes their metadata for HTTP transport. Also provides a Next.js config wrapper to prevent RSC boundary errors.

## Why

Plasmic Studio gets code component metadata by loading the dev host in an iframe and reading global registries. Server-side consumers (like the MCP server) cannot use an iframe — they need the same data via HTTP. This package provides the serialization layer for all five registry types.

## Installation

```bash
npm install @elasticpath/plasmic-mcp-registry
```

## Usage

### 1. Wrap your Next.js config

Prevents RSC boundary errors by auto-detecting Plasmic packages and adding them to `serverExternalPackages`:

```javascript
// next.config.js
const { withPlasmicRegistry } = require("@elasticpath/plasmic-mcp-registry/next");
module.exports = withPlasmicRegistry({ reactStrictMode: true });
```

### 2. Structure your registration file

Create a shared registration file with no `"use client"` directive so it can run on both server and client:

```typescript
// plasmic-register.ts
import { PLASMIC } from "@/plasmic-init";
import { registerMyComponents } from "@/components/my-components";

export function registerAllPackages(plasmic: typeof PLASMIC) {
  registerMyComponents(plasmic);
  // ... other packages
}

// Auto-register on import for client-side usage
registerAllPackages(PLASMIC);
```

### 3. Add the API route

The server-side Plasmic loader's registration functions are no-ops — they don't populate `globalThis`. Wrap your loader with `withRegistryCapture` so each registration call also invokes `@plasmicapp/host`'s functions, which write to `globalThis`:

```typescript
// app/api/plasmic-registry/route.ts
import { PLASMIC } from "@/plasmic-init";
import { registerAllPackages } from "@/plasmic-register";
import { withRegistryCapture, getFullRegistry } from "@elasticpath/plasmic-mcp-registry";

// Re-register with a captured loader so globalThis registries get populated
registerAllPackages(withRegistryCapture(PLASMIC));

export function GET() {
  try {
    return Response.json(getFullRegistry());
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return Response.json({ error: message }, { status: 500 });
  }
}
```

## API

### `withRegistryCapture<T>(plasmic: T): T`

Wraps a Plasmic loader instance so that registration calls (`registerComponent`, `registerGlobalContext`, `registerFunction`, `registerToken`, `registerTrait`) also invoke `@plasmicapp/host`'s corresponding functions, populating `globalThis` registries on the server. Use this in your API route; it is not needed on the client.

### `getFullRegistry(): FullRegistryResponse`

Reads all five registries and returns `{ components, contexts, functions, tokens, traits }`.

### Individual Readers

- `getComponentRegistry(): SerializedComponentMeta[]`
- `getContextRegistry(): SerializedContextMeta[]`
- `getFunctionRegistry(): SerializedFunctionMeta[]`
- `getTokenRegistry(): TokenRegistration[]`
- `getTraitRegistry(): TraitRegistration[]`

### Serializers

- `serializeComponentMeta(meta: unknown): SerializedComponentMeta`
- `serializeContextMeta(meta: unknown): SerializedContextMeta`
- `serializeFunctionMeta(meta: unknown): SerializedFunctionMeta`

### `withPlasmicRegistry(config?): NextConfig`

Auto-detects `@plasmicpkgs/*`, `@elasticpath/plasmic-*`, and `@plasmicapp/host` from your `package.json` and adds them to `serverExternalPackages`.

### Types

- `SerializedComponentMeta` — JSON-safe component metadata
- `SerializedContextMeta` — JSON-safe global context metadata
- `SerializedFunctionMeta` — JSON-safe custom function metadata
- `TokenRegistration` — design token registration (color, spacing, etc.)
- `TraitRegistration` — trait registration (text, number, boolean, choice)
- `FullRegistryResponse` — all five registries combined
- `RegistryResponse` — (deprecated) components-only response shape

## Design

- Zero runtime dependencies on `@plasmicapp/host` — reads from `globalThis`
- Works in both Node.js (API routes) and browser (except `./next` which uses `fs`)
- Returns full metadata so consumers can extract what they need
