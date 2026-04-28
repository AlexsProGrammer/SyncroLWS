/**
 * Phase V — Admin tRPC client.
 *
 * Thin fetch wrappers around `auth.users.*` and `auth.audit.list`. Mirrors
 * the pattern in `core/sharing.ts` (Bearer userToken, 401 → auth:expired).
 */
import { useSyncStore } from '@/store/syncStore';
import { eventBus } from './events';

// ── Types ────────────────────────────────────────────────────────────────────

export type OrgRole = 'admin' | 'member';

export interface AdminUser {
  id: string;
  email: string;
  display_name: string;
  org_role: OrgRole;
  must_change_password: boolean;
  disabled_at: string | null;
  created_at: string;
  created_by: string | null;
}

export interface AuditEntry {
  id: string;
  ts: string;
  actor_user_id: string | null;
  actor_device_id: string | null;
  workspace_id: string | null;
  target_kind: string | null;
  target_id: string | null;
  action: string;
  payload: Record<string, unknown>;
  ip_addr: string | null;
}

export interface AuditQuery {
  workspace_id?: string;
  actor_user_id?: string;
  action?: string;
  since?: string;
  until?: string;
  limit?: number;
}

// ── tRPC plumbing ────────────────────────────────────────────────────────────

function trpcUrl(serverUrl: string, route: string): string {
  return `${serverUrl.replace(/\/+$/, '')}/trpc/${route}`;
}

async function call<T>(route: string, input: unknown, method: 'query' | 'mutation'): Promise<T> {
  const { syncUrl, userToken } = useSyncStore.getState();
  if (!syncUrl) throw new Error('Server URL not configured.');
  if (!userToken) throw new Error('Not signed in.');

  const url = method === 'query'
    ? `${trpcUrl(syncUrl, route)}?input=${encodeURIComponent(JSON.stringify(input))}`
    : trpcUrl(syncUrl, route);

  const res = await fetch(url, {
    method: method === 'query' ? 'GET' : 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${userToken}`,
    },
    body: method === 'mutation' ? JSON.stringify(input) : undefined,
    signal: AbortSignal.timeout(15_000),
  });

  if (res.status === 401) {
    eventBus.emit('auth:expired', { reason: 'rejected' });
    throw new Error('Authentication expired.');
  }
  if (!res.ok) {
    let message = `HTTP ${res.status}`;
    try {
      const body = await res.json();
      message =
        (body as { error?: { message?: string; json?: { message?: string } } })?.error?.message ??
        (body as { error?: { json?: { message?: string } } })?.error?.json?.message ??
        message;
    } catch { /* ignore */ }
    throw new Error(message);
  }
  const json = await res.json();
  return (json as { result?: { data?: T } })?.result?.data as T;
}

// ── Users (admin) ────────────────────────────────────────────────────────────

export async function listUsers(): Promise<AdminUser[]> {
  const data = await call<AdminUser[]>('auth.users.list', undefined, 'query');
  return Array.isArray(data) ? data : [];
}

export async function createUser(input: {
  email: string;
  display_name: string;
  org_role: OrgRole;
  default_password: string;
}): Promise<{ id: string; email: string; display_name: string; org_role: OrgRole }> {
  return call('auth.users.create', input, 'mutation');
}

export async function updateUser(input: {
  id: string;
  display_name?: string;
  org_role?: OrgRole;
}): Promise<{ success: boolean }> {
  return call('auth.users.update', input, 'mutation');
}

export async function setUserDisabled(id: string, disabled: boolean): Promise<{ success: boolean }> {
  return call('auth.users.disable', { id, disabled }, 'mutation');
}

export async function resetUserPassword(
  id: string,
  new_default_password: string,
): Promise<{ success: boolean }> {
  return call('auth.users.resetPassword', { id, new_default_password }, 'mutation');
}

// ── Audit log ────────────────────────────────────────────────────────────────

export async function listAudit(query: AuditQuery = {}): Promise<AuditEntry[]> {
  const data = await call<AuditEntry[]>('auth.audit.list', { limit: 100, ...query }, 'query');
  return Array.isArray(data) ? data : [];
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Convert audit rows to a CSV blob for client-side download. */
export function auditToCsv(rows: AuditEntry[]): string {
  const headers = [
    'ts',
    'actor_user_id',
    'actor_device_id',
    'workspace_id',
    'action',
    'target_kind',
    'target_id',
    'ip_addr',
    'payload',
  ];
  const escape = (v: unknown): string => {
    if (v === null || v === undefined) return '';
    const s = typeof v === 'string' ? v : JSON.stringify(v);
    if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  };
  const lines = [headers.join(',')];
  for (const r of rows) {
    lines.push([
      r.ts,
      r.actor_user_id ?? '',
      r.actor_device_id ?? '',
      r.workspace_id ?? '',
      r.action,
      r.target_kind ?? '',
      r.target_id ?? '',
      r.ip_addr ?? '',
      r.payload,
    ].map(escape).join(','));
  }
  return lines.join('\n');
}
