import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';
import {
  SHEET_EXPIRED_MS,
  SHEET_KEY,
  SHEET_MAX_ROWS,
  SHEET_STALE_MS,
  SHEET_VERSION,
  ageLabel,
  parseSheet,
  searchSheet,
  sheetAge,
  sheetFromPayload,
  sheetSummary,
  sheetToJson,
  toRow,
} from '@/lib/offline';

const row = (over: Record<string, unknown> = {}) => ({
  ref: 'LF-2026-0007',
  title: 'Black wireless earbuds in a charging case',
  category: 'electronics',
  type: 'found',
  status: 'available',
  zone: 'Central Library',
  spot: 'second floor desk',
  eventDate: '2026-11-20',
  heldSince: '2026-11-20T09:15:00Z',
  ...over,
});

const payload = (rows: unknown[] = [row()], over: Record<string, unknown> = {}) => ({
  ok: true,
  generatedAt: '2026-11-28T05:00:00Z',
  count: rows.length,
  rows,
  ...over,
});

/** run one of the browser scripts in a bare context, the way the page would */
function loadBrowserScript(file: string) {
  const src = readFileSync(new URL(`../../public/${file}`, import.meta.url), 'utf8');
  // a bare realm: the browser globals the script may legitimately use, and nothing else
  const context: Record<string, unknown> = { console, URL };
  vm.createContext(context);
  vm.runInContext(src, context);
  return context;
}

describe('the desk sheet payload', () => {
  it('turns a good payload into a stored sheet', () => {
    const sheet = sheetFromPayload(payload(), '2026-11-28T05:30:00Z');
    expect(sheet).not.toBeNull();
    expect(sheet!.version).toBe(SHEET_VERSION);
    expect(sheet!.savedAt).toBe('2026-11-28T05:30:00Z');
    expect(sheet!.generatedAt).toBe('2026-11-28T05:00:00Z');
    expect(sheet!.rows).toHaveLength(1);
    expect(sheet!.rows[0].ref).toBe('LF-2026-0007');
  });

  it('refuses a refusal', () => {
    expect(sheetFromPayload({ ok: false, error: 'NOT_STAFF' }, '2026-11-28T05:30:00Z')).toBeNull();
    expect(sheetFromPayload(null, '2026-11-28T05:30:00Z')).toBeNull();
  });

  it('refuses an empty sheet: there is nothing worth carrying', () => {
    expect(sheetFromPayload(payload([]), '2026-11-28T05:30:00Z')).toBeNull();
    expect(sheetFromPayload(payload([{ ref: 'not-a-ref' }]), '2026-11-28T05:30:00Z')).toBeNull();
  });

  it('drops a malformed row and keeps the rest, rather than repairing it', () => {
    const sheet = sheetFromPayload(
      payload([row(), { ref: 'LF-2026-0008' }, row({ ref: 'LF-2026-0009' })]),
      '2026-11-28T05:30:00Z',
    );
    expect(sheet!.rows.map((r) => r.ref)).toEqual(['LF-2026-0007', 'LF-2026-0009']);
  });

  it('refuses a row whose status or type is not one the board has', () => {
    expect(toRow(row({ status: 'in_the_van' }))).toBeNull();
    expect(toRow(row({ type: 'borrowed' }))).toBeNull();
  });

  it('normalises the reference to upper case and trims it', () => {
    expect(toRow(row({ ref: '  lf-2026-0007 ' }))!.ref).toBe('LF-2026-0007');
  });

  it('never stores a field the sheet is not supposed to have', () => {
    const sheet = sheetFromPayload(
      payload([row({ reporter_id: 'x', contact_email: 'a@b.test', answer_hash: 'h', serial_number: 'S1' })]),
      '2026-11-28T05:30:00Z',
    );
    const stored = JSON.stringify(sheet);
    for (const forbidden of ['reporter', 'contact', 'answer', 'serial', 'a@b.test']) {
      expect(stored).not.toContain(forbidden);
    }
  });

  it('caps the sheet at the function’s own limit', () => {
    const rows = Array.from({ length: SHEET_MAX_ROWS + 25 }, (_, i) =>
      row({ ref: `LF-2026-${String(1000 + i).padStart(4, '0')}` }),
    );
    const sheet = sheetFromPayload(payload(rows), '2026-11-28T05:30:00Z');
    expect(sheet!.rows).toHaveLength(SHEET_MAX_ROWS);
  });

  it('needs a real saved-at stamp', () => {
    expect(sheetFromPayload(payload(), 'whenever')).toBeNull();
  });
});

