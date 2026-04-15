/**
 * HabitsView — Daily / weekly habit tracker with streaks and contribution graph.
 */
import React, { useState, useEffect, useCallback } from 'react';
import { getWorkspaceDB } from '@/core/db';
import { eventBus } from '@/core/events';
import { Button } from '@/ui/components/button';
import { Input } from '@/ui/components/input';
import { Badge } from '@/ui/components/badge';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/ui/components/dialog';

// ── Types ─────────────────────────────────────────────────────────────────────

interface Habit {
  id: string;
  name: string;
  icon: string;
  color: string;
  frequency: 'daily' | 'weekly';
  target_count: number;
  completions: Record<string, number>;
  archived: boolean;
  created_at: string;
}

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

function getStreak(completions: Record<string, number>, targetCount: number, frequency: 'daily' | 'weekly'): number {
  let streak = 0;
  const date = new Date();

  // Start from yesterday for daily (today might be in progress)
  if (frequency === 'daily') {
    date.setDate(date.getDate() - 1);
  } else {
    date.setDate(date.getDate() - 7);
  }

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
      if (frequency === 'daily') {
        date.setDate(date.getDate() - 1);
      } else {
        date.setDate(date.getDate() - 7);
      }
    } else {
      break;
    }

    if (streak > 1000) break; // Safety
  }

  // Check if today/this week also counts
  const currentKey = periodKey(frequency);
  if ((completions[currentKey] ?? 0) >= targetCount) {
    streak++;
  }

  return streak;
}

