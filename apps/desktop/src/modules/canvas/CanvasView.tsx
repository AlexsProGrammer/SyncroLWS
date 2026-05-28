/**
 * CanvasView — Infinite canvas workspace powered by tldraw.
 *
 * Phase 2: full-size Tailwind wrapper + tldraw rendering envelope.
 * Phase 3: onMount wires useTldrawStore — each shape change is persisted as a
 *           granular entity_aspects row in SQLite (dirty = 1 for sync).
 * Phase 4: useCanvasAssets will intercept image drops for offline storage.
 *
 * DSGVO: No external network requests. All tldraw assets are resolved from the
 * local npm bundle by Vite. @tldraw/tldraw/tldraw.css is bundled at build time.
 */
import React, { useState, useCallback } from 'react';
import { Tldraw } from '@tldraw/tldraw';
import type { Editor } from '@tldraw/tldraw';
import '@tldraw/tldraw/tldraw.css';
import { useTldrawStore } from './hooks/useTldrawStore';
import { useCanvasAssets } from './hooks/useCanvasAssets';

interface CanvasViewProps {
  /** Tool-instance id — scopes this canvas to a specific board. */
  toolInstanceId?: string;
}

/**
 * Renders the tldraw infinite canvas inside a Tailwind full-size container.
 * Each `toolInstanceId` gets its own isolated canvas session via `persistenceKey`.
 * Shape mutations are intercepted by `useTldrawStore` and written to SQLite.
 */
export function CanvasView({ toolInstanceId }: CanvasViewProps): React.ReactElement {
  const [editor, setEditor] = useState<Editor | null>(null);

  const handleMount = useCallback((e: Editor): void => {
    setEditor(e);
  }, []);

  // Wire the granular shape persistence hook (Phase 3).
  useTldrawStore(editor, toolInstanceId);

  // Phase 4: offline content-addressable asset store.
  const assets = useCanvasAssets();

  return (
    <div className="w-full h-full">
      <Tldraw
        persistenceKey={toolInstanceId ? `canvas-${toolInstanceId}` : 'canvas-default'}
        onMount={handleMount}
        assets={assets}
      />
    </div>
  );
}
