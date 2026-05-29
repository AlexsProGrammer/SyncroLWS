/**
 * useTimePredictor — Debounced historical time-log lookup hook.
 *
 * As the user types a description, this hook queries the local SQLite database
 * for entries with similar titles and returns ranked suggestions carrying the
 * historical average duration and population standard deviation per project.
 * All computation stays on-device (DSGVO compliant).
 */
import { useState, useEffect, useRef } from 'react';
import { getWorkspaceDB } from '@/core/db';
import { useWorkspaceStore } from '@/store/workspaceStore';

export interface PredictedEntry {
  /** Project extracted from historical [Project] bracket notation. */
  project: string;
  /** Mean duration (seconds) for matching entries in this project. */
  avgSeconds: number;
  /** Population standard deviation of duration — spread of estimates. */
  stdSeconds: number;
  /** How many historical entries matched the query. */
  matchCount: number;
  /** Most recently saved title for display context. */
  sampleTitle: string;
}

const parseFloat_ = (v: number | string | null): number =>
  v == null ? 0 : typeof v === 'number' ? v : parseFloat(v) || 0;

/** Minimum input length before queries fire. */
const MIN_CHARS = 2;
/** Debounce delay in milliseconds (targets <16 ms perceived UI lag). */
const DEBOUNCE_MS = 300;

export function useTimePredictor(inputVal: string): {
  suggestions: PredictedEntry[];
  loading: boolean;
} {
  const [suggestions, setSuggestions] = useState<PredictedEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const activeWorkspaceId = useWorkspaceStore((s) => s.activeWorkspaceId);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const trimmed = inputVal.trim();

    if (trimmed.length < MIN_CHARS || !activeWorkspaceId) {
      setSuggestions([]);
      return;
    }

    if (debounceRef.current) clearTimeout(debounceRef.current);

    debounceRef.current = setTimeout(async () => {
      setLoading(true);
      try {
        const db = getWorkspaceDB();
        const rows = await db.select<{
          project: string;
          avg_seconds: number | string | null;
          std_seconds: number | string | null;
          match_count: number | string | null;
          sample_title: string;
        }[]>(
          `SELECT
             COALESCE(NULLIF(TRIM(json_extract(ea.data, '$.project')), ''), '') AS project,
             AVG(CAST(json_extract(ea.data, '$.duration_seconds') AS REAL))     AS avg_seconds,
             SQRT(MAX(0,
               AVG(
                 CAST(json_extract(ea.data, '$.duration_seconds') AS REAL) *
                 CAST(json_extract(ea.data, '$.duration_seconds') AS REAL)
               ) -
               AVG(CAST(json_extract(ea.data, '$.duration_seconds') AS REAL)) *
               AVG(CAST(json_extract(ea.data, '$.duration_seconds') AS REAL))
             ))                                                                  AS std_seconds,
             COUNT(*)                                                            AS match_count,
             be.title                                                            AS sample_title
           FROM base_entities be
           JOIN entity_aspects ea ON ea.entity_id = be.id
           WHERE ea.aspect_type = 'time_log'
             AND be.deleted_at IS NULL
             AND ea.deleted_at IS NULL
             AND json_extract(ea.data, '$.duration_seconds') IS NOT NULL
             AND LOWER(be.title) LIKE LOWER(?)
           GROUP BY LOWER(COALESCE(NULLIF(TRIM(json_extract(ea.data, '$.project')), ''), ''))
           ORDER BY match_count DESC, avg_seconds DESC
           LIMIT 5`,
          [`%${trimmed}%`],
        );

        setSuggestions(
          rows.map((r) => ({
            project: r.project,
            avgSeconds: parseFloat_(r.avg_seconds),
            stdSeconds: parseFloat_(r.std_seconds),
            matchCount: parseFloat_(r.match_count),
            sampleTitle: r.sample_title,
          })),
        );
      } catch (err) {
        console.error('[useTimePredictor]', err);
        setSuggestions([]);
      } finally {
        setLoading(false);
      }
    }, DEBOUNCE_MS);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [inputVal, activeWorkspaceId]);

  return { suggestions, loading };
}
