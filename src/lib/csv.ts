/**
 * A small CSV reader for the backlog import. Handles quoted fields, escaped
 * quotes, CRLF and a header row with aliases, because a desk will paste a
 * spreadsheet rather than hand-craft JSON.
 */

export type CsvRow = Record<string, string>;

const ALIASES: Record<string, string> = {
  title: 'title',
  name: 'title',
  item: 'title',
  description: 'description',
  desc: 'description',
  details: 'description',
  question: 'question',
  q: 'question',
  verification_question: 'question',
  answer: 'answer',
  a: 'answer',
  event_date: 'event_date',
  date: 'event_date',
  found_on: 'event_date',
  category: 'category',
  type: 'category',
  zone_code: 'zone_code',
  zone: 'zone_code',
  spot: 'spot',
  location: 'spot',
  custody: 'custody',
  bin: 'bin',
};

/** Split one CSV document into rows of cells. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;

  const source = text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');

  for (let i = 0; i < source.length; i += 1) {
    const char = source[i];

    if (quoted) {
      if (char === '"') {
        if (source[i + 1] === '"') {
          cell += '"';
          i += 1;
        } else {
          quoted = false;
        }
      } else {
        cell += char;
      }
      continue;
    }

    if (char === '"') {
      quoted = true;
    } else if (char === ',') {
      row.push(cell);
      cell = '';
    } else if (char === '\n') {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else {
      cell += char;
    }
  }

  if (cell.length > 0 || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }

  return rows.filter((cells) => cells.some((value) => value.trim() !== ''));
}

/** Map the header row onto the fields the importer expects. */
export function toImportRows(text: string): { rows: CsvRow[]; headers: string[]; unknown: string[] } {
  const table = parseCsv(text);
  if (table.length === 0) return { rows: [], headers: [], unknown: [] };

  const headers = table[0].map((h) => h.trim().toLowerCase().replace(/\s+/g, '_'));
  const mapped = headers.map((h) => ALIASES[h] ?? null);
  const unknown = headers.filter((h, index) => mapped[index] === null && h !== '');

  const rows = table.slice(1).map((cells) => {
    const row: CsvRow = {};
    mapped.forEach((field, index) => {
      if (field) row[field] = (cells[index] ?? '').trim();
    });
    return row;
  });

  return { rows, headers, unknown };
}

/** What the importer will refuse, so the desk sees it before the round trip. */
export function rowProblem(row: CsvRow): string | null {
  if ((row.title ?? '').length < 3) return 'title too short';
  if ((row.description ?? '').length < 10) return 'description too short';
  if ((row.question ?? '').length < 8) return 'question too short';
  if ((row.answer ?? '').length < 1) return 'answer missing';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(row.event_date ?? '')) return 'date must be YYYY-MM-DD';
  return null;
}
