import React from 'react';

// ── Types ──────────────────────────────────────────────────────────────────────

export type AggFn = 'AVG' | 'SUM' | 'COUNT';

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
  y1Col: number | null;
  y1Agg: AggFn;
  y2Col: number | null;
  y2Agg: AggFn;
  xPreprocess?: PreprocessConfig;
  y1Preprocess?: PreprocessConfig;
  y2Preprocess?: PreprocessConfig;
}

export const DEFAULT_AXIS_CONFIG: AxisConfig = {
  xCol: null,
  y1Col: null,
  y1Agg: 'AVG',
  y2Col: null,
  y2Agg: 'SUM',
  xPreprocess: { ...DEFAULT_PREPROCESS_CONFIG },
  y1Preprocess: { ...DEFAULT_PREPROCESS_CONFIG },
  y2Preprocess: { ...DEFAULT_PREPROCESS_CONFIG },
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

// ── AxisConfigurator ───────────────────────────────────────────────────────────

/**
 * Renders three column-selector strips (X, Y1-primary, Y2-secondary).
 * Each Y strip pairs a column dropdown with an aggregation function selector.
 * All selections are lifted to the parent via `onChange`.
 */
export function AxisConfigurator({
  headers,
  value,
  onChange,
}: AxisConfiguratorProps): React.ReactElement {
  const set = <K extends keyof AxisConfig>(key: K, v: AxisConfig[K]) =>
    onChange({ ...value, [key]: v });

  return (
    <div className="flex flex-col gap-2 px-6 py-3 border-b border-border bg-muted/30">
      <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">
        Axis Configuration
      </p>

      <div className="grid grid-cols-3 gap-3">
        {/* X Axis */}
        <div className="flex flex-col gap-1">
          <span className="text-xs font-medium text-foreground">X Axis</span>
          <ColSelect
            headers={headers}
            value={value.xCol}
            onChange={(v) => set('xCol', v)}
            placeholder="Select column…"
          />
        </div>

        {/* Y1 — Primary */}
        <div className="flex flex-col gap-1">
          <span className="text-xs font-medium text-foreground">Y1 — Primary</span>
          <div className="flex gap-1">
            <div className="flex-1 min-w-0">
              <ColSelect
                headers={headers}
                value={value.y1Col}
                onChange={(v) => set('y1Col', v)}
                placeholder="Select column…"
              />
            </div>
            <AggSelect value={value.y1Agg} onChange={(v) => set('y1Agg', v)} />
          </div>
        </div>

        {/* Y2 — Secondary (optional) */}
        <div className="flex flex-col gap-1">
          <span className="text-xs font-medium text-foreground">Y2 — Secondary</span>
          <div className="flex gap-1">
            <div className="flex-1 min-w-0">
              <ColSelect
                headers={headers}
                value={value.y2Col}
                onChange={(v) => set('y2Col', v)}
                placeholder="None"
              />
            </div>
            <AggSelect value={value.y2Agg} onChange={(v) => set('y2Agg', v)} />
          </div>
        </div>
      </div>
    </div>
  );
}
