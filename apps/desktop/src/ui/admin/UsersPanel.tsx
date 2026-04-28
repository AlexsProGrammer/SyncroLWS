/**
 * Phase V — Users admin panel.
 *
 * Lists users, lets admins create / disable / re-enable / change role /
 * reset password. Backed by `auth.users.*` (Phase P).
 */
import React, { useCallback, useEffect, useState } from 'react';
import { Button } from '@/ui/components/button';
import { Input } from '@/ui/components/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/ui/components/select';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/ui/components/dialog';
import { toast } from '@/ui/hooks/use-toast';
import {
  type AdminUser,
  type OrgRole,
  createUser,
  listUsers,
  resetUserPassword,
  setUserDisabled,
  updateUser,
} from '@/core/admin';
import { useSyncStore } from '@/store/syncStore';

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString();
}

export function UsersPanel(): React.ReactElement {
  const callerUserId = useSyncStore((s) => s.userId);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Create dialog state
  const [createOpen, setCreateOpen] = useState(false);
  const [newEmail, setNewEmail] = useState('');
  const [newDisplayName, setNewDisplayName] = useState('');
  const [newRole, setNewRole] = useState<OrgRole>('member');
  const [newDefaultPw, setNewDefaultPw] = useState('');
  const [creating, setCreating] = useState(false);

  // Reset-password dialog state
  const [resetTarget, setResetTarget] = useState<AdminUser | null>(null);
  const [resetPw, setResetPw] = useState('');
  const [resetting, setResetting] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const rows = await listUsers();
      setUsers(rows);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const handleCreate = async (): Promise<void> => {
    if (!newEmail.trim() || !newDisplayName.trim() || newDefaultPw.length < 8) {
      toast({ title: 'Missing fields', description: 'Email, name, and 8+ char password are required.', variant: 'destructive' });
      return;
    }
    setCreating(true);
    try {
      await createUser({
        email: newEmail.trim(),
        display_name: newDisplayName.trim(),
        org_role: newRole,
        default_password: newDefaultPw,
      });
      toast({ title: 'User created', description: `${newEmail} must change password on first login.` });
      setCreateOpen(false);
      setNewEmail('');
      setNewDisplayName('');
      setNewRole('member');
      setNewDefaultPw('');
      void refresh();
    } catch (e) {
      toast({ title: 'Create failed', description: e instanceof Error ? e.message : String(e), variant: 'destructive' });
    } finally {
      setCreating(false);
    }
  };

  const handleRoleChange = async (user: AdminUser, role: OrgRole): Promise<void> => {
    if (user.org_role === role) return;
    try {
      await updateUser({ id: user.id, org_role: role });
      toast({ title: 'Role updated', description: `${user.email} → ${role}` });
      void refresh();
    } catch (e) {
      toast({ title: 'Update failed', description: e instanceof Error ? e.message : String(e), variant: 'destructive' });
    }
  };

  const handleToggleDisabled = async (user: AdminUser): Promise<void> => {
    const disable = !user.disabled_at;
    try {
      await setUserDisabled(user.id, disable);
      toast({ title: disable ? 'User disabled' : 'User re-enabled', description: user.email });
      void refresh();
    } catch (e) {
      toast({ title: 'Action failed', description: e instanceof Error ? e.message : String(e), variant: 'destructive' });
    }
  };

  const handleResetSubmit = async (): Promise<void> => {
    if (!resetTarget) return;
    if (resetPw.length < 8) {
      toast({ title: 'Password too short', description: 'Minimum 8 characters.', variant: 'destructive' });
      return;
    }
    setResetting(true);
    try {
      await resetUserPassword(resetTarget.id, resetPw);
      toast({ title: 'Password reset', description: `${resetTarget.email} must change password on next login.` });
      setResetTarget(null);
      setResetPw('');
    } catch (e) {
      toast({ title: 'Reset failed', description: e instanceof Error ? e.message : String(e), variant: 'destructive' });
    } finally {
      setResetting(false);
    }
  };

  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-base font-semibold">Users</h3>
          <p className="text-sm text-muted-foreground">Manage organization members and their roles.</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => void refresh()} disabled={loading}>
            {loading ? 'Loading…' : 'Refresh'}
          </Button>
          <Button size="sm" onClick={() => setCreateOpen(true)}>New user</Button>
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
              <th className="p-2">User</th>
              <th className="p-2">Role</th>
              <th className="p-2">Status</th>
              <th className="p-2">Created</th>
              <th className="p-2 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {users.length === 0 && !loading ? (
              <tr><td colSpan={5} className="p-4 text-center text-muted-foreground">No users.</td></tr>
            ) : null}
            {users.map((u) => {
              const isSelf = u.id === callerUserId;
              const disabled = !!u.disabled_at;
              return (
                <tr key={u.id} className="border-t border-border">
                  <td className="p-2">
                    <div className="font-medium">{u.display_name}</div>
                    <div className="text-xs text-muted-foreground">{u.email}</div>
                    {u.must_change_password ? (
                      <div className="mt-0.5 text-[10px] uppercase tracking-wide text-amber-600">Must change pw</div>
                    ) : null}
                  </td>
                  <td className="p-2">
                    <Select
                      value={u.org_role}
                      onValueChange={(v) => void handleRoleChange(u, v as OrgRole)}
                      disabled={isSelf || disabled}
                    >
                      <SelectTrigger className="h-8 w-[110px]"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="admin">admin</SelectItem>
                        <SelectItem value="member">member</SelectItem>
                      </SelectContent>
                    </Select>
                  </td>
                  <td className="p-2">
                    {disabled ? (
                      <span className="rounded bg-muted px-2 py-0.5 text-xs">Disabled</span>
                    ) : (
                      <span className="rounded bg-emerald-500/10 px-2 py-0.5 text-xs text-emerald-700 dark:text-emerald-400">Active</span>
                    )}
                  </td>
                  <td className="p-2 text-xs text-muted-foreground">{formatDate(u.created_at)}</td>
                  <td className="p-2">
                    <div className="flex justify-end gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => { setResetTarget(u); setResetPw(''); }}
                        disabled={isSelf}
                      >
                        Reset pw
                      </Button>
                      <Button
                        variant={disabled ? 'outline' : 'ghost'}
                        size="sm"
                        onClick={() => void handleToggleDisabled(u)}
                        disabled={isSelf}
                      >
                        {disabled ? 'Re-enable' : 'Disable'}
                      </Button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Create user dialog */}
      <Dialog open={createOpen} onOpenChange={(o) => { if (!o) setCreateOpen(false); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New user</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <Input placeholder="Email" type="email" value={newEmail} onChange={(e) => setNewEmail(e.target.value)} />
            <Input placeholder="Display name" value={newDisplayName} onChange={(e) => setNewDisplayName(e.target.value)} />
            <Select value={newRole} onValueChange={(v) => setNewRole(v as OrgRole)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="member">member</SelectItem>
                <SelectItem value="admin">admin</SelectItem>
              </SelectContent>
            </Select>
            <Input
              placeholder="Default password (8+ chars)"
              type="text"
              value={newDefaultPw}
              onChange={(e) => setNewDefaultPw(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              The user will be required to change this password on first login.
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)} disabled={creating}>Cancel</Button>
            <Button onClick={() => void handleCreate()} disabled={creating}>
              {creating ? 'Creating…' : 'Create'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Reset password dialog */}
      <Dialog open={!!resetTarget} onOpenChange={(o) => { if (!o) setResetTarget(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reset password</DialogTitle>
          </DialogHeader>
          {resetTarget ? (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                Set a new default password for <strong>{resetTarget.email}</strong>. They will be required to change
                it on next login.
              </p>
              <Input
                placeholder="New default password (8+ chars)"
                type="text"
                value={resetPw}
                onChange={(e) => setResetPw(e.target.value)}
                autoFocus
              />
            </div>
          ) : null}
          <DialogFooter>
            <Button variant="outline" onClick={() => setResetTarget(null)} disabled={resetting}>Cancel</Button>
            <Button onClick={() => void handleResetSubmit()} disabled={resetting}>
              {resetting ? 'Saving…' : 'Reset'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
