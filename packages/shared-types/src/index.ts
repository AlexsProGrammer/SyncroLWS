export * from './base-entity';
export * from './events';
// trpc.ts is now @trpc/server-free (Phase I) — only zod schemas + types.
// Safe to re-export as values for both desktop and backend.
export * from './trpc';
