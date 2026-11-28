import { describe, expect, it } from 'vitest';
import {
  buildCustodyTimeline,
  custodyOutlook,
  personShapedPaths,
  type CustodyPayload,
} from '../../src/lib/custody';

const NOW = new Date('2026-11-28T06:00:00Z');

const payload = (over: Partial<CustodyPayload> = {}): CustodyPayload => ({
  ok: true,
  access: 'owner',
  item: {
    ref: 'LF-2026-0007',
    title: 'Black wireless earbuds in a charging case',
    type: 'found',
    status: 'recovered',
    category: 'electronics',
    custodyLabel: 'Main Gate & Security Desk',
    reportedAt: '2026-11-19T09:12:00Z',
    publishedAt: '2026-11-19T09:12:00Z',
    expiresAt: '2027-02-17T09:12:00Z',
    disposedAt: null,
    disposition: null,
  },
  steps: [
    { key: 'handed_in', at: '2026-11-19T09:12:00Z', count: null },
    { key: 'published', at: '2026-11-19T09:12:00Z', count: null },
    { key: 'claim_received', at: '2026-11-21T14:30:00Z', count: 2 },
    { key: 'claim_approved', at: '2026-11-22T11:05:00Z', count: 1 },
    { key: 'code_issued', at: '2026-11-22T11:05:00Z', count: null },
    { key: 'handed_over', at: '2026-11-24T16:40:00Z', count: null },
  ],
  ...over,
});

const build = (over: Partial<CustodyPayload> = {}, now = NOW) => buildCustodyTimeline(payload(over), now);

describe('what the timeline refuses to build', () => {
  it('has nothing to show for a refusal', () => {
    expect(buildCustodyTimeline({ ok: false, error: 'NOT_FOUND' }, NOW)).toBeNull();
    expect(buildCustodyTimeline(null, NOW)).toBeNull();
  });

  it('has nothing to show without an item', () => {
    expect(buildCustodyTimeline({ ok: true, steps: [] }, NOW)).toBeNull();
    expect(buildCustodyTimeline({ ok: true, item: { title: 'no ref' } }, NOW)).toBeNull();
  });

  it('stops rather than draw a payload that names a person', () => {
    const leaked = payload() as CustodyPayload & Record<string, unknown>;
    (leaked.item as Record<string, unknown>).claimantEmail = 'someone@campus.edu';
    expect(personShapedPaths(leaked)).toEqual(['item.claimantEmail']);
    expect(buildCustodyTimeline(leaked, NOW)).toBeNull();
  });
});

describe('the person-shaped guard', () => {
  it('finds a field three levels down', () => {
    expect(personShapedPaths({ ok: true, steps: [{ key: 'x', at: null, claimant_id: 'abc' }] })).toEqual([
      'steps[0].claimant_id',
    ]);
  });

  it('does not flag the fields the payload is allowed to carry', () => {
    expect(personShapedPaths(payload())).toEqual([]);
  });

  it('flags the code and the answer, in any casing', () => {
    expect(personShapedPaths({ Code_Hash: 'x', answer_hash: 'y', proof: 'z' })).toEqual([
      'Code_Hash',
      'answer_hash',
      'proof',
    ]);
  });

  it('flags staff free text, which can quote a person', () => {
    expect(personShapedPaths({ item: { disposition_note: 'handed to Ananya' } })).toEqual([
      'item.disposition_note',
    ]);
  });
});

describe('ordering', () => {
  it('sorts by time, whatever order the database emitted', () => {
    const timeline = buildCustodyTimeline(
      payload({
        steps: [
          { key: 'handed_over', at: '2026-11-24T16:40:00Z' },
          { key: 'handed_in', at: '2026-11-19T09:12:00Z' },
          { key: 'claim_received', at: '2026-11-21T14:30:00Z', count: 1 },
        ],
      }),
      NOW,
    );
    expect(timeline?.steps.map((s) => s.key)).toEqual(['handed_in', 'claim_received', 'handed_over']);
  });

  it('breaks a same-second tie in chain order, not alphabetically', () => {
    const timeline = buildCustodyTimeline(
      payload({
        steps: [
          { key: 'handed_over', at: '2026-11-22T11:05:00Z' },
          { key: 'code_issued', at: '2026-11-22T11:05:00Z' },
          { key: 'claim_approved', at: '2026-11-22T11:05:00Z' },
        ],
      }),
      NOW,
    );
    expect(timeline?.steps.map((s) => s.key)).toEqual(['claim_approved', 'code_issued', 'handed_over']);
  });

  it('drops a step with no usable timestamp, and one it does not know', () => {
    const timeline = buildCustodyTimeline(
      payload({
        steps: [
          { key: 'handed_in', at: '2026-11-19T09:12:00Z' },
          { key: 'published', at: null },
          { key: 'published', at: 'not a date' },
          { key: 'a_step_from_the_future', at: '2026-11-20T09:12:00Z' },
        ],
      }),
      NOW,
    );
    expect(timeline?.steps.map((s) => s.key)).toEqual(['handed_in']);
  });
});

