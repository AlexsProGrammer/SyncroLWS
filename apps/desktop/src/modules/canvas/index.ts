import type { HybridEntity } from '@syncrohws/shared-types';

export { CanvasView } from './CanvasView';

// ── Entity helpers ────────────────────────────────────────────────────────────

function canvasShapeData(entity: HybridEntity): Record<string, unknown> {
  return (
    entity.aspects.find((a) => a.aspect_type === 'canvas_shape')?.data ?? {}
  ) as Record<string, unknown>;
}

/** Display title: falls back to "Untitled Shape" for unnamed canvas shapes. */
export function getEntityTitle(entity: HybridEntity): string {
  return entity.core.title || 'Untitled Shape';
}

/**
 * Subtitle: shows the tldraw shape type (geo, draw, text, image, …)
 * so users can distinguish shape rows in the command palette.
 */
export function getEntitySubtitle(entity: HybridEntity): string | undefined {
  const data = canvasShapeData(entity);
  const type = typeof data['type'] === 'string' ? data['type'] : undefined;
  return type ? `Canvas shape · ${type}` : undefined;
}

// ── Module initialisation ─────────────────────────────────────────────────────

/**
 * Canvas module — called once at app bootstrap by discoverAndRegisterTools().
 * Phase 3 will register event-bus listeners here for shape sync callbacks.
 */
export function init(): void {
  console.log('[module:canvas] initialised');
}
