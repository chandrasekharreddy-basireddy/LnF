import { describe, expect, it } from 'vitest';
import {
  A4,
  buildReportPdf,
  formatDays,
  formatPeriod,
  formatRate,
  formatRateCell,
  formatStamp,
  layoutReport,
  monthKey,
  monthRange,
  pdfSafeText,
  recentMonths,
  reportFilename,
  reportFlows,
  reportNotes,
  wrapText,
  type ReportBucket,
  type ReportInput,
  type ReportSnapshot,
} from '../../src/lib/monthly-report';

const bucket = (over: Partial<ReportBucket> = {}): ReportBucket => ({
  key: 'library',
  label: 'Central Library',
  handedIn: 12,
  returned: 7,
  rate: 58.3,
  lowSample: false,
  ...over,
});

const snapshot = (over: Partial<ReportSnapshot> = {}): ReportSnapshot => ({
  from: '2026-09-01',
  to: '2026-09-30',
  days: 30,
  clamped: false,
  generatedAt: '2026-10-01T04:30:00+00:00',
  totals: {
    handedIn: 24,
    returned: 11,
    recoveryRate: 45.8,
    lowSample: false,
    medianDaysToRecovery: 3.5,
    handovers: 11,
    awaitingCollection: 2,
    openOnBoard: 9,
    lostReports: 6,
    claimsSubmitted: 14,
    claimsApproved: 11,
    claimsRejected: 2,
    disputesOpened: 1,
    disputesUpheld: 0,
  },
  byZone: [
    bucket(),
    bucket({ key: 'canteen', label: 'Canteen & Food Court', handedIn: 8, returned: 4, rate: 50 }),
    bucket({ key: 'sports', label: 'Sports Complex', handedIn: 4, returned: 4, rate: 100, lowSample: true }),
  ],
  byCategory: [
    bucket({ key: 'electronics', label: 'electronics', handedIn: 15, returned: 8, rate: 53.3 }),
    bucket({ key: 'keys', label: 'keys', handedIn: 9, returned: 3, rate: 33.3 }),
  ],
  byMonth: [
    bucket({ key: '2026-09', label: 'Sep 2026', handedIn: 24, returned: 11, rate: 45.8, handovers: 11 }),
  ],
  ...over,
});

const input = (over: Partial<ReportSnapshot> = {}): ReportInput => ({
  snapshot: snapshot(over),
  venue: 'Sai University',
});

const latin1 = (bytes: Uint8Array): string => Array.from(bytes, (b) => String.fromCharCode(b)).join('');

describe('month ranges', () => {
  it('covers a whole month, including a leap February', () => {
    expect(monthRange('2026-09')).toEqual({
      key: '2026-09',
      from: '2026-09-01',
      to: '2026-09-30',
      label: 'September 2026',
    });
    expect(monthRange('2024-02')?.to).toBe('2024-02-29');
    expect(monthRange('2026-02')?.to).toBe('2026-02-28');
  });

  it('refuses anything that is not a real YYYY-MM month', () => {
    for (const bad of ['', '2026', '2026-13', '2026-00', '2026-1', '2026-09-01', 'sept-2026', '1999-12', null, undefined]) {
      expect(monthRange(bad)).toBeNull();
    }
  });

  it('reads the current month in UTC, the clock the database uses', () => {
    expect(monthKey(new Date('2026-11-30T23:30:00Z'))).toBe('2026-11');
    expect(monthKey(new Date('2026-12-01T00:10:00Z'))).toBe('2026-12');
  });

  it('lists recent months newest first, across a year boundary', () => {
    const months = recentMonths(3, new Date('2026-02-15T12:00:00Z'));
    expect(months.map((m) => m.key)).toEqual(['2026-02', '2026-01', '2025-12']);
    expect(months[2].label).toBe('December 2025');
  });
});

describe('dates and numbers', () => {
  it('formats a day without letting a timezone move it', () => {
    expect(formatPeriod('2026-09-01', '2026-09-30')).toBe('1 September 2026 – 30 September 2026');
    expect(formatPeriod('2026-09-01', '2026-09-01')).toBe('1 September 2026');
  });

  it('stamps in UTC', () => {
    expect(formatStamp('2026-10-01T04:30:00+00:00')).toBe('1 Oct 2026, 04:30 UTC');
  });

  it('marks a rate that rests on fewer than five items', () => {
    expect(formatRate(45.8, false)).toBe('45.8%');
    expect(formatRate(100, true)).toBe('100.0% (small sample)');
    expect(formatRate(null, false)).toBe('n/a');
    expect(formatRateCell(45.8, false, 24)).toBe('45.8%');
    expect(formatRateCell(100, true, 4)).toBe('100.0% (n=4)');
    expect(formatRateCell(null, true, 0)).toBe('n/a');
    expect(formatDays(3)).toBe('3 days');
    expect(formatDays(3.5)).toBe('3.5 days');
    expect(formatDays(null)).toBe('n/a');
  });

  it('names the file after the period it covers', () => {
    expect(reportFilename('2026-09-01', '2026-09-30')).toBe('lnf-report-2026-09-01-to-2026-09-30.pdf');
  });
});

describe('PDF text safety', () => {
  it('escapes the three characters that mean something inside a PDF string', () => {
    expect(pdfSafeText('Notes (draft) \\ final')).toBe('Notes \\(draft\\) \\\\ final');
  });

  it('folds typographic punctuation to ASCII', () => {
    expect(pdfSafeText('1 September – 30 September')).toBe('1 September - 30 September');
    expect(pdfSafeText('the desk’s “log”')).toBe("the desk's \"log\"");
  });

  it('replaces characters outside ASCII rather than emitting a broken string', () => {
    expect(pdfSafeText('Café Ångström 北京')).toBe('Caf? ?ngstr?m ??');
    expect(pdfSafeText('line\u0000break')).toBe('line break');
  });
});

