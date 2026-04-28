/**
 * Phase R — Audit log helper.
 *
 * Server-side append-only log of meaningful actions. Callers do not block on
 * write failures: audit logging is best-effort. If the DB write fails we log
 * to stderr and move on so a transient logging issue can never break the
 * primary action.
 */
import { db } from './db/client';
import { auditLog } from './db/schema';
import type { AuthContext, TRPCContext } from '@syncrohws/shared-types';

/** Closed enum of actions the rest of the codebase records. */
export type AuditAction =
  | 'auth.login'
  | 'auth.password_change'
  | 'user.create'
  | 'user.update'
  | 'user.disable'
  | 'user.role_change'
  | 'user.password_reset'
  | 'workspace.create'
  | 'workspace.update'
  | 'workspace.delete'
  | 'workspace.invite'
  | 'workspace.role_change'
  | 'workspace.remove_member'
  | 'workspace.leave'
  | 'entity.create'
  | 'entity.update'
  | 'entity.delete'
  | 'aspect.create'
  | 'aspect.update'
  | 'aspect.delete'
  | 'relation.create'
  | 'relation.update'
  | 'relation.delete'
  | 'share_link.create'
  | 'share_link.revoke'
  | 'device.pair'
  | 'device.revoke';

export interface AuditInput {
  action: AuditAction;
  workspace_id?: string | null;
  target_kind?: string | null;
  target_id?: string | null;
  payload?: Record<string, unknown>;
}

/** Subset of TRPCContext needed for audit; lets us also call from REST. */
type AuditCtx = Pick<TRPCContext, 'auth' | 'ipAddr'>;

function actorIds(auth: AuthContext): {
  user_id: string | null;
  device_id: string | null;
} {
  if (auth.kind === 'user') return { user_id: auth.userId, device_id: null };
  if (auth.kind === 'device') return { user_id: auth.userId, device_id: auth.deviceId };
  return { user_id: null, device_id: null };
}

/**
 * Record one audit row. Fire-and-forget: never throws into the caller.
 * Use `await record(...)` only if a test needs to assert the row landed.
 */
export async function record(ctx: AuditCtx, input: AuditInput): Promise<void> {
  const { user_id, device_id } = actorIds(ctx.auth);
  try {
    await db.insert(auditLog).values({
      actor_user_id: user_id,
      actor_device_id: device_id,
      workspace_id: input.workspace_id ?? null,
      target_kind: input.target_kind ?? null,
      target_id: input.target_id ?? null,
      action: input.action,
      payload: input.payload ?? {},
      ip_addr: ctx.ipAddr ?? null,
    });
  } catch (err) {
    // Best-effort: audit failures must never break the main op.
    // eslint-disable-next-line no-console
    console.error('[audit] failed to record', input.action, err);
  }
}

/**
 * Anonymous record — used by `auth.login` for failed login attempts where
 * we don't have an authenticated context yet but still want a trail.
 */
export async function recordAnonymous(
  ipAddr: string | undefined,
  input: AuditInput,
): Promise<void> {
  return record({ auth: { kind: 'anonymous' }, ipAddr }, input);
}
