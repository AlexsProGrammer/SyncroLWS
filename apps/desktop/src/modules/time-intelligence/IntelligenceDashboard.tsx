/**
 * IntelligenceDashboard — Premium Time Intelligence reporting container.
 *
 * Renders multi-scale statistical metrics computed natively from the local
 * SQLite workspace database. No data leaves the device (DSGVO compliant).
 */
import React, { useState, useEffect, useCallback } from 'react';
import {
  AreaChart,
  Area,
  BarChart,
  Bar,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  type TooltipProps,
} from 'recharts';
import { useWorkspaceStore } from '@/store/workspaceStore';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/ui/components/tabs';
import { Badge } from '@/ui/components/badge';
import { Button } from '@/ui/components/button';
import type { ToolViewProps } from '@/registry/ToolRegistry';
import {
  getTimeWindowStats,
  type TimeWindowStats,
} from './utils/metricsCalculator';
import { LiveRegexTerminal } from './components/LiveRegexTerminal';

// ── Helpers ───────────────────────────────────────────────────────────────────

function secsToHours(s: number): number {
  return Math.round((s / 3600) * 10) / 10;
}

function fmtH(s: number): string {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

function fmtDate(iso: string): string {
  return iso.slice(5); // MM-DD
}

function fmtPct(ratio: number): string {
  return `${Math.round(ratio * 100)}%`;
}

const BUCKET_LABELS: Record<string, string> = {
  'bucket:work': 'Work',
  'bucket:life': 'Life',
  'bucket:school_uni': 'School / Uni',
};

const BUCKET_COLORS: Record<string, string> = {
  'bucket:work': '#3b82f6',
  'bucket:life': '#10b981',
  'bucket:school_uni': '#a855f7',
};

// ── Sub-components ────────────────────────────────────────────────────────────

function MetricCard({
  label,
  value,
  sub,
  accent,
}: {
  label: string;
  value: string;
  sub?: string;
  accent?: string;
}): React.ReactElement {
  return (
    <div className="flex flex-col gap-1 rounded-xl border border-border bg-card p-4">
      <p className="text-[11px] font-medium uppercase tracking-widest text-muted-foreground">
        {label}
      </p>
      <p className={`text-2xl font-bold tabular-nums ${accent ?? 'text-foreground'}`}>
        {value}
      </p>
      {sub && <p className="text-xs text-muted-foreground">{sub}</p>}
    </div>
  );
}

function HoursTooltip({ active, payload, label }: TooltipProps<number, string>): React.ReactElement | null {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-border bg-popover px-3 py-2 text-xs shadow-md">
      <p className="mb-1 font-medium text-foreground">{label}</p>
      {payload.map((p) => (
        <p key={String(p.name)} style={{ color: p.color ?? '#888' }}>
          {p.name}: <strong>{fmtH(Number(p.value) * 3600)}</strong>
        </p>
      ))}
    </div>
  );
}

