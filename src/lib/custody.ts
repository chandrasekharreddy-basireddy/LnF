/**
 * The custody timeline, as the owner reads it.
 *
 * The database decides who may see a timeline and which steps exist
 * (`item_custody_timeline`, migration 0032). This module decides nothing about
 * access — it turns that payload into ordered, labelled steps, and refuses to
 * hand back anything that looks like it is about a person rather than the item.
 *
 * Everything here is pure: no fetch, no clock, no React. `now` is passed in, so
 * the day counts are the same in a test and in a browser.
 */

export type CustodyStepKey =
  | 'reported'
  | 'handed_in'
  | 'held'
  | 'in_review'
  | 'published'
  | 'claim_received'
  | 'claim_under_review'
  | 'claim_approved'
  | 'claim_rejected'
  | 'claim_withdrawn'
  | 'code_issued'
  | 'handed_over'
  | 'dispute_open'
  | 'dispute_upheld'
  | 'dispute_dismissed'
  | 'dispute_withdrawn'
  | 'disposed'
  | 'window_closed';

export type CustodyTone = 'done' | 'warn' | 'note';

export type CustodyStep = {
  key: CustodyStepKey;
  label: string;
  detail: string;
  /** ISO timestamp the step happened at */
  at: string;
  /** how many of this thing, when the step is a count (claims, disputes) */
  count: number | null;
  tone: CustodyTone;
};

export type CustodyItem = {
  ref: string;
  title: string;
  type: 'lost' | 'found';
  status: string;
  category: string;
  custodyLabel: string | null;
  reportedAt: string | null;
  publishedAt: string | null;
  expiresAt: string | null;
  disposedAt: string | null;
  disposition: string | null;
};

export type CustodyRawStep = { key?: unknown; at?: unknown; count?: unknown };

export type CustodyPayload = {
  ok?: boolean;
  error?: string;
  access?: 'owner' | 'staff';
  item?: Partial<CustodyItem> | null;
  steps?: CustodyRawStep[] | null;
};

export type CustodyTimeline = {
  item: CustodyItem;
  access: 'owner' | 'staff';
  steps: CustodyStep[];
  summary: {
    daysInCustody: number;
    claims: number;
    approved: number;
    rejected: number;
    handovers: number;
    openDisputes: number;
    lastAt: string | null;
  };
  open: boolean;
  /** days until the retention window closes, when the item is still in custody */
  daysLeft: number | null;
};

/** The chain order, used only to break ties between steps stamped the same second. */
const RANK: Record<CustodyStepKey, number> = {
  reported: 10,
  handed_in: 10,
  held: 20,
  in_review: 20,
  published: 20,
  claim_received: 30,
  claim_under_review: 31,
  claim_approved: 32,
  claim_rejected: 32,
  claim_withdrawn: 32,
  code_issued: 40,
  handed_over: 50,
  dispute_open: 55,
  dispute_upheld: 56,
  dispute_dismissed: 56,
  dispute_withdrawn: 56,
  disposed: 60,
  window_closed: 60,
};

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

type Copy = { label: (count: number) => string; detail: (count: number) => string; tone: CustodyTone };

