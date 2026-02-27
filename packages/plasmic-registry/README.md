# @elasticpath/plasmic-registry

Reads `globalThis.__PlasmicComponentRegistry` (the same global that `@plasmicapp/host`'s `registerComponent()` writes to) and serializes component metadata for HTTP transport.

## Why

Plasmic Studio gets code component metadata by loading the dev host in an iframe and reading the global registry. Server-side consumers (like the MCP server) cannot use an iframe — they need the same data via HTTP. This package provides the serialization layer.

## Usage

Add an API route to your Next.js dev host app:

```typescript
// app/api/plasmic-registry/route.ts
import "../../../plasmic-init-server"; // triggers component registration
import { getComponentRegistry } from "@elasticpath/plasmic-registry";

export function GET() {
  return Response.json({ components: getComponentRegistry() });
}
```

`plasmic-init-server.ts` should import the same registration calls as your client file, but without `"use client"`.

## API

### `getComponentRegistry(): SerializedComponentMeta[]`

Reads all registered components and returns their full serializable metadata. Non-serializable fields (functions, React elements) are stripped. Returns an empty array if no components are registered.

### `serializeComponentMeta(meta: unknown): SerializedComponentMeta`

Strips non-serializable fields from a single `CodeComponentMeta` object. Used internally by `getComponentRegistry()`, but exported for direct use.

### Types

- `SerializedComponentMeta` — all JSON-safe fields from `CodeComponentMeta`
- `RegistryResponse` — response shape: `{ components: SerializedComponentMeta[] }`

## What Gets Stripped

**Top-level fields:** `figmaPropsTransform`, `treeLabel`, `componentHelpers`, `refActions`, `actions`, `templates`

**Nested in props:** Any function-valued fields (`hidden`, `validator`, `readOnly` callbacks, etc.) — only declarative type descriptors are preserved.

## Design

- Zero runtime dependencies on `@plasmicapp/host` — reads from `globalThis`
- Works in both Node.js (API routes) and browser
- Returns full metadata so consumers can extract what they need
