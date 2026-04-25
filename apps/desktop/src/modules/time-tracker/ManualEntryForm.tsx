/**
 * ManualEntryForm — Hybrid-entity edition. Creates a new entity with a time_log aspect.
 */
import React, { useState, useCallback } from 'react';
import { createEntity } from '@/core/entityStore';
import { Button } from '@/ui/components/button';
import { Switch } from '@/ui/components/switch';
import type { TimeLogAspectData } from '@syncrohws/shared-types';

interface ManualEntryFormProps {
  onSaved: () => void | Promise<void>;
}

export function ManualEntryForm({ onSaved }: ManualEntryFormProps): React.ReactElement {
  const [description, setDescription] = useState('');
  const [project, setProject] = useState('');
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [startTime, setStartTime] = useState('09:00');
  const [endTime, setEndTime] = useState('10:00');
  const [billable, setBillable] = useState(false);
  const [hourlyRate, setHourlyRate] = useState('');
  const [saving, setSaving] = useState(false);
  const [success, setSuccess] = useState(false);

  const reset = useCallback(() => {
    setDescription('');
    setProject('');
    setDate(new Date().toISOString().slice(0, 10));
    setStartTime('09:00');
    setEndTime('10:00');
    setBillable(false);
    setHourlyRate('');
  }, []);

  const handleSave = useCallback(async () => {
    if (!description.trim()) return;
    setSaving(true);
    setSuccess(false);

    try {
      const startISO = new Date(`${date}T${startTime}:00`).toISOString();
      const endISO = new Date(`${date}T${endTime}:00`).toISOString();
      const startMs = new Date(startISO).getTime();
      const endMs = new Date(endISO).getTime();
      const durationSeconds = Math.max(0, Math.floor((endMs - startMs) / 1000));

      const rateCents = billable && hourlyRate
        ? Math.round(parseFloat(hourlyRate) * 100)
        : 0;

      const data: TimeLogAspectData = {
        start: startISO,
        end: endISO,
        duration_seconds: durationSeconds,
        window_title: '',
        billable,
        hourly_rate_cents: rateCents,
        project: project.trim(),
        manual: true,
      };

      await createEntity({
        core: { title: description.trim(), tags: [] },
        aspects: [{ aspect_type: 'time_log', data }],
      });

      setSuccess(true);
      reset();
      void onSaved();
      setTimeout(() => setSuccess(false), 2000);
    } catch (err) {
      console.error('[time-tracker] manual entry save failed:', err);
    } finally {
      setSaving(false);
    }
  }, [description, project, date, startTime, endTime, billable, hourlyRate, reset, onSaved]);

  const previewDuration = (() => {
    try {
      const s = new Date(`${date}T${startTime}:00`).getTime();
      const e = new Date(`${date}T${endTime}:00`).getTime();
      const diff = Math.max(0, Math.floor((e - s) / 1000));
      const h = Math.floor(diff / 3600);
      const m = Math.floor((diff % 3600) / 60);
      return `${h}h ${m}m`;
    } catch {
      return '—';
    }
  })();

  const previewCost = (() => {
    if (!billable || !hourlyRate) return null;
    try {
      const s = new Date(`${date}T${startTime}:00`).getTime();
      const e = new Date(`${date}T${endTime}:00`).getTime();
      const hours = Math.max(0, (e - s) / 3600000);
      const rate = parseFloat(hourlyRate);
      if (isNaN(rate)) return null;
      return (hours * rate).toFixed(2);
    } catch {
      return null;
    }
  })();

  return (
    <div className="mx-auto max-w-lg">
      <h2 className="mb-4 text-base font-semibold text-foreground">Add Manual Time Entry</h2>

      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-medium text-muted-foreground">Description *</label>
          <input
            type="text"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="What did you work on?"
            className="rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-medium text-muted-foreground">Project / Client</label>
          <input
            type="text"
            value={project}
            onChange={(e) => setProject(e.target.value)}
            placeholder="e.g. ClientX Website Redesign"
            className="rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </div>

        <div className="grid grid-cols-3 gap-3">
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-muted-foreground">Date</label>
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-muted-foreground">Start time</label>
            <input
              type="time"
              value={startTime}
              onChange={(e) => setStartTime(e.target.value)}
              className="rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-muted-foreground">End time</label>
            <input
              type="time"
              value={endTime}
              onChange={(e) => setEndTime(e.target.value)}
              className="rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>
        </div>

        <div className="flex items-center gap-4 rounded-lg border border-border bg-muted/50 px-4 py-2.5">
          <div className="flex-1">
            <p className="text-xs text-muted-foreground">Duration</p>
            <p className="font-mono text-lg font-semibold text-foreground">{previewDuration}</p>
          </div>
          {previewCost !== null && (
            <div className="text-right">
              <p className="text-xs text-muted-foreground">Estimated cost</p>
              <p className="font-mono text-lg font-semibold text-green-500">${previewCost}</p>
            </div>
          )}
        </div>

        <div className="flex items-center justify-between rounded-lg border border-border bg-card px-4 py-3">
          <div className="flex flex-col gap-0.5">
            <p className="text-sm font-medium text-foreground">Billable</p>
            <p className="text-xs text-muted-foreground">Mark this entry as billable time</p>
          </div>
          <Switch checked={billable} onCheckedChange={setBillable} />
        </div>

        {billable && (
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-muted-foreground">
              Hourly Rate ($)
            </label>
            <input
              type="number"
              min="0"
              step="0.01"
              value={hourlyRate}
              onChange={(e) => setHourlyRate(e.target.value)}
              placeholder="75.00"
              className="rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>
        )}

        <div className="flex items-center gap-3 pt-2">
          <Button onClick={() => void handleSave()} disabled={saving || !description.trim()}>
            {saving ? 'Saving…' : 'Add Entry'}
          </Button>
          <Button variant="outline" onClick={reset}>Reset</Button>
          {success && <span className="text-sm text-green-500">✓ Entry added</span>}
        </div>
      </div>
    </div>
  );
}