const COPY: Record<CustodyStepKey, Copy> = {
  reported: {
    label: () => 'Lost report posted',
    detail: () => 'The desk lists lost reports so a finder can match what they hand in.',
    tone: 'done',
  },
  handed_in: {
    label: () => 'Handed in',
    detail: () => 'Logged at the desk with this reference, so anyone can quote it.',
    tone: 'done',
  },
  held: {
    label: () => 'Held at the desk, never published',
    detail: () =>
      'Identity documents and bank cards are not put on the board. Collect in person with proof of identity.',
    tone: 'warn',
  },
  in_review: {
    label: () => 'Waiting for a check',
    detail: () => 'A first report is looked at by the desk before it goes on the board.',
    tone: 'note',
  },
  published: {
    label: () => 'On the board',
    detail: () => 'Visible to anyone browsing, and to finders searching lost reports.',
    tone: 'done',
  },
  claim_received: {
    label: (n) => (n > 1 ? `${n} people claimed it` : 'Someone claimed it'),
    detail: (n) =>
      n > 1
        ? 'Each claim is checked against the answer the finder recorded. Only one can be approved.'
        : 'The desk checks the claim against the answer the finder recorded.',
    tone: 'note',
  },
  claim_under_review: {
    label: () => 'A claim is under review',
    detail: () => 'The desk is comparing the answer with what the finder recorded.',
    tone: 'note',
  },
  claim_approved: {
    label: () => 'Claim approved',
    detail: () => 'The desk accepted a claim and issued that person a one-time collection code.',
    tone: 'done',
  },
  claim_rejected: {
    label: () => 'Claim not approved',
    detail: () => 'An answer did not match, so the item stayed with the desk.',
    tone: 'warn',
  },
  claim_withdrawn: {
    label: () => 'Claim withdrawn',
    detail: () => 'The person who claimed it stepped back, so the item stayed with the desk.',
    tone: 'note',
  },
  code_issued: {
    label: () => 'Collection code issued',
    detail: () => 'A one-time code went to the person collecting it. Only the desk can check it.',
    tone: 'note',
  },
  handed_over: {
    label: () => 'Handed over',
    detail: () => 'Released at the desk against that code. Custody of this item has ended.',
    tone: 'done',
  },
  dispute_open: {
    label: () => 'A second look was requested',
    detail: () => 'Someone asked the desk to review a decision on this item.',
    tone: 'note',
  },
  dispute_upheld: {
    label: () => 'Second look upheld',
    detail: () => 'The desk agreed the decision was wrong and reopened the claim.',
    tone: 'warn',
  },
  dispute_dismissed: {
    label: () => 'Second look dismissed',
    detail: () => 'The desk looked again and kept its decision.',
    tone: 'note',
  },
  dispute_withdrawn: {
    label: () => 'Second look withdrawn',
    detail: () => 'The person who asked for it withdrew the request.',
    tone: 'note',
  },
  disposed: {
    label: () => 'Left the desk',
    detail: () => 'Unclaimed at the end of its window, so the desk recorded what happened to it.',
    tone: 'done',
  },
  window_closed: {
    label: () => 'Window closed',
    detail: () => 'The retention window ran out. The listing is no longer open.',
    tone: 'note',
  },
};

const OPEN_STATUS = new Set(['available', 'claimed', 'pending_moderation', 'quarantined']);
const DAY = 86_400_000;

function time(iso: unknown): number | null {
  if (typeof iso !== 'string' || !iso) return null;
  const ms = new Date(iso).getTime();
  return Number.isNaN(ms) ? null : ms;
}

/**
 * Keys that would mean the payload is about a person. The function in 0032
 * never returns these; this is the second lock, so a future change that starts
 * returning one fails visibly here instead of on the page.
 */
const PERSON_KEY = /claimant|email|phone|answer|proof|witness|reason|note|hash|secret|_id$/i;
const ALLOWED_KEYS = new Set(['key', 'ok', 'at', 'count', 'ref', 'access']);

/** Returns the paths of anything person-shaped in a payload. Empty means clean. */
export function personShapedPaths(value: unknown, path = ''): string[] {
  if (Array.isArray(value)) {
    return value.flatMap((entry, index) => personShapedPaths(entry, `${path}[${index}]`));
  }
  if (!value || typeof value !== 'object') return [];
  const found: string[] = [];
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    const here = path ? `${path}.${key}` : key;
    if (!ALLOWED_KEYS.has(key) && PERSON_KEY.test(key)) found.push(here);
    found.push(...personShapedPaths(entry, here));
  }
  return found;
}

function toItem(raw: Partial<CustodyItem> | null | undefined): CustodyItem | null {
  if (!raw || typeof raw.ref !== 'string' || !raw.ref) return null;
  return {
    ref: raw.ref,
    title: typeof raw.title === 'string' ? raw.title : '',
    type: raw.type === 'lost' ? 'lost' : 'found',
    status: typeof raw.status === 'string' ? raw.status : 'available',
    category: typeof raw.category === 'string' ? raw.category : '',
    custodyLabel: typeof raw.custodyLabel === 'string' ? raw.custodyLabel : null,
    reportedAt: typeof raw.reportedAt === 'string' ? raw.reportedAt : null,
    publishedAt: typeof raw.publishedAt === 'string' ? raw.publishedAt : null,
    expiresAt: typeof raw.expiresAt === 'string' ? raw.expiresAt : null,
    disposedAt: typeof raw.disposedAt === 'string' ? raw.disposedAt : null,
    disposition: typeof raw.disposition === 'string' ? raw.disposition : null,
  };
}

