export * from './base-entity';
export * from './events';
// trpc.ts intentionally NOT re-exported as a value here — it imports
// @trpc/server which is Node-only and must not be bundled by Vite for the
// desktop (browser) app. Type-only re-exports are erased at compile time and
// safe to surface for shared client/server typing.
export type { AuthContext, TRPCContext } from './trpc';
