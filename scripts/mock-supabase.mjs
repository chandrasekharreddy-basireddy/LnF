/**
 * Local stand-in for Supabase's REST, Auth and Storage endpoints.
 * Used only by scripts/smoke.mjs so the UI can be rendered and checked in this
 * sandbox, which cannot reach the live project. Fixtures mirror the real
 * response shapes returned by supabase/migrations/0003_functions.sql.
 */
import http from 'node:http';

const ZONES = [
  { code: 'library', name: 'Central Library', sort_order: 20 },
  { code: 'canteen', name: 'Canteen & Food Court', sort_order: 50 },
  { code: 'sports', name: 'Sports Complex', sort_order: 60 },
  { code: 'lecture', name: 'Lecture Halls', sort_order: 30 },
  { code: 'parking', name: 'Parking & Shuttle Stop', sort_order: 80 },
  { code: 'main-gate', name: 'Main Gate & Security Desk', sort_order: 10 },
];

const ITEMS = [
  {
    id: '49550e3d-8aad-460c-9337-32dbb17c9146',
    ref: 'LF-2026-0007',
    type: 'found',
    status: 'available',
    category: 'electronics',
    title: 'Black wireless earbuds in a charging case',
    description:
      'Matte black earbuds in an open case. A small sticker on the back of the case. Found on a study desk.',
    zoneLabel: 'Central Library',
    zoneCode: 'library',
    spot: 'Quiet study desks, north windows',
    eventDate: '2026-11-24',
    custodyLabel: 'Main Gate & Security Desk',
    verificationQuestion: 'What is the Bluetooth name of the case?',
    sensitiveHiddenPhoto: false,
    isSample: true,
    createdAt: '2026-11-26T14:59:09.671181+00:00',
    coverPath: 'demo/earbuds.webp',
  },
  {
    id: 'a2',
    ref: 'LF-2026-0008',
    type: 'found',
    status: 'available',
    category: 'bags',
    title: 'Grey canvas backpack with a blue tag',
    description:
      'Single-compartment canvas bag, zip works fine, has a blue luggage tag with the name partly rubbed off.',
    zoneLabel: 'Canteen & Food Court',
    zoneCode: 'canteen',
    spot: 'Table near the billing counter',
    eventDate: '2026-11-23',
    custodyLabel: 'Canteen supervisor desk',
    verificationQuestion: 'What is written on the inside label?',
    sensitiveHiddenPhoto: false,
    isSample: true,
    createdAt: '2026-11-26T14:59:09.671181+00:00',
    coverPath: null,
  },
  {
    id: 'a3',
    ref: 'LF-2026-0009',
    type: 'found',
    status: 'available',
    category: 'documents',
    title: 'Steel water bottle with a dented base',
    description: 'One-litre steel bottle, blue cap, dent on the bottom edge. Name scratched off.',
    zoneLabel: 'Sports Complex',
    zoneCode: 'sports',
    spot: 'Bench by court 2',
    eventDate: '2026-11-25',
    custodyLabel: 'Sports office',
    verificationQuestion: 'What sticker is on the bottle?',
    sensitiveHiddenPhoto: true,
    isSample: true,
    createdAt: '2026-11-26T14:59:09.671181+00:00',
    coverPath: 'demo/bottle.webp',
  },
  {
    id: 'a4',
    ref: 'LF-2026-0010',
    type: 'found',
    status: 'available',
    category: 'accessories',
    title: 'Spectacles in a brown hard case',
    description: 'Thin gold frame, brown hard case, one lens has a small scratch at the edge.',
    zoneLabel: 'Lecture Halls',
    zoneCode: 'lecture',
    spot: 'Room LH-204, back row',
    eventDate: '2026-11-22',
    custodyLabel: 'Main Gate & Security Desk',
    verificationQuestion: 'What is taped inside the case lid?',
    sensitiveHiddenPhoto: false,
    isSample: true,
    createdAt: '2026-11-26T14:59:09.671181+00:00',
    coverPath: null,
  },
  {
    id: 'a5',
    ref: 'LF-2026-0011',
    type: 'lost',
    status: 'available',
    category: 'electronics',
    title: 'Black wired earphones lost near the shuttle stop',
    description: 'Wired earphones, black, with one white earbud tip. Lost while boarding the 5:30 shuttle.',
    zoneLabel: 'Parking & Shuttle Stop',
    zoneCode: 'parking',
    spot: 'Shuttle bay, near the notice board',
    eventDate: '2026-11-24',
    custodyLabel: null,
    verificationQuestion: null,
    sensitiveHiddenPhoto: false,
    isSample: true,
    createdAt: '2026-11-26T14:59:09.671181+00:00',
    coverPath: null,
  },
  {
    id: 'a6',
    ref: 'LF-2026-0012',
    type: 'found',
    status: 'recovered',
    category: 'electronics',
    title: 'Silver laptop charger, 65W USB-C',
    description: 'Compact 65W charger with a USB-C cable, cable has a red velcro tie.',
    zoneLabel: 'Labs & Workshops',
    zoneCode: 'lab',
    spot: 'Lab 3, seat 12',
    eventDate: '2026-11-06',
    custodyLabel: 'Main Gate & Security Desk',
    verificationQuestion: 'What is the brand printed on the brick?',
    sensitiveHiddenPhoto: false,
    isSample: true,
    createdAt: '2026-11-06T14:59:09.671181+00:00',
    coverPath: null,
  },
];

