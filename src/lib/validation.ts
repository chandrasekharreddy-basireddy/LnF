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

export function todayISO(): string {
  const d = new Date();
  const off = d.getTimezoneOffset();
  return new Date(d.getTime() - off * 60_000).toISOString().slice(0, 10);
}

export function isValidDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(value + 'T00:00:00');
  return !Number.isNaN(d.getTime());
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
