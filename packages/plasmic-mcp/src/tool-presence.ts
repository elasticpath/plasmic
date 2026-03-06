/**
 * Presence hooks for MCP tool execution.
 *
 * Emits presence events so Studio users see which component/node the
 * agent is working on. Called at the start of each tool handler, with
 * cleanup via clearEditPresence() in the handler's finally block.
 *
 * Edit tools: emitEditPresence(componentUuid, nodeRef?) → arena + optional selection
 * Inspect tools: emitInspectPresence(componentUuid) → arena only
 * Cleanup: clearEditPresence() → clears selection, preserves arena
 */

import { updateArena, updateSelection, clearSelection } from "./presence-manager.js";
import { getSession } from "./session.js";
import { resolveNode } from "./node-resolver.js";
import type { ArenaType } from "@/wab/shared/ApiSchema";

/**
 * Emit presence for an edit operation targeting a component.
 *
 * Sets the arena to the target component so Studio users see which
 * component the agent is editing. If nodeRef is provided, resolves
 * it and updates the selection so users see which element is targeted.
 *
 * @param componentUuid - UUID of the component being edited
 * @param nodeRef - Optional node reference (UUID, name, path, or index)
 */
export function emitEditPresence(
  componentUuid: string,
  nodeRef?: string
): void {
  const session = getSession();
  if (!session) return;

  const component = session.site.components?.find(
    (c: any) => c.uuid === componentUuid
  );
  if (!component) return;

  const arenaType: ArenaType = component.pageMeta?.path ? "page" : "component";
  updateArena(componentUuid, arenaType);

  if (nodeRef) {
    let nodeUuid: string | undefined;
    try {
      const result = resolveNode(component, nodeRef);
      if (result.nodes.length >= 1) {
        nodeUuid = result.nodes[0].uuid;
      }
    } catch {
      // Graceful degradation: skip selection if resolution fails
    }
    // Use componentUuid as frameUuid (MCP has no separate frame/artboard concept)
    updateSelection(componentUuid, nodeUuid);
  }
}

/**
 * Clear selection after an edit operation completes.
 * Arena info is preserved so Studio users still see which component
 * the agent is in during batch operations.
 */
export function clearEditPresence(): void {
  clearSelection();
}

/**
 * Emit presence for a read-only inspection of a component.
 * Sets arena only — no selection, no cleanup needed.
 *
 * @param componentUuid - UUID of the component being inspected
 */
export function emitInspectPresence(componentUuid: string): void {
  const session = getSession();
  if (!session) return;

  const component = session.site.components?.find(
    (c: any) => c.uuid === componentUuid
  );
  if (!component) return;

  const arenaType: ArenaType = component.pageMeta?.path ? "page" : "component";
  updateArena(componentUuid, arenaType);
}
