/**
 * Local stand-in for Supabase's REST, Auth and Storage endpoints.
 * Used only by scripts/smoke.mjs so the UI can be rendered and checked in this
 * sandbox, which cannot reach the live project. Fixtures mirror the real
 * response shapes returned by supabase/migrations/0003_functions.sql.
 */
import http from 'node:http';


const sessionRole = () => (process.env.MOCK_ROLE === 'staff' ? 'staff' : 'member');

const SESSION_USER = {
  id: '11111111-1111-4111-8111-111111111111',
  aud: 'authenticated',
  role: 'authenticated',
  email: 'ananya@campus.edu',
  email_confirmed_at: '2026-11-01T09:00:00Z',
  app_metadata: { provider: 'email' },
  user_metadata: {},
  created_at: '2026-11-01T09:00:00Z',
};

const SESSION_PROFILE = {
  full_name: 'Ananya Rao',
  email: 'ananya@campus.edu',
  phone: null,
  alerts_opt_in: true,
  marketing_opt_in: false,
  email_verified_at: '2026-11-01T09:02:00Z',
};

const MY_ITEMS = [
  { id: 'i1', ref_code: 'LF-2026-0007', type: 'found', status: 'available', title: 'Black wireless earbuds in a charging case', category: 'electronics', created_at: '2026-11-20T10:00:00Z', event_date: '2026-11-19' },
  { id: 'i2', ref_code: 'LF-2026-0011', type: 'lost', status: 'available', title: 'Lost: white wired earphones', category: 'electronics', created_at: '2026-11-18T10:00:00Z', event_date: '2026-11-18' },
];

const MY_CLAIMS = [
  { ref: 'CLM-2026-0002', status: 'approved', itemRef: 'LF-2026-0007', itemTitle: 'Black wireless earbuds in a charging case', itemStatus: 'claimed', createdAt: '2026-11-24T09:00:00Z', decidedAt: '2026-11-25T11:00:00Z', reason: 'Answer matched', hasCode: true },
  { ref: 'CLM-2026-0001', status: 'submitted', itemRef: 'LF-2026-0008', itemTitle: 'Grey canvas backpack with a blue tag', itemStatus: 'available', createdAt: '2026-11-26T09:00:00Z', decidedAt: null, reason: null, hasCode: false },
];

const CONVERSATIONS = [
  { claimRef: 'CLM-2026-0002', claimId: 'c1', itemRef: 'LF-2026-0007', itemTitle: 'Black wireless earbuds in a charging case', claimStatus: 'approved', itemStatus: 'claimed', myRole: sessionRole(), lastMessage: 'The desk has your item at the main gate counter.', lastAt: '2026-11-27T15:10:00Z', unread: 2, locked: false },
  { claimRef: 'CLM-2026-0001', claimId: 'c2', itemRef: 'LF-2026-0008', itemTitle: 'Grey canvas backpack with a blue tag', claimStatus: 'submitted', itemStatus: 'available', myRole: sessionRole(), lastMessage: 'Could you describe the tag?', lastAt: '2026-11-26T12:00:00Z', unread: 0, locked: false },
];

const INTAKE = [
  { ref: 'LF-2026-0016', title: 'Grey umbrella, wooden handle', status: 'pending_moderation', type: 'found', createdAt: '2026-11-27T08:10:00Z', zone: 'Main Gate & Security Desk' },
  { ref: 'LF-2026-0017', title: 'Aadhaar card found near the gate', status: 'quarantined', type: 'found', createdAt: '2026-11-27T08:20:00Z', zone: null },
];

const AWAITING = [
  { claimRef: 'CLM-2026-0002', itemRef: 'LF-2026-0007', itemTitle: 'Black wireless earbuds in a charging case', approvedAt: '2026-11-25T11:00:00Z', codeUsed: false },
];

const CLAIM_QUEUE = [
  { ref: 'CLM-2026-0004', itemStatus: 'available', claimant: 'Ananya Rao', claimantEmail: 'ananya@campus.edu', itemRef: 'LF-2026-0009', itemTitle: 'Steel water bottle with a dented base', status: 'submitted', answerMatched: true, createdAt: '2026-11-27T09:12:00Z', proof: 'I have the receipt' },
  { ref: 'CLM-2026-0003', itemStatus: 'available', claimant: 'Vikram Iyer', claimantEmail: 'vikram@campus.edu', itemRef: 'LF-2026-0008', itemTitle: 'Grey canvas backpack with a blue tag', status: 'under_review', answerMatched: false, createdAt: '2026-11-26T16:40:00Z', proof: null },
];

