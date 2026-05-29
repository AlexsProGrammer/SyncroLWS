import React from 'react';
import { Input } from '@/ui/components/input';
import { Switch } from '@/ui/components/switch';

// ── Types ──────────────────────────────────────────────────────────────────────

export type AggFn = 'AVG' | 'SUM' | 'COUNT';

export type CategoryMapping = Record<string, number>;

export interface YSeriesItem {
  colId: number | null;
  agg: AggFn;
  drawType: 'line' | 'bar' | 'area';
  fillHex: string;
  preprocess?: PreprocessConfig;
  mode: 'numeric' | 'categorical';
  mappingRules: CategoryMapping;
}

export interface PreprocessConfig {
  enabled: boolean;
  regexPattern: string;      // e.g. "(?<hour>\\d+)h\\s*(?<minutes>\\d+)min"
  formulaExpression: string; // e.g. "hour + (minutes / 60)"
}

const DEFAULT_PREPROCESS_CONFIG: PreprocessConfig = {
  enabled: false,
  regexPattern: '',
  formulaExpression: '',
};

export interface AxisConfig {
  xCol: number | null;
  ySeries: YSeriesItem[];
  xPreprocess?: PreprocessConfig;
  /** Date/time format string for chronological X-axis sorting (e.g. "DD.MM.YY").
   *  Tokens: DD MM YY YYYY HH mm SS. Leave empty for lexicographic sort. */
  xTimestampFormat?: string;
}

export const DEFAULT_AXIS_CONFIG: AxisConfig = {
  xCol: null,
  ySeries: [],
  xPreprocess: { ...DEFAULT_PREPROCESS_CONFIG },
  xTimestampFormat: '',
};

interface AxisConfiguratorProps {
  headers: string[];
  value: AxisConfig;
  onChange: (cfg: AxisConfig) => void;
}

// ── Internal sub-components ────────────────────────────────────────────────────

const SELECT_CLS =
  'appearance-none text-xs bg-muted border border-border rounded px-2 py-1.5 pr-6 ' +
  'text-foreground focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-50 cursor-pointer';