describe('reading a stored sheet back', () => {
  it('round-trips through JSON', () => {
    const sheet = sheetFromPayload(payload(), '2026-11-28T05:30:00Z')!;
    const back = parseSheet(sheetToJson(sheet));
    expect(back).toEqual(sheet);
  });

  it('refuses bad JSON, junk, and a sheet from another version', () => {
    expect(parseSheet(null)).toBeNull();
    expect(parseSheet('')).toBeNull();
    expect(parseSheet('{')).toBeNull();
    expect(parseSheet('[]')).toBeNull();
    expect(parseSheet(JSON.stringify({ version: 99, savedAt: '2026-11-28T05:30:00Z', rows: [row()] }))).toBeNull();
    expect(parseSheet(JSON.stringify({ version: SHEET_VERSION, savedAt: 'x', rows: [row()] }))).toBeNull();
    expect(parseSheet(JSON.stringify({ version: SHEET_VERSION, savedAt: '2026-11-28T05:30:00Z', rows: [] }))).toBeNull();
  });

  it('refuses a sheet whose rows all decayed', () => {
    const decayed = JSON.stringify({ version: SHEET_VERSION, savedAt: '2026-11-28T05:30:00Z', rows: [{ ref: 'x' }] });
    expect(parseSheet(decayed)).toBeNull();
  });
});

describe('how old a sheet is', () => {
  const sheet = sheetFromPayload(payload(), '2026-11-28T05:00:00Z')!;
  const at = (iso: string) => sheetAge(sheet, new Date(iso));

  it('is fresh under the stale line', () => {
    const age = at('2026-11-28T10:00:00Z');
    expect(age.hours).toBe(5);
    expect(age.stale).toBe(false);
    expect(age.expired).toBe(false);
  });

  it('is stale from the stale line onward', () => {
    expect(at(new Date(Date.parse('2026-11-28T05:00:00Z') + SHEET_STALE_MS - 1).toISOString()).stale).toBe(false);
    expect(at(new Date(Date.parse('2026-11-28T05:00:00Z') + SHEET_STALE_MS).toISOString()).stale).toBe(true);
  });

  it('is expired from the expiry line onward', () => {
    expect(at(new Date(Date.parse('2026-11-28T05:00:00Z') + SHEET_EXPIRED_MS - 1).toISOString()).expired).toBe(false);
    expect(at(new Date(Date.parse('2026-11-28T05:00:00Z') + SHEET_EXPIRED_MS).toISOString()).expired).toBe(true);
  });

  it('reads a clock that jumped backwards as just saved, never as negative', () => {
    const age = at('2026-11-27T05:00:00Z');
    expect(age.ms).toBe(0);
    expect(age.stale).toBe(false);
  });

  it('labels an age in words a person would say', () => {
    expect(ageLabel(0)).toBe('saved just now');
    expect(ageLabel(59_000)).toBe('saved just now');
    expect(ageLabel(60_000)).toBe('saved 1 minute ago');
    expect(ageLabel(5 * 60_000)).toBe('saved 5 minutes ago');
    expect(ageLabel(3_600_000)).toBe('saved 1 hour ago');
    expect(ageLabel(7 * 3_600_000)).toBe('saved 7 hours ago');
  });

  it('summarises count and age together', () => {
    const two = sheetFromPayload(payload([row(), row({ ref: 'LF-2026-0011' })]), '2026-11-28T05:00:00Z')!;
    expect(sheetSummary(two, new Date('2026-11-28T07:00:00Z'))).toBe('2 items · saved 2 hours ago');
    const one = sheetFromPayload(payload([row()]), '2026-11-28T05:00:00Z')!;
    expect(sheetSummary(one, new Date('2026-11-28T05:00:30Z'))).toBe('1 item · saved just now');
  });
});

