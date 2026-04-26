export * from './base-entity';
export * from './events';
// trpc.ts intentionally NOT re-exported here — it imports @trpc/server which
// is Node-only and must not be bundled by Vite for the desktop (browser) app.