describe('the words on the steps', () => {
  it('counts claims in the plural only when there are several', () => {
    const two = build()?.steps.find((s) => s.key === 'claim_received');
    expect(two?.label).toBe('2 people claimed it');

    const one = buildCustodyTimeline(
      payload({ steps: [{ key: 'claim_received', at: '2026-11-21T14:30:00Z', count: 1 }] }),
      NOW,
    );
    expect(one?.steps[0].label).toBe('Someone claimed it');
  });

  it('treats a missing count as one, and keeps a zero as zero', () => {
    const timeline = buildCustodyTimeline(
      payload({
        steps: [
          { key: 'claim_received', at: '2026-11-21T14:30:00Z' },
          { key: 'dispute_open', at: '2026-11-21T14:30:00Z', count: 0 },
        ],
      }),
      NOW,
    );
    expect(timeline?.steps[0].count).toBeNull();
    expect(timeline?.steps[1].count).toBe(0);
    expect(timeline?.summary.openDisputes).toBe(0);
  });

  it('says nothing about a person on any step', () => {
    const timeline = build();
    const words = JSON.stringify(timeline).toLowerCase();
    expect(words).not.toMatch(/claimant|@|answer_hash|proof|witness|code_plain/);
  });
});

describe('the numbers under the title', () => {
  it('counts claims, approvals and handovers from the steps', () => {
    const timeline = build();
    expect(timeline?.summary.claims).toBe(2);
    expect(timeline?.summary.approved).toBe(1);
    expect(timeline?.summary.rejected).toBe(0);
    expect(timeline?.summary.handovers).toBe(1);
  });

  it('counts custody days up to the handover, not up to today', () => {
    expect(build()?.summary.daysInCustody).toBe(5);
  });

  it('counts up to now while the item is still held', () => {
    const timeline = build({
      item: { ...payload().item!, status: 'claimed' },
      steps: [{ key: 'handed_in', at: '2026-11-19T09:12:00Z' }],
    });
    // 19 Nov 09:12 → 28 Nov 06:00 is eight full days and a bit
    expect(timeline?.summary.daysInCustody).toBe(8);
    expect(timeline?.open).toBe(true);
  });

  it('never reports negative time, even with a clock ahead of the data', () => {
    const timeline = build({ item: { ...payload().item!, reportedAt: '2026-12-01T00:00:00Z' }, steps: [] });
    expect(timeline?.summary.daysInCustody).toBe(0);
  });

  it('reports the days left in the window, rounded up, only while it is open', () => {
    const open = build({ item: { ...payload().item!, status: 'available' }, steps: [] });
    // the window closes at 09:12 on 17 Feb, three hours after the hour we ask,
    // so the last part-day counts
    expect(open?.daysLeft).toBe(82);

    const closed = build();
    expect(closed?.daysLeft).toBeNull();
  });

  it('treats a quarantined listing as still in custody', () => {
    const timeline = build({ item: { ...payload().item!, status: 'quarantined' }, steps: [] });
    expect(timeline?.open).toBe(true);
    expect(custodyOutlook(timeline!)).toMatch(/proof of identity/i);
  });
});

describe('the line under the summary', () => {
  it('closes the story once the item is back with its owner', () => {
    expect(custodyOutlook(build()!)).toMatch(/Returned to its owner/);
  });

  it('names the disposition when the desk let it go', () => {
    const timeline = build({
      item: { ...payload().item!, status: 'archived', disposition: 'donated', disposedAt: '2026-11-25T10:00:00Z' },
    });
    expect(custodyOutlook(timeline!)).toBe('No longer held: donated.');
  });

  it('tells an owner waiting on a collection what is happening', () => {
    const timeline = build({
      item: { ...payload().item!, status: 'claimed' },
      steps: [{ key: 'handed_in', at: '2026-11-19T09:12:00Z' }],
    });
    expect(custodyOutlook(timeline!)).toMatch(/Waiting for the person to collect it/);
  });

  it('gives the days left while it is on the board', () => {
    const timeline = build({ item: { ...payload().item!, status: 'available' }, steps: [] });
    expect(custodyOutlook(timeline!)).toBe('Leaves the desk in 82 days if nobody claims it.');
  });
});
