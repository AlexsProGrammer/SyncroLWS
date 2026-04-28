/**
 * HabitsView — Hybrid-entity edition.
 * core.title=name, core.icon, core.color; habit aspect holds frequency/target/completions/archived.
 */
import React, { useState, useEffect, useCallback } from 'react';
import { eventBus } from '@/core/events';
import {
  createEntity,
  listByAspect,
  softDeleteEntity,
  updateAspect,
  type AspectWithCore,
} from '@/core/entityStore';
import { Button } from '@/ui/components/button';
import { Input } from '@/ui/components/input';
import { Badge } from '@/ui/components/badge';
import { EntityRowContextMenu } from '@/ui/components/EntityRowContextMenu';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/ui/components/dialog';
import type { HabitAspectData } from '@syncrohws/shared-types';

// ── Helpers ───────────────────────────────────────────────────────────────────

function todayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

function weekKey(): string {
  const d = new Date();
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1); // ISO Monday
  const monday = new Date(d);
  monday.setDate(diff);
  return monday.toISOString().slice(0, 10);
}

function periodKey(frequency: 'daily' | 'weekly'): string {
  return frequency === 'daily' ? todayKey() : weekKey();
}

function dataOf(item: AspectWithCore): Partial<HabitAspectData> {
  return item.aspect.data as Partial<HabitAspectData>;
}

function getStreak(
  completions: Record<string, number>,
  targetCount: number,
  frequency: 'daily' | 'weekly',
): number {
  let streak = 0;
  const date = new Date();
  if (frequency === 'daily') date.setDate(date.getDate() - 1);
  else date.setDate(date.getDate() - 7);

  while (true) {
    const key = frequency === 'daily'
      ? date.toISOString().slice(0, 10)
      : (() => {
          const d = new Date(date);
          const day = d.getDay();
          const diff = d.getDate() - day + (day === 0 ? -6 : 1);
          d.setDate(diff);
          return d.toISOString().slice(0, 10);
        })();

    if ((completions[key] ?? 0) >= targetCount) {
      streak++;
      if (frequency === 'daily') date.setDate(date.getDate() - 1);
      else date.setDate(date.getDate() - 7);
    } else break;
    if (streak > 1000) break;
  }

  const currentKey = periodKey(frequency);
  if ((completions[currentKey] ?? 0) >= targetCount) streak++;
  return streak;
}

function getLast90Days(): { key: string; label: string }[] {
  const days: { key: string; label: string }[] = [];
  for (let i = 89; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    days.push({
      key: d.toISOString().slice(0, 10),
      label: d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
    });
  }
  return days;
}

// ── ContributionGraph ─────────────────────────────────────────────────────────

