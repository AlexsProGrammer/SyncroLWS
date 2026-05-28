/**
 * CanvasView — Infinite canvas workspace powered by tldraw.
 *
 * Phase 2: initialises the tldraw rendering envelope with a full-size wrapper.
 * Phase 3 will replace the internal tldraw store with a granular SQLite-backed
 * store (useTldrawStore) that persists individual shapes as entity_aspects rows.
 * Phase 4 will wire useCanvasAssets for offline content-addressable image storage.
 *
 * DSGVO: No external network requests. tldraw assets are resolved from the local
 * npm bundle only. @tldraw/tldraw/tldraw.css is bundled by Vite at build time.
 */
import React from 'react';
import { Tldraw } from '@tldraw/tldraw';
import '@tldraw/tldraw/tldraw.css';

interface CanvasViewProps {
  /** Tool-instance id — scopes this canvas to a specific board. */
  toolInstanceId?: string;
}

/**
 * Renders the tldraw infinite canvas inside a Tailwind full-size container.
 * Each `toolInstanceId` gets its own isolated canvas session.
 */
export function CanvasView({ toolInstanceId }: CanvasViewProps): React.ReactElement {
  return (
    <div className="w-full h-full">
      <Tldraw
        persistenceKey={toolInstanceId ? `canvas-${toolInstanceId}` : 'canvas-default'}
      />
    </div>
  );
}