/**
 * Turns the RPC payload into the page's shape. Returns null when there is
 * nothing honest to show — a refusal, a missing item, or a payload that carries
 * something about a person — so the page can render its neutral state instead
 * of half a story.
 */
export function buildCustodyTimeline(payload: CustodyPayload | null, now: Date): CustodyTimeline | null {
  if (!payload || payload.ok !== true) return null;
  if (personShapedPaths(payload).length) return null;

  const item = toItem(payload.item);
  if (!item) return null;

  const rows = Array.isArray(payload.steps) ? payload.steps : [];
  const steps: CustodyStep[] = [];
  for (const row of rows) {
    const key = typeof row?.key === 'string' ? (row.key as CustodyStepKey) : null;
    if (!key || !(key in COPY)) continue;
    const at = time(row.at);
    if (at === null) continue;
    const count =
      typeof row.count === 'number' && Number.isFinite(row.count) && row.count >= 0 ? Math.floor(row.count) : null;
    const copy = COPY[key];
    const n = count ?? 1;
    steps.push({
      key,
      label: copy.label(n),
      detail: copy.detail(n),
      at: new Date(at).toISOString(),
      count,
      tone: copy.tone,
    });
  }

  steps.sort((a, b) => {
    const byTime = new Date(a.at).getTime() - new Date(b.at).getTime();
    if (byTime !== 0) return byTime;
    return RANK[a.key] - RANK[b.key];
  });

  const countOf = (key: CustodyStepKey) => steps.find((s) => s.key === key)?.count ?? 0;
  const has = (key: CustodyStepKey) => steps.some((s) => s.key === key);

  const end =
    steps.find((s) => s.key === 'handed_over')?.at ?? steps.find((s) => s.key === 'disposed')?.at ?? null;
  const startedAt = time(item.reportedAt) ?? time(steps[0]?.at);
  const endedAt = time(end) ?? now.getTime();
  const daysInCustody =
    startedAt === null ? 0 : Math.max(0, Math.floor((endedAt - startedAt) / DAY));

  const open = OPEN_STATUS.has(item.status);
  const expiresAt = time(item.expiresAt);
  const daysLeft =
    open && expiresAt !== null ? Math.max(0, Math.ceil((expiresAt - now.getTime()) / DAY)) : null;

  return {
    item,
    access: payload.access === 'staff' ? 'staff' : 'owner',
    steps,
    summary: {
      daysInCustody,
      claims: countOf('claim_received'),
      approved: countOf('claim_approved'),
      rejected: countOf('claim_rejected'),
      handovers: has('handed_over') ? 1 : 0,
      openDisputes: countOf('dispute_open'),
      lastAt: steps.length ? steps[steps.length - 1].at : null,
    },
    open,
    daysLeft,
  };
}

/** One line under the summary, for the owner: what happens next, or why nothing does. */
export function custodyOutlook(timeline: CustodyTimeline): string {
  const { item, summary, daysLeft } = timeline;
  if (item.status === 'recovered') return 'Returned to its owner. This timeline is closed.';
  if (item.disposition) return `No longer held: ${item.disposition.replace(/_/g, ' ')}.`;
  if (item.status === 'expired' || item.status === 'archived') return 'The retention window has closed.';
  if (item.status === 'quarantined') return 'Held at the desk. Bring proof of identity to collect it.';
  if (item.status === 'pending_moderation') return 'The desk is checking this listing before it goes on the board.';
  if (item.status === 'claimed') {
    return summary.handovers
      ? 'Released at the desk.'
      : 'A claim was approved. Waiting for the person to collect it.';
  }
  if (daysLeft === null) return 'On the board. Nothing is waiting on you.';
  if (daysLeft <= 0) return 'The retention window closes today.';
  return `Leaves the desk in ${daysLeft} ${plural(daysLeft, 'day', 'days')} if nobody claims it.`;
}