const STATS = {
  open_found: 4,
  open_lost: 1,
  recovered_total: 0,
  recovered_30d: 0,
  median_days_to_recovery: null,
};

function search(p = {}) {
  const q = (p.q ?? '').toLowerCase().trim();
  let rows = ITEMS.filter((i) => ['available', 'claimed', 'recovered'].includes(i.status));
  if (p.type) rows = rows.filter((i) => i.type === p.type);
  if (p.category) rows = rows.filter((i) => i.category === p.category);
  if (p.zone) rows = rows.filter((i) => i.zoneCode === p.zone);
  if (p.status) rows = rows.filter((i) => i.status === p.status);
  if (p.from) rows = rows.filter((i) => i.eventDate >= p.from);
  if (p.to) rows = rows.filter((i) => i.eventDate <= p.to);
  if (q) {
    const synonyms = { airpods: 'earbuds', earphone: 'earbuds', wallet: 'purse', mobile: 'phone' };
    const qx = q.replace(/airpods|airpod|earphone/g, 'earbuds').replace(/mobile|cell/g, 'phone');
    rows = rows.filter(
      (i) =>
        (i.title + ' ' + i.description + ' ' + i.category).toLowerCase().includes(q) ||
        (i.title + ' ' + i.description).toLowerCase().includes(qx),
    );
    void synonyms;
  }
  if (p.sort === 'newest') rows = [...rows].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const total = rows.length;
  const offset = p.offset ?? 0;
  const limit = Math.min(p.limit ?? 20, 50);
  return { items: rows.slice(offset, offset + limit), total, limit, offset };
}

function send(res, status, body) {
  const payload = typeof body === 'string' ? body : JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json',
    'access-control-allow-origin': '*',
    'access-control-expose-headers': 'Content-Range',
  });
  res.end(payload);
}

