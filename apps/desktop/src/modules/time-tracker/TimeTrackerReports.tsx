/**
 * TimeTrackerReports — Daily/weekly/monthly bar charts + CSV/PDF export.
 *
 * Uses recharts for charting and jspdf for PDF generation (all local, zero CDN).
 */
import React, { useState, useMemo, useCallback } from 'react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RechartsTooltip,
  ResponsiveContainer,
  Cell,
  PieChart,
  Pie,
} from 'recharts';
import { jsPDF } from 'jspdf';
import { Button } from '@/ui/components/button';
import type { TimeLogItem } from './TimeTrackerView';
import { formatDuration } from './TimeTrackerView';

// ── Types ─────────────────────────────────────────────────────────────────────

type Period = 'daily' | 'weekly' | 'monthly';

interface ChartPoint {
  label: string;
  totalHours: number;
  billableHours: number;
}

interface ProjectBreakdown {
  name: string;
  hours: number;
  color: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const PROJECT_COLORS = [
  '#3b82f6', '#22c55e', '#f59e0b', '#ef4444', '#8b5cf6',
  '#ec4899', '#06b6d4', '#f97316', '#14b8a6', '#6366f1',
];

function getWeekNumber(d: Date): number {
  const oneJan = new Date(d.getFullYear(), 0, 1);
  return Math.ceil(((d.getTime() - oneJan.getTime()) / 86400000 + oneJan.getDay() + 1) / 7);
}

function groupByPeriod(logs: TimeLogItem[], period: Period): ChartPoint[] {
  const buckets = new Map<string, { total: number; billable: number }>();

  for (const log of logs) {
    const d = new Date(log.payload.start);
    const seconds = log.payload.duration_seconds ?? 0;
    let key: string;

    switch (period) {
      case 'daily':
        key = d.toLocaleDateString([], { month: 'short', day: 'numeric' });
        break;
      case 'weekly':
        key = `W${getWeekNumber(d)} ${d.getFullYear()}`;
        break;
      case 'monthly':
        key = d.toLocaleDateString([], { month: 'short', year: '2-digit' });
        break;
    }

    const existing = buckets.get(key) ?? { total: 0, billable: 0 };
    existing.total += seconds;
    if (log.payload.billable) existing.billable += seconds;
    buckets.set(key, existing);
  }

  return Array.from(buckets.entries()).map(([label, v]) => ({
    label,
    totalHours: Math.round((v.total / 3600) * 100) / 100,
    billableHours: Math.round((v.billable / 3600) * 100) / 100,
  }));
}

function groupByProject(logs: TimeLogItem[]): ProjectBreakdown[] {
  const buckets = new Map<string, number>();

  for (const log of logs) {
    const name = log.payload.project || 'Unassigned';
    const seconds = log.payload.duration_seconds ?? 0;
    buckets.set(name, (buckets.get(name) ?? 0) + seconds);
  }

  return Array.from(buckets.entries())
    .map(([name, seconds], i) => ({
      name,
      hours: Math.round((seconds / 3600) * 100) / 100,
      color: PROJECT_COLORS[i % PROJECT_COLORS.length] ?? '#6366f1',
    }))
    .sort((a, b) => b.hours - a.hours);
}

// ── Component ─────────────────────────────────────────────────────────────────

interface TimeTrackerReportsProps {
  logs: TimeLogItem[];
}

export function TimeTrackerReports({ logs }: TimeTrackerReportsProps): React.ReactElement {
  const [period, setPeriod] = useState<Period>('daily');

  // Filter logs to recent range based on period
  const filteredLogs = useMemo(() => {
    const now = Date.now();
    const msInDay = 86400000;
    let cutoff: number;

    switch (period) {
      case 'daily':
        cutoff = now - 14 * msInDay; // Last 14 days
        break;
      case 'weekly':
        cutoff = now - 12 * 7 * msInDay; // Last 12 weeks
        break;
      case 'monthly':
        cutoff = now - 365 * msInDay; // Last 12 months
        break;
    }

    return logs.filter((l) => new Date(l.payload.start).getTime() >= cutoff);
  }, [logs, period]);

  const chartData = useMemo(() => groupByPeriod(filteredLogs, period), [filteredLogs, period]);
  const projectData = useMemo(() => groupByProject(filteredLogs), [filteredLogs]);

  // ── Summary stats ────────────────────────────────────────────────────────

  const stats = useMemo(() => {
    const totalSeconds = filteredLogs.reduce((s, l) => s + (l.payload.duration_seconds ?? 0), 0);
    const billableSeconds = filteredLogs
      .filter((l) => l.payload.billable)
      .reduce((s, l) => s + (l.payload.duration_seconds ?? 0), 0);
    const totalEarnings = filteredLogs
      .filter((l) => l.payload.billable && l.payload.hourly_rate_cents > 0)
      .reduce((s, l) => {
        const hours = (l.payload.duration_seconds ?? 0) / 3600;
        return s + hours * (l.payload.hourly_rate_cents / 100);
      }, 0);

    return {
      totalSeconds,
      billableSeconds,
      totalEarnings: Math.round(totalEarnings * 100) / 100,
      entryCount: filteredLogs.length,
    };
  }, [filteredLogs]);

  // ── Export CSV ────────────────────────────────────────────────────────────

  const exportCSV = useCallback(() => {
    const headers = ['Date', 'Start', 'End', 'Duration (h)', 'Description', 'Project', 'Billable', 'Rate ($/h)', 'Cost ($)'];
    const rows = filteredLogs.map((l) => {
      const p = l.payload;
      const hours = (p.duration_seconds ?? 0) / 3600;
      const rate = p.hourly_rate_cents / 100;
      const cost = p.billable ? (hours * rate).toFixed(2) : '0.00';
      return [
        new Date(p.start).toLocaleDateString(),
        new Date(p.start).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        p.end ? new Date(p.end).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '',
        hours.toFixed(2),
        `"${p.description.replace(/"/g, '""')}"`,
        `"${p.project.replace(/"/g, '""')}"`,
        p.billable ? 'Yes' : 'No',
        rate > 0 ? rate.toFixed(2) : '',
        cost,
      ].join(',');
    });

    const csv = [headers.join(','), ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `time-report-${period}-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }, [filteredLogs, period]);

  // ── Export PDF ────────────────────────────────────────────────────────────

  const exportPDF = useCallback(() => {
    const doc = new jsPDF();
    const pageWidth = doc.internal.pageSize.getWidth();

    // Title
    doc.setFontSize(16);
    doc.text('Time Tracking Report', 14, 20);
    doc.setFontSize(10);
    doc.text(`Period: ${period} | Generated: ${new Date().toLocaleDateString()}`, 14, 28);

    // Summary
    doc.setFontSize(12);
    doc.text('Summary', 14, 40);
    doc.setFontSize(10);
    doc.text(`Total time: ${formatDuration(stats.totalSeconds)}`, 14, 48);
    doc.text(`Billable time: ${formatDuration(stats.billableSeconds)}`, 14, 55);
    doc.text(`Total earnings: $${stats.totalEarnings.toFixed(2)}`, 14, 62);
    doc.text(`Entries: ${stats.entryCount}`, 14, 69);

    // Table header
    let y = 82;
    doc.setFontSize(8);
    doc.setFont('helvetica', 'bold');
    const cols = ['Date', 'Start', 'End', 'Hours', 'Description', 'Project', 'Billable', 'Cost'];
    const colWidths = [22, 16, 16, 14, 50, 32, 16, 18];
    let x = 14;
    for (let i = 0; i < cols.length; i++) {
      doc.text(cols[i] ?? '', x, y);
      x += colWidths[i] ?? 0;
    }
    doc.setFont('helvetica', 'normal');
    y += 6;

    // Table rows
    for (const l of filteredLogs) {
      if (y > 275) {
        doc.addPage();
        y = 20;
      }
      const p = l.payload;
      const hours = ((p.duration_seconds ?? 0) / 3600).toFixed(2);
      const rate = p.hourly_rate_cents / 100;
      const cost = p.billable ? ((p.duration_seconds ?? 0) / 3600 * rate).toFixed(2) : '—';
      const row = [
        new Date(p.start).toLocaleDateString(),
        new Date(p.start).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        p.end ? new Date(p.end).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—',
        hours,
        p.description.slice(0, 35),
        p.project.slice(0, 20),
        p.billable ? 'Yes' : 'No',
        `$${cost}`,
      ];
      x = 14;
      for (let i = 0; i < row.length; i++) {
        doc.text(row[i] ?? '', x, y);
        x += colWidths[i] ?? 0;
      }
      y += 5;
    }

    doc.save(`time-report-${period}-${new Date().toISOString().slice(0, 10)}.pdf`);
  }, [filteredLogs, period, stats]);

  // ── Custom tooltip for recharts ───────────────────────────────────────────

  const CustomTooltip = ({ active, payload, label }: any) => {
    if (!active || !payload?.length) return null;
    return (
      <div className="rounded-lg border border-border bg-popover px-3 py-2 text-xs shadow-md">
        <p className="mb-1 font-medium text-foreground">{label}</p>
        {payload.map((p: any) => (
          <p key={p.dataKey} style={{ color: p.fill }} className="text-muted-foreground">
            {p.name}: {p.value.toFixed(2)}h
          </p>
        ))}
      </div>
    );
  };

  return (
    <div className="flex flex-col gap-6">
      {/* ── Controls ───────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-1">
          {(['daily', 'weekly', 'monthly'] as const).map((p) => (
            <Button
              key={p}
              variant={period === p ? 'default' : 'outline'}
              size="sm"
              onClick={() => setPeriod(p)}
              className="h-8 text-xs capitalize"
            >
              {p}
            </Button>
          ))}
        </div>

        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={exportCSV} className="h-8 text-xs">
            <svg className="mr-1.5 h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="7 10 12 15 17 10" />
              <line x1="12" y1="15" x2="12" y2="3" />
            </svg>
            CSV
          </Button>
          <Button variant="outline" size="sm" onClick={exportPDF} className="h-8 text-xs">
            <svg className="mr-1.5 h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
              <polyline points="14 2 14 8 20 8" />
            </svg>
            PDF
          </Button>
        </div>
      </div>

      {/* ── Summary cards ──────────────────────────────────────────── */}
      <div className="grid grid-cols-4 gap-3">
        <StatCard label="Total Time" value={formatDuration(stats.totalSeconds)} />
        <StatCard label="Billable" value={formatDuration(stats.billableSeconds)} className="text-green-500" />
        <StatCard label="Earnings" value={`$${stats.totalEarnings.toFixed(2)}`} className="text-green-500" />
        <StatCard label="Entries" value={String(stats.entryCount)} />
      </div>

      {/* ── Hours bar chart ────────────────────────────────────────── */}
      <section className="rounded-lg border border-border bg-card p-4">
        <h3 className="mb-3 text-sm font-semibold text-foreground">Hours per {period === 'daily' ? 'Day' : period === 'weekly' ? 'Week' : 'Month'}</h3>
        {chartData.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">No data for this period</p>
        ) : (
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={chartData} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis
                dataKey="label"
                tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }}
                axisLine={{ stroke: 'hsl(var(--border))' }}
              />
              <YAxis
                tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }}
                axisLine={{ stroke: 'hsl(var(--border))' }}
                tickFormatter={(v: number) => `${v}h`}
              />
              <RechartsTooltip content={<CustomTooltip />} />
              <Bar dataKey="totalHours" name="Total" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
              <Bar dataKey="billableHours" name="Billable" fill="#22c55e" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </section>

      {/* ── Project breakdown ──────────────────────────────────────── */}
      <section className="rounded-lg border border-border bg-card p-4">
        <h3 className="mb-3 text-sm font-semibold text-foreground">By Project</h3>
        {projectData.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">No data</p>
        ) : (
          <div className="flex items-start gap-6">
            <ResponsiveContainer width={180} height={180}>
              <PieChart>
                <Pie
                  data={projectData}
                  dataKey="hours"
                  nameKey="name"
                  cx="50%"
                  cy="50%"
                  outerRadius={80}
                  innerRadius={40}
                  strokeWidth={2}
                  stroke="hsl(var(--card))"
                >
                  {projectData.map((entry, i) => (
                    <Cell key={entry.name} fill={entry.color} />
                  ))}
                </Pie>
              </PieChart>
            </ResponsiveContainer>

            <div className="flex flex-1 flex-col gap-1.5">
              {projectData.map((p) => (
                <div key={p.name} className="flex items-center gap-2 text-sm">
                  <div className="h-3 w-3 shrink-0 rounded-sm" style={{ background: p.color }} />
                  <span className="flex-1 truncate text-foreground">{p.name}</span>
                  <span className="font-mono text-xs text-muted-foreground">{p.hours.toFixed(1)}h</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

// ── StatCard ──────────────────────────────────────────────────────────────────

function StatCard({
  label,
  value,
  className,
}: {
  label: string;
  value: string;
  className?: string;
}): React.ReactElement {
  return (
    <div className="rounded-lg border border-border bg-card px-3 py-2.5">
      <p className="text-[11px] font-medium uppercase tracking-widest text-muted-foreground">
        {label}
      </p>
      <p className={`mt-0.5 font-mono text-lg font-semibold ${className ?? 'text-foreground'}`}>
        {value}
      </p>
    </div>
  );
}
