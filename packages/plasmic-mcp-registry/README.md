# @elasticpath/plasmic-mcp-registry

Reads all five Plasmic `globalThis` registries (components, contexts, functions, tokens, traits) and serializes their metadata for HTTP transport. Also provides a Next.js config wrapper to prevent RSC boundary errors.

## Why

Plasmic Studio gets code component metadata by loading the dev host in an iframe and reading global registries. Server-side consumers (like the MCP server) cannot use an iframe — they need the same data via HTTP. This package provides the serialization layer for all five registry types.

## Usage

Add an API route to your Next.js dev host app:

```typescript
// app/api/plasmic-registry/route.ts
import "../../../plasmic-init-server"; // triggers component registration
import { getFullRegistry } from "@elasticpath/plasmic-mcp-registry";

export function GET() {
  return Response.json(getFullRegistry());
}
```

Wrap your Next.js config to prevent RSC boundary errors:

```javascript
// next.config.js
const { withPlasmicRegistry } = require("@elasticpath/plasmic-mcp-registry/next");
module.exports = withPlasmicRegistry({ reactStrictMode: true });
```

## API

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