/** Generate an array of the last N days for the contribution graph. */
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
  completions,
  target,
  color,
}: {
  completions: Record<string, number>;
  target: number;
  color: string;
}): React.ReactElement {
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

export function HabitsView(): React.ReactElement {
  const [habits, setHabits] = useState<Habit[]>([]);
  const [showArchived, setShowArchived] = useState(false);
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [selectedHabit, setSelectedHabit] = useState<Habit | null>(null);

  // New habit form
  const [newName, setNewName] = useState('');
  const [newIcon, setNewIcon] = useState('✅');
  const [newColor, setNewColor] = useState('#22c55e');
  const [newFrequency, setNewFrequency] = useState<'daily' | 'weekly'>('daily');
  const [newTarget, setNewTarget] = useState(1);

  // ── Load habits ───────────────────────────────────────────────────────────

  const loadHabits = useCallback(async () => {
    try {
      const db = getWorkspaceDB();
      const rows = await db.select<{ id: string; payload: string; created_at: string }[]>(
        `SELECT id, payload, created_at FROM base_entities
         WHERE type = 'habit' AND deleted_at IS NULL
         ORDER BY created_at ASC`,
      );

      setHabits(
        rows.map((r) => {
          const p = JSON.parse(r.payload);
          return {
            id: r.id,
            name: p.name ?? '',
            icon: p.icon ?? '✅',
            color: p.color ?? '#22c55e',
            frequency: p.frequency ?? 'daily',
            target_count: p.target_count ?? 1,
            completions: p.completions ?? {},
            archived: p.archived ?? false,
            created_at: r.created_at,
          };
        }),
      );
    } catch (err) {
      console.error('[habits] load failed:', err);
    }
  }, []);

  useEffect(() => {
    void loadHabits();
  }, [loadHabits]);

  useEffect(() => {
    const handler = (): void => void loadHabits();
    eventBus.on('entity:created', handler);
    eventBus.on('entity:updated', handler);
    eventBus.on('entity:deleted', handler);
    return () => {
      eventBus.off('entity:created', handler);
      eventBus.off('entity:updated', handler);
      eventBus.off('entity:deleted', handler);
    };
  }, [loadHabits]);

  // ── Create habit ──────────────────────────────────────────────────────────

  const createHabit = useCallback(async () => {
    if (!newName.trim()) return;
    const db = getWorkspaceDB();
    const id = crypto.randomUUID();
    const now = new Date().toISOString();

    const payload = {
      name: newName.trim(),
      icon: newIcon,
      color: newColor,
      frequency: newFrequency,
      target_count: newTarget,
      completions: {},
      archived: false,
    };

    await db.execute(
      `INSERT INTO base_entities
         (id, type, payload, metadata, tags, parent_id, created_at, updated_at)
       VALUES (?, 'habit', ?, '{}', '[]', NULL, ?, ?)`,
      [id, JSON.stringify(payload), now, now],
    );

    eventBus.emit('entity:created', {
      entity: {
        id,
        type: 'habit',
        payload,
        metadata: {},
        tags: [],
        parent_id: null,
        created_at: now,
        updated_at: now,
        deleted_at: null,
      },
    });

    setNewName('');
    setNewIcon('✅');
    setNewColor('#22c55e');
    setNewFrequency('daily');
    setNewTarget(1);
    setShowCreateDialog(false);
  }, [newName, newIcon, newColor, newFrequency, newTarget]);

  // ── Toggle completion ─────────────────────────────────────────────────────

  const toggleCompletion = useCallback(
    async (habit: Habit) => {
      const db = getWorkspaceDB();
      const key = periodKey(habit.frequency);
      const current = habit.completions[key] ?? 0;
      const next = current >= habit.target_count ? 0 : current + 1;
      const updatedCompletions = { ...habit.completions, [key]: next };
      const now = new Date().toISOString();

      await db.execute(
        `UPDATE base_entities
         SET payload = json_set(payload, '$.completions', json(?)),
             updated_at = ?
         WHERE id = ?`,
        [JSON.stringify(updatedCompletions), now, habit.id],
      );

      eventBus.emit('entity:updated', { entity: { id: habit.id, type: 'habit', payload: {} as Record<string, unknown>, metadata: {}, tags: [], parent_id: null, created_at: habit.created_at, updated_at: now, deleted_at: null } });
    },
    [],
  );

  // ── Archive / delete ──────────────────────────────────────────────────────

  const archiveHabit = useCallback(async (habit: Habit) => {
    const db = getWorkspaceDB();
    const now = new Date().toISOString();
    await db.execute(
      `UPDATE base_entities
       SET payload = json_set(payload, '$.archived', json('true')),
           updated_at = ?
       WHERE id = ?`,
      [now, habit.id],
    );
    eventBus.emit('entity:updated', { entity: { id: habit.id, type: 'habit', payload: {} as Record<string, unknown>, metadata: {}, tags: [], parent_id: null, created_at: habit.created_at, updated_at: now, deleted_at: null } });
  }, []);

  const deleteHabit = useCallback(async (habit: Habit) => {
    const db = getWorkspaceDB();
    const now = new Date().toISOString();
    await db.execute(`UPDATE base_entities SET deleted_at = ? WHERE id = ?`, [now, habit.id]);
    eventBus.emit('entity:deleted', { id: habit.id, type: 'habit' });
    setSelectedHabit(null);
  }, []);

  // ── Filtered habits ───────────────────────────────────────────────────────

  const activeHabits = habits.filter((h) => !h.archived);
  const archivedHabits = habits.filter((h) => h.archived);

  return (
    <div className="flex flex-1 flex-col overflow-hidden p-4">
      {/* ── Toolbar ────────────────────────────────────────── */}
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold text-foreground">Today&apos;s Habits</h2>
          <Badge variant="outline" className="text-[10px]">
            {activeHabits.filter((h) => (h.completions[periodKey(h.frequency)] ?? 0) >= h.target_count).length}/{activeHabits.length}
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
        {activeHabits.map((habit) => {
          const key = periodKey(habit.frequency);
          const current = habit.completions[key] ?? 0;
          const completed = current >= habit.target_count;
          const streak = getStreak(habit.completions, habit.target_count, habit.frequency);

          return (
            <div
              key={habit.id}
              className="group flex items-center gap-3 rounded-lg border border-border bg-card p-3 transition-colors hover:border-primary/30"
            >
              {/* Completion button */}
              <button
                onClick={() => void toggleCompletion(habit)}
                className="flex h-10 w-10 items-center justify-center rounded-full text-xl transition-transform hover:scale-110"
                style={{
                  backgroundColor: completed ? habit.color + '20' : 'transparent',
                  border: `2px solid ${completed ? habit.color : 'hsl(var(--border))'}`,
                }}
              >
                {completed ? habit.icon : <span className="text-sm text-muted-foreground">{current}</span>}
              </button>

              {/* Info */}
              <div
                className="flex-1 cursor-pointer"
                onClick={() => setSelectedHabit(habit)}
              >
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-foreground">{habit.name}</span>
                  <Badge variant="outline" className="text-[10px]">{habit.frequency}</Badge>
                  {habit.target_count > 1 && (
                    <span className="text-xs text-muted-foreground">
                      {current}/{habit.target_count}
                    </span>
                  )}
                </div>
                {streak > 0 && (
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    🔥 {streak} {habit.frequency === 'daily' ? 'day' : 'week'} streak
                  </p>
                )}
              </div>

              {/* Progress bar */}
              <div className="w-20">
                <div className="h-1.5 rounded-full bg-muted">
                  <div
                    className="h-1.5 rounded-full transition-all"
                    style={{
                      width: `${Math.min((current / habit.target_count) * 100, 100)}%`,
                      backgroundColor: habit.color,
                    }}
                  />
                </div>
              </div>

              {/* Archive button */}
              <button
                onClick={() => void archiveHabit(habit)}
                className="rounded p-1 text-muted-foreground opacity-0 transition-opacity hover:text-foreground group-hover:opacity-100"
                title="Archive"
              >
                <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                  <polyline points="21 8 21 21 3 21 3 8" />
                  <rect x="1" y="3" width="22" height="5" />
                </svg>
              </button>
            </div>
          );
        })}

        {/* ── Archived ──────────────────────────────────────── */}
        {showArchived &&
          archivedHabits.map((habit) => (
            <div
              key={habit.id}
              className="flex items-center gap-3 rounded-lg border border-border bg-card p-3 opacity-50"
            >
              <span className="text-xl">{habit.icon}</span>
              <span className="flex-1 text-sm text-muted-foreground line-through">{habit.name}</span>
              <button
                onClick={() => void deleteHabit(habit)}
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
              <span>{selectedHabit?.icon}</span>
              <span>{selectedHabit?.name}</span>
            </DialogTitle>
          </DialogHeader>

          {selectedHabit && (
            <div className="mt-2 space-y-4">
              <div className="flex items-center gap-3">
                <Badge variant="outline">{selectedHabit.frequency}</Badge>
                <Badge variant="secondary">
                  🔥 {getStreak(selectedHabit.completions, selectedHabit.target_count, selectedHabit.frequency)} streak
                </Badge>
                <Badge variant="secondary">
                  Target: {selectedHabit.target_count}x / {selectedHabit.frequency === 'daily' ? 'day' : 'week'}
                </Badge>
              </div>

              <div>
                <label className="mb-2 block text-xs font-medium text-muted-foreground">Last 90 days</label>
                <ContributionGraph
                  completions={selectedHabit.completions}
                  target={selectedHabit.target_count}
                  color={selectedHabit.color}
                />
              </div>

              <div className="flex justify-end gap-2">
                <Button variant="outline" size="sm" onClick={() => void archiveHabit(selectedHabit)}>
                  Archive
                </Button>
                <Button variant="destructive" size="sm" onClick={() => void deleteHabit(selectedHabit)}>
                  Delete
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