function IconRefresh({ className }: { className?: string }): React.ReactElement {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8" />
      <path d="M21 3v5h-5" />
    </svg>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export function IntelligenceDashboardView({ toolInstanceId: _ }: ToolViewProps): React.ReactElement {
  const [stats, setStats] = useState<TimeWindowStats | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const activeWorkspaceId = useWorkspaceStore((s) => s.activeWorkspaceId);

  const loadStats = useCallback(async () => {
    if (!activeWorkspaceId) return;
    setLoading(true);
    setError(null);
    try {
      const result = await getTimeWindowStats();
      setStats(result);
    } catch (err) {
      setError(String(err));
      console.error('[time-intelligence] failed to load stats:', err);
    } finally {
      setLoading(false);
    }
  }, [activeWorkspaceId]);

  useEffect(() => {
    void loadStats();
  }, [loadStats]);

  // ── Derived values ──────────────────────────────────────────────────────────

  const todayRow = stats?.dailyProfiles[0];
  const weekRow = stats?.weeklyVelocities[0];
  const monthRow = stats?.monthlyBounds[0];
  const topProject = stats?.projectTotals[0];

  const totalTrackedSecs = stats
    ? stats.projectTotals.reduce((s, p) => s + p.total_seconds, 0)
    : 0;
  const totalBillableSecs = stats
    ? stats.projectTotals.reduce((s, p) => s + p.billable_seconds, 0)
    : 0;
  const overallBillableRatio = totalTrackedSecs > 0
    ? totalBillableSecs / totalTrackedSecs
    : 0;

  // Daily trend – chronological order, capped at 30 days
  const dailyChartData = (stats?.dailyProfiles ?? [])
    .slice(0, 30)
    .reverse()
    .map((d) => ({
      day: fmtDate(d.day),
      'Total (h)': secsToHours(d.total_seconds),
      '30d Avg (h)': secsToHours(d.rolling_30d_avg_seconds),
    }));

  // Bucket distribution chart
  const bucketChartData = (stats?.bucketSummary ?? []).map((b) => ({
    name: BUCKET_LABELS[b.bucket] ?? b.bucket,
    Hours: secsToHours(b.total_seconds),
    _bucket: b.bucket,
  }));

  // Weekly velocity – last 12 weeks, chronological
  const weeklyChartData = (stats?.weeklyVelocities ?? [])
    .slice(0, 12)
    .reverse()
    .map((w) => ({
      week: w.week.slice(5),
      'Total (h)': secsToHours(w.total_seconds),
      '4w Avg (h)': secsToHours(w.rolling_4w_avg_seconds),
    }));

  const hasData = stats && stats.dailyProfiles.length > 0;

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-1 min-h-0 flex-col overflow-hidden">
      <Tabs defaultValue="overview" className="flex flex-1 min-h-0 flex-col overflow-hidden">
        {/* ── Tab bar ──────────────────────────────────────────────── */}
        <div className="flex items-center justify-between border-b border-border px-4 pt-3 pb-0 shrink-0">
          <TabsList className="h-9">
            <TabsTrigger value="overview" className="text-xs">Overview</TabsTrigger>
            <TabsTrigger value="projects" className="text-xs">Projects</TabsTrigger>
            <TabsTrigger value="patterns" className="text-xs">Patterns</TabsTrigger>
            <TabsTrigger value="regex" className="text-xs">Regex Lab</TabsTrigger>
          </TabsList>
          <div className="flex items-center gap-2 pr-1 pb-1">
            {stats && (
              <span className="text-[11px] text-muted-foreground">
                {stats.computedMs.toFixed(0)} ms
              </span>
            )}
            <Button
              size="sm"
              variant="ghost"
              onClick={() => void loadStats()}
              disabled={loading}
              className="h-7 w-7 p-0"
              title="Refresh metrics"
            >
              <IconRefresh className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
            </Button>
          </div>
        </div>

        {/* ── Overview ─────────────────────────────────────────────── */}
        <TabsContent
          value="overview"
          className="data-[state=active]:flex flex-1 min-h-0 flex-col overflow-auto p-4 gap-5"
        >
          {error && (
            <p className="rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
              {error}
            </p>
          )}

          {loading && !stats && (
            <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground animate-pulse">
              Computing metrics…
            </div>
          )}

          {!activeWorkspaceId && (
            <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
              Open a workspace to see time intelligence.
            </div>
          )}

          {stats && (
            <>
              {/* Metric cards */}
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <MetricCard
                  label="Today"
                  value={fmtH(todayRow?.total_seconds ?? 0)}
                  sub={`${fmtH(todayRow?.billable_seconds ?? 0)} billable`}
                />
                <MetricCard
                  label="This week"
                  value={fmtH(weekRow?.total_seconds ?? 0)}
                  sub={`4w avg ${fmtH(weekRow?.rolling_4w_avg_seconds ?? 0)}`}
                />
                <MetricCard
                  label="This month"
                  value={fmtH(monthRow?.total_seconds ?? 0)}
                  sub={`${monthRow?.entry_count ?? 0} entries`}
                />
                <MetricCard
                  label="Billable ratio"
                  value={fmtPct(overallBillableRatio)}
                  sub={topProject ? `Top: ${topProject.project}` : undefined}
                  accent="text-green-500"
                />
              </div>

              {/* Daily trend */}
              {dailyChartData.length > 0 && (
                <section>
                  <p className="mb-2 text-[11px] font-medium uppercase tracking-widest text-muted-foreground">
                    Daily Trend — last 30 days
                  </p>
                  <div className="rounded-xl border border-border bg-card p-3">
                    <ResponsiveContainer width="100%" height={180}>
                      <AreaChart data={dailyChartData} margin={{ top: 4, right: 4, left: -16, bottom: 0 }}>
                        <defs>
                          <linearGradient id="tiGradTotal" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#6366f1" stopOpacity={0.3} />
                            <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
                          </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                        <XAxis
                          dataKey="day"
                          tick={{ fontSize: 10 }}
                          tickLine={false}
                          axisLine={false}
                          interval="preserveStartEnd"
                        />
                        <YAxis
                          tick={{ fontSize: 10 }}
                          tickLine={false}
                          axisLine={false}
                          unit="h"
                          width={32}
                        />
                        <Tooltip content={HoursTooltip} />
                        <Area
                          type="monotone"
                          dataKey="Total (h)"
                          stroke="#6366f1"
                          fill="url(#tiGradTotal)"
                          strokeWidth={2}
                          dot={false}
                        />
                        <Area
                          type="monotone"
                          dataKey="30d Avg (h)"
                          stroke="#f97316"
                          fill="none"
                          strokeWidth={1.5}
                          strokeDasharray="4 2"
                          dot={false}
                        />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                </section>
              )}

              {/* Bucket distribution */}
              {bucketChartData.length > 0 && (
                <section>
                  <p className="mb-2 text-[11px] font-medium uppercase tracking-widest text-muted-foreground">
                    Life Bucket Distribution
                  </p>
                  <div className="rounded-xl border border-border bg-card p-3">
                    <ResponsiveContainer width="100%" height={140}>
                      <BarChart data={bucketChartData} margin={{ top: 4, right: 4, left: -16, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                        <XAxis dataKey="name" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
                        <YAxis tick={{ fontSize: 10 }} tickLine={false} axisLine={false} unit="h" width={32} />
                        <Tooltip content={HoursTooltip} />
                        <Bar dataKey="Hours" radius={[4, 4, 0, 0]}>
                          {bucketChartData.map((entry, i) => (
                            <Cell key={i} fill={BUCKET_COLORS[entry._bucket] ?? '#6366f1'} />
                          ))}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </section>
              )}

              {!hasData && (
                <div className="flex flex-1 items-center justify-center py-16 text-center text-sm text-muted-foreground">
                  No time log data yet.
                  <br />
                  Start tracking in the Time Tracker module.
                </div>
              )}
            </>
          )}
        </TabsContent>

        {/* ── Projects ─────────────────────────────────────────────── */}
        <TabsContent
          value="projects"
          className="data-[state=active]:flex flex-1 min-h-0 flex-col overflow-auto p-4 gap-4"
        >
          {stats && stats.projectTotals.length > 0 ? (
            <div>
              <p className="mb-2 text-[11px] font-medium uppercase tracking-widest text-muted-foreground">
                Project Breakdown — last 90 days
              </p>
              <div className="flex flex-col gap-2">
                {stats.projectTotals.map((p) => (
                  <div
                    key={p.project}
                    className="flex items-center gap-3 rounded-lg border border-border bg-card px-4 py-2.5"
                  >
                    <div className="flex-1 min-w-0">
                      <p className="truncate text-sm font-medium text-foreground">{p.project}</p>
                      <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-muted">
                        <div
                          className="h-full rounded-full bg-primary/70"
                          style={{
                            width: `${Math.min(
                              100,
                              (p.total_seconds / (stats.projectTotals[0]?.total_seconds ?? 1)) * 100,
                            )}%`,
                          }}
                        />
                      </div>
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="text-sm font-semibold tabular-nums text-foreground">
                        {fmtH(p.total_seconds)}
                      </p>
                      <div className="flex items-center justify-end gap-1.5">
                        {p.billable_seconds > 0 && (
                          <Badge
                            variant="outline"
                            className="h-4 border-green-500/30 px-1 text-[10px] text-green-500"
                          >
                            {fmtPct(p.billable_ratio)}
                          </Badge>
                        )}
                        {p.earned_cents > 0 && (
                          <span className="text-[11px] text-green-500">
                            ${(p.earned_cents / 100).toFixed(0)}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="flex flex-1 items-center justify-center py-16 text-center text-sm text-muted-foreground">
              {loading
                ? 'Computing…'
                : 'No project data. Tag time entries with [ProjectName] to track projects.'}
            </div>
          )}
        </TabsContent>

        {/* ── Patterns ─────────────────────────────────────────────── */}
        <TabsContent
          value="patterns"
          className="data-[state=active]:flex flex-1 min-h-0 flex-col overflow-auto p-4 gap-5"
        >
          {loading && !stats && (
            <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground animate-pulse">
              Computing…
            </div>
          )}

          {stats && (
            <>
              {weeklyChartData.length > 0 && (
                <section>
                  <p className="mb-2 text-[11px] font-medium uppercase tracking-widest text-muted-foreground">
                    Weekly Velocity — last 12 weeks
                  </p>
                  <div className="rounded-xl border border-border bg-card p-3">
                    <ResponsiveContainer width="100%" height={180}>
                      <BarChart data={weeklyChartData} margin={{ top: 4, right: 4, left: -16, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                        <XAxis dataKey="week" tick={{ fontSize: 10 }} tickLine={false} axisLine={false} />
                        <YAxis tick={{ fontSize: 10 }} tickLine={false} axisLine={false} unit="h" width={32} />
                        <Tooltip content={HoursTooltip} />
                        <Legend wrapperStyle={{ fontSize: 11 }} />
                        <Bar dataKey="Total (h)" fill="#6366f1" radius={[3, 3, 0, 0]} />
                        <Bar dataKey="4w Avg (h)" fill="#f97316" radius={[3, 3, 0, 0]} opacity={0.7} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </section>
              )}

              {stats.tagConcentration.length > 0 && (
                <section>
                  <p className="mb-2 text-[11px] font-medium uppercase tracking-widest text-muted-foreground">
                    Tag Concentration
                  </p>
                  <div className="flex flex-col gap-1.5">
                    {stats.tagConcentration.slice(0, 15).map((t) => (
                      <div
                        key={t.tag}
                        className="flex items-center gap-3 rounded-lg border border-border bg-card px-3 py-2"
                      >
                        <Badge variant="outline" className="shrink-0 px-1.5 font-mono text-[10px]">
                          #{t.tag}
                        </Badge>
                        <div className="flex-1 h-1.5 overflow-hidden rounded-full bg-muted">
                          <div
                            className="h-full rounded-full bg-primary/60"
                            style={{
                              width: `${Math.min(
                                100,
                                (t.total_seconds / (stats.tagConcentration[0]?.total_seconds ?? 1)) * 100,
                              )}%`,
                            }}
                          />
                        </div>
                        <span className="shrink-0 text-xs tabular-nums text-foreground">
                          {fmtH(t.total_seconds)}
                        </span>
                        <span className="shrink-0 text-[11px] text-muted-foreground">{t.count}×</span>
                      </div>
                    ))}
                  </div>
                </section>
              )}

              {weeklyChartData.length === 0 && stats.tagConcentration.length === 0 && (
                <div className="flex flex-1 items-center justify-center py-16 text-center text-sm text-muted-foreground">
                  No pattern data yet.
                </div>
              )}
            </>
          )}
        </TabsContent>

        {/* ── Regex Lab ────────────────────────────────────────────── */}
        <TabsContent
          value="regex"
          className="data-[state=active]:flex flex-1 min-h-0 flex-col overflow-auto p-4"
        >
          <LiveRegexTerminal />
        </TabsContent>
      </Tabs>
    </div>
  );
}
