import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/** Merge Tailwind classes without conflicts. Use everywhere instead of bare `clsx`. */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

/**
 * Convert an ISO timestamp to the local-zone string format expected by
 * `<input type="datetime-local">` (or `type="date"` when `dateOnly`).
 *
 * Returns an empty string for invalid input — safe to bind directly to an
 * input's `value` prop without crashing on bad data.
 */
export function toLocalInput(iso: string, dateOnly = false): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const off = d.getTimezoneOffset();
  const local = new Date(d.getTime() - off * 60_000);
  return dateOnly ? local.toISOString().slice(0, 10) : local.toISOString().slice(0, 16);
}
