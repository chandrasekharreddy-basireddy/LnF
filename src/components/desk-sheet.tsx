'use client';

import { useMemo, useState, useSyncExternalStore } from 'react';
import {
  SHEET_KEY,
  SHEET_STALE_MS,
  parseSheet,
  sheetAge,
  sheetFromPayload,
  sheetSummary,
  sheetToJson,
  type DeskSheetRow,
} from '@/lib/offline';

/**
 * The one control on the desk sheet: keep a copy of this list in this browser.
 *
 * It writes to localStorage and nothing else — no cookie, no server, no queue of
 * writes to replay. The sheet is public-equivalent by construction (the function
 * behind it only returns what /browse already shows), so a browser that outlives
 * a shift leaks nothing that was not public. What it does leak is *staleness*,
 * which is why the copy carries its save time and stops being shown after a day.
 *
 * The stored value is read through `useSyncExternalStore` rather than an effect:
 * the server snapshot is "nothing saved", the browser snapshot is the real one,
 * so hydration matches and a save in another tab is picked up by the `storage`
 * event.
 */
const CHANGED = 'lnf-desk-sheet-changed';

function read(): string | null {
  try {
    return window.localStorage.getItem(SHEET_KEY);
  } catch {
    return null;
  }
}

function subscribe(onChange: () => void) {
  window.addEventListener('storage', onChange);
  window.addEventListener(CHANGED, onChange);
  return () => {
    window.removeEventListener('storage', onChange);
    window.removeEventListener(CHANGED, onChange);
  };
}

function announce() {
  window.dispatchEvent(new Event(CHANGED));
}

export function DeskSheetSave({ rows, generatedAt }: { rows: DeskSheetRow[]; generatedAt: string | null }) {
  const raw = useSyncExternalStore(subscribe, read, () => null);
  const sheet = useMemo(() => parseSheet(raw), [raw]);
  const [note, setNote] = useState('');

  const summary = sheet ? sheetSummary(sheet, new Date()) : null;
  const stale = sheet ? sheetAge(sheet, new Date()).stale : false;

  const save = () => {
    try {
      const next = sheetFromPayload({ ok: true, rows, generatedAt }, new Date().toISOString());
      if (!next) {
        setNote('There is nothing on this sheet to save.');
        return;
      }
      window.localStorage.setItem(SHEET_KEY, sheetToJson(next));
      announce();
      setNote('Saved in this browser. It works with the network off.');
    } catch {
      setNote('This browser refused to store it — private mode, or no room left. The sheet still works online.');
    }
  };

  const clear = () => {
    try {
      window.localStorage.removeItem(SHEET_KEY);
      announce();
    } catch {
      // nothing stored, nothing to remove
    }
    setNote('Removed from this browser.');
  };

  return (
    <div className="card" style={{ padding: 18 }}>
      <h3 style={{ marginTop: 0 }}>Keep this sheet for the counter</h3>
      <p className="small muted" style={{ marginTop: 6 }}>
        {rows.length} {rows.length === 1 ? 'item' : 'items'} on the board right now. Saving stores the reference, title,
        category and where it was found — nothing about who reported it, no answer, no claim. It is the same list a
        visitor sees on the board.
      </p>
      <div className="row" style={{ marginTop: 12, flexWrap: 'wrap', gap: 8 }}>
        <button type="button" className="btn btn-sm" onClick={save}>
          {summary ? 'Save again' : 'Save for offline'}
        </button>
        {summary ? (
          <button type="button" className="btn btn-secondary btn-sm" onClick={clear}>
            Remove from this browser
          </button>
        ) : null}
        <a className="btn btn-secondary btn-sm" href="/offline.html" target="_blank" rel="noreferrer">
          Open the offline sheet
        </a>
      </div>
      <p className="small" role="status" aria-live="polite" style={{ marginTop: 10 }}>
        {summary ? `In this browser: ${summary}.` : 'Nothing saved in this browser yet.'}
      </p>
      {stale ? (
        <p className="small" style={{ marginTop: 4 }}>
          That copy is more than {Math.round(SHEET_STALE_MS / 3_600_000)} hours old. Save again before a shift — an old
          sheet is a wrong answer at the counter.
        </p>
      ) : null}
      {note ? (
        <p className="small muted" style={{ marginTop: 4 }}>
          {note}
        </p>
      ) : null}
    </div>
  );
}
