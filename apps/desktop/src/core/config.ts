/**
 * Phase N — central place for tunable runtime constants. Anything that
 * "smells like a magic number" (interval, debounce, batch size, retry cap,
 * default duration) should live here so the user-facing behaviour is
 * configurable in a single edit and obvious to reviewers.
 *
 * Adding a constant here is preferred over scattering literals across
 * modules. Pure numbers only — no functions, no I/O.
 */

/** Sync engine — push/pull behaviour. */
export const SYNC = {
  /** Debounce window applied to dirty-entity events before kicking a push. */
  dirtyDebounceMs: 1_500,
  /** Maximum rows of each kind (cores/aspects/relations/deletes) per push batch. */
  pushBatchLimit: 200,
  /** Background polling interval when no dirty events are flowing. */
  backgroundPollMs: 30_000,
  /** Reconnect/test-connection ping timeout. */
  pingTimeoutMs: 5_000,
} as const;

/** Backup engine. */
export const BACKUP = {
  /** Minimum spacing between automatic backup runs. */
  intervalMs: 60 * 60 * 1_000,
  /** Default keep-last for rolling local backups. */
  defaultKeepLast: 7,
} as const;

/** Pomodoro defaults (used when a profile has no override). */
export const POMODORO = {
  workMinutes: 25,
  shortBreakMinutes: 5,
  longBreakMinutes: 15,
  cyclesBeforeLongBreak: 4,
} as const;

/** UI debounce knobs. */
export const UI = {
  /** Debounce applied to text-search inputs across views. */
  searchDebounceMs: 200,
  /** Toast auto-dismiss delay. */
  toastTimeoutMs: 4_000,
} as const;

/** AI integration (Phase N). */
export const AI = {
  /** Default Ollama-compatible chat endpoint when nothing is configured. */
  defaultEndpoint: 'http://localhost:11434/v1/chat/completions',
  /** Default model name. */
  defaultModel: 'llama3.2',
  /** Per-request timeout for summarization calls. */
  requestTimeoutMs: 60_000,
  /** Max characters of input we'll forward to a summarize call. */
  maxInputChars: 16_000,
} as const;
