import React from 'react';
import { Input } from '@/ui/components/input';
import { CategoryMapping } from './AxisConfigurator';

// ── Types ──────────────────────────────────────────────────────────────────────

interface CategoryMappingEditorProps {
  /** Display label shown as the panel header (e.g. the selected column name). */
  header: string;
  /** Current key→weight dictionary maintained by the parent. */
  value: CategoryMapping;
  /** Fired on every change so the parent can lift state immediately. */
  onChange: (mapping: CategoryMapping) => void;
}

/** An internal draft row so the user can type freely before the key is committed. */
interface DraftRow {
  id: number;
  key: string;
  weight: string; // kept as string while typing so "1." stays intact
}

// ── Helpers ────────────────────────────────────────────────────────────────────

/** Convert the external CategoryMapping into editable draft rows. */
function toDraftRows(mapping: CategoryMapping): DraftRow[] {
  return Object.entries(mapping).map(([key, weight], idx) => ({
    id: idx,
    key,
    weight: String(weight),
  }));
}

/** Collapse draft rows back into a CategoryMapping, skipping blanks. */
function toMapping(rows: DraftRow[]): CategoryMapping {
  const result: CategoryMapping = {};
  for (const row of rows) {
    const trimmedKey = row.key.trim();
    const parsed = parseFloat(row.weight);
    if (trimmedKey !== '' && !Number.isNaN(parsed)) {
      result[trimmedKey] = parsed;
    }
  }
  return result;
}

let _nextId = 1;
function nextId() { return _nextId++; }

// ── Shared style tokens ────────────────────────────────────────────────────────

const INPUT_CLS = 'h-7 text-xs font-mono px-2';

// ── Component ──────────────────────────────────────────────────────────────────

/**
 * Inline dictionary editor that maps discrete string category codes
 * (e.g. "H", "W") to numeric weights (e.g. 1.0, 0.0).
 *
 * State is fully controlled: every keystroke fires `onChange` with the
 * current collapsed mapping so the parent (AxisConfigurator) always holds
 * the canonical value.
 *
 * All data remains in local React state — no network calls (DSGVO compliant).
 */
export function CategoryMappingEditor({
  header,
  value,
  onChange,
}: CategoryMappingEditorProps): React.ReactElement {
  const [rows, setRows] = React.useState<DraftRow[]>(() => toDraftRows(value));

  // Keep local draft rows in sync if the parent resets the value externally
  // (e.g. when the user switches columns).
  const prevValueRef = React.useRef(value);
  React.useEffect(() => {
    if (prevValueRef.current !== value) {
      prevValueRef.current = value;
      setRows(toDraftRows(value));
    }
  }, [value]);

  // Commit rows → mapping and bubble up to parent on every change.
  const commit = (nextRows: DraftRow[]) => {
    setRows(nextRows);
    onChange(toMapping(nextRows));
  };

  const handleKeyChange = (id: number, newKey: string) => {
    commit(rows.map((r) => (r.id === id ? { ...r, key: newKey } : r)));
  };

  const handleWeightChange = (id: number, raw: string) => {
    commit(rows.map((r) => (r.id === id ? { ...r, weight: raw } : r)));
  };

  const handleRemove = (id: number) => {
    commit(rows.filter((r) => r.id !== id));
  };

  const handleAdd = () => {
    commit([...rows, { id: nextId(), key: '', weight: '' }]);
  };

  return (
    <div className="mt-1.5 rounded-md border border-border bg-background p-2.5 flex flex-col gap-2 shadow-sm">
      {/* Header */}
      <span className="text-[11px] font-medium text-foreground">
        Category encoder — <span className="text-primary">{header}</span>
      </span>

      {/* Entry list */}
      {rows.length > 0 && (
        <div className="flex flex-col gap-1">
          {/* Column labels */}
          <div className="flex gap-1 items-center">
            <span className="flex-1 text-[10px] text-muted-foreground">String key</span>
            <span className="w-20 text-[10px] text-muted-foreground">Numeric weight</span>
            {/* spacer for remove button */}
            <span className="w-6" />
          </div>

          {rows.map((row) => (
            <div key={row.id} className="flex gap-1 items-center">
              {/* String key input */}
              <div className="flex-1 min-w-0">
                <Input
                  className={INPUT_CLS}
                  value={row.key}
                  onChange={(e) => handleKeyChange(row.id, e.target.value)}
                  placeholder="H"
                  spellCheck={false}
                />
              </div>

              {/* Numeric weight input */}
              <div className="w-20 shrink-0">
                <Input
                  className={INPUT_CLS}
                  type="number"
                  step="any"
                  value={row.weight}
                  onChange={(e) => handleWeightChange(row.id, e.target.value)}
                  placeholder="1.0"
                />
              </div>

              {/* Remove button */}
              <button
                type="button"
                onClick={() => handleRemove(row.id)}
                title="Remove mapping entry"
                className={
                  'shrink-0 flex items-center justify-center w-6 h-6 rounded border ' +
                  'border-border bg-muted/50 text-muted-foreground transition-colors ' +
                  'hover:text-destructive hover:border-destructive/60 hover:bg-destructive/10 ' +
                  'focus:outline-none focus:ring-1 focus:ring-ring'
                }
              >
                <svg
                  viewBox="0 0 16 16"
                  className="w-3 h-3"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={2}
                >
                  <path d="M4 4l8 8M12 4l-8 8" strokeLinecap="round" />
                </svg>
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Add entry button */}
      <button
        type="button"
        onClick={handleAdd}
        className={
          'flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground ' +
          'hover:text-foreground border border-dashed border-border rounded px-2 py-1.5 ' +
          'transition-colors hover:bg-muted/50 focus:outline-none focus:ring-1 focus:ring-ring'
        }
      >
        <svg
          viewBox="0 0 16 16"
          className="w-3 h-3"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path d="M8 2v12M2 8h12" strokeLinecap="round" />
        </svg>
        Add Dynamic Key Value Pair
      </button>
    </div>
  );
}
