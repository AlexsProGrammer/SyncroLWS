/**
 * Phase U — Workspace member management dialog.
 *
 * Owner-only UI for inviting users by email, changing roles, and removing
 * members. Non-owners get a read-only members list (with a "Leave" button
 * for editor/viewer roles).
 */
import React, { useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/ui/components/dialog';
import { Input } from '@/ui/components/input';
import { Button } from '@/ui/components/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/ui/components/select';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/ui/components/tabs';
import { AuditLogPanel } from '@/ui/admin/AuditLogPanel';
import { toast } from '@/ui/hooks/use-toast';
import {
  inviteMember,
  setMemberRole as apiSetMemberRole,
  removeMember as apiRemoveMember,
  leaveWorkspace,
  listMembers,
  type RemoteMember,
  type WorkspaceRole,
} from '@/core/sharing';
import { useWorkspaceStore, workspaceRole } from '@/store/workspaceStore';
import { useSyncStore } from '@/store/syncStore';

interface ManageMembersDialogProps {
  open: boolean;
  workspaceId: string | null;
  onClose: () => void;
}

export function ManageMembersDialog({
  open,
  workspaceId,
  onClose,
}: ManageMembersDialogProps): React.ReactElement | null {
  const callerUserId = useSyncStore((s) => s.userId);
  const membership = useWorkspaceStore((s) => s.membership);
  const reconcileShares = useWorkspaceStore((s) => s.reconcileShares);
  const workspaces = useWorkspaceStore((s) => s.workspaces);

  const [members, setMembers] = useState<RemoteMember[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<'editor' | 'viewer'>('editor');

  const ws = workspaces.find((w) => w.id === workspaceId);
  const callerRole = workspaceId ? workspaceRole(workspaceId, membership) : 'viewer';
  const isOwner = callerRole === 'owner';

  useEffect(() => {
    if (!open || !workspaceId) return;
    let cancelled = false;
    setLoading(true);
    listMembers(workspaceId)
      .then((rows) => { if (!cancelled) setMembers(rows); })
      .catch((err: Error) => {
        if (!cancelled) {
          toast({ variant: 'destructive', title: 'Failed to load members', description: err.message });
        }
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [open, workspaceId]);

  async function refresh(): Promise<void> {
    if (!workspaceId) return;
    setLoading(true);
    try {
      const rows = await listMembers(workspaceId);
      setMembers(rows);
    } finally {
      setLoading(false);
    }
  }

  async function handleInvite(): Promise<void> {
    if (!workspaceId || !inviteEmail.trim()) return;
    setBusy(true);
    try {
      await inviteMember(workspaceId, inviteEmail.trim(), inviteRole);
      setInviteEmail('');
      toast({ title: 'Invitation sent', description: `${inviteEmail} added as ${inviteRole}.` });
      await refresh();
      void reconcileShares();
    } catch (err) {
      toast({ variant: 'destructive', title: 'Invite failed', description: (err as Error).message });
    } finally {
      setBusy(false);
    }
  }

  async function handleRoleChange(userId: string, role: WorkspaceRole): Promise<void> {
    if (!workspaceId) return;
    setBusy(true);
    try {
      await apiSetMemberRole(workspaceId, userId, role);
      await refresh();
      void reconcileShares();
    } catch (err) {
      toast({ variant: 'destructive', title: 'Role update failed', description: (err as Error).message });
    } finally {
      setBusy(false);
    }
  }

  async function handleRemove(userId: string, email: string): Promise<void> {
    if (!workspaceId) return;
    if (!confirm(`Remove ${email} from this workspace?`)) return;
    setBusy(true);
    try {
      await apiRemoveMember(workspaceId, userId);
      toast({ title: 'Member removed', description: email });
      await refresh();
      void reconcileShares();
    } catch (err) {
      toast({ variant: 'destructive', title: 'Remove failed', description: (err as Error).message });
    } finally {
      setBusy(false);
    }
  }

  async function handleLeave(): Promise<void> {
    if (!workspaceId) return;
    if (!confirm('Leave this workspace? You will lose access until re-invited.')) return;
    setBusy(true);
    try {
      await leaveWorkspace(workspaceId);
      toast({ title: 'Left workspace' });
      void reconcileShares();
      onClose();
    } catch (err) {
      toast({ variant: 'destructive', title: 'Leave failed', description: (err as Error).message });
    } finally {
      setBusy(false);
    }
  }

  if (!workspaceId) return null;

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Members — {ws?.name ?? 'Workspace'}</DialogTitle>
        </DialogHeader>

        <Tabs defaultValue="members" className="mt-2">
          {isOwner ? (
            <TabsList>
              <TabsTrigger value="members">Members</TabsTrigger>
              <TabsTrigger value="activity">Activity</TabsTrigger>
            </TabsList>
          ) : null}

          <TabsContent value="members">

        {isOwner && (
          <div className="mt-4 flex items-end gap-2 border-b border-border pb-4">
            <div className="flex-1">
              <label className="mb-1 block text-xs font-medium text-muted-foreground">
                Invite by email
              </label>
              <Input
                type="email"
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                placeholder="user@example.com"
                disabled={busy}
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">
                Role
              </label>
              <Select value={inviteRole} onValueChange={(v) => setInviteRole(v as 'editor' | 'viewer')}>
                <SelectTrigger className="w-32">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="editor">Editor</SelectItem>
                  <SelectItem value="viewer">Viewer</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Button onClick={handleInvite} disabled={busy || !inviteEmail.trim()}>
              Invite
            </Button>
          </div>
        )}

        <div className="mt-4 max-h-96 overflow-y-auto">
          {loading ? (
            <div className="py-8 text-center text-sm text-muted-foreground">Loading…</div>
          ) : members.length === 0 ? (
            <div className="py-8 text-center text-sm text-muted-foreground">No members yet.</div>
          ) : (
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="py-2">User</th>
                  <th className="py-2">Role</th>
                  <th className="py-2"></th>
                </tr>
              </thead>
              <tbody>
                {members.map((m) => {
                  const isSelf = m.user_id === callerUserId;
                  const isWsOwner = m.role === 'owner';
                  return (
                    <tr key={m.user_id} className="border-t border-border">
                      <td className="py-2">
                        <div className="font-medium">{m.display_name || m.email}</div>
                        <div className="text-xs text-muted-foreground">{m.email}</div>
                      </td>
                      <td className="py-2">
                        {isOwner && !isWsOwner ? (
                          <Select
                            value={m.role}
                            onValueChange={(v) => void handleRoleChange(m.user_id, v as WorkspaceRole)}
                            disabled={busy}
                          >
                            <SelectTrigger className="w-32">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="editor">Editor</SelectItem>
                              <SelectItem value="viewer">Viewer</SelectItem>
                            </SelectContent>
                          </Select>
                        ) : (
                          <span className="capitalize">{m.role}</span>
                        )}
                      </td>
                      <td className="py-2 text-right">
                        {isOwner && !isWsOwner && !isSelf && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => void handleRemove(m.user_id, m.email)}
                            disabled={busy}
                          >
                            Remove
                          </Button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

          </TabsContent>

          {isOwner ? (
            <TabsContent value="activity">
              <AuditLogPanel fixedWorkspaceId={workspaceId} hideUserFilter />
            </TabsContent>
          ) : null}
        </Tabs>

        <div className="mt-4 flex justify-end gap-2">
          {!isOwner && (callerRole === 'editor' || callerRole === 'viewer') && (
            <Button variant="destructive" onClick={handleLeave} disabled={busy}>
              Leave workspace
            </Button>
          )}
          <Button variant="outline" onClick={onClose}>Close</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
