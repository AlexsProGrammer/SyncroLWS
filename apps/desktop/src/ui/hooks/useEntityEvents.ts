/**
 * useEntityEvents — subscribe a handler to all CRUD/relation events emitted
 * by the central entity store. Use this in list views to reload data when
 * any module mutates entities.
 *
 * Optional `aspectType` filters the callback to events that touch that
 * aspect — but only for events that carry the aspect (`aspect:*`). Core
 * mutations (`core:*`) and relations (`relation:*`) always fire because
 * core changes can affect any list view.
 *
 * Pass a stable handler reference (e.g. wrap loaders in `useCallback`).
 */
import { useEffect } from 'react';
import { eventBus } from '@/core/events';
import type { AspectType } from '@syncrohws/shared-types';

export interface UseEntityEventsOptions {
  /** Restrict aspect:* events to a single type. */
  aspectType?: AspectType;
}

export function useEntityEvents(
  handler: () => void,
  options: UseEntityEventsOptions = {},
): void {
  useEffect(() => {
    const { aspectType } = options;

    const onCore = (): void => handler();
    const onRelation = (): void => handler();
    const onAspect = (event: { aspect?: { aspect_type: AspectType }; aspect_type?: AspectType }): void => {
      if (aspectType) {
        const t = event.aspect?.aspect_type ?? event.aspect_type;
        if (t !== aspectType) return;
      }
      handler();
    };

    eventBus.on('core:created', onCore);
    eventBus.on('core:updated', onCore);
    eventBus.on('core:deleted', onCore);
    eventBus.on('aspect:added', onAspect);
    eventBus.on('aspect:updated', onAspect);
    eventBus.on('aspect:removed', onAspect);
    eventBus.on('relation:added', onRelation);
    eventBus.on('relation:removed', onRelation);

    return () => {
      eventBus.off('core:created', onCore);
      eventBus.off('core:updated', onCore);
      eventBus.off('core:deleted', onCore);
      eventBus.off('aspect:added', onAspect);
      eventBus.off('aspect:updated', onAspect);
      eventBus.off('aspect:removed', onAspect);
      eventBus.off('relation:added', onRelation);
      eventBus.off('relation:removed', onRelation);
    };
  }, [handler, options.aspectType]);
}
