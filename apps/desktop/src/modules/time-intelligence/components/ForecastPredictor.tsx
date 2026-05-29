/**
 * ForecastPredictor — Predictive text input controller.
 *
 * Drop-in replacement for a description <input>. While the user types it
 * queries historical time-log entries for semantic matches and surfaces ranked
 * suggestions below the field — each showing the historical project, a sample
 * title, the average tracked duration, and the spread (±σ).
 *
 * Clicking a suggestion fires `onAccept` and lets the parent react (e.g. by
 * prepending [ProjectName] to the current text). The input itself is never
 * auto-replaced so the user retains full control.
 */
import React from 'react';
import { Input } from '@/ui/components/input';
import { Badge } from '@/ui/components/badge';
import { useTimePredictor } from '../hooks/useTimePredictor';

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtApprox(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h === 0) return `~${m}m`;
  if (m === 0) return `~${h}h`;
  return `~${h}h ${m}m`;
}

// ── Component ─────────────────────────────────────────────────────────────────

export interface ForecastPredictorProps {
  value: string;
  onChange: (val: string) => void;
  /** Called when the user clicks a suggestion row. */
  onAccept?: (project: string, estimatedSeconds: number) => void;
  onKeyDown?: React.KeyboardEventHandler<HTMLInputElement>;
  disabled?: boolean;
  placeholder?: string;
  className?: string;
}

export function ForecastPredictor({
  value,
  onChange,
  onAccept,
  onKeyDown,
  disabled = false,
  placeholder = 'What are you working on?',
  className,
}: ForecastPredictorProps): React.ReactElement {
  // Suppress the hook while tracking is active to avoid unnecessary DB reads.
  const { suggestions, loading } = useTimePredictor(disabled ? '' : value);

  return (
    <div className="flex flex-col gap-1.5">
      <div className="relative">
        <Input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={onKeyDown}
          disabled={disabled}
          placeholder={placeholder}
          className={className}
        />
        {loading && (
          <span className="absolute right-2.5 top-1/2 -translate-y-1/2 animate-pulse text-[10px] text-muted-foreground">
            …
          </span>
        )}
      </div>

      {!disabled && suggestions.length > 0 && (
        <div className="flex flex-col gap-1" role="listbox" aria-label="History suggestions">
          {suggestions.map((s, i) => (
            <button
              key={`${s.project}-${i}`}
              type="button"
              role="option"
              aria-selected={false}
              onClick={() => onAccept?.(s.project, s.avgSeconds)}
              className="flex items-center gap-2 rounded-lg border border-border bg-muted/40 px-3 py-1.5 text-left text-xs transition-colors hover:bg-accent hover:text-accent-foreground"
            >
              {s.project && (
                <Badge variant="outline" className="h-4 shrink-0 px-1.5 font-mono text-[10px]">
                  {s.project}
                </Badge>
              )}
              <span className="flex-1 truncate text-muted-foreground">{s.sampleTitle}</span>
              <span className="shrink-0 font-semibold tabular-nums text-foreground">
                {fmtApprox(s.avgSeconds)}
              </span>
              {/* Only show spread if it's meaningfully large (>5 min) */}
              {s.stdSeconds > 300 && (
                <span className="shrink-0 text-[10px] text-muted-foreground">
                  ±{fmtApprox(s.stdSeconds)}
                </span>
              )}
              <span className="shrink-0 text-[10px] text-muted-foreground">{s.matchCount}×</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
