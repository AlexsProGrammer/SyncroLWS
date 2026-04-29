/**
 * PomodoroView — Hybrid-entity edition.
 * Persists each completed phase as an entity with a `pomodoro_session` aspect,
 * and (for focus phases) a sibling `time_log` entity linked via a reference relation.
 */
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { eventBus } from '@/core/events';
import {
  createEntity,
  listByAspect,
  addRelation,
} from '@/core/entityStore';
import { Button } from '@/ui/components/button';
import { Input } from '@/ui/components/input';
import { Badge } from '@/ui/components/badge';
import { WebviewWindow } from '@tauri-apps/api/webviewWindow';
import { listen } from '@tauri-apps/api/event';
import type { PomodoroAspectData, TimeLogAspectData } from '@syncrohws/shared-types';

// ── Types ─────────────────────────────────────────────────────────────────────

type Phase = 'focus' | 'short_break' | 'long_break' | 'idle';

interface PomodoroConfig {
  focusMinutes: number;
  shortBreakMinutes: number;
  longBreakMinutes: number;
  intervalsBeforeLong: number;
}

const DEFAULT_CONFIG: PomodoroConfig = {
  focusMinutes: 25,
  shortBreakMinutes: 5,
  longBreakMinutes: 15,
  intervalsBeforeLong: 4,
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function phaseLabel(phase: Phase): string {
  switch (phase) {
    case 'focus': return 'Focus';
    case 'short_break': return 'Short Break';
    case 'long_break': return 'Long Break';
    case 'idle': return 'Ready';
  }
}

function phaseColor(phase: Phase): string {
  switch (phase) {
    case 'focus': return 'hsl(var(--primary))';
    case 'short_break': return '#22c55e';
    case 'long_break': return '#3b82f6';
    case 'idle': return 'hsl(var(--muted-foreground))';
  }
}

function formatTimer(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

// ── CircularTimer ─────────────────────────────────────────────────────────────

function CircularTimer({
  remaining, total, phase,
}: { remaining: number; total: number; phase: Phase }): React.ReactElement {
  const radius = 90;
  const circumference = 2 * Math.PI * radius;
  const progress = total > 0 ? remaining / total : 0;
  const offset = circumference * (1 - progress);

  return (
    <div className="relative mx-auto flex h-60 w-60 items-center justify-center">
      <svg className="-rotate-90" width="240" height="240" viewBox="0 0 240 240">
        <circle cx="120" cy="120" r={radius} fill="none" stroke="hsl(var(--muted))" strokeWidth="8" />
        <circle
          cx="120" cy="120" r={radius} fill="none"
          stroke={phaseColor(phase)} strokeWidth="8" strokeLinecap="round"
          strokeDasharray={circumference} strokeDashoffset={offset}
          style={{ transition: 'stroke-dashoffset 0.5s linear' }}
        />
      </svg>
      <div className="absolute flex flex-col items-center">
        <span className="text-4xl font-bold tabular-nums text-foreground">{formatTimer(remaining)}</span>
        <span className="mt-1 text-xs font-medium uppercase tracking-wider" style={{ color: phaseColor(phase) }}>
          {phaseLabel(phase)}
        </span>
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export function PomodoroView({ toolInstanceId }: { toolInstanceId?: string }): React.ReactElement {
  const [config, setConfig] = useState<PomodoroConfig>(DEFAULT_CONFIG);
  const [phase, setPhase] = useState<Phase>('idle');
  const [remaining, setRemaining] = useState(DEFAULT_CONFIG.focusMinutes * 60);
  const [totalSeconds, setTotalSeconds] = useState(DEFAULT_CONFIG.focusMinutes * 60);
  const [currentInterval, setCurrentInterval] = useState(1);
  const [completedToday, setCompletedToday] = useState(0);
  const [label, setLabel] = useState('');
  const [showConfig, setShowConfig] = useState(false);
  const [pipActive, setPipActive] = useState(false);

  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const phaseStartRef = useRef<string | null>(null);
  const pipWindowRef = useRef<WebviewWindow | null>(null);

  // ── Load today's completed focus sessions ─────────────────────────────────

  const loadTodayCount = useCallback(async () => {
    try {
      const items = await listByAspect('pomodoro_session', { tool_instance_id: toolInstanceId ?? null });
      const today = new Date().toISOString().slice(0, 10);
      const count = items.filter((i) => {
        const d = i.aspect.data as Partial<PomodoroAspectData>;
        return d.phase === 'focus' && (d.started_at ?? '').slice(0, 10) === today;
      }).length;
      setCompletedToday(count);
    } catch {
      /* ignore */
    }
  }, [toolInstanceId]);

  useEffect(() => {
    void loadTodayCount();
  }, [loadTodayCount]);

  // ── Timer tick ────────────────────────────────────────────────────────────

  const stopTimer = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }, []);

  const startPhase = useCallback(
    (nextPhase: Phase) => {
      stopTimer();
      let seconds: number;
      switch (nextPhase) {
        case 'focus': seconds = config.focusMinutes * 60; break;
        case 'short_break': seconds = config.shortBreakMinutes * 60; break;
        case 'long_break': seconds = config.longBreakMinutes * 60; break;
        default:
          setPhase('idle');
          setRemaining(config.focusMinutes * 60);
          setTotalSeconds(config.focusMinutes * 60);
          return;
      }
      setPhase(nextPhase);
      setRemaining(seconds);
      setTotalSeconds(seconds);
      phaseStartRef.current = new Date().toISOString();

      eventBus.emit('pomodoro:started', { phase: nextPhase as 'focus' | 'short_break' | 'long_break', label });

      intervalRef.current = setInterval(() => {
        setRemaining((prev) => {
          if (prev <= 1) {
            stopTimer();
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
    },
    [config, label, stopTimer],
  );

  // ── Picture-in-Picture via Tauri WebviewWindow ─────────────────────────────
  const getPipData = useCallback(() => {
    const progress = totalSeconds > 0 ? remaining / totalSeconds : 0;
    const circumference = 2 * Math.PI * 50;
    const offset = circumference * (1 - progress);
    const bg = phase === 'focus' ? '#1a1a2e' : phase === 'idle' ? '#1a1a2e' : '#1a2e1a';
    const color = phase === 'focus' ? '#6366f1' : phase === 'short_break' ? '#22c55e' : phase === 'long_break' ? '#3b82f6' : '#888';
    return { bg, color, offset, time: formatTimer(remaining), label: phaseLabel(phase) };
  }, [remaining, totalSeconds, phase]);

  useEffect(() => {
    if (!pipActive || !pipWindowRef.current) return;
    pipWindowRef.current.emitTo('pomodoro-pip', 'pip-update', getPipData()).catch(() => {});
  }, [pipActive, getPipData]);

  const openPip = useCallback(async () => {
    if (pipWindowRef.current) {
      try { await pipWindowRef.current.setFocus(); return; }
      catch { pipWindowRef.current = null; }
    }
    try {
      // Load the PiP window at the main app origin with ?pip=pomodoro so the
      // child window gets the full Tauri IPC bridge. data: URLs are blocked by
      // Tauri's CSP (default-src 'self') and open silently without any JS error.
      const pipUrl = `${window.location.origin}/?pip=pomodoro`;
      const pip = new WebviewWindow('pomodoro-pip', {
        title: 'Pomodoro Timer',
        width: 220, height: 240,
        resizable: false, alwaysOnTop: true, decorations: true,
        center: false, x: 100, y: 100,
        url: pipUrl,
      });
      pip.once('tauri://created', () => {
        setTimeout(() => {
          pip.emitTo('pomodoro-pip', 'pip-update', getPipData()).catch(() => {});
        }, 300);
      });
      pip.once('tauri://destroyed', () => {
        pipWindowRef.current = null;
        setPipActive(false);
      });
      pipWindowRef.current = pip;
      setPipActive(true);
    } catch (err) {
      console.error('[pomodoro] PiP window failed:', err);
      eventBus.emit('notification:show', {
        title: 'Picture-in-Picture',
        body: 'Could not open PiP window.',
        type: 'warning',
      });
    }
  }, [getPipData]);

  const closePip = useCallback(async () => {
    if (pipWindowRef.current) {
      try { await pipWindowRef.current.destroy(); } catch { /* already closed */ }
      pipWindowRef.current = null;
    }
    setPipActive(false);
  }, []);

  useEffect(() => () => {
    if (pipWindowRef.current) {
      pipWindowRef.current.destroy().catch(() => {});
      pipWindowRef.current = null;
    }
  }, []);

  // ── Handle timer reaching 0 ──────────────────────────────────────────────

  useEffect(() => {
    if (remaining > 0 || phase === 'idle') return;

    void (async () => {
      const now = new Date().toISOString();
      const startedAt = phaseStartRef.current || now;

      const sessionData: PomodoroAspectData = {
        focus_minutes: config.focusMinutes,
        short_break_minutes: config.shortBreakMinutes,
        long_break_minutes: config.longBreakMinutes,
        intervals_before_long: config.intervalsBeforeLong,
        current_interval: currentInterval,
        phase: phase as 'focus' | 'short_break' | 'long_break',
        started_at: startedAt,
        completed_sessions: phase === 'focus' ? completedToday + 1 : completedToday,
      };

      try {
        const session = await createEntity({
          core: {
            title: label || `${phaseLabel(phase)} session`,
            tags: ['pomodoro'],
          },
          aspects: [{ aspect_type: 'pomodoro_session', data: sessionData, tool_instance_id: toolInstanceId ?? null }],
        });

        eventBus.emit('pomodoro:completed', { phase: phase as 'focus' | 'short_break' | 'long_break', label });

        if (phase === 'focus') {
          // Compute duration
          const startMs = new Date(startedAt).getTime();
          const endMs = new Date(now).getTime();
          const durationSeconds = Math.max(0, Math.floor((endMs - startMs) / 1000));

          const timeLogData: TimeLogAspectData = {
            start: startedAt,
            end: now,
            duration_seconds: durationSeconds,
            window_title: '',
            billable: false,
            hourly_rate_cents: 0,
            project: '',
            manual: false,
          };

          const timeLog = await createEntity({
            core: {
              title: label || 'Focus session',
              tags: ['pomodoro'],
            },
            aspects: [{ aspect_type: 'time_log', data: timeLogData, tool_instance_id: toolInstanceId ?? null }],
          });

          // Link via relation
          await addRelation(session.core.id, timeLog.core.id, 'reference', { source: 'pomodoro' });

          setCompletedToday((c) => c + 1);

          const nextInterval = currentInterval >= config.intervalsBeforeLong ? 1 : currentInterval + 1;
          setCurrentInterval(nextInterval);

          const nextPhase: Phase =
            currentInterval >= config.intervalsBeforeLong ? 'long_break' : 'short_break';
          startPhase(nextPhase);
        } else {
          startPhase('focus');
        }
      } catch (err) {
        console.error('[pomodoro] persist failed:', err);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [remaining]);

  // ── Clean up on unmount ───────────────────────────────────────────────────

  useEffect(() => stopTimer, [stopTimer]);

  // ── Action handlers ───────────────────────────────────────────────────────

  const handleStart = (): void => startPhase('focus');

  const handleStop = (): void => {
    stopTimer();
    setPhase('idle');
    setRemaining(config.focusMinutes * 60);
    setTotalSeconds(config.focusMinutes * 60);
    setCurrentInterval(1);
    eventBus.emit('pomodoro:stopped', undefined as unknown as void);
  };

  const handleSkip = (): void => {
    stopTimer();
    if (phase === 'focus') {
      const nextPhase: Phase =
        currentInterval >= config.intervalsBeforeLong ? 'long_break' : 'short_break';
      startPhase(nextPhase);
    } else {
      startPhase('focus');
    }
  };

  return (
    <div className="flex flex-1 flex-col items-center overflow-auto p-6">
      <div className="mb-6 flex items-center gap-3">
        <Badge variant="outline">
          Session {currentInterval}/{config.intervalsBeforeLong}
        </Badge>
        <Badge variant="secondary">
          {completedToday} focus session{completedToday !== 1 ? 's' : ''} today
        </Badge>
      </div>

      <CircularTimer remaining={remaining} total={totalSeconds} phase={phase} />

      <div className="mt-4 w-72">
        <Input
          placeholder="What are you focusing on?"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          disabled={phase !== 'idle'}
          className="text-center text-sm"
        />
      </div>

      <div className="mt-6 flex items-center gap-3">
        {phase === 'idle' ? (
          <Button size="lg" onClick={handleStart} className="px-8">Start Focus</Button>
        ) : (
          <>
            <Button variant="outline" size="sm" onClick={handleStop}>Stop</Button>
            <Button variant="secondary" size="sm" onClick={handleSkip}>Skip</Button>
          </>
        )}
        <Button variant="ghost" size="sm" onClick={() => setShowConfig(!showConfig)}>
          <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09a1.65 1.65 0 0 0-1.08-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.68 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
          </svg>
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => void (pipActive ? closePip() : openPip())}
          title="Picture-in-Picture"
        >
          <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
            <rect x="2" y="3" width="20" height="14" rx="2" />
            <rect x="12" y="9" width="8" height="6" rx="1" fill="currentColor" opacity="0.3" />
          </svg>
        </Button>
      </div>

      {showConfig && (
        <div className="mt-6 grid w-72 grid-cols-2 gap-3 rounded-lg border border-border bg-card p-4">
          <label className="col-span-2 text-xs font-medium text-muted-foreground">Timer Settings</label>

          <div>
            <label className="mb-1 block text-xs text-muted-foreground">Focus (min)</label>
            <Input type="number" min={1} max={120}
              value={config.focusMinutes}
              onChange={(e) => {
                const v = Math.max(1, Math.min(120, Number(e.target.value) || 1));
                setConfig((c) => ({ ...c, focusMinutes: v }));
                if (phase === 'idle') { setRemaining(v * 60); setTotalSeconds(v * 60); }
              }}
              disabled={phase !== 'idle'} className="h-8 text-sm"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs text-muted-foreground">Short Break</label>
            <Input type="number" min={1} max={30}
              value={config.shortBreakMinutes}
              onChange={(e) => {
                const v = Math.max(1, Math.min(30, Number(e.target.value) || 1));
                setConfig((c) => ({ ...c, shortBreakMinutes: v }));
              }}
              disabled={phase !== 'idle'} className="h-8 text-sm"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs text-muted-foreground">Long Break</label>
            <Input type="number" min={1} max={60}
              value={config.longBreakMinutes}
              onChange={(e) => {
                const v = Math.max(1, Math.min(60, Number(e.target.value) || 1));
                setConfig((c) => ({ ...c, longBreakMinutes: v }));
              }}
              disabled={phase !== 'idle'} className="h-8 text-sm"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs text-muted-foreground">Intervals</label>
            <Input type="number" min={1} max={10}
              value={config.intervalsBeforeLong}
              onChange={(e) => {
                const v = Math.max(1, Math.min(10, Number(e.target.value) || 1));
                setConfig((c) => ({ ...c, intervalsBeforeLong: v }));
              }}
              disabled={phase !== 'idle'} className="h-8 text-sm"
            />
          </div>
        </div>
      )}

      <div className="mt-6 flex items-center gap-2">
        {Array.from({ length: config.intervalsBeforeLong }, (_, i) => (
          <div
            key={i}
            className="h-3 w-3 rounded-full transition-colors"
            style={{
              backgroundColor:
                i < currentInterval - 1 || (i === currentInterval - 1 && phase !== 'focus' && phase !== 'idle')
                  ? phaseColor('focus')
                  : 'hsl(var(--muted))',
              border: i === currentInterval - 1 && phase === 'focus' ? `2px solid ${phaseColor('focus')}` : 'none',
            }}
          />
        ))}
      </div>
    </div>
  );
}

// ── PiP window component ──────────────────────────────────────────────────────
// Rendered by main.tsx when the window URL contains ?pip=pomodoro.
// Receives live timer state via Tauri 'pip-update' events emitted from the
// main PomodoroView (see the useEffect that calls pipWindowRef.current.emitTo).

interface PipState {
  bg: string;
  color: string;
  offset: number;
  time: string;
  label: string;
}

const PIP_INITIAL: PipState = {
  bg: '#1a1a2e',
  color: '#6366f1',
  offset: 0,
  time: '00:00',
  label: 'Ready',
};

export function PomodoroPip(): React.ReactElement {
  const [state, setState] = useState<PipState>(PIP_INITIAL);
  const circumference = 2 * Math.PI * 50; // r=50 → C≈314.16

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    void listen<PipState>('pip-update', (e) => {
      setState(e.payload);
    }).then((fn) => { unlisten = fn; });
    return () => { unlisten?.(); };
  }, []);

  return (
    <div
      style={{
        background: state.bg,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100vh',
        margin: 0,
        overflow: 'hidden',
        fontFamily: 'system-ui, sans-serif',
        userSelect: 'none',
      }}
    >
      <div style={{ position: 'relative', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
        <svg width="140" height="140" viewBox="0 0 140 140" style={{ transform: 'rotate(-90deg)' }}>
          <circle cx="70" cy="70" r="50" fill="none" stroke="#333" strokeWidth="6" />
          <circle
            cx="70" cy="70" r="50" fill="none"
            stroke={state.color} strokeWidth="6" strokeLinecap="round"
            strokeDasharray={String(circumference)}
            strokeDashoffset={String(state.offset)}
            style={{ transition: 'stroke-dashoffset 0.5s linear' }}
          />
        </svg>
        <div
          style={{
            position: 'absolute',
            top: '50%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
            color: '#fff',
            textAlign: 'center',
          }}
        >
          <div style={{ fontSize: '28px', fontWeight: 'bold', fontVariantNumeric: 'tabular-nums' }}>
            {state.time}
          </div>
          <div style={{ fontSize: '11px', textTransform: 'uppercase', letterSpacing: '1px', marginTop: '2px', color: state.color }}>
            {state.label}
          </div>
        </div>
      </div>
    </div>
  );
}
