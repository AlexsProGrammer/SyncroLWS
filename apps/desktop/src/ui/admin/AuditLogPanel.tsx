/**
 * Phase V — Audit log viewer.
 *
 * Reads `auth.audit.list` (Phase R). Filters by workspace, actor, action,
 * since/until. Exports current view to CSV client-side.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Button } from '@/ui/components/button';
import { Input } from '@/ui/components/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/ui/components/select';
import { toast } from '@/ui/hooks/use-toast';
import {
  type AdminUser,
  type AuditEntry,
  type AuditQuery,
  auditToCsv,
  listAudit,
  listUsers,
} from '@/core/admin';
import { useSyncStore } from '@/store/syncStore';
import { useWorkspaceStore } from '@/store/workspaceStore';

const ACTION_OPTIONS = [
  '',
  'auth.login',
  'auth.password_change',
  'user.create',
  'user.update',
  'user.role_change',
  'user.disable',
  'user.password_reset',
  'workspace.create',
  'workspace.invite',
  'workspace.role_change',
  'workspace.remove_member',
  'entity.create',
  'entity.update',
  'entity.delete',
  'share_link.create',
  'share_link.revoke',
];

interface Props {
  /** When set, locks the workspace filter to this id (used by per-workspace activity). */
  fixedWorkspaceId?: string;
  /** When true, hide the Users filter (e.g. workspace owner activity tab). */
  hideUserFilter?: boolean;
  /** Show admin-only "all users" picker. Defaults to true. */
  allowUserFilter?: boolean;
}

function fmt(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString();
}

