import { describe, expect, it } from 'vitest';
import {
  DISPUTE_WINDOW_DAYS,
  REASON_MAX,
  REASON_MIN,
  canOpenDispute,
  daysLeftToDispute,
  disputeDeadline,
  noteProblem,
  outcomeExplanation,
  reasonProblem,
  resolutionDays,
  trustLabel,
  trustSummary,
  type TrustCounts,
} from '../../src/lib/trust';

const NOW = new Date('2026-11-28T06:00:00Z');
const HOUR = 3_600_000;

const counts = (over: Partial<TrustCounts> = {}): TrustCounts => ({
  claimsTotal: 0,
  approved: 0,
  rejected: 0,
  handovers: 0,
  disputesOpened: 0,
  disputesUpheld: 0,
  accountAgeDays: 0,
  ...over,
});

describe('the dispute window', () => {
  it('closes exactly fourteen days after the decision', () => {
    const deadline = disputeDeadline('2026-11-14T06:00:00Z');
    expect(deadline?.toISOString()).toBe('2026-11-28T06:00:00.000Z');
    expect(DISPUTE_WINDOW_DAYS).toBe(14);
  });

  it('has no deadline when there is no decision', () => {
    expect(disputeDeadline(null)).toBeNull();
    expect(disputeDeadline('not a date')).toBeNull();
    expect(daysLeftToDispute(null, NOW)).toBe(0);
  });

  it('counts whole days left, and never goes negative', () => {
    expect(daysLeftToDispute('2026-11-27T06:00:00Z', NOW)).toBe(13);
    expect(daysLeftToDispute('2026-11-14T06:00:00Z', NOW)).toBe(0);
    expect(daysLeftToDispute('2026-11-01T06:00:00Z', NOW)).toBe(0);
  });
});

describe('canOpenDispute', () => {
  const base = {
    role: 'claimant' as const,
    claimStatus: 'rejected',
    itemStatus: 'available',
    decidedAt: '2026-11-25T06:00:00Z',
    hasDispute: false,
    now: NOW,
  };

  it('lets a claimant contest a recent rejection', () => {
    expect(canOpenDispute(base)).toEqual({ ok: true });
  });

  it('lets the finder contest a handover that has already happened', () => {
    expect(
      canOpenDispute({ ...base, role: 'finder', claimStatus: 'approved', itemStatus: 'recovered' }),
    ).toEqual({ ok: true });
  });

  it('refuses staff, who decide rather than contest', () => {
    expect(canOpenDispute({ ...base, role: 'staff' })).toEqual({ ok: false, error: 'FORBIDDEN' });
  });

  it('refuses a claim the desk has not decided yet', () => {
    expect(canOpenDispute({ ...base, claimStatus: 'submitted' })).toEqual({
      ok: false,
      error: 'NOT_DECIDED',
    });
  });

  it('refuses after the window, at the boundary as well as past it', () => {
    expect(canOpenDispute({ ...base, decidedAt: new Date(NOW.getTime() - 13 * 24 * HOUR).toISOString() })).toEqual({
      ok: true,
    });
    expect(
      canOpenDispute({ ...base, decidedAt: new Date(NOW.getTime() - 14 * 24 * HOUR).toISOString() }),
    ).toEqual({ ok: false, error: 'WINDOW_CLOSED' });
    expect(
      canOpenDispute({ ...base, decidedAt: new Date(NOW.getTime() - 15 * 24 * HOUR).toISOString() }),
    ).toEqual({ ok: false, error: 'WINDOW_CLOSED' });
  });

  it('refuses a second dispute on the same claim', () => {
    expect(canOpenDispute({ ...base, hasDispute: true })).toEqual({
      ok: false,
      error: 'DISPUTE_EXISTS',
    });
  });

  it('checks the window before the duplicate, as the database does', () => {
    expect(
      canOpenDispute({
        ...base,
        hasDispute: true,
        decidedAt: new Date(NOW.getTime() - 30 * 24 * HOUR).toISOString(),
      }),
    ).toEqual({ ok: false, error: 'WINDOW_CLOSED' });
  });
});

