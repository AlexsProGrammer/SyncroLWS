import React, { useState, useCallback, useMemo } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/ui/components/dialog';
import { Button } from '@/ui/components/button';
import { Input } from '@/ui/components/input';
import { Textarea } from '@/ui/components/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/ui/components/select';
import { cn } from '@/lib/utils';
import { RRule, Frequency } from 'rrule';
import type { CalendarEventPayload } from '@syncrohws/shared-types';

// ── Preset event colors ──────────────────────────────────────────────────────

const EVENT_COLORS = [
  '#3b82f6', '#ef4444', '#22c55e', '#f97316',
  '#8b5cf6', '#ec4899', '#06b6d4', '#eab308',
];

// ── Recurrence labels ────────────────────────────────────────────────────────

const RECURRENCE_OPTIONS: { value: string; label: string }[] = [
  { value: '', label: 'No repeat' },
  { value: 'DAILY', label: 'Daily' },
  { value: 'WEEKLY', label: 'Weekly' },
  { value: 'BIWEEKLY', label: 'Every 2 weeks' },
  { value: 'MONTHLY', label: 'Monthly' },
  { value: 'YEARLY', label: 'Yearly' },
];

function recurrenceToRRule(key: string, dtstart: Date): string | null {
  switch (key) {
    case 'DAILY':
      return new RRule({ freq: Frequency.DAILY, dtstart }).toString();
    case 'WEEKLY':
      return new RRule({ freq: Frequency.WEEKLY, dtstart }).toString();
    case 'BIWEEKLY':
      return new RRule({ freq: Frequency.WEEKLY, interval: 2, dtstart }).toString();
    case 'MONTHLY':
      return new RRule({ freq: Frequency.MONTHLY, dtstart }).toString();
    case 'YEARLY':
      return new RRule({ freq: Frequency.YEARLY, dtstart }).toString();
    default:
      return null;
  }
}

function rruleToKey(rule: string | null): string {
  if (!rule) return '';
  const upper = rule.toUpperCase();
  if (upper.includes('YEARLY')) return 'YEARLY';
  if (upper.includes('MONTHLY')) return 'MONTHLY';
  if (upper.includes('WEEKLY') && upper.includes('INTERVAL=2')) return 'BIWEEKLY';
  if (upper.includes('WEEKLY')) return 'WEEKLY';
  if (upper.includes('DAILY')) return 'DAILY';
  return '';
}

// ── Types ─────────────────────────────────────────────────────────────────────

export interface CalendarEventItem {
  id: string;
  payload: CalendarEventPayload;
  created_at: string;
  updated_at: string;
}

interface EventDetailModalProps {
  /** Pass null for "create" mode, event for "edit" mode */
  event: CalendarEventItem | null;
  /** Default start/end for new events */
  defaultStart?: string;
  defaultEnd?: string;
  defaultAllDay?: boolean;
  open: boolean;
  onClose: () => void;
  onSave: (id: string | null, payload: CalendarEventPayload) => void;
  onDelete?: (id: string) => void;
}

// ── Helper: ISO ↔ datetime-local ─────────────────────────────────────────────