export function AuditLogPanel({
  fixedWorkspaceId,
  hideUserFilter,
  allowUserFilter = true,
}: Props): React.ReactElement {
  const workspaces = useWorkspaceStore((s) => s.workspaces);
  const orgRole = useSyncStore((s) => s.orgRole);
  const [users, setUsers] = useState<AdminUser[]>([]);

  const [rows, setRows] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [filterWs, setFilterWs] = useState<string>(fixedWorkspaceId ?? '');
  const [filterUser, setFilterUser] = useState<string>('');
  const [filterAction, setFilterAction] = useState<string>('');
  const [filterSince, setFilterSince] = useState<string>('');
  const [filterUntil, setFilterUntil] = useState<string>('');
  const [limit, setLimit] = useState<number>(100);

  // Load user list once if admin (for actor filter dropdown).
  useEffect(() => {
    if (orgRole !== 'admin' || !allowUserFilter || hideUserFilter) return;
    void listUsers().then(setUsers).catch(() => { /* not admin, ignore */ });
  }, [orgRole, allowUserFilter, hideUserFilter]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const q: AuditQuery = { limit };
      const wsId = fixedWorkspaceId ?? filterWs;
      if (wsId) q.workspace_id = wsId;
      if (filterUser) q.actor_user_id = filterUser;
      if (filterAction) q.action = filterAction;
      if (filterSince) q.since = new Date(filterSince).toISOString();
      if (filterUntil) q.until = new Date(filterUntil).toISOString();
      const data = await listAudit(q);
      setRows(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [fixedWorkspaceId, filterWs, filterUser, filterAction, filterSince, filterUntil, limit]);

  useEffect(() => { void load(); }, [load]);

  const userMap = useMemo(() => {
    const m = new Map<string, AdminUser>();
    for (const u of users) m.set(u.id, u);
    return m;
  }, [users]);

  const wsMap = useMemo(() => {
    const m = new Map<string, string>();
    for (const w of workspaces) m.set(w.id, w.name);
    return m;
  }, [workspaces]);

  const handleExport = (): void => {
    if (rows.length === 0) {
      toast({ title: 'Nothing to export', description: 'Audit list is empty.' });
      return;
    }
    const csv = auditToCsv(rows);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `audit-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-base font-semibold">Audit log</h3>
          <p className="text-sm text-muted-foreground">
            {orgRole === 'admin'
              ? 'All organization activity.'
              : 'Your activity plus events on workspaces you own.'}
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
            {loading ? 'Loading…' : 'Refresh'}
          </Button>
          <Button size="sm" onClick={handleExport} disabled={rows.length === 0}>Export CSV</Button>
        </div>
      </div>

      {/* Filters */}
      <div className="grid grid-cols-1 gap-2 md:grid-cols-3 lg:grid-cols-6">
        {!fixedWorkspaceId ? (
          <div>
            <label className="mb-1 block text-xs text-muted-foreground">Workspace</label>
            <Select value={filterWs || '__all__'} onValueChange={(v) => setFilterWs(v === '__all__' ? '' : v)}>
              <SelectTrigger className="h-8"><SelectValue placeholder="All" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">All workspaces</SelectItem>
                {workspaces.filter((w) => w.icon !== 'folder-group').map((w) => (
                  <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        ) : null}
        {!hideUserFilter && allowUserFilter && orgRole === 'admin' ? (
          <div>
            <label className="mb-1 block text-xs text-muted-foreground">Actor</label>
            <Select value={filterUser || '__all__'} onValueChange={(v) => setFilterUser(v === '__all__' ? '' : v)}>
              <SelectTrigger className="h-8"><SelectValue placeholder="Any" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">Any actor</SelectItem>
                {users.map((u) => (
                  <SelectItem key={u.id} value={u.id}>{u.display_name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        ) : null}
        <div>
          <label className="mb-1 block text-xs text-muted-foreground">Action</label>
          <Select value={filterAction || '__all__'} onValueChange={(v) => setFilterAction(v === '__all__' ? '' : v)}>
            <SelectTrigger className="h-8"><SelectValue placeholder="Any" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">Any action</SelectItem>
              {ACTION_OPTIONS.filter(Boolean).map((a) => (
                <SelectItem key={a} value={a}>{a}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <label className="mb-1 block text-xs text-muted-foreground">Since</label>
          <Input type="datetime-local" className="h-8" value={filterSince} onChange={(e) => setFilterSince(e.target.value)} />
        </div>
        <div>
          <label className="mb-1 block text-xs text-muted-foreground">Until</label>
          <Input type="datetime-local" className="h-8" value={filterUntil} onChange={(e) => setFilterUntil(e.target.value)} />
        </div>
        <div>
          <label className="mb-1 block text-xs text-muted-foreground">Limit</label>
          <Select value={String(limit)} onValueChange={(v) => setLimit(Number(v))}>
            <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
            <SelectContent>
              {[50, 100, 250, 500].map((n) => (
                <SelectItem key={n} value={String(n)}>{n}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {error ? (
        <div className="rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
          {error}
        </div>
      ) : null}

      <div className="overflow-hidden rounded-md border border-border">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="p-2">Time</th>
              <th className="p-2">Actor</th>
              <th className="p-2">Action</th>
              <th className="p-2">Workspace</th>
              <th className="p-2">Target</th>
              <th className="p-2">Details</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && !loading ? (
              <tr><td colSpan={6} className="p-4 text-center text-muted-foreground">No events.</td></tr>
            ) : null}
            {rows.map((r) => {
              const actor = r.actor_user_id ? userMap.get(r.actor_user_id)?.display_name ?? r.actor_user_id.slice(0, 8) : '—';
              const wsName = r.workspace_id ? wsMap.get(r.workspace_id) ?? r.workspace_id.slice(0, 8) : '—';
              return (
                <tr key={r.id} className="border-t border-border align-top">
                  <td className="whitespace-nowrap p-2 font-mono text-xs">{fmt(r.ts)}</td>
                  <td className="p-2">{actor}</td>
                  <td className="p-2"><code className="rounded bg-muted px-1 py-0.5 text-xs">{r.action}</code></td>
                  <td className="p-2">{wsName}</td>
                  <td className="p-2 text-xs">
                    {r.target_kind ? <span className="text-muted-foreground">{r.target_kind}</span> : null}
                    {r.target_id ? <span className="ml-1 font-mono">{r.target_id.slice(0, 8)}</span> : null}
                  </td>
                  <td className="p-2 max-w-[300px] truncate text-xs text-muted-foreground" title={JSON.stringify(r.payload)}>
                    {Object.keys(r.payload ?? {}).length > 0 ? JSON.stringify(r.payload) : '—'}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
