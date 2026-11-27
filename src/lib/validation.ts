export type FieldErrors = Record<string, string>;

export function str(value: FormDataEntryValue | null | undefined): string {
  return typeof value === 'string' ? value.trim() : '';
}

export function bool(value: FormDataEntryValue | null | undefined): boolean {
  return value === 'on' || value === 'true' || value === '1';
}

export function isEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value);
}

export function clamp(value: string, max: number): string {
  return value.length > max ? value.slice(0, max) : value;
}

const CAMPUS_TZ = process.env.NEXT_PUBLIC_TIMEZONE || 'Asia/Kolkata';

/** The desk's today, not UTC's. */
export function todayISO(): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: CAMPUS_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
  return parts;
}

export function isValidDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  // 2026-02-30 parses happily as 2 March; compare the parts back to catch it
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

/**
 * Only a same-origin path is a valid post-sign-in destination.
 * Rejects absolute URLs, protocol-relative "//host", and the "\\" forms some
 * browsers normalise to "/".
 */
export function safeInternalPath(next: string | null | undefined, fallback = '/account'): string {
  if (!next) return fallback;

  // The URL parser deletes TAB/LF/CR before resolving, so "/<TAB>/evil.com"
  // would otherwise become "//evil.com" and leave the origin.
  const cleaned = Array.from(next)
    .filter((char) => char.charCodeAt(0) > 31 && char.charCodeAt(0) !== 127)
    .join('');

  if (!cleaned.startsWith('/') || cleaned.startsWith('//') || cleaned.includes('\\')) return fallback;

  // Resolve against a throwaway origin and keep only the path: ".." segments
  // can turn "/ok//../..//evil.com" into "//evil.com", which is still our
  // origin but not a page.
  try {
    const resolved = new URL(cleaned, 'http://lnf.invalid');
    if (resolved.origin !== 'http://lnf.invalid') return fallback;
    if (resolved.pathname.startsWith('//')) return fallback;
    return `${resolved.pathname}${resolved.search}${resolved.hash}`;
  } catch {
    return fallback;
  }
}

export function refLooksValid(ref: string): boolean {
  return /^LF-\d{4}-\d{4}$/i.test(ref);
}

export function claimRefLooksValid(ref: string): boolean {
  return /^CLM-\d{4}-\d{4}$/i.test(ref);
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso.length <= 10 ? iso + 'T00:00:00' : iso);
  if (Number.isNaN(d.getTime())) return '—';
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  return `${dd}/${mm}/${d.getFullYear()}`;
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const time = d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true });
  return `${formatDate(iso)}, ${time}`;
}

export function daysBetween(a: string, b: string): number {
  return Math.round((new Date(b).getTime() - new Date(a).getTime()) / 86_400_000);
}
