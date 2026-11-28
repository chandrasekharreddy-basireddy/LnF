'use client';

import { useActionState, useMemo, useState } from 'react';
import { importRows, type ImportState } from '@/lib/actions/import';
import { rowProblem, toImportRows, type CsvRow } from '@/lib/csv';
import { SubmitButton } from './submit-button';
import { Banner } from './banner';

const initial: ImportState = { ok: false };

const TEMPLATE = `title,description,question,answer,event_date,category,zone_code,spot,bin
Black wireless earbuds,"Matte black case, small sticker on the back",What is the Bluetooth name of the case?,redmi buds,2026-11-20,electronics,library,Study desk 4,BIN-A-04`;

export function ImportForm() {
  const [state, action] = useActionState(importRows, initial);
  const [text, setText] = useState('');

  const parsed = useMemo(() => (text.trim() ? toImportRows(text) : { rows: [], headers: [], unknown: [] }), [text]);
  const checked = useMemo(
    () => parsed.rows.map((row: CsvRow, index) => ({ row, line: index + 2, problem: rowProblem(row) })),
    [parsed.rows],
  );
  const bad = checked.filter((r) => r.problem);
  const good = checked.filter((r) => !r.problem);

  return (
    <form className="form" action={action}>
      {state.error ? <Banner tone="danger">{state.error}</Banner> : null}
      {state.message ? <Banner tone="ok">{state.message}</Banner> : null}

      {state.skipped && state.skipped.length > 0 ? (
        <div className="card" style={{ background: 'var(--warn-bg)', borderColor: 'var(--warn-bg)' }}>
          <p className="small" style={{ marginBottom: 6 }}>
            <strong>Skipped rows</strong>
          </p>
          <ul className="small" style={{ margin: 0, paddingLeft: 18 }}>
            {state.skipped.map((row) => (
              <li key={`${row.row}-${row.reason}`}>
                Line {row.row}: {row.reason}
                {row.title ? ` — “${row.title}”` : ''}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="field">
        <label htmlFor="csv-file">Spreadsheet file (.csv)</label>
        <input
          id="csv-file"
          type="file"
          accept=".csv,text/csv,text/plain"
          onChange={async (event) => {
            const file = event.target.files?.[0];
            if (!file) return;
            setText(await file.text());
          }}
        />
        <p className="hint">Or paste the rows below. The header row names the columns.</p>
      </div>

      <div className="field">
        <label htmlFor="csv-text">Rows</label>
        <textarea
          id="csv-text"
          value={text}
          onChange={(event) => setText(event.target.value)}
          rows={8}
          spellCheck={false}
          placeholder={TEMPLATE}
          style={{ fontFamily: 'var(--mono)', fontSize: '0.82rem' }}
        />
        <p className="hint">
          Columns: title, description, question, answer, event_date, category, zone_code, spot, bin. Unknown columns
          are reported, not ignored.
        </p>
      </div>

      {parsed.unknown.length > 0 ? (
        <Banner tone="warn">
          These columns were not recognised and will be ignored: {parsed.unknown.join(', ')}
        </Banner>
      ) : null}

      {checked.length > 0 ? (
        <div className="card" style={{ overflowX: 'auto' }}>
          <p className="small" style={{ marginBottom: 8 }}>
            <strong>{good.length}</strong> ready, <strong>{bad.length}</strong> need a fix. First ten:
          </p>
          <table className="data">
            <thead>
              <tr>
                <th>Line</th>
                <th>Title</th>
                <th>Check</th>
              </tr>
            </thead>
            <tbody>
              {checked.slice(0, 10).map((entry) => (
                <tr key={entry.line}>
                  <td className="mono">{entry.line}</td>
                  <td>{entry.row.title || '—'}</td>
                  <td>
                    {entry.problem ? (
                      <span className="chip chip-danger">{entry.problem}</span>
                    ) : (
                      <span className="chip chip-ok">ready</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="hint" style={{ marginTop: 8 }}>
            Rows that fail the check are skipped by the database too; the report below lists them.
          </p>
        </div>
      ) : null}

      <input type="hidden" name="rows" value={JSON.stringify(parsed.rows)} />
      <div className="field">
        <label htmlFor="import-note">Where this sheet came from (optional)</label>
        <input id="import-note" name="note" type="text" maxLength={200} placeholder="Backlog box behind the desk, batch 1" />
      </div>

      <SubmitButton pendingLabel="Importing…" className="btn">
        {`Import ${parsed.rows.length || 0} rows`}
      </SubmitButton>
    </form>
  );
}