function isoToLocal(iso: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function isoToDateOnly(iso: string): string {
  if (!iso) return '';
  return iso.slice(0, 10);
}

// ── Component ─────────────────────────────────────────────────────────────────

export function EventDetailModal({
  event,
  defaultStart,
  defaultEnd,
  defaultAllDay,
  open,
  onClose,
  onSave,
  onDelete,
}: EventDetailModalProps): React.ReactElement {
  const isEdit = event !== null;
  const p = event?.payload;

  const [title, setTitle] = useState(p?.title ?? '');
  const [description, setDescription] = useState(p?.description ?? '');
  const [start, setStart] = useState(
    p?.start
      ? isoToLocal(p.start)
      : defaultStart
        ? isoToLocal(defaultStart)
        : isoToLocal(new Date().toISOString()),
  );
  const [end, setEnd] = useState(
    p?.end
      ? isoToLocal(p.end)
      : defaultEnd
        ? isoToLocal(defaultEnd)
        : '',
  );
  const [allDay, setAllDay] = useState(p?.all_day ?? defaultAllDay ?? false);
  const [location, setLocation] = useState(p?.location ?? '');
  const [color, setColor] = useState<string>(p?.color ?? EVENT_COLORS[0] ?? '#3b82f6');
  const [recurrence, setRecurrence] = useState(rruleToKey(p?.recurrence_rule ?? null));

  const handleSave = useCallback(() => {
    if (!title.trim()) return;

    let startISO: string;
    let endISO: string;

    if (allDay) {
      const startDate = start.slice(0, 10);
      const endDate = end.slice(0, 10) || startDate;
      startISO = new Date(startDate + 'T00:00:00').toISOString();
      endISO = new Date(endDate + 'T23:59:59').toISOString();
    } else {
      startISO = new Date(start).toISOString();
      endISO = end ? new Date(end).toISOString() : new Date(new Date(start).getTime() + 3600000).toISOString();
    }

    const rrule = recurrenceToRRule(recurrence, new Date(startISO));

    const payload: CalendarEventPayload = {
      title: title.trim(),
      description: description.trim(),
      start: startISO,
      end: endISO,
      all_day: allDay,
      recurrence_rule: rrule,
      location: location.trim(),
      color,
      linked_entity_id: p?.linked_entity_id ?? null,
      linked_entity_type: p?.linked_entity_type ?? null,
    };

    onSave(event?.id ?? null, payload);
    onClose();
  }, [
    title, description, start, end, allDay, location, color,
    recurrence, event, p, onSave, onClose,
  ]);

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{isEdit ? 'Edit Event' : 'New Event'}</DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-3 py-2">
          {/* Title */}
          <Input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Event title"
            autoFocus
          />

          {/* Description */}
          <Textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Add description…"
            rows={2}
            className="text-sm"
          />

          {/* All-day toggle */}
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={allDay}
              onChange={(e) => setAllDay(e.target.checked)}
              className="h-3.5 w-3.5 accent-primary"
            />
            All-day event
          </label>

          {/* Start / End */}
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="mb-1 block text-xs text-muted-foreground">Start</label>
              <Input
                type={allDay ? 'date' : 'datetime-local'}
                value={allDay ? start.slice(0, 10) : start}
                onChange={(e) => setStart(e.target.value)}
                className="h-8 text-xs"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-muted-foreground">End</label>
              <Input
                type={allDay ? 'date' : 'datetime-local'}
                value={allDay ? end.slice(0, 10) : end}
                onChange={(e) => setEnd(e.target.value)}
                className="h-8 text-xs"
              />
            </div>
          </div>

          {/* Location */}
          <Input
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            placeholder="Location"
            className="h-8 text-sm"
          />

          {/* Recurrence */}
          <div>
            <label className="mb-1 block text-xs text-muted-foreground">Repeat</label>
            <Select value={recurrence || '_none'} onValueChange={(v) => setRecurrence(v === '_none' ? '' : v)}>
              <SelectTrigger className="h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {RECURRENCE_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value || '_none'} value={opt.value || '_none'}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Color */}
          <div>
            <label className="mb-1 block text-xs text-muted-foreground">Color</label>
            <div className="flex gap-1.5">
              {EVENT_COLORS.map((c) => (
                <button
                  key={c}
                  onClick={() => setColor(c)}
                  className={cn(
                    'h-6 w-6 rounded-full border-2 transition-transform',
                    color === c ? 'scale-110 border-foreground' : 'border-transparent',
                  )}
                  style={{ backgroundColor: c }}
                />
              ))}
            </div>
          </div>

          {/* Linked entity info (read only) */}
          {p?.linked_entity_id && (
            <div className="rounded border border-border/50 bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
              Linked to {p.linked_entity_type ?? 'entity'}: {p.linked_entity_id.slice(0, 8)}…
            </div>
          )}
        </div>

        <DialogFooter>
          <div className="flex w-full items-center justify-between">
            <div>
              {isEdit && onDelete && (
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={() => { onDelete(event.id); onClose(); }}
                >
                  Delete
                </Button>
              )}
            </div>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={onClose}>
                Cancel
              </Button>
              <Button size="sm" onClick={handleSave} disabled={!title.trim()}>
                {isEdit ? 'Update' : 'Create'}
              </Button>
            </div>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
