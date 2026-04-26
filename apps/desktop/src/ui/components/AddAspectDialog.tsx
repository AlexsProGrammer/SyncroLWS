import * as React from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from './dialog';
import { Button } from './button';
import { Input } from './input';
import {
  getAllAspectPlugins,
  getAspectPlugin,
  type AspectPlugin,
} from '@/registry/ToolRegistry';
import { addAspect, listToolInstances, type ToolInstance } from '@/core/entityStore';
import type { EntityAspect } from '@syncrohws/shared-types';

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Merge manifest defaultData with any runtime-generated defaults that cannot
 * be static values (e.g. ISO datetimes).
 */
function buildDefaultData(
  aspectType: string,
  base: Record<string, unknown>,
): Record<string, unknown> {
  if (aspectType === 'calendar_event') {
    const now = new Date();
    const start = now.toISOString();
    const end = new Date(now.getTime() + 60 * 60 * 1000).toISOString(); // +1 h
    return { start, end, ...base };
  }
  if (aspectType === 'time_log') {
    const start = new Date().toISOString();
    return { start, end: null, duration_seconds: null, ...base };
  }
  return base;
}

export interface AddAspectDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Entity to attach the new aspect to. */
  entityId: string;
  /** Aspect types already present — hidden from the picker. */
  existingTypes: string[];
  /** Pre-selected aspect type (skips type-picking step). */
  initialType?: string;
  /** Called after successful attach. */
  onAdded?: (aspect: EntityAspect) => void;
}

// ── Component ────────────────────────────────────────────────────────────────

/**
 * Universal "Add aspect to this entity" flow.
 *
 *   1. Pick aspect type (skipped when `initialType` is passed).
 *   2. If the plugin requires a tool instance, pick one (or create new).
 *   3. Attach via `entityStore.addAspect` and emit aspect:added.
 */
export function AddAspectDialog({
  open,
  onOpenChange,
  entityId,
  existingTypes,
  initialType,
  onAdded,
}: AddAspectDialogProps): React.ReactElement | null {
  const [selectedType, setSelectedType] = React.useState<string | null>(initialType ?? null);
  const [instances, setInstances] = React.useState<ToolInstance[]>([]);
  const [selectedInstanceId, setSelectedInstanceId] = React.useState<string | null>(null);
  const [newInstanceName, setNewInstanceName] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  // Reset state when dialog opens / closes
  React.useEffect(() => {
    if (open) {
      setSelectedType(initialType ?? null);
      setSelectedInstanceId(null);
      setNewInstanceName('');
      setError(null);
    }
  }, [open, initialType]);

  // Load tool instances when an aspect type is selected
  React.useEffect(() => {
    if (!selectedType) {
      setInstances([]);
      return;
    }
    const plugin = getAspectPlugin(selectedType);
    if (!plugin) return;
    void listToolInstances(plugin.toolId).then((rows) => {
      setInstances(rows);
      if (rows.length === 1) setSelectedInstanceId(rows[0]!.id);
    });
  }, [selectedType]);

  if (!open) return null;

  const availablePlugins = getAllAspectPlugins().filter(
    (p) => !existingTypes.includes(p.type),
  );

  const plugin = selectedType ? getAspectPlugin(selectedType) : null;
  const needsInstance = plugin?.requiresToolInstance === true;

  async function handleAttach(): Promise<void> {
    if (!plugin) return;
    setBusy(true);
    setError(null);
    try {
      let toolInstanceId = selectedInstanceId;

      if (needsInstance && !toolInstanceId && newInstanceName.trim()) {
        toolInstanceId = await createToolInstance(plugin.toolId, newInstanceName.trim());
      }

      if (needsInstance && !toolInstanceId) {
        setError(`Pick or create a ${plugin.label.toLowerCase()} target.`);
        setBusy(false);
        return;
      }

      const aspect = await addAspect(entityId, {
        aspect_type: plugin.type as EntityAspect['aspect_type'],
        data: { ...buildDefaultData(plugin.type, plugin.defaultData) },
        tool_instance_id: toolInstanceId,
      });
      onAdded?.(aspect);
      onOpenChange(false);
    } catch (err) {
      console.error('[AddAspectDialog] attach failed:', err);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{plugin ? `Add ${plugin.label}` : 'Add aspect'}</DialogTitle>
          <DialogDescription>
            {plugin
              ? 'This entity will gain another personality. The original aspects are kept.'
              : 'Pick a personality to add to this entity.'}
          </DialogDescription>
        </DialogHeader>

        {/* Step 1 — pick type */}
        {!plugin && (
          <div className="grid grid-cols-2 gap-2 py-4">
            {availablePlugins.length === 0 && (
              <p className="col-span-2 text-sm text-muted-foreground">
                This entity already has every available aspect.
              </p>
            )}
            {availablePlugins.map((p) => (
              <PluginPickButton key={p.type} plugin={p} onPick={() => setSelectedType(p.type)} />
            ))}
          </div>
        )}

        {/* Step 2 — pick / create tool instance */}
        {plugin && needsInstance && (
          <div className="space-y-3 py-2">
            {instances.length > 0 && (
              <div className="space-y-1">
                <p className="text-xs text-muted-foreground">Existing</p>
                <div className="grid gap-1">
                  {instances.map((inst) => (
                    <button
                      key={inst.id}
                      type="button"
                      onClick={() => setSelectedInstanceId(inst.id)}
                      className={`flex items-center justify-between rounded-md border px-3 py-2 text-left text-sm transition ${
                        selectedInstanceId === inst.id
                          ? 'border-primary bg-primary/10'
                          : 'border-border hover:bg-muted'
                      }`}
                    >
                      <span>{inst.name}</span>
                      {inst.description && (
                        <span className="text-xs text-muted-foreground">{inst.description}</span>
                      )}
                    </button>
                  ))}
                </div>
              </div>
            )}
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground">Or create new</p>
              <Input
                placeholder={`New ${plugin.label.toLowerCase()}…`}
                value={newInstanceName}
                onChange={(e) => {
                  setNewInstanceName(e.target.value);
                  if (e.target.value) setSelectedInstanceId(null);
                }}
              />
            </div>
          </div>
        )}

        {error && <p className="text-sm text-destructive">{error}</p>}

        <DialogFooter>
          {plugin && !initialType && (
            <Button variant="ghost" onClick={() => setSelectedType(null)} disabled={busy}>
              Back
            </Button>
          )}
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          {plugin && (
            <Button onClick={handleAttach} disabled={busy}>
              {busy ? 'Adding…' : `Add ${plugin.label}`}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function PluginPickButton({
  plugin,
  onPick,
}: {
  plugin: AspectPlugin;
  onPick: () => void;
}): React.ReactElement {
  const Icon = plugin.icon;
  return (
    <button
      type="button"
      onClick={onPick}
      className="flex flex-col items-start gap-1 rounded-md border border-border p-3 text-left transition hover:bg-muted"
    >
      <Icon className="h-5 w-5 text-foreground" />
      <span className="text-sm font-medium">{plugin.label}</span>
      <span className="text-xs text-muted-foreground">
        {plugin.requiresToolInstance ? 'Pick a target' : 'Workspace-wide'}
      </span>
    </button>
  );
}

async function createToolInstance(toolId: string, name: string): Promise<string> {
  const { getWorkspaceDB } = await import('@/core/db');
  const db = getWorkspaceDB();
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  await db.execute(
    `INSERT INTO workspace_tools (id, tool_id, name, description, config, sort_order, created_at)
     VALUES (?, ?, ?, '', '{}', 0, ?)`,
    [id, toolId, name, now],
  );
  return id;
}
