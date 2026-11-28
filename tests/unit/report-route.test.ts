import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReportSnapshot } from '../../src/lib/monthly-report';

const snapshot: ReportSnapshot = {
  from: '2026-11-01',
  to: '2026-11-30',
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
  byZone: [{ key: 'library', label: 'Central Library', handedIn: 6, returned: 2, rate: 33.3, lowSample: false }],
  byCategory: [{ key: 'electronics', label: 'electronics', handedIn: 6, returned: 2, rate: 33.3, lowSample: false }],
  byMonth: [{ key: '2026-11', label: 'Nov 2026', handedIn: 6, returned: 2, handovers: 2, rate: 33.3, lowSample: false }],
};

const state: {
  user: { id: string; roles: string[] } | null;
  result: { ok: true; snapshot: ReportSnapshot } | { ok: false; error: 'RANGE_INVALID' | 'FORBIDDEN' | 'UNAVAILABLE' };
  audited: string[];
} = { user: { id: 'u1', roles: ['staff'] }, result: { ok: true, snapshot }, audited: [] };

vi.mock('@/lib/data', () => ({
  currentUser: async () => state.user,
  isStaff: (user: { roles: string[] } | null) =>
    Boolean(user && (user.roles.includes('staff') || user.roles.includes('admin'))),
  institutionAnalytics: async () => state.result,
  logReportExport: async (from: string, to: string) => {
    state.audited.push(`${from}..${to}`);
    return true;
  },
}));

vi.mock('@/lib/env', () => ({ env: { campusName: 'Sai University' } }));

const { GET } = await import('../../src/app/api/staff/report/monthly/route');

const call = (query = '?month=2026-11') =>
  GET(new Request(`http://localhost/api/staff/report/monthly${query}`));

beforeEach(() => {
  state.user = { id: 'u1', roles: ['staff'] };
  state.result = { ok: true, snapshot };
  state.audited = [];
});

describe('GET /api/staff/report/monthly', () => {
  it('refuses an anonymous caller with text, not a document', async () => {
    state.user = null;
    const res = await call();
    expect(res.status).toBe(401);
    expect(res.headers.get('content-type')).toContain('text/plain');
    expect(await res.text()).toMatch(/sign in/i);
  });

  it('refuses a signed-in member with no staff role', async () => {
    state.user = { id: 'u2', roles: ['member'] };
    const res = await call();
    expect(res.status).toBe(403);
    expect(await res.text()).toMatch(/desk/i);
  });

  it('lets an admin through, because an admin is staff', async () => {
    state.user = { id: 'u3', roles: ['admin'] };
    expect((await call()).status).toBe(200);
  });

  it('refuses a month that is not YYYY-MM before building anything', async () => {
    const res = await call('?month=2026-13');
    expect(res.status).toBe(400);
    expect(await res.text()).toContain('YYYY-MM');
  });

  it('defaults to the current month when none is given', async () => {
    const res = await call('');
    expect(res.status).toBe(200);
    expect(state.audited).toHaveLength(1);
  });

  it('serves a real PDF with a filename that names the period', async () => {
    const res = await call();
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/pdf');
    expect(res.headers.get('content-disposition')).toBe(
      'attachment; filename="lnf-report-2026-11-01-to-2026-11-30.pdf"',
    );
    expect(res.headers.get('cache-control')).toBe('no-store');

    const bytes = new Uint8Array(await res.arrayBuffer());
    const head = String.fromCharCode(...bytes.slice(0, 8));
    const tail = String.fromCharCode(...bytes.slice(-6));
    expect(head).toBe('%PDF-1.4');
    expect(tail).toBe('%%EOF\n');
    const text = String.fromCharCode(...bytes);
    expect(text).toContain('(Sai University)');
    expect(text).toContain('(33.3%)');
  });

  it('writes exactly one audit row per download, for the range it served', async () => {
    await call();
    expect(state.audited).toEqual(['2026-11-01..2026-11-30']);
  });

  it('says 403 when Postgres refuses, and 503 when the board is unreachable', async () => {
    state.result = { ok: false, error: 'FORBIDDEN' };
    expect((await call()).status).toBe(403);
    state.result = { ok: false, error: 'UNAVAILABLE' };
    expect((await call()).status).toBe(503);
    state.result = { ok: false, error: 'RANGE_INVALID' };
    expect((await call()).status).toBe(400);
    expect(state.audited).toEqual([]);
  });

  it('never puts a private field in the document', async () => {
    const bytes = new Uint8Array(await (await call()).arrayBuffer());
    const text = String.fromCharCode(...bytes);
    for (const field of ['answer_hash', 'contact_email', 'reporter_id', 'claimant']) {
      expect(text).not.toContain(field);
    }
  });
});
