import mitt from 'mitt';
import type { AppEvents } from '@syncrohws/shared-types';

/**
 * Singleton Event Bus — the ONLY communication channel between modules.
 * Import this instance; never create a new mitt() elsewhere.
 *
 * Usage:
 *   import { eventBus } from '@/core/events';
 *   eventBus.emit('entity:created', { entity });
 *   eventBus.on('entity:created', ({ entity }) => { … });
 */
export const eventBus = mitt<AppEvents>();
