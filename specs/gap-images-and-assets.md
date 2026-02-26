# Images & Assets

## Jobs to Be Done
- As a Claude Code user building pages, I want to upload and reference image assets so that pages have properly managed images
- As a Claude Code user, I want to use project image assets in elements so that images are tracked in the design system rather than as raw URLs

## Background

Studio manages `ImageAsset` objects with: `name`, `type` (icon | image | responsive-image), `dataUri`, `width`, `height`, `aspectRatio`. Elements reference images via `ImageAssetRef`. TplMgr provides: `addImageAsset()`, `renameImageAsset()`, `removeImageAsset()`.

Currently the MCP only supports raw `src` URLs in PlasmicElement image elements.

## Implementation

Asset management integrates into the `component` domain (site-level operations).

### `component({ action: "list-assets" })`
- **Parameters**: `type?` (icon | image | responsive-image)
- Returns: Array of `{ assetUuid, name, type, width?, height?, aspectRatio? }`

### `component({ action: "upload-asset" })`
- **Parameters**: `name`, `type` (icon | image), `url` (fetch and embed) or `dataUri` (inline), `width?`, `height?`
- Fetches URL, converts to dataUri, creates ImageAsset
- Returns: `{ assetUuid, name, type }`

### `component({ action: "remove-asset" })`
- **Parameters**: `assetRef` (name or UUID)
- Removes asset + cleans up references

### `component({ action: "rename-asset" })`
- **Parameters**: `assetRef`, `newName`
- Renames asset

### `node({ action: "set-image" })`
- **Parameters**: `componentUuid`, `nodeRef`, `assetRef` (name or UUID) or `src` (raw URL), `variant?`, `dryRun?`
- Sets the image source on a TplTag with tag "img" or background-image on any element
- When using assetRef, creates proper ImageAssetRef

## Acceptance Criteria
- [x] Can list all image assets in a project
- [x] Can upload image from URL and create asset
- [x] Can upload image from dataUri
- [x] Can set element image to a project asset by name/UUID
- [x] Can set element image to a raw URL (backward compatible)
- [x] `inspect({ action: "node" })` shows asset reference info (name, UUID) not just raw URL
- [x] Can remove an image asset with cleanup
- [x] Can rename an image asset
- [x] Undo support for all asset operations
- [x] Integration test: upload asset → set on element → read back → verify
- [x] Unit tests for all operations

## Edge Cases
| Scenario | Expected behaviour |
|----------|-------------------|
| Upload from unreachable URL | Error: "Failed to fetch image from URL" |
| Upload non-image file | Error: "URL does not point to a supported image format" |
| Set image on non-img element | Sets as background-image style |
| Duplicate asset name | Auto-deduplicate |
| Remove asset used by elements | Clean up references (set to empty) |
| Asset from dependency project | Read-only listing, cannot remove |

## Out of Scope
- Image optimization/resizing (handled by Plasmic's img-optimizer)
- SVG inline embedding
- Responsive image srcsets
