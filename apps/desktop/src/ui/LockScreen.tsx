/**
 * Phase T — App lock screen.
 *
 * Rendered by App.tsx as a full-screen overlay before the main UI when
 * `useAppLockStore.locked === true`. The user must type the app password
 * to unlock. Wrong attempts trigger an incremental backoff (1s/2s/5s/...).
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Input } from '@/ui/components/input';
import { Button } from '@/ui/components/button';
import { useAppLockStore, unlockBackoffMs } from '@/core/lock';

export function LockScreen(): React.ReactElement {
  const failedAttempts = useAppLockStore((s) => s.failedAttempts);
  const unlock = useAppLockStore((s) => s.unlock);

  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [cooldownEnd, setCooldownEnd] = useState<number>(0);
  const [, force] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { inputRef.current?.focus(); }, []);

  // Tick once a second while in cooldown so the countdown UI updates.
  useEffect(() => {
    if (cooldownEnd <= Date.now()) return;
    const id = setInterval(() => force((n) => n + 1), 250);
    return () => clearInterval(id);
  }, [cooldownEnd]);

  const remainingCooldown = useMemo(() => {
    return Math.max(0, cooldownEnd - Date.now());
  }, [cooldownEnd]);

  const submit = async (): Promise<void> => {
    if (busy || remainingCooldown > 0) return;
    setBusy(true);
    setError(null);
    try {
      const ok = await unlock(password);
      if (!ok) {
        const next = failedAttempts + 1;
        const wait = unlockBackoffMs(next);
        if (wait > 0) setCooldownEnd(Date.now() + wait);
        setError('Incorrect password.');
        setPassword('');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-background/95 backdrop-blur-sm">
      <div className="w-full max-w-sm rounded-2xl border border-border bg-card p-6 shadow-xl">
        <div className="mb-4 flex flex-col items-center text-center">
          <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" className="h-6 w-6">
              <rect x="3" y="11" width="18" height="11" rx="2" />
              <path d="M7 11V7a5 5 0 0 1 10 0v4" />
            </svg>
          </div>
          <h1 className="text-lg font-semibold text-foreground">SyncroLWS is locked</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Enter your app password to continue.
          </p>
        </div>

        <form
          onSubmit={(e) => { e.preventDefault(); void submit(); }}
          className="space-y-3"
        >
          <Input
            ref={inputRef}
            type="password"
            placeholder="App password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            disabled={busy || remainingCooldown > 0}
          />
          {error && (
            <p className="text-xs font-medium text-red-500">{error}</p>
          )}
          {remainingCooldown > 0 && (
            <p className="text-xs text-muted-foreground">
              Too many attempts. Try again in {Math.ceil(remainingCooldown / 1000)}s.
            </p>
          )}
          <Button
            type="submit"
            className="w-full"
            disabled={busy || remainingCooldown > 0 || !password}
          >
            {busy ? 'Checking…' : 'Unlock'}
          </Button>
        </form>
      </div>
    </div>
  );
}