function ContributionGraph({
  completions, target, color,
}: { completions: Record<string, number>; target: number; color: string }): React.ReactElement {
  const days = getLast90Days();
  return (
    <div className="flex flex-wrap gap-[3px]">
      {days.map((d) => {
        const count = completions[d.key] ?? 0;
        const ratio = Math.min(count / target, 1);
        return (
          <div
            key={d.key}
            className="h-3 w-3 rounded-sm"
            title={`${d.label}: ${count}/${target}`}
            style={{
              backgroundColor: ratio === 0 ? 'hsl(var(--muted))' : color,
              opacity: ratio === 0 ? 1 : 0.25 + ratio * 0.75,
            }}
          />
        );
      })}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export function HabitsView({ toolInstanceId }: { toolInstanceId?: string }): React.ReactElement {
  const [habits, setHabits] = useState<AspectWithCore[]>([]);
  const [showArchived, setShowArchived] = useState(false);
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [selectedHabit, setSelectedHabit] = useState<AspectWithCore | null>(null);

  // New habit form
  const [newName, setNewName] = useState('');
  const [newIcon, setNewIcon] = useState('✅');
  const [newColor, setNewColor] = useState('#22c55e');
  const [newFrequency, setNewFrequency] = useState<'daily' | 'weekly'>('daily');
  const [newTarget, setNewTarget] = useState(1);

  // ── Load ──────────────────────────────────────────────────────────────────

  const load = useCallback(async () => {
    try {
      const items = await listByAspect('habit', { tool_instance_id: toolInstanceId ?? null });
      // Stable sort by created_at ascending
      items.sort((a, b) => a.core.created_at.localeCompare(b.core.created_at));
      setHabits(items);
    } catch (err) {
      console.error('[habits] load failed:', err);
    }
  }, [toolInstanceId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const onChange = (): void => void load();
    const events = [
      'core:created', 'core:updated', 'core:deleted',
      'aspect:added', 'aspect:updated', 'aspect:removed',
      'entity:created', 'entity:updated', 'entity:deleted',
    ] as const;
    events.forEach((e) => eventBus.on(e, onChange));
    return () => events.forEach((e) => eventBus.off(e, onChange));
  }, [load]);

  // Keep selectedHabit in sync with reloaded list
  useEffect(() => {
    if (!selectedHabit) return;
    const fresh = habits.find((h) => h.core.id === selectedHabit.core.id);
    if (fresh && fresh !== selectedHabit) setSelectedHabit(fresh);
  }, [habits, selectedHabit]);

  // Open detail sheet handlers
  const openDetail = useCallback((id: string) => {
    eventBus.emit('nav:open-detail-sheet', { id, initialAspectType: 'habit' });
  }, []);

  useEffect(() => {
    const onNav = ({ id, type }: { id: string; type: string }): void => {
      if (type === 'habit') openDetail(id);
    };
    eventBus.on('nav:open-entity', onNav);
    return () => { eventBus.off('nav:open-entity', onNav); };
  }, [openDetail]);

  // ── Create habit ──────────────────────────────────────────────────────────

  const createHabit = useCallback(async () => {
    if (!newName.trim()) return;
    try {
      await createEntity({
        core: {
          title: newName.trim(),
          icon: newIcon,
          color: newColor,
        },
        aspects: [
          {
            aspect_type: 'habit',
            data: {
              frequency: newFrequency,
              target_count: newTarget,
              completions: {},
              archived: false,
            },
            tool_instance_id: toolInstanceId ?? null,
          },
        ],
      });
      setNewName('');
      setNewIcon('✅');
      setNewColor('#22c55e');
      setNewFrequency('daily');
      setNewTarget(1);
      setShowCreateDialog(false);
    } catch (err) {
      console.error('[habits] create failed:', err);
    }
  }, [newName, newIcon, newColor, newFrequency, newTarget, toolInstanceId]);

  // ── Toggle completion ─────────────────────────────────────────────────────

  const toggleCompletion = useCallback(async (item: AspectWithCore) => {
    const data = dataOf(item);
    const frequency = data.frequency ?? 'daily';
    const target = data.target_count ?? 1;
    const key = periodKey(frequency);
    const completions = { ...(data.completions ?? {}) };
    const current = completions[key] ?? 0;
    const next = current >= target ? 0 : current + 1;
    if (next === 0) delete completions[key];
    else completions[key] = next;
    try {
      await updateAspect(item.aspect.id, { data: { completions } });
    } catch (err) {
      console.error('[habits] toggle failed:', err);
    }
  }, []);

  // ── Archive / delete ──────────────────────────────────────────────────────

  const archiveHabit = useCallback(async (item: AspectWithCore) => {
    try {
      await updateAspect(item.aspect.id, { data: { archived: true } });
    } catch (err) {
      console.error('[habits] archive failed:', err);
    }
  }, []);

  const deleteHabit = useCallback(async (item: AspectWithCore) => {
    try {
      await softDeleteEntity(item.core.id);
      setSelectedHabit(null);
    } catch (err) {
      console.error('[habits] delete failed:', err);
    }
  }, []);

  // ── Filtered habits ───────────────────────────────────────────────────────

  const activeHabits = habits.filter((h) => !dataOf(h).archived);
  const archivedHabits = habits.filter((h) => dataOf(h).archived);

  return (
    <div className="flex flex-1 flex-col overflow-hidden p-4">
      {/* ── Toolbar ────────────────────────────────────────── */}
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold text-foreground">Today&apos;s Habits</h2>
          <Badge variant="outline" className="text-[10px]">
            {activeHabits.filter((h) => {
              const d = dataOf(h);
              return (d.completions?.[periodKey(d.frequency ?? 'daily')] ?? 0) >= (d.target_count ?? 1);
            }).length}
            /{activeHabits.length}
          </Badge>
        </div>
        <div className="flex items-center gap-2">
          {archivedHabits.length > 0 && (
            <Button variant="ghost" size="sm" onClick={() => setShowArchived(!showArchived)} className="text-xs">
              {showArchived ? 'Hide' : 'Show'} archived ({archivedHabits.length})
            </Button>
          )}
          <Button size="sm" onClick={() => setShowCreateDialog(true)} className="h-7">
            + New Habit
          </Button>
        </div>
      </div>

      {/* ── Habit cards ────────────────────────────────────── */}
      <div className="flex-1 space-y-2 overflow-auto">
        {activeHabits.length === 0 && (
          <div className="flex flex-col items-center gap-3 py-16 text-center">
            <span className="text-4xl">🎯</span>
            <p className="text-sm text-muted-foreground">No habits yet — create one to start tracking!</p>
          </div>
        )}
        {activeHabits.map((item) => {
          const data = dataOf(item);
          const frequency = data.frequency ?? 'daily';
          const target = data.target_count ?? 1;
          const completions = data.completions ?? {};
          const key = periodKey(frequency);
          const current = completions[key] ?? 0;
          const completed = current >= target;
          const streak = getStreak(completions, target, frequency);
          const color = item.core.color;
          const icon = item.core.icon || '✅';

          return (
            <EntityRowContextMenu
              key={item.core.id}
              entityId={item.core.id}
              existingTypes={['habit']}
              openInitialAspectType="habit"
              onDelete={() => void deleteHabit(item)}
            >
            <div
              className="group flex items-center gap-3 rounded-lg border border-border bg-card p-3 transition-colors hover:border-primary/30"
            >
              <button
                onClick={() => void toggleCompletion(item)}
                className="flex h-10 w-10 items-center justify-center rounded-full text-xl transition-transform hover:scale-110"
                style={{
                  backgroundColor: completed ? color + '20' : 'transparent',
                  border: `2px solid ${completed ? color : 'hsl(var(--border))'}`,
                }}
              >
                {completed ? icon : <span className="text-sm text-muted-foreground">{current}</span>}
              </button>

              <div
                className="flex-1 cursor-pointer"
                onClick={() => setSelectedHabit(item)}
              >
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-foreground">{item.core.title}</span>
                  <Badge variant="outline" className="text-[10px]">{frequency}</Badge>
                  {target > 1 && (
                    <span className="text-xs text-muted-foreground">{current}/{target}</span>
                  )}
                </div>
                {streak > 0 && (
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    🔥 {streak} {frequency === 'daily' ? 'day' : 'week'} streak
                  </p>
                )}
              </div>

              <div className="w-20">
                <div className="h-1.5 rounded-full bg-muted">
                  <div
                    className="h-1.5 rounded-full transition-all"
                    style={{
                      width: `${Math.min((current / target) * 100, 100)}%`,
                      backgroundColor: color,
                    }}
                  />
                </div>
              </div>

              <button
                onClick={() => openDetail(item.core.id)}
                className="rounded p-1 text-muted-foreground opacity-0 transition-opacity hover:text-foreground group-hover:opacity-100"
                title="Open in detail sheet"
              >
                <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                  <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                  <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                </svg>
              </button>

              <button
                onClick={() => void archiveHabit(item)}
                className="rounded p-1 text-muted-foreground opacity-0 transition-opacity hover:text-foreground group-hover:opacity-100"
                title="Archive"
              >
                <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                  <polyline points="21 8 21 21 3 21 3 8" />
                  <rect x="1" y="3" width="22" height="5" />
                </svg>
              </button>
            </div>
            </EntityRowContextMenu>
          );
        })}

        {showArchived && archivedHabits.map((item) => (
          <div
            key={item.core.id}
            className="flex items-center gap-3 rounded-lg border border-border bg-card p-3 opacity-50"
          >
            <span className="text-xl">{item.core.icon || '✅'}</span>
            <span className="flex-1 text-sm text-muted-foreground line-through">{item.core.title}</span>
            <button
              onClick={() => void deleteHabit(item)}
              className="rounded p-1 text-muted-foreground hover:text-destructive"
            >
              <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                <polyline points="3 6 5 6 21 6" />
                <path d="M19 6l-2 14a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L5 6" />
              </svg>
            </button>
          </div>
        ))}
      </div>

      {/* ── Create dialog ──────────────────────────────────── */}
      <Dialog open={showCreateDialog} onOpenChange={setShowCreateDialog}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>New Habit</DialogTitle>
          </DialogHeader>

          <div className="mt-2 space-y-3">
            <div>
              <label className="mb-1 block text-xs text-muted-foreground">Name</label>
              <Input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="e.g. Drink water"
                autoFocus
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1 block text-xs text-muted-foreground">Icon</label>
                <Input
                  value={newIcon}
                  onChange={(e) => setNewIcon(e.target.value)}
                  className="text-center text-lg"
                  maxLength={2}
                />
              </div>
              <div>
                <label className="mb-1 block text-xs text-muted-foreground">Color</label>
                <div className="flex items-center gap-2">
                  <input
                    type="color"
                    value={newColor}
                    onChange={(e) => setNewColor(e.target.value)}
                    className="h-8 w-8 cursor-pointer rounded border border-border"
                  />
                  <Input
                    value={newColor}
                    onChange={(e) => setNewColor(e.target.value)}
                    className="h-8 flex-1 text-xs"
                  />
                </div>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1 block text-xs text-muted-foreground">Frequency</label>
                <div className="flex gap-1">
                  {(['daily', 'weekly'] as const).map((f) => (
                    <button
                      key={f}
                      onClick={() => setNewFrequency(f)}
                      className={`flex-1 rounded px-2 py-1.5 text-xs font-medium transition-colors ${
                        newFrequency === f
                          ? 'bg-primary text-primary-foreground'
                          : 'bg-muted text-muted-foreground hover:text-foreground'
                      }`}
                    >
                      {f}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="mb-1 block text-xs text-muted-foreground">Target count</label>
                <Input
                  type="number"
                  min={1}
                  max={100}
                  value={newTarget}
                  onChange={(e) => setNewTarget(Math.max(1, Number(e.target.value) || 1))}
                  className="h-8 text-sm"
                />
              </div>
            </div>

            <Button onClick={() => void createHabit()} className="w-full" disabled={!newName.trim()}>
              Create Habit
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Detail dialog with contribution graph ──────────── */}
      <Dialog open={!!selectedHabit} onOpenChange={(open) => !open && setSelectedHabit(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <span>{selectedHabit?.core.icon || '✅'}</span>
              <span>{selectedHabit?.core.title}</span>
            </DialogTitle>
          </DialogHeader>

          {selectedHabit && (() => {
            const d = dataOf(selectedHabit);
            const frequency = d.frequency ?? 'daily';
            const target = d.target_count ?? 1;
            const completions = d.completions ?? {};
            const color = selectedHabit.core.color;
            return (
              <div className="mt-2 space-y-4">
                <div className="flex flex-wrap items-center gap-3">
                  <Badge variant="outline">{frequency}</Badge>
                  <Badge variant="secondary">
                    🔥 {getStreak(completions, target, frequency)} streak
                  </Badge>
                  <Badge variant="secondary">
                    Target: {target}x / {frequency === 'daily' ? 'day' : 'week'}
                  </Badge>
                </div>

                <div>
                  <label className="mb-2 block text-xs font-medium text-muted-foreground">Last 90 days</label>
                  <ContributionGraph completions={completions} target={target} color={color} />
                </div>

                <div className="flex justify-end gap-2">
                  <Button variant="outline" size="sm" onClick={() => openDetail(selectedHabit.core.id)}>
                    Open in Sheet
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => void archiveHabit(selectedHabit)}>
                    Archive
                  </Button>
                  <Button variant="destructive" size="sm" onClick={() => void deleteHabit(selectedHabit)}>
                    Delete
                  </Button>
                </div>
              </div>
            );
          })()}
        </DialogContent>
      </Dialog>
    </div>
  );
}
