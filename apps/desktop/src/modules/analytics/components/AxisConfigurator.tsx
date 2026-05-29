import React from 'react';
import { Input } from '@/ui/components/input';
import { Switch } from '@/ui/components/switch';

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

// ── AxisConfigurator ───────────────────────────────────────────────────────────────────

/**
 * Renders three column-selector strips (X, Y1-primary, Y2-secondary).
 * Each strip has an f(x) button that reveals a collapsible PreprocessPanel
 * for configuring regex token extraction and formula evaluation.
 * All state is lifted to the parent via `onChange`.
 */
export function AxisConfigurator({
  headers,
  value,
  onChange,
}: AxisConfiguratorProps): React.ReactElement {
  const [openPanel, setOpenPanel] = React.useState<'x' | 'y1' | 'y2' | null>(null);

  const set = <K extends keyof AxisConfig>(key: K, v: AxisConfig[K]) =>
    onChange({ ...value, [key]: v });

  const togglePanel = (panel: 'x' | 'y1' | 'y2') =>
    setOpenPanel((prev) => (prev === panel ? null : panel));

  const setPreprocess = (
    key: 'xPreprocess' | 'y1Preprocess' | 'y2Preprocess',
    cfg: PreprocessConfig,
  ) => set(key, cfg);

  const xCfg = value.xPreprocess ?? { ...DEFAULT_PREPROCESS_CONFIG };
  const y1Cfg = value.y1Preprocess ?? { ...DEFAULT_PREPROCESS_CONFIG };
  const y2Cfg = value.y2Preprocess ?? { ...DEFAULT_PREPROCESS_CONFIG };

  return (
    <div className="flex flex-col gap-2 px-6 py-3 border-b border-border bg-muted/30">
      <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">
        Axis Configuration
      </p>

      <div className="grid grid-cols-3 gap-3">
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
          </div>
          {openPanel === 'x' && (
            <PreprocessPanel
              config={xCfg}
              onChange={(cfg) => setPreprocess('xPreprocess', cfg)}
            />
          )}
        </div>

        {/* Y1 — Primary */}
        <div className="flex flex-col gap-1">
          <span className="text-xs font-medium text-foreground">Y1 — Primary</span>
          <div className="flex gap-1 items-center">
            <div className="flex-1 min-w-0">
              <ColSelect
                headers={headers}
                value={value.y1Col}
                onChange={(v) => set('y1Col', v)}
                placeholder="Select column…"
              />
            </div>
            <AggSelect value={value.y1Agg} onChange={(v) => set('y1Agg', v)} />
            <PreprocessButton
              active={y1Cfg.enabled}
              open={openPanel === 'y1'}
              onToggle={() => togglePanel('y1')}
            />
          </div>
          {openPanel === 'y1' && (
            <PreprocessPanel
              config={y1Cfg}
              onChange={(cfg) => setPreprocess('y1Preprocess', cfg)}
            />
          )}
        </div>

        {/* Y2 — Secondary (optional) */}
        <div className="flex flex-col gap-1">
          <span className="text-xs font-medium text-foreground">Y2 — Secondary</span>
          <div className="flex gap-1 items-center">
            <div className="flex-1 min-w-0">
              <ColSelect
                headers={headers}
                value={value.y2Col}
                onChange={(v) => set('y2Col', v)}
                placeholder="None"
              />
            </div>
            <AggSelect value={value.y2Agg} onChange={(v) => set('y2Agg', v)} />
            <PreprocessButton
              active={y2Cfg.enabled}
              open={openPanel === 'y2'}
              onToggle={() => togglePanel('y2')}
            />
          </div>
          {openPanel === 'y2' && (
            <PreprocessPanel
              config={y2Cfg}
              onChange={(cfg) => setPreprocess('y2Preprocess', cfg)}
            />
          )}
        </div>
      </div>
    </div>
  );
}