describe('the counter’s lookup', () => {
  const rows = sheetFromPayload(
    payload([
      row(),
      row({ ref: 'LF-2026-0012', title: 'Brown leather belt, brass buckle', category: 'accessories', zone: 'Sports Complex', spot: null }),
      row({ ref: 'LF-2026-0031', title: 'Steel water bottle', category: 'bottles', zone: null, spot: 'Main Gate' }),
    ]),
    '2026-11-28T05:00:00Z',
  )!.rows;

  it('returns everything for an empty query', () => {
    expect(searchSheet(rows, '')).toHaveLength(3);
    expect(searchSheet(rows, '   ')).toHaveLength(3);
  });

  it('finds a tag read aloud as digits', () => {
    expect(searchSheet(rows, '0012').map((r) => r.ref)).toEqual(['LF-2026-0012']);
    expect(searchSheet(rows, '12').map((r) => r.ref)).toEqual(['LF-2026-0012']);
    expect(searchSheet(rows, 'LF-2026-0031').map((r) => r.ref)).toEqual(['LF-2026-0031']);
  });

  it('finds a word from the title, the category, the zone or the spot', () => {
    expect(searchSheet(rows, 'EARBUDS').map((r) => r.ref)).toEqual(['LF-2026-0007']);
    expect(searchSheet(rows, 'bottles').map((r) => r.ref)).toEqual(['LF-2026-0031']);
    expect(searchSheet(rows, 'sports').map((r) => r.ref)).toEqual(['LF-2026-0012']);
    expect(searchSheet(rows, 'gate').map((r) => r.ref)).toEqual(['LF-2026-0031']);
  });

  it('answers nothing, not everything, when nothing matches', () => {
    expect(searchSheet(rows, 'umbrella')).toEqual([]);
    expect(searchSheet(rows, '9999')).toEqual([]);
  });

  it('survives a row with no zone and no spot', () => {
    const bare = sheetFromPayload(payload([row({ zone: null, spot: null })]), '2026-11-28T05:00:00Z')!.rows;
    expect(searchSheet(bare, 'earbuds')).toHaveLength(1);
    expect(searchSheet(bare, 'library')).toHaveLength(0);
  });
});

