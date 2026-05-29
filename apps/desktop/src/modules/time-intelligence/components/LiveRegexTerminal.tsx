/**
 * LiveRegexTerminal — Interactive regex pattern tester for time-log classification rules.
 *
 * Lets users define custom regex criteria and immediately see which life-bucket
 * each sample text maps to. All data stays local (DSGVO compliant).
 */
import React, { useState, useCallback, useMemo } from 'react';
import { Input } from '@/ui/components/input';
import { Button } from '@/ui/components/button';
import { Badge } from '@/ui/components/badge';
import {
  parseTimeLogDescription,
  setSchoolKeywords,
  setWorkKeywords,
  SCHOOL_KEYWORDS,
  WORK_KEYWORDS,
  type LifeBucket,
} from '../utils/logParser';

// ── Helpers ───────────────────────────────────────────────────────────────────

const BUCKET_COLORS: Record<LifeBucket, string> = {
  work: 'bg-blue-500/15 text-blue-600 border-blue-500/30',
  school_uni: 'bg-purple-500/15 text-purple-600 border-purple-500/30',
  life: 'bg-emerald-500/15 text-emerald-600 border-emerald-500/30',
};

const DEFAULT_SAMPLES: string[] = [
  '[CompanyAlpha] Implemented api schema #refactor',
  'Lecture on distributed systems #uni-exam',
  'Morning run and meditation',
  '[ClientBeta] Code review sprint planning #meeting',
  'Study session: Advanced algorithms #assignment',
];

// ── Sub-components ────────────────────────────────────────────────────────────

interface SampleResultRowProps {
  sample: string;
}

