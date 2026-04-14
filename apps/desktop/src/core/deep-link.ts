import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { eventBus } from './events';

/**
 * Bridges native Tauri deep-link events into the React Event Bus.
 *
 * The Rust side emits "deeplink://received" via `handle.emit(...)` whenever the
 * OS opens a URL matching the `syncrohws://` URI scheme registered in tauri.conf.json.
 *
 * Supported URL patterns (after bridging through the event bus):
 *   syncrohws://entity/<type>/<id>   → navigate to that entity
 *   syncrohws://test/<anything>      → verification helper (just logged)
 *
 * Call once from bootstrap() — AFTER initDB() and module init() calls.
 * Returns a cleanup function that unregisters the Tauri listener.
 */
export async function initDeepLink(): Promise<UnlistenFn> {
  const unlisten = await listen<{ path: string; params: Record<string, string> }>(
    'deeplink://received',
    (event) => {
      const { path, params } = event.payload;
      console.log('[deep-link] received:', path, params);
      eventBus.emit('deeplink:received', { path, params });
    },
  );

  console.log('[deep-link] listening for syncrohws:// URIs');
  return unlisten;
}