describe('the offline page reads what the desk page wrote', () => {
  it('agrees on the storage key', () => {
    const offline = loadBrowserScript('offline-sheet.js').LNFOffline as { SHEET_KEY: string; SHEET_VERSION: number };
    expect(offline.SHEET_KEY).toBe(SHEET_KEY);
    expect(offline.SHEET_VERSION).toBe(SHEET_VERSION);
  });

  it('parses a sheet built by the TypeScript module, row for row', () => {
    const sheet = sheetFromPayload(
      payload([row(), row({ ref: 'LF-2026-0012', zone: null, spot: 'Main Gate' })]),
      '2026-11-28T05:30:00Z',
    )!;
    const offline = loadBrowserScript('offline-sheet.js').LNFOffline as {
      parseSheet: (raw: string | null) => { rows: unknown[]; savedAt: string } | null;
      searchSheet: (rows: unknown[], q: string) => unknown[];
    };
    const back = offline.parseSheet(sheetToJson(sheet));
    expect(back).not.toBeNull();
    expect(back!.savedAt).toBe(sheet.savedAt);
    expect(back!.rows).toEqual(sheet.rows);
    expect(offline.searchSheet(back!.rows, '0012')).toHaveLength(1);
  });

  it('refuses what the TypeScript module refuses', () => {
    const offline = loadBrowserScript('offline-sheet.js').LNFOffline as {
      parseSheet: (raw: string | null) => unknown;
    };
    expect(offline.parseSheet('{')).toBeNull();
    expect(offline.parseSheet(JSON.stringify({ version: 99, savedAt: '2026-11-28T05:30:00Z', rows: [row()] }))).toBeNull();
    expect(offline.parseSheet(JSON.stringify({ version: SHEET_VERSION, savedAt: '2026-11-28T05:30:00Z', rows: [] }))).toBeNull();
  });

  it('expires a sheet on the same line the TypeScript module does', () => {
    const offline = loadBrowserScript('offline-sheet.js').LNFOffline as {
      sheetAge: (sheet: unknown, now: Date) => { stale: boolean; expired: boolean };
      SHEET_STALE_MS: number;
      SHEET_EXPIRED_MS: number;
    };
    expect(offline.SHEET_STALE_MS).toBe(SHEET_STALE_MS);
    expect(offline.SHEET_EXPIRED_MS).toBe(SHEET_EXPIRED_MS);
    const sheet = { savedAt: '2026-11-28T05:00:00Z' };
    const at = (ms: number) => offline.sheetAge(sheet, new Date(Date.parse('2026-11-28T05:00:00Z') + ms));
    expect(at(SHEET_STALE_MS).stale).toBe(true);
    expect(at(SHEET_STALE_MS - 1).stale).toBe(false);
    expect(at(SHEET_EXPIRED_MS).expired).toBe(true);
  });
});

describe('what the service worker may cache', () => {
  const policy = loadBrowserScript('sw-policy.js').LNFPolicy as {
    CACHE: string;
    PRECACHE: string[];
    isPrivate: (path: string) => boolean;
    isStatic: (path: string) => boolean;
    plan: (request: { url: string; method?: string; mode?: string }, origin?: string) => string;
  };
  const ORIGIN = 'https://lnf.example';
  const req = (path: string, over: Record<string, unknown> = {}) => ({
    url: `${ORIGIN}${path}`,
    method: 'GET',
    mode: 'no-cors',
    ...over,
  });

  it('never caches an API response, a session page, or a listing', () => {
    for (const path of ['/api/health', '/api/staff/report/monthly', '/staff', '/staff/desk', '/account', '/messages', '/claims', '/disputes', '/admin', '/items/LF-2026-0007', '/hand-in', '/report/found', '/sign-in']) {
      expect(policy.plan(req(path, { mode: 'navigate' }), ORIGIN)).toBe('bypass');
      expect(policy.isPrivate(path)).toBe(true);
    }
  });

  it('never touches anything but GET', () => {
    expect(policy.plan(req('/browse', { method: 'POST', mode: 'navigate' }), ORIGIN)).toBe('bypass');
  });

  it('never touches another origin', () => {
    expect(policy.plan({ url: 'https://storage.example/x.webp', method: 'GET', mode: 'no-cors' }, ORIGIN)).toBe('bypass');
  });

  it('serves immutable build assets from the cache', () => {
    expect(policy.plan(req('/_next/static/chunks/main-abc123.js'), ORIGIN)).toBe('static');
    expect(policy.plan(req('/icon-192.png'), ORIGIN)).toBe('static');
    expect(policy.plan(req('/offline.html'), ORIGIN)).toBe('static');
  });

  it('sends a navigation to the network, with the offline page as the only fallback', () => {
    expect(policy.plan(req('/browse', { mode: 'navigate' }), ORIGIN)).toBe('navigation');
    expect(policy.plan(req('/', { mode: 'navigate' }), ORIGIN)).toBe('navigation');
    // a non-navigation fetch of a page is not a navigation: leave it alone
    expect(policy.plan(req('/browse'), ORIGIN)).toBe('bypass');
  });

  it('precaches the offline page and its reader', () => {
    expect(policy.PRECACHE).toContain('/offline.html');
    expect(policy.PRECACHE).toContain('/offline-sheet.js');
    expect(policy.CACHE.startsWith('lnf-')).toBe(true);
  });
});
