/**
 * The desk sheet, as a browser keeps it.
 *
 * The database decides who may build a sheet (`desk_sheet`, migration 0035) and
 * what is in it: only what is already on the public board. This module decides
 * nothing about access. It turns that payload into the small record a staff
 * browser stores for a shift, reads it back without trusting it, and answers the
 * one question the counter asks — "is this ref on the sheet?".
 *
 * Everything here is pure: no fetch, no clock of its own, no React. `now` and
 * `savedAt` are passed in, so an age is the same in a test and in a browser.
 *
 * `public/offline-sheet.js` mirrors `parseSheet` for the page served when there
 * is no network. The two are held together by a round-trip test: a sheet built
 * here must parse there, or the offline page silently shows nothing.
 */

export const SHEET_KEY = 'lnf-desk-sheet';

/** bump when the stored shape changes; an older sheet is then refused, not guessed at */
export const SHEET_VERSION = 1;

/** past this, the sheet says so out loud: the board may have moved on */
export const SHEET_STALE_MS = 12 * 60 * 60 * 1000;

/** past this, the sheet is not shown at all */
export const SHEET_EXPIRED_MS = 24 * 60 * 60 * 1000;

/** the function caps at 500; so does anything stored from it */
export const SHEET_MAX_ROWS = 500;

export type DeskSheetRow = {
  ref: string;
  title: string;
  category: string;
  type: 'lost' | 'found';
  status: string;
  zone: string | null;
  spot: string | null;
  eventDate: string | null;
  heldSince: string | null;
};

export type DeskSheet = {
  version: number;
  /** when this browser saved it */
  savedAt: string;
  /** when the database built it */
  generatedAt: string | null;
  rows: DeskSheetRow[];
};

export type DeskSheetPayload = {
  ok?: boolean;
  error?: string;
  generatedAt?: unknown;
  count?: unknown;
  rows?: unknown;
};

const REF = /^[A-Z]{2}-\d{4}-\d{4}$/i;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}/;
const TYPES = new Set(['lost', 'found']);
const STATUSES = new Set(['pending_moderation', 'available', 'claimed', 'recovered', 'expired', 'quarantined', 'archived']);

function text(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, max);
}

function stamp(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return ISO_DATE.test(trimmed) ? trimmed.slice(0, 40) : null;
}

/** One row, or null. A row that is not shaped like a board listing is dropped, never repaired. */
export function toRow(raw: unknown): DeskSheetRow | null {
  if (!raw || typeof raw !== 'object') return null;
  const row = raw as Record<string, unknown>;
  const ref = text(row.ref, 20);
  const title = text(row.title, 120);
  const category = text(row.category, 40);
  const type = text(row.type, 8);
  const status = text(row.status, 24);
  if (!ref || !REF.test(ref)) return null;
  if (!title || !category || !type || !status) return null;
  if (!TYPES.has(type) || !STATUSES.has(status)) return null;
  return {
    ref: ref.toUpperCase(),
    title,
    category,
    type: type as 'lost' | 'found',
    status,
    zone: text(row.zone, 120),
    spot: text(row.spot, 120),
    eventDate: stamp(row.eventDate),
    heldSince: stamp(row.heldSince),
  };
}

/**
 * The payload from `desk_sheet()` → the record to store, or null.
 * `ok: false` (a refusal), a non-array `rows`, or a payload with no usable row
 * all give null: an empty sheet is not worth carrying, and a partial one is
 * worse than none.
 */
export function sheetFromPayload(payload: DeskSheetPayload | null, savedAt: string): DeskSheet | null {
  if (!payload || payload.ok !== true) return null;
  if (!Array.isArray(payload.rows)) return null;
  const rows: DeskSheetRow[] = [];
  for (const raw of payload.rows) {
    const row = toRow(raw);
    if (row) rows.push(row);
    if (rows.length >= SHEET_MAX_ROWS) break;
  }
  if (rows.length === 0) return null;
  const saved = stamp(savedAt);
  if (!saved) return null;
  return {
    version: SHEET_VERSION,
    savedAt: saved,
    generatedAt: stamp(payload.generatedAt),
    rows,
  };
}

/** Whatever the browser hands back, treated as hostile: bad JSON, an old version, junk rows. */
export function parseSheet(raw: string | null): DeskSheet | null {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > 2_000_000) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;
  const sheet = parsed as Record<string, unknown>;
  if (sheet.version !== SHEET_VERSION) return null;
  const savedAt = stamp(sheet.savedAt);
  if (!savedAt) return null;
  if (!Array.isArray(sheet.rows)) return null;
  const rows: DeskSheetRow[] = [];
  for (const raw of sheet.rows) {
    const row = toRow(raw);
    if (row) rows.push(row);
    if (rows.length >= SHEET_MAX_ROWS) break;
  }
  if (rows.length === 0) return null;
  return { version: SHEET_VERSION, savedAt, generatedAt: stamp(sheet.generatedAt), rows };
}

export function sheetToJson(sheet: DeskSheet): string {
  return JSON.stringify(sheet);
}

export type SheetAge = {
  ms: number;
  hours: number;
  stale: boolean;
  expired: boolean;
};

/** A saved sheet's age. A clock that has jumped backwards reads as "just saved", never negative. */
export function sheetAge(sheet: DeskSheet, now: Date): SheetAge {
  const saved = Date.parse(sheet.savedAt);
  const ms = Number.isFinite(saved) ? Math.max(0, now.getTime() - saved) : Number.POSITIVE_INFINITY;
  return {
    ms,
    hours: Number.isFinite(ms) ? Math.floor(ms / 3_600_000) : Number.POSITIVE_INFINITY,
    stale: ms >= SHEET_STALE_MS,
    expired: ms >= SHEET_EXPIRED_MS,
  };
}

export function ageLabel(ms: number): string {
  if (!Number.isFinite(ms)) return 'saved at an unknown time';
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return 'saved just now';
  if (minutes === 1) return 'saved 1 minute ago';
  if (minutes < 60) return `saved ${minutes} minutes ago`;
  const hours = Math.floor(minutes / 60);
  if (hours === 1) return 'saved 1 hour ago';
  return `saved ${hours} hours ago`;
}

export function sheetSummary(sheet: DeskSheet, now: Date): string {
  const count = sheet.rows.length;
  const noun = count === 1 ? 'item' : 'items';
  return `${count} ${noun} · ${ageLabel(sheetAge(sheet, now).ms)}`;
}

/**
 * The counter's lookup. A tag is read aloud as digits ("two zero zero seven"),
 * so a digits-only query matches the reference's digits; anything else matches
 * the reference, title, category, zone or spot, case-insensitively.
 */
export function searchSheet(rows: DeskSheetRow[], query: string): DeskSheetRow[] {
  const q = query.trim().toLowerCase();
  if (!q) return rows;
  const digits = /^[\d\s-]+$/.test(q) ? q.replace(/\D/g, '') : '';
  return rows.filter((row) => {
    if (digits && row.ref.replace(/\D/g, '').includes(digits)) return true;
    return [row.ref, row.title, row.category, row.zone ?? '', row.spot ?? ''].some((field) =>
      field.toLowerCase().includes(q),
    );
  });
}