export function startMock(port = 54321) {
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://127.0.0.1:${port}`);
    const path = url.pathname;
    let body = '';
    for await (const chunk of req) body += chunk;
    const json = body ? JSON.parse(body) : {};

    if (path === '/auth/v1/user') {
      return send(res, 401, { message: 'no session' });
    }
    if (path === '/auth/v1/verify' || path.startsWith('/auth/v1/token') || path.startsWith('/auth/v1/otp')) {
      return send(res, 200, { access_token: 'mock', token_type: 'bearer', user: { id: 'mock-user' } });
    }
    if (path === '/rest/v1/rpc/search_items') {
      return send(res, 200, search(json.p ?? {}));
    }
    if (path === '/rest/v1/rpc/my_saved_items' || path === '/rest/v1/rpc/my_saved_searches') {
      return send(res, 200, []);
    }
    if (path === '/rest/v1/rpc/disposal_queue') {
      return send(res, 200, []);
    }
    if (path === '/rest/v1/retention_policies') {
      return send(res, 200, [
        { category: 'electronics', retention_days: 90, requires_photo_id: true, auto_hide_photos: false, notes: null },
        { category: 'clothing', retention_days: 30, requires_photo_id: false, auto_hide_photos: false, notes: null },
      ]);
    }
    if (path === '/rest/v1/rpc/is_item_saved') {
      return send(res, 200, false);
    }
    if (path === '/rest/v1/rpc/claim_thread') {
      return send(res, 200, null);
    }
    // disputes (0030): empty lists for a signed-out visitor, and a public record
    // with numbers in it so /safety renders the block rather than hiding it
    if (path === '/rest/v1/rpc/my_disputes' || path === '/rest/v1/rpc/my_disputable_claims') {
      return send(res, 200, []);
    }
    if (path === '/rest/v1/rpc/dispute_queue') {
      return send(res, 200, []);
    }
    if (path === '/rest/v1/rpc/dispute_room' || path === '/rest/v1/rpc/claimant_trust') {
      return send(res, 200, null);
    }
    if (path === '/rest/v1/rpc/public_trust') {
      return send(res, 200, {
        disputesOpened: 3,
        disputesResolved: 2,
        disputesUpheld: 1,
        openDisputes: 1,
        medianResolutionDays: 4,
        claimsDecided30d: 12,
      });
    }
    // institution analytics (0031): a staff-only snapshot. The mock answers as
    // staff would see it, because the route is what enforces the session here;
    // the function itself is the guard in the real database.
    if (path === '/rest/v1/rpc/institution_analytics') {
      return send(res, 200, {
        ok: true,
        from: json.p_from ?? '2026-11-01',
        to: json.p_to ?? '2026-11-30',
        days: 30,
        clamped: false,
        generatedAt: '2026-11-28T02:00:00+00:00',
        totals: {
          handedIn: 6,
          returned: 2,
          recoveryRate: 33.3,
          lowSample: false,
          medianDaysToRecovery: 3,
          handovers: 2,
          awaitingCollection: 1,
          openOnBoard: 4,
          lostReports: 1,
          claimsSubmitted: 2,
          claimsApproved: 2,
          claimsRejected: 0,
          disputesOpened: 1,
          disputesUpheld: 1,
        },
        byZone: [
          { key: 'library', label: 'Central Library', handedIn: 2, returned: 1, rate: 50, lowSample: true },
          { key: 'canteen', label: 'Canteen & Food Court', handedIn: 2, returned: 1, rate: 50, lowSample: true },
          { key: 'sports', label: 'Sports Complex', handedIn: 2, returned: 0, rate: 0, lowSample: true },
        ],
        byCategory: [
          { key: 'electronics', label: 'electronics', handedIn: 2, returned: 1, rate: 50, lowSample: true },
          { key: 'bags', label: 'bags', handedIn: 2, returned: 1, rate: 50, lowSample: true },
          { key: 'keys', label: 'keys', handedIn: 2, returned: 0, rate: 0, lowSample: true },
        ],
        byMonth: [
          { key: '2026-11', label: 'Nov 2026', handedIn: 6, returned: 2, handovers: 2, rate: 33.3, lowSample: false },
        ],
      });
    }
    if (path === '/rest/v1/rpc/log_report_export') {
      return send(res, 200, { ok: true });
    }
    if (path === '/rest/v1/rpc/board_stats') {
      return send(res, 200, STATS);
    }
    if (path === '/rest/v1/rpc/get_public_item') {
      const item = ITEMS.find((i) => i.ref.toLowerCase() === String(json.p_ref).toLowerCase());
      if (!item) return send(res, 200, null);
      const photos =
        item.sensitiveHiddenPhoto || !item.coverPath
          ? []
          : [{ path: item.coverPath, alt: `${item.title} — photo`, width: 640, height: 480 }];
      return send(res, 200, { item, photos });
    }
    if (path.startsWith('/rest/v1/rpc/')) {
      return send(res, 200, []);
    }
    if (path === '/rest/v1/public_zones') {
      return send(res, 200, ZONES);
    }
    if (path.startsWith('/rest/v1/')) {
      return send(res, 200, []);
    }
    if (path.startsWith('/storage/v1/object/sign/')) {
      const paths = json.paths ?? [];
      return send(
        res,
        200,
        paths.map((p) => ({ signedURL: `/object/sign/item-photos/${p}?token=mock`, path: p, error: null })),
      );
    }
    return send(res, 404, { message: 'not found', path });
  });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => resolve(server));
  });
}


// CLI: `node scripts/mock-supabase.mjs --serve 54321` (used by playwright.config.ts)
const invokedDirectly = process.argv[1] && process.argv[1].endsWith('mock-supabase.mjs');
if (invokedDirectly && process.argv.includes('--serve')) {
  const port = Number(process.argv[process.argv.indexOf('--serve') + 1] ?? 54321);
  const server = await startMock(port);
  console.log(`mock supabase listening on http://127.0.0.1:${port}`);
  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, () => {
      server.close(() => process.exit(0));
    });
  }
}
