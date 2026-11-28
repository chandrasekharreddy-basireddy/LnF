/**
 * The dispute room's rules, as pure functions.
 *
 * Postgres enforces every one of these (0030). They are here so the page can
 * explain a refusal before the round trip, and so the rule itself can be tested
 * without a database. When the two disagree, the database wins — but they are
 * meant to be the same number, and the tests pin the number.
 */

export const DISPUTE_WINDOW_DAYS = 14;
export const REASON_MIN = 20;
export const REASON_MAX = 2000;
export const NOTE_MIN = 10;

export type DisputeStatus = 'open' | 'upheld' | 'dismissed' | 'withdrawn';
export type DisputeRole = 'claimant' | 'finder' | 'staff';

export type TrustCounts = {
  claimsTotal: number | null;
  approved: number | null;
  rejected: number | null;
  handovers: number | null;
  disputesOpened: number | null;
  disputesUpheld: number | null;
  accountAgeDays: number | null;
};

export type OpenDisputeInput = {
  role: DisputeRole;
  claimStatus: string;
  itemStatus: string;
  decidedAt: string | null;
  hasDispute: boolean;
  now?: Date;
};

export type DisputeGate = { ok: boolean; error?: string };

const DAY_MS = 86_400_000;

function toTime(value: string | null | undefined): number | null {
  if (!value) return null;
  const time = new Date(value).getTime();
  return Number.isNaN(time) ? null : time;
}

/** The last moment a decision can be contested, or null if there is no decision. */
export function disputeDeadline(decidedAt: string | null, windowDays = DISPUTE_WINDOW_DAYS): Date | null {
  const time = toTime(decidedAt);
  if (time === null) return null;
  return new Date(time + windowDays * DAY_MS);
}

/** Whole days left in the window; 0 once it has closed. */
export function daysLeftToDispute(
  decidedAt: string | null,
  now: Date = new Date(),
  windowDays = DISPUTE_WINDOW_DAYS,
): number {
  const deadline = disputeDeadline(decidedAt, windowDays);
  if (!deadline) return 0;
  const left = deadline.getTime() - now.getTime();
  return left <= 0 ? 0 : Math.ceil(left / DAY_MS);
}

/**
 * Mirrors open_dispute(). Order matters: it is the order the database checks in,
 * so the message a person sees is the one the database would have given.
 */
export function canOpenDispute(input: OpenDisputeInput): DisputeGate {
  if (input.role !== 'claimant' && input.role !== 'finder') {
    return { ok: false, error: 'FORBIDDEN' };
  }
  const decided = input.claimStatus === 'rejected' || input.claimStatus === 'approved';
  if (!decided && input.itemStatus !== 'recovered') {
    return { ok: false, error: 'NOT_DECIDED' };
  }
  const deadline = disputeDeadline(input.decidedAt);
  const now = input.now ?? new Date();
  if (!deadline) return { ok: false, error: 'NOT_DECIDED' };
  if (now.getTime() - deadline.getTime() >= 0) {
    return { ok: false, error: 'WINDOW_CLOSED' };
  }
  if (input.hasDispute) return { ok: false, error: 'DISPUTE_EXISTS' };
  return { ok: true };
}

/** The reason field's own check, before the payment/contact scan. */
export function reasonProblem(reason: string): string | null {
  const text = reason.trim();
  if (text.length < REASON_MIN) return 'REASON_TOO_SHORT';
  if (text.length > REASON_MAX) return 'TOO_LONG';
  return null;
}

export function noteProblem(note: string): string | null {
  const text = note.trim();
  if (text.length < NOTE_MIN) return 'NOTE_REQUIRED';
  if (text.length > REASON_MAX) return 'TOO_LONG';
  return null;
}

/**
 * A label for the desk, not a verdict about a person.
 *
 * "watch" needs more than one upheld dispute: one upheld dispute is the system
 * working, not evidence of anything. A dispute is a request for a second look.
 */
export function trustLabel(counts: TrustCounts): 'new' | 'watch' | 'established' | 'neutral' {
  const claims = Number(counts.claimsTotal ?? 0);
  const handovers = Number(counts.handovers ?? 0);
  const opened = Number(counts.disputesOpened ?? 0);
  const upheld = Number(counts.disputesUpheld ?? 0);
  const age = Number(counts.accountAgeDays ?? 0);

  if (upheld >= 2 || (opened >= 3 && upheld * 2 > opened)) return 'watch';
  if (claims === 0 || age < 7) return 'new';
  // one upheld dispute is the system working, not a mark against the person
  if (handovers >= 1 && upheld < 2) return 'established';
  return 'neutral';
}

export const TRUST_LABEL_TEXT: Record<ReturnType<typeof trustLabel>, string> = {
  new: 'New account',
  watch: 'Repeat disputes upheld',
  established: 'Collected before',
  neutral: 'No strong signal',
};

/** One plain sentence the desk can read without interpreting a number. */
export function trustSummary(counts: TrustCounts): string {
  const claims = Number(counts.claimsTotal ?? 0);
  if (claims === 0) return 'No claims on this account before this one.';

  const parts = [`${claims} claim${claims === 1 ? '' : 's'}`];
  const approved = Number(counts.approved ?? 0);
  const rejected = Number(counts.rejected ?? 0);
  const handovers = Number(counts.handovers ?? 0);
  const opened = Number(counts.disputesOpened ?? 0);
  const upheld = Number(counts.disputesUpheld ?? 0);

  if (approved) parts.push(`${approved} approved`);
  if (rejected) parts.push(`${rejected} not approved`);
  if (handovers) parts.push(`${handovers} collected at the desk`);
  if (opened) parts.push(`${opened} dispute${opened === 1 ? '' : 's'} raised`);
  if (upheld) parts.push(`${upheld} upheld`);

  return parts.join(' · ') + '.';
}

/** Whole days between two timestamps, floored; null when either is missing. */
export function resolutionDays(openedAt: string | null, decidedAt: string | null): number | null {
  const from = toTime(openedAt);
  const to = toTime(decidedAt);
  if (from === null || to === null) return null;
  return Math.max(0, Math.floor((to - from) / DAY_MS));
}

export const DISPUTE_STATUS_TEXT: Record<DisputeStatus, string> = {
  open: 'With the desk',
  upheld: 'Upheld',
  dismissed: 'Dismissed',
  withdrawn: 'Withdrawn',
};

/**
 * What a person is told when they win. Upholding reopens the claim only while the
 * item is still in custody; after a handover it records the finding and stops.
 */
export function outcomeExplanation(status: DisputeStatus, reopened: boolean): string {
  if (status === 'upheld') {
    return reopened
      ? 'The desk agreed and put your claim back in the queue. You will hear from them once it is reviewed again.'
      : 'The desk agreed with you. The item has already left the desk, so the claim cannot be reopened — the desk will contact you about what happens next.';
  }
  if (status === 'dismissed') {
    return 'The desk looked again and did not change the decision. Their reason is on this page.';
  }
  if (status === 'withdrawn') return 'You withdrew this dispute. Nothing further will happen.';
  return 'The desk has this and will look at it. Most are answered within a week.';
}