describe('reason and note length', () => {
  it('wants a real explanation, not a word', () => {
    expect(reasonProblem('')).toBe('REASON_TOO_SHORT');
    expect(reasonProblem('   unfair   ')).toBe('REASON_TOO_SHORT');
    expect(reasonProblem('x'.repeat(REASON_MIN - 1))).toBe('REASON_TOO_SHORT');
    expect(reasonProblem('x'.repeat(REASON_MIN))).toBeNull();
  });

  it('caps the reason at the same length the column does', () => {
    expect(reasonProblem('x'.repeat(REASON_MAX))).toBeNull();
    expect(reasonProblem('x'.repeat(REASON_MAX + 1))).toBe('TOO_LONG');
  });

  it('requires a note from staff, because the audit log needs a reason', () => {
    expect(noteProblem('ok')).toBe('NOTE_REQUIRED');
    expect(noteProblem('Reopened: the photo shows the initials.')).toBeNull();
  });
});

describe('trustLabel', () => {
  it('calls an account with no claims new', () => {
    expect(trustLabel(counts())).toBe('new');
    expect(trustLabel(counts({ claimsTotal: 2, accountAgeDays: 3 }))).toBe('new');
  });

  it('calls a collector with a clean record established', () => {
    expect(trustLabel(counts({ claimsTotal: 2, approved: 1, handovers: 1, accountAgeDays: 90 }))).toBe(
      'established',
    );
  });

  it('does not punish one upheld dispute', () => {
    expect(
      trustLabel(counts({ claimsTotal: 3, rejected: 1, handovers: 1, disputesOpened: 1, disputesUpheld: 1, accountAgeDays: 90 })),
    ).toBe('established');
  });

  it('flags a pattern, not a single loss', () => {
    expect(trustLabel(counts({ claimsTotal: 4, disputesOpened: 2, disputesUpheld: 2, accountAgeDays: 90 }))).toBe(
      'watch',
    );
    expect(trustLabel(counts({ claimsTotal: 4, disputesOpened: 3, disputesUpheld: 2, accountAgeDays: 90 }))).toBe(
      'watch',
    );
  });

  it('leaves an ordinary record neutral', () => {
    expect(trustLabel(counts({ claimsTotal: 1, rejected: 1, accountAgeDays: 30 }))).toBe('neutral');
  });

  it('treats missing counts as zero rather than NaN', () => {
    expect(trustLabel({ ...counts(), claimsTotal: null, handovers: null, disputesUpheld: null })).toBe('new');
  });
});

describe('trustSummary', () => {
  it('says so plainly when there is no history', () => {
    expect(trustSummary(counts())).toBe('No claims on this account before this one.');
  });

  it('reads as a sentence, with plurals that agree', () => {
    expect(
      trustSummary(counts({ claimsTotal: 1, approved: 1, handovers: 1, accountAgeDays: 40 })),
    ).toBe('1 claim · 1 approved · 1 collected at the desk.');
    expect(
      trustSummary(counts({ claimsTotal: 2, rejected: 2, disputesOpened: 1, disputesUpheld: 1, accountAgeDays: 40 })),
    ).toBe('2 claims · 2 not approved · 1 dispute raised · 1 upheld.');
  });
});

describe('resolutionDays', () => {
  it('floors partial days and refuses to go negative', () => {
    expect(resolutionDays('2026-11-20T06:00:00Z', '2026-11-23T05:00:00Z')).toBe(2);
    expect(resolutionDays('2026-11-23T06:00:00Z', '2026-11-20T06:00:00Z')).toBe(0);
    expect(resolutionDays(null, '2026-11-23T06:00:00Z')).toBeNull();
  });
});

describe('outcomeExplanation', () => {
  it('does not promise an item back once it has left the desk', () => {
    expect(outcomeExplanation('upheld', true)).toContain('back in the queue');
    expect(outcomeExplanation('upheld', false)).toContain('cannot be reopened');
  });

  it('has words for every state', () => {
    for (const status of ['open', 'upheld', 'dismissed', 'withdrawn'] as const) {
      expect(outcomeExplanation(status, false).length).toBeGreaterThan(20);
    }
  });
});