describe('wrapping', () => {
  it('never splits a word and never loses one', () => {
    const text =
      'The cohort is every found item taken in during the period, and returned counts that same cohort.';
    const lines = wrapText(text, 9, 300);
    expect(lines.length).toBeGreaterThan(1);
    expect(lines.join(' ')).toBe(text);
    for (const line of lines) expect(line.length).toBeLessThanOrEqual(66);
  });
});

describe('the report flows', () => {
  it('carries the cohort definition and the sample caveat as sentences', () => {
    const notes = reportNotes(snapshot());
    expect(notes.join(' ')).toMatch(/cohort is every found item taken in during the period/);
    expect(notes.join(' ')).toMatch(/fewer than 5 items/);
    expect(notes.join(' ')).toMatch(/\(n=4\)/);
    expect(notes.join(' ')).toMatch(/UTC days/);
  });

  it('says so when a longer range was cut to a year', () => {
    expect(reportNotes(snapshot({ clamped: true }))[0]).toMatch(/covers 367 days/);
    const flows = reportFlows(input({ clamped: true }));
    expect(flows.some((f) => f.t === 'para' && /longer than a year/.test(f.text))).toBe(true);
  });

  it('keeps every rate between 0 and 100', () => {
    const snap = snapshot();
    const rates = [snap.totals.recoveryRate, ...snap.byZone.map((b) => b.rate), ...snap.byCategory.map((b) => b.rate)];
    for (const rate of rates) {
      if (rate === null) continue;
      expect(rate).toBeGreaterThanOrEqual(0);
      expect(rate).toBeLessThanOrEqual(100);
    }
    expect(latin1(buildReportPdf(input()))).toContain('45.8%');
  });
});

describe('the PDF', () => {
  const pdf = buildReportPdf(input());
  const text = latin1(pdf);

  it('is a PDF 1.4 file that ends where it says it does', () => {
    expect(text.startsWith('%PDF-1.4\n')).toBe(true);
    expect(text.endsWith('%%EOF\n')).toBe(true);
  });

  it('is pure ASCII, so it can be inspected with a grep', () => {
    for (const byte of pdf) expect(byte).toBeLessThan(128);
  });

  it('has a cross-reference table whose offsets point at the objects', () => {
    const startxref = Number(/startxref\n(\d+)\n%%EOF/.exec(text)?.[1]);
    expect(Number.isFinite(startxref)).toBe(true);
    expect(text.slice(startxref, startxref + 4)).toBe('xref');

    const size = Number(/\/Size (\d+)/.exec(text)?.[1]);
    const entries = text.slice(startxref).split('\n');
    for (let i = 1; i < size; i++) {
      const offset = Number(entries[2 + i].slice(0, 10));
      expect(text.slice(offset, offset + `${i} 0 obj`.length)).toBe(`${i} 0 obj`);
    }
  });

  it('declares exactly the pages it draws, each with a content stream', () => {
    const pages = layoutReport(reportFlows(input()));
    expect(text).toContain(`/Count ${pages.length}`);
    expect(text.match(/\/Type \/Page /g)?.length).toBe(pages.length);
    expect(text.match(/\/Length \d+ >>\nstream/g)?.length).toBe(pages.length);
    expect(text).toContain(`Page 1 of ${pages.length}`);
  });

  it('carries the figures, the period and the venue', () => {
    expect(text).toContain('Lost & found: institution report');
    expect(text).toContain('Sai University');
    expect(text).toContain('1 September 2026 - 30 September 2026');
    expect(text).toContain('(24)');
    expect(text).toContain('(45.8%)');
    expect(text).toContain('(3.5 days)');
    expect(text).toContain('(Central Library)');
    expect(text).toContain('(Sep 2026)');
    // the parentheses inside the cell are escaped, which is how they survive the PDF string
    expect(text).toContain('(100.0% \\(n=4\\))');
  });

  it('is deterministic: the same numbers produce the same bytes', () => {
    expect(latin1(buildReportPdf(input()))).toBe(text);
  });

  it('paginates a long report instead of drawing off the page', () => {
    const big = snapshot({
      byMonth: Array.from({ length: 13 }, (_, i) =>
        bucket({ key: `2026-${i}`, label: `M${i} 2026`, handovers: i }),
      ),
      byZone: Array.from({ length: 24 }, (_, i) => bucket({ key: `z${i}`, label: `Zone ${i}` })),
    });
    const pages = layoutReport(reportFlows({ snapshot: big, venue: 'Sai University' }));
    expect(pages.length).toBeGreaterThan(1);
    for (const page of pages) {
      for (const draw of page.draws) {
        if (draw.t !== 'text') continue;
        expect(draw.y).toBeGreaterThan(0);
        expect(draw.y).toBeLessThan(A4.height);
        expect(draw.x).toBeGreaterThanOrEqual(A4.margin - 1);
        expect(draw.x).toBeLessThan(A4.width);
      }
    }
  });

  it('draws an empty period as a sentence, not as a blank table', () => {
    const empty = buildReportPdf(
      input({
        totals: {
          ...snapshot().totals,
          handedIn: 0,
          returned: 0,
          recoveryRate: null,
          handovers: 0,
          medianDaysToRecovery: null,
        },
        byZone: [],
        byCategory: [],
        byMonth: [],
      }),
    );
    expect(latin1(empty)).toContain('(Nothing was handed in during this period.)');
    expect(latin1(empty)).toContain('(n/a)');
  });
});