const STAFF_ITEM = {
  item: { id: 'i1', ref: 'LF-2026-0007', type: 'found', status: 'available', category: 'electronics', title: 'Black wireless earbuds in a charging case', description: 'Matte black case, small sticker on the back. Found on a study desk.', zoneLabel: 'Central Library', zoneCode: 'library', spot: 'Quiet study desks, north windows', eventDate: '2026-11-19', custodyLabel: 'Main Gate & Security Desk', verificationQuestion: 'What is the Bluetooth name of the case?', sensitiveHiddenPhoto: false, isSample: false, createdAt: '2026-11-20T10:00:00Z', expiresAt: '2027-02-18T10:00:00Z' },
  private: { answerHash: 'hash', notes: null, serial: null, bin: 'BIN-A-04', finderContact: 'finder@campus.edu' },
  claims: [{ ref: 'CLM-2026-0002', status: 'approved', createdAt: '2026-11-24T09:00:00Z', answerMatched: true, proof: 'photo on my phone', reason: 'Answer matched', claimantId: 'c1' }],
  history: [{ at: '2026-11-24T09:00:00Z', action: 'claim_submitted', detail: { ref: 'CLM-2026-0002' }, severity: 'info' }],
  contactEmail: null,
};

const METRICS = {
  itemsByStatus: { available: 4, claimed: 1, recovered: 17, expired: 2, quarantined: 1, pending_moderation: 2 },
  claimsByStatus: { submitted: 3, under_review: 1, approved: 2, rejected: 1 },
  openReports: 1,
  cohort60d: { total: 24, recovered: 17, rate: 0.71 },
  medianDays: 3.2,
  openFound: 4, openLost: 1, recoveredTotal: 17,
  byZone: [{ zone: 'Central Library', count: 9 }, { zone: 'Canteen', count: 5 }, { zone: 'Sports Complex', count: 3 }],
  claims: { submitted: 3, under_review: 1, approved: 2, rejected: 1 },
  staff: 3, admins: 1, users: 46,
};

const REPORTS = [
  { id: 'r1', reason: 'asks_for_money', details: 'Asked me for ₹500 to return the bottle.', status: 'open', createdAt: '2026-11-27T08:30:00Z', itemRef: 'LF-2026-0009', itemTitle: 'Steel water bottle with a dented base', reporterId: 'u9', reporterEmail: 'student@campus.edu' },
];

const MY_CLAIM_DETAIL = {
  claim: { ref: 'CLM-2026-0002', status: 'approved', createdAt: '2026-11-24T09:00:00Z', decidedAt: '2026-11-25T11:00:00Z', reason: 'Answer matched', proof: 'photo on my phone' },
  item: { ref: 'LF-2026-0007', title: 'Black wireless earbuds in a charging case', status: 'claimed', zoneLabel: 'Central Library', custodyLabel: 'Main Gate & Security Desk', eventDate: '2026-11-19', category: 'electronics' },
  timeline: [
    { at: '2026-11-24T09:00:00Z', status: 'submitted', note: 'Claim submitted from the public item page.' },
    { at: '2026-11-25T11:00:00Z', status: 'approved', note: 'Answer matched' },
  ],
  handover: { code: '4Y2FX8', revealed: false, expiresAt: '2026-12-11T19:44:00Z', used: false },
};

const THREAD = {
  claimRef: 'CLM-2026-0002', claimId: 'c1', itemRef: 'LF-2026-0007',
  itemTitle: 'Black wireless earbuds in a charging case', itemStatus: 'claimed',
  claimStatus: 'approved', role: sessionRole(), locked: false, lockReason: null,
  counterparty: 'The finder and the desk', unread: 2,
  messages: [
    { id: 'm1', body: 'Hi — I lost these on Tuesday in the library. I can describe the sticker on the case.', role: 'claimant', mine: true, kind: 'text', quarantined: false, at: '2026-11-26T10:02:00Z' },
    { id: 'm2', body: 'Thanks. The desk has matched your answer and approved the claim.', role: 'staff', mine: false, kind: 'text', quarantined: false, at: '2026-11-26T10:40:00Z' },
    { id: 'm3', body: 'Bring photo ID to the main gate counter and show your handover code.', role: 'staff', mine: false, kind: 'text', quarantined: false, at: '2026-11-27T15:10:00Z' },
  ],
};

