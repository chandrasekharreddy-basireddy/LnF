/**
 * The monthly institution report, as a document.
 *
 * Everything here is pure: a snapshot of numbers in, a byte array out. No
 * Supabase client, no React, no filesystem, so the whole thing is testable and
 * the route that serves it only has to decide who may ask.
 *
 * The PDF is written by hand rather than with a library. A report is four
 * tables and a dozen figures; a dependency that pulls a font stack into the
 * build is a worse trade than 300 lines of PDF 1.4, and every byte is ASCII so
 * the output can be checked with a grep as well as a viewer.
 *
 * Two rules the numbers keep, because a recovery rate that changes definition
 * between months is worse than no number at all:
 *   - the cohort is "found items taken in during the period", and `returned`
 *     counts that same cohort, so the rate cannot exceed 100% by mixing sets;
 *   - a rate on fewer than 5 items is marked as a small sample, in the document,
 *     not in a footnote nobody reads.
 */

export const A4 = { width: 595, height: 842, margin: 56 } as const;

const FOOTER_SPACE = 46;

export type ReportBucket = {
  key: string;
  label: string;
  handedIn: number;
  returned: number;
  handovers?: number;
  rate: number | null;
  lowSample: boolean;
};

export type ReportTotals = {
  handedIn: number;
  returned: number;
  recoveryRate: number | null;
  lowSample: boolean;
  medianDaysToRecovery: number | null;
  handovers: number;
  awaitingCollection: number;
  openOnBoard: number;
  lostReports: number;
  claimsSubmitted: number;
  claimsApproved: number;
  claimsRejected: number;
  disputesOpened: number;
  disputesUpheld: number;
};

export type ReportSnapshot = {
  from: string;
  to: string;
  days: number;
  clamped: boolean;
  generatedAt: string;
  totals: ReportTotals;
  byZone: ReportBucket[];
  byCategory: ReportBucket[];
  byMonth: ReportBucket[];
};

export type ReportInput = {
  snapshot: ReportSnapshot;
  /** the venue, from NEXT_PUBLIC_CAMPUS_NAME — never a person */
  venue: string;
};

export type MonthRange = { key: string; from: string; to: string; label: string };

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

const SHORT_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// ---------------------------------------------------------------- dates

