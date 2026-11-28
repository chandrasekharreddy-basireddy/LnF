/**
 * The saved desk sheet, read back with no network.
 *
 * Loaded by /offline.html. It reads one localStorage key and draws a table.
 * Nothing here talks to the server, and nothing here decides who may look: the
 * sheet was built by a staff session in this browser, and it only ever held what
 * the public board shows.
 *
 * The pure half (`parseSheet`, `sheetAge`, `searchSheet`) mirrors src/lib/offline.ts
 * so the offline page and the desk page agree on the stored shape. A unit test
 * builds a sheet with the TypeScript module and parses it here: if the two drift,
 * the offline page would quietly show nothing, and that test is what stops it.
 *
 * Everything is drawn with textContent, never innerHTML. The sheet came from our
 * own database, but a page that renders stored data as markup is a page that one
 * bad title can turn into a script tag.
 */
(function (global) {
  'use strict';

  var SHEET_KEY = 'lnf-desk-sheet';
  var SHEET_VERSION = 1;
  var SHEET_STALE_MS = 12 * 60 * 60 * 1000;
  var SHEET_EXPIRED_MS = 24 * 60 * 60 * 1000;
  var SHEET_MAX_ROWS = 500;

  var REF = /^[A-Z]{2}-\d{4}-\d{4}$/i;
  var ISO_DATE = /^\d{4}-\d{2}-\d{2}/;
  var TYPES = { lost: true, found: true };
  var STATUSES = {
    pending_moderation: true,
    available: true,
    claimed: true,
    recovered: true,
    expired: true,
    quarantined: true,
    archived: true,
  };

  function text(value, max) {
    if (typeof value !== 'string') return null;
    var trimmed = value.trim();
    if (!trimmed) return null;
    return trimmed.slice(0, max);
  }

  function stamp(value) {
    if (typeof value !== 'string') return null;
    var trimmed = value.trim();
    return ISO_DATE.test(trimmed) ? trimmed.slice(0, 40) : null;
  }

  function toRow(raw) {
    if (!raw || typeof raw !== 'object') return null;
    var ref = text(raw.ref, 20);
    var title = text(raw.title, 120);
    var category = text(raw.category, 40);
    var type = text(raw.type, 8);
    var status = text(raw.status, 24);
    if (!ref || !REF.test(ref)) return null;
    if (!title || !category || !type || !status) return null;
    if (!TYPES[type] || !STATUSES[status]) return null;
    return {
      ref: ref.toUpperCase(),
      title: title,
      category: category,
      type: type,
      status: status,
      zone: text(raw.zone, 120),
      spot: text(raw.spot, 120),
      eventDate: stamp(raw.eventDate),
      heldSince: stamp(raw.heldSince),
    };
  }

  function parseSheet(raw) {
    if (typeof raw !== 'string' || raw.length === 0 || raw.length > 2000000) return null;
    var parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (err) {
      return null;
    }
    if (!parsed || typeof parsed !== 'object') return null;
    if (parsed.version !== SHEET_VERSION) return null;
    var savedAt = stamp(parsed.savedAt);
    if (!savedAt) return null;
    if (!Array.isArray(parsed.rows)) return null;
    var rows = [];
    for (var i = 0; i < parsed.rows.length; i++) {
      var row = toRow(parsed.rows[i]);
      if (row) rows.push(row);
      if (rows.length >= SHEET_MAX_ROWS) break;
    }
    if (rows.length === 0) return null;
    return { version: SHEET_VERSION, savedAt: savedAt, generatedAt: stamp(parsed.generatedAt), rows: rows };
  }

  function sheetAge(sheet, now) {
    var saved = Date.parse(sheet.savedAt);
    var ms = isFinite(saved) ? Math.max(0, now.getTime() - saved) : Infinity;
    return {
      ms: ms,
      stale: ms >= SHEET_STALE_MS,
      expired: ms >= SHEET_EXPIRED_MS,
    };
  }

  function ageLabel(ms) {
    if (!isFinite(ms)) return 'saved at an unknown time';
    var minutes = Math.floor(ms / 60000);
    if (minutes < 1) return 'saved just now';
    if (minutes === 1) return 'saved 1 minute ago';
    if (minutes < 60) return 'saved ' + minutes + ' minutes ago';
    var hours = Math.floor(minutes / 60);
    if (hours === 1) return 'saved 1 hour ago';
    return 'saved ' + hours + ' hours ago';
  }

  function searchSheet(rows, query) {
    var q = String(query == null ? '' : query).trim().toLowerCase();
    if (!q) return rows;
    var digits = /^[\d\s-]+$/.test(q) ? q.replace(/\D/g, '') : '';
    return rows.filter(function (row) {
      if (digits && row.ref.replace(/\D/g, '').indexOf(digits) !== -1) return true;
      var fields = [row.ref, row.title, row.category, row.zone || '', row.spot || ''];
      for (var i = 0; i < fields.length; i++) {
        if (fields[i].toLowerCase().indexOf(q) !== -1) return true;
      }
      return false;
    });
  }

  global.LNFOffline = {
    SHEET_KEY: SHEET_KEY,
    SHEET_VERSION: SHEET_VERSION,
    SHEET_STALE_MS: SHEET_STALE_MS,
    SHEET_EXPIRED_MS: SHEET_EXPIRED_MS,
    SHEET_MAX_ROWS: SHEET_MAX_ROWS,
    toRow: toRow,
    parseSheet: parseSheet,
    sheetAge: sheetAge,
    ageLabel: ageLabel,
    searchSheet: searchSheet,
  };

  if (typeof document === 'undefined') return;

  function cell(text) {
    var td = document.createElement('td');
    td.textContent = text == null ? '—' : String(text);
    return td;
  }

  function draw(rows) {
    var body = document.getElementById('sheet-rows');
    var count = document.getElementById('sheet-count');
    if (!body || !count) return;
    while (body.firstChild) body.removeChild(body.firstChild);
    rows.forEach(function (row) {
      var tr = document.createElement('tr');
      var ref = cell(row.ref);
      ref.style.whiteSpace = 'nowrap';
      tr.appendChild(ref);
      tr.appendChild(cell(row.title));
      tr.appendChild(cell(row.zone || row.spot || '—'));
      body.appendChild(tr);
    });
    count.textContent =
      rows.length === 1 ? '1 item matches' : rows.length + ' items match';
  }

  function start() {
    var state = document.getElementById('sheet-state');
    var body = document.getElementById('sheet-body');
    var input = document.getElementById('sheet-search');
    if (!state || !body || !input) return;

    var stored = null;
    try {
      stored = global.localStorage.getItem(SHEET_KEY);
    } catch (err) {
      state.textContent = 'This browser will not let the page read its storage, so there is no saved sheet here.';
      return;
    }

    var sheet = parseSheet(stored);
    if (!sheet) {
      state.textContent =
        'No saved sheet in this browser. When the network is back, a staff account can save one from Desk → Desk sheet.';
      return;
    }

    var age = sheetAge(sheet, new Date());
    if (age.expired) {
      state.textContent =
        'The saved sheet is ' + ageLabel(age.ms) + ', so it is not shown: the board has almost certainly moved on. ' +
        'Save a fresh one when the network returns.';
      return;
    }

    state.textContent =
      sheet.rows.length +
      (sheet.rows.length === 1 ? ' item' : ' items') +
      ', ' +
      ageLabel(age.ms) +
      (age.stale
        ? '. That is more than half a day old — check with the desk before you rely on it.'
        : '.');
    body.className = '';
    draw(sheet.rows);
    input.addEventListener('input', function () {
      draw(searchSheet(sheet.rows, input.value));
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
})(typeof globalThis !== 'undefined' ? globalThis : self);