function SampleResultRow({ sample }: SampleResultRowProps): React.ReactElement {
  const result = useMemo(() => parseTimeLogDescription(sample), [sample]);

  return (
    <div className="flex items-start gap-3 rounded-lg border border-border bg-card px-3 py-2.5 text-sm">
      <div className="flex-1 min-w-0">
        <p className="font-mono text-xs text-foreground truncate">{sample}</p>
        <div className="mt-1 flex flex-wrap items-center gap-1.5">
          {result.project && (
            <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
              <span className="font-medium">project:</span>
              <code className="rounded bg-muted px-1 text-foreground">{result.project}</code>
            </span>
          )}
          {result.cleanText && (
            <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
              <span className="font-medium">text:</span>
              <code className="rounded bg-muted px-1 text-foreground">{result.cleanText}</code>
            </span>
          )}
        </div>
        <div className="mt-1.5 flex flex-wrap gap-1">
          {result.tags.map((tag) => (
            <Badge
              key={tag}
              variant="outline"
              className={`text-[10px] px-1.5 py-0 h-4 ${tag.startsWith('bucket:') ? BUCKET_COLORS[result.bucket] : ''}`}
            >
              {tag}
            </Badge>
          ))}
        </div>
      </div>
      <div className={`shrink-0 rounded-md border px-2 py-1 text-[11px] font-semibold ${BUCKET_COLORS[result.bucket]}`}>
        {result.bucket}
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export function LiveRegexTerminal(): React.ReactElement {
  const [samples, setSamples] = useState<string[]>(DEFAULT_SAMPLES);
  const [newSample, setNewSample] = useState('');

  // Keyword editor state (comma-separated strings for user-friendly editing)
  const [schoolInput, setSchoolInput] = useState(SCHOOL_KEYWORDS.join(', '));
  const [workInput, setWorkInput] = useState(WORK_KEYWORDS.join(', '));
  const [keywordsApplied, setKeywordsApplied] = useState(false);

  const addSample = useCallback(() => {
    const trimmed = newSample.trim();
    if (!trimmed) return;
    setSamples((prev) => [trimmed, ...prev]);
    setNewSample('');
  }, [newSample]);

  const removeSample = useCallback((index: number) => {
    setSamples((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const applyKeywords = useCallback(() => {
    const parseList = (s: string): string[] =>
      s.split(',').map((kw) => kw.trim().toLowerCase()).filter(Boolean);
    setSchoolKeywords(parseList(schoolInput));
    setWorkKeywords(parseList(workInput));
    setKeywordsApplied(true);
    // Force re-render of sample rows by cloning the array
    setSamples((prev) => [...prev]);
    setTimeout(() => setKeywordsApplied(false), 1500);
  }, [schoolInput, workInput]);

  const resetKeywords = useCallback(() => {
    setSchoolKeywords([
      'lecture', 'study', 'studying', 'assignment', 'homework', 'exam',
      'uni', 'university', 'seminar', 'tutorial', 'coursework', 'thesis',
      'dissertation', 'lab', 'practical', 'reading', 'class', 'school', 'uni-exam',
    ]);
    setWorkKeywords([
      'client', 'invoice', 'billable', 'meeting', 'standup', 'sprint',
      'deploy', 'development', 'dev', 'review', 'consulting', 'contract',
      'refactor', 'api', 'schema', 'feature', 'bug', 'fix', 'release',
      'pr', 'pipeline', 'ci', 'cd', 'ticket',
    ]);
    setSchoolInput(SCHOOL_KEYWORDS.join(', '));
    setWorkInput(WORK_KEYWORDS.join(', '));
    setSamples((prev) => [...prev]);
  }, []);

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h2 className="text-base font-semibold text-foreground">Live Regex Terminal</h2>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Test how time-log descriptions are tokenized and classified into life-buckets.
          Changes to keywords apply instantly to all samples below.
        </p>
      </div>

      {/* ── Keyword configuration ───────────────────────────────────────── */}
      <section className="rounded-xl border border-border bg-card p-4">
        <p className="mb-3 text-xs font-medium uppercase tracking-widest text-muted-foreground">
          Bucket Keywords
        </p>
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center gap-2">
              <span className={`rounded-md border px-2 py-0.5 text-[11px] font-semibold ${BUCKET_COLORS.school_uni}`}>
                school_uni
              </span>
              <label className="text-xs text-muted-foreground">keywords (comma-separated)</label>
            </div>
            <Input
              value={schoolInput}
              onChange={(e) => setSchoolInput(e.target.value)}
              placeholder="lecture, study, assignment, exam, …"
              className="font-mono text-xs"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <div className="flex items-center gap-2">
              <span className={`rounded-md border px-2 py-0.5 text-[11px] font-semibold ${BUCKET_COLORS.work}`}>
                work
              </span>
              <label className="text-xs text-muted-foreground">keywords (comma-separated)</label>
            </div>
            <Input
              value={workInput}
              onChange={(e) => setWorkInput(e.target.value)}
              placeholder="client, meeting, refactor, deploy, …"
              className="font-mono text-xs"
            />
          </div>

          <p className="text-[11px] text-muted-foreground">
            <span className={`rounded-md border px-1.5 py-0.5 text-[10px] font-semibold ${BUCKET_COLORS.life}`}>
              life
            </span>{' '}
            is the default fallback when no keywords match and no{' '}
            <code className="rounded bg-muted px-1">[Project]</code> anchor is present.
          </p>

          <div className="flex items-center gap-2">
            <Button size="sm" onClick={applyKeywords} className="h-7 text-xs">
              {keywordsApplied ? '✓ Applied' : 'Apply Keywords'}
            </Button>
            <Button size="sm" variant="outline" onClick={resetKeywords} className="h-7 text-xs">
              Reset Defaults
            </Button>
          </div>
        </div>
      </section>

      {/* ── Sample input ────────────────────────────────────────────────── */}
      <section>
        <p className="mb-2 text-xs font-medium uppercase tracking-widest text-muted-foreground">
          Test Samples
        </p>
        <div className="flex gap-2">
          <Input
            value={newSample}
            onChange={(e) => setNewSample(e.target.value)}
            placeholder='e.g. [CompanyAlpha] Implemented api schema #refactor'
            className="flex-1 font-mono text-xs"
            onKeyDown={(e) => {
              if (e.key === 'Enter') addSample();
            }}
          />
          <Button size="sm" onClick={addSample} className="h-9 shrink-0 text-xs">
            Add
          </Button>
        </div>
      </section>

      {/* ── Results ─────────────────────────────────────────────────────── */}
      <section className="flex flex-col gap-2">
        {samples.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            Add a sample above to test the classification pipeline.
          </p>
        ) : (
          samples.map((sample, i) => (
            <div key={`${sample}-${i}`} className="group relative">
              <SampleResultRow sample={sample} />
              <button
                onClick={() => removeSample(i)}
                className="absolute right-2 top-2 rounded p-0.5 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 hover:bg-destructive/10 hover:text-destructive"
                aria-label="Remove sample"
              >
                <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>
          ))
        )}
      </section>
    </div>
  );
}