const REVIEW = { week_of: '2026-11-24', reviewed_by: '11111111-1111-4111-8111-111111111111', notes: 'Recovery rate up; two expired items disposed.', created_at: '2026-11-25T10:00:00Z' };

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

    const wantsUser = (req.headers.authorization ?? '').startsWith('Bearer ');
    if (path === '/auth/v1/user') {
      if (!wantsUser) return send(res, 401, { message: 'no session' });
      return send(res, 200, SESSION_USER);
    }
    if (path === '/rest/v1/profiles') {
      const single = (req.headers.accept ?? '').includes('object+json');
      return send(res, 200, single ? SESSION_PROFILE : [SESSION_PROFILE]);
    }
    if (path === '/rest/v1/user_roles') {
      return send(res, 200, sessionRole() === 'staff' ? [{ role: 'staff' }, { role: 'admin' }] : [{ role: 'member' }]);
    }
    if (path === '/rest/v1/items' && url.searchParams.get('select')?.includes('ref_code')) {
      return send(res, 200, MY_ITEMS);
    }
    if (path === '/rest/v1/ops_reviews') {
      const single = (req.headers.accept ?? '').includes('object+json');
      return send(res, 200, single ? REVIEW : [REVIEW]);
    }
    if (path === '/rest/v1/rpc/my_claim') {
      return send(res, 200, MY_CLAIM_DETAIL);
    }
    if (path === '/rest/v1/rpc/my_claims') {
      return send(res, 200, MY_CLAIMS);
    }
    if (path === '/rest/v1/rpc/my_conversations') {
      return send(res, 200, CONVERSATIONS);
    }
    if (path === '/rest/v1/rpc/staff_claim_queue') {
      return send(res, 200, { claims: CLAIM_QUEUE, intake: INTAKE, awaitingHandover: AWAITING });
    }
    if (path === '/rest/v1/rpc/staff_item_detail') {
      return send(res, 200, STAFF_ITEM);
    }
    if (path === '/rest/v1/rpc/admin_metrics') {
      return send(res, 200, METRICS);
    }
    if (path === '/rest/v1/rpc/admin_open_reports' || path === '/rest/v1/rpc/open_reports') {
      return send(res, 200, REPORTS);
    }
    if (path === '/rest/v1/rpc/verify_audit_chain') {
      return send(res, 200, { ok: true, checked: 214, head: 'a1b2c3d4e5f6' });
    }
    if (path === '/rest/v1/rpc/staff_directory') {
      return send(res, 200, [{ id: 'w1', name: 'Priya Raman' }, { id: 'w2', name: 'Arun Menon' }]);
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
    if (path === '/rest/v1/rpc/my_disputes') {
      return send(res, 200, [{ ref: 'DSP-2026-0001', claimRef: 'CLM-2026-0002', itemRef: 'LF-2026-0009', itemTitle: 'Steel water bottle with a dented base', status: 'open', reason: 'Finder asked for money', createdAt: '2026-11-27T09:00:00Z', lastMessage: 'The desk has asked the finder to respond.', ageDays: 1 }]);
    }
    if (path === '/rest/v1/rpc/dispute_queue') {
      return send(res, 200, [{ ref: 'DSP-2026-0001', claimRef: 'CLM-2026-0002', itemRef: 'LF-2026-0009', itemTitle: 'Steel water bottle with a dented base', itemStatus: 'claimed', claimStatus: 'approved', openerRole: 'claimant', reason: 'Finder asked for money', createdAt: '2026-11-27T09:00:00Z', ageDays: 1, claimant: 'Ananya Rao', claimantEmail: 'ananya@campus.edu', trust: { claims: 2, approved: 1, rejected: 0, upheld: 0, label: 'new' } }]);
    }
    if (path === '/rest/v1/rpc/match_queue') {
      return send(res, 200, [{ lostRef: 'LF-2026-0011', lostTitle: 'Lost: white wired earphones', foundRef: 'LF-2026-0007', foundTitle: 'Black wireless earbuds in a charging case', score: 0.86, photoScore: 0.91, reason: 'Photo similarity 91% · same category · 2 days apart' }]);
    }
    if (path === '/rest/v1/rpc/institution_analytics') {
      return send(res, 200, { windowDays: 60, found: 24, lost: 9, recovered: 17, rate: 0.71, medianDays: 3.2, byCategory: [{ category: 'electronics', found: 9, recovered: 7 }, { category: 'documents', found: 5, recovered: 4 }], byZone: [{ zone: 'Central Library', found: 9, recovered: 7 }, { zone: 'Canteen', found: 5, recovered: 3 }], unmatched: 6 });
    }
    if (path === '/rest/v1/rpc/claim_thread') {
      return send(res, 200, THREAD);
    }
    // disputes (0030): empty lists for a signed-out visitor, and a public record
    // with numbers in it so /safety renders the block rather than hiding it
    if (path === '/rest/v1/rpc/my_disputable_claims') {
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
        // custody timeline (0032): the chain of custody for one item, for its
    // reporter. Everything else answers the way the function does for a
    // reference that is not yours — NOT_FOUND, with no steps beside it.
    if (path === '/rest/v1/rpc/item_custody_timeline') {
      if (String(json.p_ref ?? '').toUpperCase() !== 'LF-2026-0007') {
        return send(res, 200, { ok: false, error: 'NOT_FOUND' });
      }
      return send(res, 200, {
        ok: true,
        access: 'owner',
        item: {
          ref: 'LF-2026-0007',
          title: 'Black wireless earbuds in a charging case',
          type: 'found',
          status: 'recovered',
          category: 'electronics',
          custodyLabel: 'Main Gate & Security Desk',
          reportedAt: '2026-11-19T09:12:00+00:00',
          publishedAt: '2026-11-19T09:12:00+00:00',
          expiresAt: '2027-02-17T09:12:00+00:00',
          disposedAt: null,
          disposition: null,
        },
        steps: [
          { key: 'handed_in', at: '2026-11-19T09:12:00+00:00', count: null },
          { key: 'published', at: '2026-11-19T09:12:00+00:00', count: null },
          { key: 'claim_received', at: '2026-11-21T14:30:00+00:00', count: 2 },
          { key: 'claim_approved', at: '2026-11-22T11:05:00+00:00', count: 1 },
          { key: 'code_issued', at: '2026-11-22T11:05:00+00:00', count: null },
          { key: 'handed_over', at: '2026-11-24T16:40:00+00:00', count: null },
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
