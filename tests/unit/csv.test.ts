import { describe, expect, it } from 'vitest';
import { parseCsv, rowProblem, toImportRows } from '../../src/lib/csv';

describe('parseCsv', () => {
  it('splits a simple document', () => {
    expect(parseCsv('a,b\n1,2')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });

  it('keeps commas inside quotes', () => {
    expect(parseCsv('title,description\n"Bottle, steel","Dented, blue"')).toEqual([
      ['title', 'description'],
      ['Bottle, steel', 'Dented, blue'],
    ]);
  });

  it('handles escaped quotes and CRLF', () => {
    expect(parseCsv('title\r\n"A ""quoted"" name"\r\n')).toEqual([['title'], ['A "quoted" name']]);
  });

  it('drops blank lines and a byte-order mark', () => {
    expect(parseCsv('\uFEFFa\n\nb\n')).toEqual([['a'], ['b']]);
  });
});

describe('toImportRows', () => {
  it('maps header aliases onto the importer fields', () => {
    const { rows, unknown } = toImportRows('Name,Desc,Q,A,Date\nUmbrella,"Grey, folded",Handle?,blue,2026-11-20');
    expect(unknown).toEqual([]);
    expect(rows[0]).toEqual({
      title: 'Umbrella',
      description: 'Grey, folded',
      question: 'Handle?',
      answer: 'blue',
      event_date: '2026-11-20',
    });
  });

  it('reports columns it does not recognise instead of dropping them silently', () => {
    const { unknown } = toImportRows('title,colour_of_soul\nx,y');
    expect(unknown).toEqual(['colour_of_soul']);
  });
});

describe('rowProblem', () => {
  const good = {
    title: 'Grey umbrella',
    description: 'Folded grey umbrella with a wooden handle',
    question: 'What is taped to the handle?',
    answer: 'blue tape',
    event_date: '2026-11-20',
  };

  it('accepts a complete row', () => {
    expect(rowProblem(good)).toBeNull();
  });

  it.each([
    [{ ...good, title: 'x' }, 'title too short'],
    [{ ...good, description: 'short' }, 'description too short'],
    [{ ...good, question: 'why?' }, 'question too short'],
    [{ ...good, answer: '' }, 'answer missing'],
    [{ ...good, event_date: '20/11/2026' }, 'date must be YYYY-MM-DD'],
  ])('rejects %o', (row, reason) => {
    expect(rowProblem(row)).toBe(reason);
  });
});