function isoDate(year: number, monthIndex: number, day: number): string {
  return `${year}-${String(monthIndex + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function daysInMonth(year: number, monthIndex: number): number {
  return new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
}

/** "2026-11" for the given instant, read in UTC: the database counts in UTC days. */
export function monthKey(date: Date = new Date()): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

/**
 * Parse "YYYY-MM" into the UTC day range it covers. Returns null for anything
 * else — including "2026-13" and "2026-11-04" — so the caller can answer 400
 * rather than quietly reporting on a month nobody asked for.
 */
export function monthRange(month: string | null | undefined): MonthRange | null {
  const raw = (month ?? '').trim();
  const match = /^(\d{4})-(\d{2})$/.exec(raw);
  if (!match) return null;
  const year = Number(match[1]);
  const monthNumber = Number(match[2]);
  if (year < 2000 || year > 2100) return null;
  if (monthNumber < 1 || monthNumber > 12) return null;
  const monthIndex = monthNumber - 1;
  return {
    key: raw,
    from: isoDate(year, monthIndex, 1),
    to: isoDate(year, monthIndex, daysInMonth(year, monthIndex)),
    label: `${MONTHS[monthIndex]} ${year}`,
  };
}

/** The last `count` months, newest first, ending with the month `today` is in. */
export function recentMonths(count: number, today: Date = new Date()): MonthRange[] {
  const out: MonthRange[] = [];
  const year = today.getUTCFullYear();
  const month = today.getUTCMonth();
  for (let i = 0; i < Math.max(count, 1); i++) {
    const d = new Date(Date.UTC(year, month - i, 1));
    const range = monthRange(monthKey(d));
    if (range) out.push(range);
  }
  return out;
}

/** "2026-09-01" → "1 September 2026". Parsed by hand: no timezone can shift a day. */
export function formatDay(iso: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!match) return iso;
  const monthIndex = Number(match[2]) - 1;
  if (monthIndex < 0 || monthIndex > 11) return iso;
  return `${Number(match[3])} ${MONTHS[monthIndex]} ${match[1]}`;
}

export function formatPeriod(from: string, to: string): string {
  if (from === to) return formatDay(from);
  return `${formatDay(from)} – ${formatDay(to)}`;
}

/** The report is stamped in UTC, the same clock the database uses. */
export function formatStamp(iso: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/.exec(iso);
  if (!match) return iso;
  return `${Number(match[3])} ${SHORT_MONTHS[Number(match[2]) - 1]} ${match[1]}, ${match[4]}:${match[5]} UTC`;
}

export function reportFilename(from: string, to: string): string {
  return `lnf-report-${from}-to-${to}.pdf`;
}

// ---------------------------------------------------------------- numbers

/** A rate is shown to one decimal, and marked when it rests on fewer than 5 items. */
export function formatRate(rate: number | null, lowSample: boolean): string {
  if (rate === null) return 'n/a';
  const value = `${rate.toFixed(1)}%`;
  return lowSample ? `${value} (small sample)` : value;
}

/**
 * The table form of a rate. A phrase like "small sample" does not fit a 100pt
 * column, so the cell carries the count it rests on: "100.0% (n=4)".
 */
export function formatRateCell(rate: number | null, lowSample: boolean, handedIn: number): string {
  if (rate === null) return 'n/a';
  const value = `${rate.toFixed(1)}%`;
  return lowSample ? `${value} (n=${handedIn})` : value;
}

export function formatDays(value: number | null): string {
  if (value === null) return 'n/a';
  return Number.isInteger(value) ? `${value} days` : `${value.toFixed(1)} days`;
}

// ---------------------------------------------------------------- text

/**
 * PDF literal-string safety. Typographic punctuation is folded to ASCII, any
 * remaining non-ASCII becomes "?" (a name with an accent is not worth a font
 * subset in a report), and the three characters that mean something inside a
 * PDF string are escaped.
 */
export function pdfSafeText(value: string): string {
  const folded = value
    .replace(/[\u2018\u2019\u201a\u201b]/g, "'")
    .replace(/[\u201c\u201d\u201e\u201f]/g, '"')
    .replace(/[\u2013\u2014\u2212]/g, '-')
    .replace(/\u2026/g, '...')
    .replace(/\u00a0/g, ' ');
  let out = '';
  for (const char of folded) {
    const code = char.codePointAt(0) ?? 63;
    if (code < 32 || code === 127) out += ' ';
    else if (code > 126) out += '?';
    else out += char;
  }
  return out.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}

/** Helvetica advances, in thousandths of an em, for the characters a number uses. */
function numericWidth(text: string, size: number): number {
  let width = 0;
  for (const char of text) {
    if (char >= '0' && char <= '9') width += 556;
    else if (char === '.') width += 278;
    else if (char === '-') width += 333;
    else if (char === '%') width += 889;
    else if (char === ' ') width += 278;
    else width += 556;
  }
  return (width / 1000) * size;
}

/** Greedy wrap on spaces, at an approximate character count for the given size. */
export function wrapText(text: string, size: number, width: number): string[] {
  const maxChars = Math.max(20, Math.floor(width / (size * 0.5)));
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = '';
  for (const word of words) {
    if (!line) {
      line = word;
    } else if (line.length + 1 + word.length <= maxChars) {
      line += ` ${word}`;
    } else {
      lines.push(line);
      line = word;
    }
  }
  if (line) lines.push(line);
  return lines.length ? lines : [''];
}

// ---------------------------------------------------------------- layout

export type Draw =
  | { t: 'text'; x: number; y: number; size: number; bold: boolean; text: string }
  | { t: 'rule'; x1: number; x2: number; y: number; weight: number };

export type Flow =
  | { t: 'title'; text: string }
  | { t: 'sub'; text: string }
  | { t: 'gap'; h: number }
  | { t: 'heading'; text: string }
  | { t: 'kv'; label: string; value: string }
  | { t: 'para'; text: string; size: number }
  | { t: 'table'; head: string[]; rows: string[][]; widths: number[]; numeric: boolean[] };

const CONTENT_WIDTH = A4.width - A4.margin * 2;

function kv(label: string, value: string): Flow {
  return { t: 'kv', label, value };
}

function table(head: string[], rows: string[][], widths: number[], numeric: boolean[]): Flow {
  return { t: 'table', head, rows, widths, numeric };
}

/**
 * Turn the snapshot into the report's flow: what to draw, in order. Kept
 * separate from layout so the words can be tested without reading a PDF.
 */
export function reportFlows(input: ReportInput): Flow[] {
  const { snapshot, venue } = input;
  const { totals } = snapshot;
  const flows: Flow[] = [
    { t: 'title', text: 'Lost & found: institution report' },
    { t: 'sub', text: venue },
    { t: 'sub', text: formatPeriod(snapshot.from, snapshot.to) },
    { t: 'sub', text: `Generated ${formatStamp(snapshot.generatedAt)}` },
  ];

  if (snapshot.clamped) {
    flows.push({
      t: 'para',
      size: 8.5,
      text: `The requested range was longer than a year, so this report covers the last 367 days of it.`,
    });
  }

  flows.push({ t: 'gap', h: 10 });
  flows.push({ t: 'heading', text: 'The headline' });
  flows.push(kv('Handed in at the desk', String(totals.handedIn)));
  flows.push(kv('Returned to an owner', String(totals.returned)));
  flows.push(kv('Recovery rate for this cohort', formatRate(totals.recoveryRate, totals.lowSample)));
  flows.push(kv('Median days to a return', formatDays(totals.medianDaysToRecovery)));
  flows.push(kv('Handovers recorded in the period', String(totals.handovers)));
  flows.push(kv('Still waiting to be collected', String(totals.awaitingCollection)));
  flows.push(kv('Open on the board', String(totals.openOnBoard)));
  flows.push(kv('Lost reports filed', String(totals.lostReports)));
  flows.push(
    kv(
      'Claims submitted / approved / rejected',
      `${totals.claimsSubmitted} / ${totals.claimsApproved} / ${totals.claimsRejected}`,
    ),
  );
  flows.push(kv('Disputes opened / upheld', `${totals.disputesOpened} / ${totals.disputesUpheld}`));

  const zoneWidths = [238, 60, 80, 105];
  flows.push({ t: 'gap', h: 12 });
  flows.push({ t: 'heading', text: 'Where items were found' });
  flows.push(
    table(
      ['Zone', 'In', 'Returned', 'Rate'],
      snapshot.byZone.length
        ? snapshot.byZone.map((b) => [
            b.label,
            String(b.handedIn),
            String(b.returned),
            formatRateCell(b.rate, b.lowSample, b.handedIn),
          ])
        : [['Nothing was handed in during this period.', '', '', '']],
      zoneWidths,
      [false, true, true, true],
    ),
  );

  const categoryWidths = [238, 60, 80, 105];
  flows.push({ t: 'gap', h: 12 });
  flows.push({ t: 'heading', text: 'What kind of thing it was' });
  flows.push(
    table(
      ['Category', 'In', 'Returned', 'Rate'],
      snapshot.byCategory.length
        ? snapshot.byCategory.map((b) => [
            b.label.charAt(0).toUpperCase() + b.label.slice(1),
            String(b.handedIn),
            String(b.returned),
            formatRateCell(b.rate, b.lowSample, b.handedIn),
          ])
        : [['Nothing was handed in during this period.', '', '', '']],
      categoryWidths,
      [false, true, true, true],
    ),
  );

  const monthWidths = [133, 60, 75, 85, 130];
  flows.push({ t: 'gap', h: 12 });
  flows.push({ t: 'heading', text: 'Month by month' });
  flows.push(
    table(
      ['Month', 'In', 'Returned', 'Handovers', 'Rate'],
      snapshot.byMonth.length
        ? snapshot.byMonth.map((b) => [
            b.label,
            String(b.handedIn),
            String(b.returned),
            String(b.handovers ?? 0),
            formatRateCell(b.rate, b.lowSample, b.handedIn),
          ])
        : [['No months in range.', '', '', '', '']],
      monthWidths,
      [false, true, true, true, true],
    ),
  );

  flows.push({ t: 'gap', h: 14 });
  flows.push({ t: 'heading', text: 'How to read this' });
  for (const note of reportNotes(snapshot)) {
    flows.push({ t: 'para', size: 8.5, text: note });
  }

  return flows;
}

/** The caveats, as sentences a reader can check against the tables. */
export function reportNotes(snapshot: ReportSnapshot): string[] {
  const notes = [
    'The cohort is every found item taken in during the period, and "returned" counts that same cohort. An item handed in before the period and collected during it appears under handovers, not in the rate.',
    'Days are UTC days, the clock the database keeps. A report cut at a local midnight may differ by one day from the desk logbook.',
    'Sample rows are excluded, so the demo board never inflates the numbers.',
    'A rate followed by a count in brackets, such as (n=4), rests on fewer than 5 items: 1 of 1 is 100% and means nothing.',
    'These are counts of what the desk recorded. An item that was found and never handed in does not appear here, and no report can know about it.',
  ];
  if (snapshot.clamped) {
    notes.unshift('This report covers 367 days because a longer range was requested; it is not a full history.');
  }
  return notes;
}

export type Page = { draws: Draw[] };

/** Lay the flows onto A4 pages. Tables that would break across a page start a new one. */
export function layoutReport(flows: Flow[]): Page[] {
  const pages: Page[] = [];
  let current: Page = { draws: [] };
  pages.push(current);
  let y = A4.height - A4.margin;

  const top = A4.height - A4.margin;
  const bottom = A4.margin + FOOTER_SPACE;

  const newPage = () => {
    current = { draws: [] };
    pages.push(current);
    y = top;
  };

  const room = (height: number) => y - height >= bottom;

  for (const flow of flows) {
    switch (flow.t) {
      case 'title': {
        const height = 26;
        if (!room(height)) newPage();
        y -= 22;
        current.draws.push({ t: 'text', x: A4.margin, y, size: 19, bold: true, text: flow.text });
        y -= 8;
        break;
      }
      case 'sub': {
        if (!room(16)) newPage();
        y -= 13;
        current.draws.push({ t: 'text', x: A4.margin, y, size: 10, bold: false, text: flow.text });
        y -= 3;
        break;
      }
      case 'gap': {
        y -= flow.h;
        break;
      }
      case 'heading': {
        // keep the heading with at least three lines of what it introduces
        const height = 30 + 3 * 16;
        if (!room(height)) newPage();
        y -= 20;
        current.draws.push({ t: 'text', x: A4.margin, y, size: 11.5, bold: true, text: flow.text });
        y -= 6;
        current.draws.push({ t: 'rule', x1: A4.margin, x2: A4.width - A4.margin, y, weight: 0.6 });
        y -= 6;
        break;
      }
      case 'kv': {
        if (!room(16)) newPage();
        y -= 14;
        current.draws.push({ t: 'text', x: A4.margin, y, size: 10, bold: false, text: flow.label });
        current.draws.push({ t: 'text', x: A4.margin + 260, y, size: 10, bold: true, text: flow.value });
        y -= 4;
        break;
      }
      case 'para': {
        for (const line of wrapText(flow.text, flow.size, CONTENT_WIDTH)) {
          if (!room(flow.size * 1.6)) newPage();
          y -= flow.size * 1.4;
          current.draws.push({ t: 'text', x: A4.margin, y, size: flow.size, bold: false, text: line });
          y -= 2;
        }
        break;
      }
      case 'table': {
        const rowHeight = 16;
        const drawHead = () => {
          y -= 14;
          let x = A4.margin;
          flow.head.forEach((cell, i) => {
            const width = flow.widths[i] ?? 0;
            const text = cell;
            const tx = flow.numeric[i] ? x + width - numericWidth(text, 9.5) : x;
            current.draws.push({ t: 'text', x: tx, y, size: 9.5, bold: true, text });
            x += width;
          });
          y -= 5;
          current.draws.push({ t: 'rule', x1: A4.margin, x2: A4.width - A4.margin, y, weight: 0.5 });
          y -= 4;
        };
        if (!room(rowHeight * 2)) newPage();
        drawHead();
        for (const row of flow.rows) {
          if (!room(rowHeight)) {
            newPage();
            drawHead();
          }
          y -= 14;
          let x = A4.margin;
          row.forEach((cell, i) => {
            const width = flow.widths[i] ?? 0;
            const tx = flow.numeric[i] ? x + width - numericWidth(cell, 9.5) : x;
            current.draws.push({ t: 'text', x: tx, y, size: 9.5, bold: false, text: cell });
            x += width;
          });
          y -= 4;
        }
        break;
      }
    }
  }

  return pages;
}

function contentStream(page: Page, index: number, total: number, input: ReportInput): string {
  const ops: string[] = ['0 G'];
  for (const draw of page.draws) {
    if (draw.t === 'text') {
      const font = draw.bold ? '/F2' : '/F1';
      ops.push(
        `BT ${font} ${draw.size} Tf 1 0 0 1 ${draw.x.toFixed(2)} ${draw.y.toFixed(2)} Tm (${pdfSafeText(draw.text)}) Tj ET`,
      );
    } else {
      ops.push(
        `${draw.weight.toFixed(2)} w 0.55 G ${draw.x1} ${draw.y.toFixed(2)} m ${draw.x2} ${draw.y.toFixed(2)} l S 0 G`,
      );
    }
  }

  // footer: the venue and the page count, so a printed page can be put back in order
  const footerY = A4.margin - 4;
  ops.push(
    `BT /F1 8 Tf 1 0 0 1 ${A4.margin} ${footerY} Tm (${pdfSafeText(input.venue)}) Tj ET`,
  );
  const pageLabel = `Page ${index + 1} of ${total}`;
  ops.push(
    `BT /F1 8 Tf 1 0 0 1 ${(A4.width - A4.margin - numericWidth(pageLabel, 8)).toFixed(2)} ${footerY} Tm (${pdfSafeText(pageLabel)}) Tj ET`,
  );

  return ops.join('\n');
}

// ---------------------------------------------------------------- assembly

/**
 * Assemble a PDF 1.4 file. Object numbering is fixed: 1 catalog, 2 page tree,
 * 3 and 4 the two fonts, then a page object and a content object per page. The
 * cross-reference table is written from the byte offsets actually produced, so
 * a broken offset would show up as a viewer refusing to open the file.
 */
export function assemblePdf(pageStreams: string[]): Uint8Array {
  const pageCount = Math.max(pageStreams.length, 1);
  const pageNumbers: number[] = [];
  const contentNumbers: number[] = [];
  let next = 5;
  for (let i = 0; i < pageCount; i++) {
    pageNumbers.push(next++);
    contentNumbers.push(next++);
  }

  const bodies: string[] = [];
  bodies[1] = '<< /Type /Catalog /Pages 2 0 R >>';
  bodies[2] = `<< /Type /Pages /Kids [${pageNumbers.map((n) => `${n} 0 R`).join(' ')}] /Count ${pageCount} >>`;
  bodies[3] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>';
  bodies[4] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>';

  for (let i = 0; i < pageCount; i++) {
    const stream = pageStreams[i] ?? '';
    bodies[pageNumbers[i]] =
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${A4.width} ${A4.height}] ` +
      `/Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${contentNumbers[i]} 0 R >>`;
    bodies[contentNumbers[i]] = `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`;
  }

  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [];
  for (let i = 1; i < bodies.length; i++) {
    offsets[i] = pdf.length;
    pdf += `${i} 0 obj\n${bodies[i]}\nendobj\n`;
  }

  const xrefStart = pdf.length;
  const size = bodies.length;
  let xref = `xref\n0 ${size}\n0000000000 65535 f \n`;
  for (let i = 1; i < size; i++) {
    xref += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  }
  pdf += xref;
  pdf += `trailer\n<< /Size ${size} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`;

  const bytes = new Uint8Array(pdf.length);
  for (let i = 0; i < pdf.length; i++) bytes[i] = pdf.charCodeAt(i) & 0xff;
  return bytes;
}

/** The whole document: flows → pages → one PDF byte array. */
export function buildReportPdf(input: ReportInput): Uint8Array {
  const pages = layoutReport(reportFlows(input));
  const streams = pages.map((page, index) => contentStream(page, index, pages.length, input));
  return assemblePdf(streams);
}
