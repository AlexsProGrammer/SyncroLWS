/**
 * logParser — Tokenization and life-bucket classification for time-log descriptions.
 *
 * Extracts structured metadata from free-text time-log descriptions:
 *   - Leading `[ProjectName]` anchors  → `project` field
 *   - Trailing `#tag` sequences        → `tags` array
 *   - Keyword-based bucket scoring     → `bucket:work | life | school_uni`
 *
 * All processing is purely local — no network calls are made (DSGVO compliant).
 */

// ── Configurable keyword arrays ───────────────────────────────────────────────

/**
 * Keywords that classify a time entry as `school_uni`.
 * Mutate via `setSchoolKeywords()` for runtime customisation.
 */
export let SCHOOL_KEYWORDS: string[] = [
  'lecture', 'study', 'studying', 'assignment', 'homework', 'exam',
  'uni', 'university', 'seminar', 'tutorial', 'coursework', 'thesis',
  'dissertation', 'lab', 'practical', 'reading', 'class', 'school',
  'uni-exam',
];

/**
 * Keywords that classify a time entry as `work`.
 * A leading `[Project]` anchor is also treated as a work signal.
 * Mutate via `setWorkKeywords()` for runtime customisation.
 */
export let WORK_KEYWORDS: string[] = [
  'client', 'invoice', 'billable', 'meeting', 'standup', 'sprint',
  'deploy', 'development', 'dev', 'review', 'consulting', 'contract',
  'refactor', 'api', 'schema', 'feature', 'bug', 'fix', 'release',
  'pr', 'pipeline', 'ci', 'cd', 'ticket',
];

/** Replace the school_uni keyword list at runtime (in-memory only; never persisted externally). */
export function setSchoolKeywords(keywords: string[]): void {
  SCHOOL_KEYWORDS = keywords;
}

/** Replace the work keyword list at runtime (in-memory only; never persisted externally). */
export function setWorkKeywords(keywords: string[]): void {
  WORK_KEYWORDS = keywords;
}

// ── Regex patterns ────────────────────────────────────────────────────────────

/** Extracts a leading project anchor: `[ProjectName]` */
const PROJECT_RE = /^\[(.*?)\]/;

/** Matches all inline hashtag labels: `#word` or `#word-dashes` */
const TAG_RE = /#(\w[\w-]*)/g;

// ── Types ─────────────────────────────────────────────────────────────────────

export type LifeBucket = 'work' | 'life' | 'school_uni';

export interface ParsedTimeLog {
  /** Project name extracted from the leading `[Project]` bracket, or empty string. */
  project: string;
  /** Description with the `[Project]` prefix and `#tag` tokens removed, whitespace normalised. */
  cleanText: string;
  /**
   * `#tag` values extracted from the raw string, plus a `bucket:<bucket>` label so the
   * entity's FTS5 virtual table can search by bucket without any schema change.
   */
  tags: string[];
  /** The resolved life-bucket classification. */
  bucket: LifeBucket;
}

// ── Core parser ───────────────────────────────────────────────────────────────

/**
 * Tokenises a raw time-log description and returns structured metadata.
 *
 * Classification priority: `school_uni` > `work` > `life`.
 * - `school_uni`: any token or #tag matches a word in {@link SCHOOL_KEYWORDS}.
 * - `work`: a `[Project]` anchor is present, or a token matches {@link WORK_KEYWORDS}.
 * - `life`: default fallback.
 *
 * @example
 * parseTimeLogDescription('[CompanyAlpha] Implemented api schema #refactor')
 * // → { project: 'CompanyAlpha', cleanText: 'Implemented api schema',
 * //     tags: ['refactor', 'bucket:work'], bucket: 'work' }
 */
export function parseTimeLogDescription(rawStr: string): ParsedTimeLog {
  // 1. Extract leading [Project] anchor
  const projectMatch = PROJECT_RE.exec(rawStr);
  const project = projectMatch ? (projectMatch[1] ?? '').trim() : '';
  const withoutProject = projectMatch
    ? rawStr.slice(projectMatch[0].length).trim()
    : rawStr.trim();

  // 2. Collect all #tag tokens
  const rawTags: string[] = [];
  TAG_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = TAG_RE.exec(withoutProject)) !== null) {
    rawTags.push(m[1] ?? '');
  }

  // 3. Build clean description text
  const cleanText = withoutProject
    .replace(/#\w[\w-]*/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  // 4. Classify into a life-bucket
  //    Tokenise the full raw string for keyword matching
  const allTokens = rawStr
    .toLowerCase()
    .split(/[\s\-_#[\]]+/)
    .filter(Boolean);
  const tagTokens = rawTags.map((t) => t.toLowerCase());
  const combined = [...allTokens, ...tagTokens];

  const hits = (keywords: string[]): boolean =>
    keywords.some((kw) => combined.some((tok) => tok === kw || tok.includes(kw)));

  const hasSchool = hits(SCHOOL_KEYWORDS);
  // A project anchor acts as a work signal even without keyword matches
  const hasWork = project !== '' || hits(WORK_KEYWORDS);

  const bucket: LifeBucket = hasSchool ? 'school_uni' : hasWork ? 'work' : 'life';

  return {
    project,
    cleanText,
    tags: [...rawTags, `bucket:${bucket}`],
    bucket,
  };
}