function ChevronDown(): React.ReactElement {
  return (
    <svg
      className="pointer-events-none absolute right-1.5 top-1/2 -translate-y-1/2 w-3 h-3 text-muted-foreground"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
    >
      <path d="M4 6l4 4 4-4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

const AGG_OPTIONS: AggFn[] = ['AVG', 'SUM', 'COUNT'];

function ColSelect({
  headers,
  value,
  onChange,
  placeholder,
}: {
  headers: string[];
  value: number | null;
  onChange: (v: number | null) => void;
  placeholder: string;
}): React.ReactElement {
  return (
    <div className="relative w-full">
      <select
        className={`w-full ${SELECT_CLS}`}
        value={value ?? ''}
        onChange={(e) => {
          const v = e.target.value;
          onChange(v === '' ? null : Number(v));
        }}
      >
        <option value="">{placeholder}</option>
        {headers.map((h, i) => (
          <option key={i} value={i}>
            {h}
          </option>
        ))}
      </select>
      <ChevronDown />
    </div>
  );
}

function AggSelect({
  value,
  onChange,
}: {
  value: AggFn;
  onChange: (v: AggFn) => void;
}): React.ReactElement {
  return (
    <div className="relative">
      <select
        className={SELECT_CLS}
        value={value}
        onChange={(e) => onChange(e.target.value as AggFn)}
      >
        {AGG_OPTIONS.map((fn) => (
          <option key={fn} value={fn}>
            {fn}
          </option>
        ))}
      </select>
      <ChevronDown />
    </div>
  );
}

// ── PreprocessPanel ──────────────────────────────────────────────────────────────────

function PreprocessPanel({
  config,
  onChange,
}: {
  config: PreprocessConfig;
  onChange: (cfg: PreprocessConfig) => void;
}): React.ReactElement {
  return (
    <div className="mt-1.5 rounded-md border border-border bg-background p-2.5 flex flex-col gap-2 shadow-sm">
      {/* Enable toggle */}
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] font-medium text-foreground">Enable preprocessing</span>
        <Switch
          checked={config.enabled}
          onCheckedChange={(v) => onChange({ ...config, enabled: v })}
        />
      </div>

      {config.enabled && (
        <>
          {/* Regex pattern */}
          <div className="flex flex-col gap-0.5">
            <span className="text-[10px] text-muted-foreground">
              Regex pattern — named groups become formula variables
            </span>
            <Input
              className="h-7 text-xs font-mono px-2"
              value={config.regexPattern}
              onChange={(e) => onChange({ ...config, regexPattern: e.target.value })}
              placeholder="(?<hour>\\d+)h\\s*(?<minutes>\\d+)min"
              spellCheck={false}
            />
          </div>

          {/* Formula expression */}
          <div className="flex flex-col gap-0.5">
            <span className="text-[10px] text-muted-foreground">
              Formula expression — use captured group names, e.g. hour + (minutes / 60)
            </span>
            <Input
              className="h-7 text-xs font-mono px-2"
              value={config.formulaExpression}
              onChange={(e) => onChange({ ...config, formulaExpression: e.target.value })}
              placeholder="hour + (minutes / 60)"
              spellCheck={false}
            />
          </div>
        </>
      )}
    </div>
  );
}

// ── PreprocessButton ──────────────────────────────────────────────────────────────

function PreprocessButton({
  active,
  open,
  onToggle,
}: {
  active: boolean;
  open: boolean;
  onToggle: () => void;
}): React.ReactElement {
  return (
    <button
      type="button"
      onClick={onToggle}
      title="Configure data preprocessing"
      className={[
        'shrink-0 text-[10px] font-medium px-1.5 py-0.5 rounded border transition-colors',
        'focus:outline-none focus:ring-1 focus:ring-ring',
        active
          ? 'border-primary/60 bg-primary/10 text-primary'
          : open
          ? 'border-border bg-muted text-foreground'
          : 'border-border bg-muted/50 text-muted-foreground hover:text-foreground hover:bg-muted',
      ].join(' ')}
    >
      f(x)
    </button>
  );
}

// ── DateSortPanel ─────────────────────────────────────────────────────────────────────

function DateSortPanel({
  format,
  onChange,
}: {
  format: string;
  onChange: (fmt: string) => void;
}): React.ReactElement {
  return (
    <div className="mt-1.5 rounded-md border border-border bg-background p-2.5 flex flex-col gap-2 shadow-sm">
      <div className="flex flex-col gap-0.5">
        <span className="text-[11px] font-medium text-foreground">Date / timestamp format</span>
        <span className="text-[10px] text-muted-foreground">
          Tokens: DD · MM · YY / YYYY · HH · mm · SS
        </span>
        <Input
          className="h-7 text-xs font-mono px-2"
          value={format}
          onChange={(e) => onChange(e.target.value)}
          placeholder="DD.MM.YY"
          spellCheck={false}
        />
        <span className="text-[10px] text-muted-foreground mt-0.5">
          e.g. DD.MM.YY · MM/DD/YYYY · YYYY-MM-DD · DD.MM.YYYY HH:mm:SS
        </span>
      </div>
      {format && (
        <p className="text-[10px] text-muted-foreground border-t border-border pt-1.5">
          X values are parsed and sorted chronologically. Clear to sort alphabetically.
        </p>
      )}
    </div>
  );
}

function DateSortButton({
  active,
  open,
  onToggle,
}: {
  active: boolean;
  open: boolean;
  onToggle: () => void;
}): React.ReactElement {
  return (
    <button
      type="button"
      onClick={onToggle}
      title="Configure date / time axis sorting"
      className={[
        'shrink-0 text-[10px] font-medium px-1.5 py-0.5 rounded border transition-colors',
        'focus:outline-none focus:ring-1 focus:ring-ring',
        active
          ? 'border-primary/60 bg-primary/10 text-primary'
          : open
          ? 'border-border bg-muted text-foreground'
          : 'border-border bg-muted/50 text-muted-foreground hover:text-foreground hover:bg-muted',
      ].join(' ')}
    >
      date
    </button>
  );
}

// ── DrawTypeSelect ────────────────────────────────────────────────────────────────────

const DRAW_OPTIONS: Array<{ value: YSeriesItem['drawType']; label: string }> = [
  { value: 'bar',  label: 'Bar'  },
  { value: 'line', label: 'Line' },
  { value: 'area', label: 'Area' },
];

function DrawTypeSelect({
  value,
  onChange,
}: {
  value: YSeriesItem['drawType'];
  onChange: (v: YSeriesItem['drawType']) => void;
}): React.ReactElement {
  return (
    <div className="relative">
      <select
        className={SELECT_CLS}
        value={value}
        onChange={(e) => onChange(e.target.value as YSeriesItem['drawType'])}
      >
        {DRAW_OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <ChevronDown />
    </div>
  );
}

// ── AxisConfigurator ───────────────────────────────────────────────────────────────────

/**
 * Renders an X-axis column selector (with preprocessing and date-sort options)
 * followed by a dynamic list of Y series rows. Each row exposes a column
 * picker, aggregation selector, draw-type selector, colour picker, and a
 * remove button. An "Add Series Metric" button appends new rows.
 * All state is lifted to the parent via `onChange`.
 */
export function AxisConfigurator({
  headers,
  value,
  onChange,
}: AxisConfiguratorProps): React.ReactElement {
  const [openPanel, setOpenPanel] = React.useState<string | null>(null);

  const set = <K extends keyof AxisConfig>(key: K, v: AxisConfig[K]) =>
    onChange({ ...value, [key]: v });

  const togglePanel = (panel: string) =>
    setOpenPanel((prev) => (prev === panel ? null : panel));

  const xCfg = value.xPreprocess ?? { ...DEFAULT_PREPROCESS_CONFIG };

  const updateSeries = (i: number, patch: Partial<YSeriesItem>) => {
    set('ySeries', value.ySeries.map((s, idx) => (idx === i ? { ...s, ...patch } : s)));
  };

  const removeSeries = (i: number) => {
    set('ySeries', value.ySeries.filter((_, idx) => idx !== i));
  };

  const addSeries = () => {
    set('ySeries', [
      ...value.ySeries,
      { colId: null, agg: 'AVG', drawType: 'bar', fillHex: '#6366f1', preprocess: { ...DEFAULT_PREPROCESS_CONFIG }, mode: 'numeric', mappingRules: {} },
    ]);
  };

  return (
    <div className="flex flex-col gap-2 px-6 py-3 border-b border-border bg-muted/30">
      <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">
        Axis Configuration
      </p>

      {/* X Axis */}
      <div className="flex flex-col gap-1">
        <span className="text-xs font-medium text-foreground">X Axis</span>
        <div className="flex gap-1 items-center">
          <div className="flex-1 min-w-0">
            <ColSelect
              headers={headers}
              value={value.xCol}
              onChange={(v) => set('xCol', v)}
              placeholder="Select column…"
            />
          </div>
          <PreprocessButton
            active={xCfg.enabled}
            open={openPanel === 'x'}
            onToggle={() => togglePanel('x')}
          />
          <DateSortButton
            active={!!(value.xTimestampFormat)}
            open={openPanel === 'xdate'}
            onToggle={() => togglePanel('xdate')}
          />
        </div>
        {openPanel === 'x' && (
          <PreprocessPanel
            config={xCfg}
            onChange={(cfg) => set('xPreprocess', cfg)}
          />
        )}
        {openPanel === 'xdate' && (
          <DateSortPanel
            format={value.xTimestampFormat ?? ''}
            onChange={(fmt) => set('xTimestampFormat', fmt)}
          />
        )}
      </div>

      {/* Y Series */}
      <div className="flex flex-col gap-1.5">
        <span className="text-xs font-medium text-foreground">Y Series</span>

        {/* Step 3.2 — dynamic list mapped over value.ySeries */}
        {value.ySeries.map((s, i) => (
          <div key={i} className="flex flex-col gap-0.5">
            {/* Step 3.3 — one row per series */}
            <div className="flex gap-1 items-center">
              {/* Column picker */}
              <div className="flex-1 min-w-0">
                <ColSelect
                  headers={headers}
                  value={s.colId}
                  onChange={(v) => updateSeries(i, { colId: v })}
                  placeholder="Select column…"
                />
              </div>

              {/* Draw-type selector */}
              <DrawTypeSelect
                value={s.drawType}
                onChange={(v) => updateSeries(i, { drawType: v })}
              />

              {/* Preprocessing toggle */}
              <PreprocessButton
                active={!!(s.preprocess?.enabled)}
                open={openPanel === `y-${i}`}
                onToggle={() => togglePanel(`y-${i}`)}
              />

              {/* Hex colour picker */}
              <div className="shrink-0 rounded border border-border overflow-hidden">
                <input
                  type="color"
                  value={s.fillHex}
                  onChange={(e) => updateSeries(i, { fillHex: e.target.value })}
                  className="block w-7 h-[26px] cursor-pointer bg-transparent p-0.5"
                  title="Series colour"
                />
              </div>

              {/* Remove button */}
              <button
                type="button"
                onClick={() => removeSeries(i)}
                title="Remove series"
                className={
                  'shrink-0 flex items-center justify-center w-6 h-6 rounded border ' +
                  'border-border bg-muted/50 text-muted-foreground transition-colors ' +
                  'hover:text-destructive hover:border-destructive/60 hover:bg-destructive/10 ' +
                  'focus:outline-none focus:ring-1 focus:ring-ring'
                }
              >
                <svg viewBox="0 0 16 16" className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth={2}>
                  <path d="M4 4l8 8M12 4l-8 8" strokeLinecap="round" />
                </svg>
              </button>
            </div>

            {/* Preprocess panel for this Y series */}
            {openPanel === `y-${i}` && (
              <PreprocessPanel
                config={s.preprocess ?? { enabled: false, regexPattern: '', formulaExpression: '' }}
                onChange={(cfg) => updateSeries(i, { preprocess: cfg })}
              />
            )}
          </div>
        ))}

        {/* Step 3.4 — Add Series Metric button */}
        <button
          type="button"
          onClick={addSeries}
          className={
            'mt-0.5 flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground ' +
            'hover:text-foreground border border-dashed border-border rounded px-2 py-1.5 ' +
            'transition-colors hover:bg-muted/50 focus:outline-none focus:ring-1 focus:ring-ring'
          }
        >
          <svg viewBox="0 0 16 16" className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth={2}>
            <path d="M8 2v12M2 8h12" strokeLinecap="round" />
          </svg>
          Add Series Metric
        </button>
      </div>
    </div>
  );
}
