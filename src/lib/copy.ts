export const SAFETY = {
  noPay: 'Never pay to get an item back.',
  noPayDetail:
    'Anything asking for money, gift cards or a deposit is a scam. Report it from the listing and we will take it down.',
  collect: 'Collect from the desk.',
  collectDetail:
    'Handovers happen at a staffed counter in daylight. We never ask you to meet a stranger alone or send an item by courier.',
  dontPost: 'Do not post your ID, address or phone number.',
  dontPostDetail:
    'Descriptions are public. Keep serial numbers and ID numbers out — the desk can verify those in person.',
};

export const EMPTY = {
  browseNone: {
    title: 'Nothing matches those filters yet',
    body: 'Try a wider date range, drop the zone filter, or post a lost report so we can alert you when something turns up.',
  },
  browseBlank: {
    title: 'The board is empty for now',
    body: 'Nothing has been handed in yet. If you lost something, post a lost report — finders search those first.',
  },
  claims: {
    title: 'No claims yet',
    body: 'When you claim an item, its status and handover code appear here.',
  },
};

export const ERRORS: Record<string, string> = {
  AUTH_REQUIRED: 'Sign in first so we can send you updates.',
  RATE_LIMITED: 'That is a lot of attempts in a short time. Wait a few minutes and try again.',
  BAD_TYPE: 'Choose whether you lost the item or found it.',
  TITLE_TOO_SHORT: 'Give the item a name of at least 3 characters.',
  DESCRIPTION_TOO_SHORT: 'Add a description of at least 10 characters so the owner can recognise it.',
  DATE_IN_FUTURE: 'Use a date today or earlier.',
  DATE_TOO_OLD: 'We only keep reports from the last year.',
  NOT_FOUND: 'We could not find that reference. Check the code and try again.',
  NOT_CLAIMABLE: 'Lost reports cannot be claimed. Look for the matching found item instead.',
  NOT_AVAILABLE: 'This item is no longer available to claim.',
  OWN_ITEM: 'You reported this item, so you cannot claim it.',
  FORBIDDEN: 'Your account does not have access to this area.',
  ALREADY_DECIDED: 'That claim was already decided.',
  NO_APPROVED_CLAIM: 'Approve a claim before confirming a handover.',
  CODE_MISMATCH: 'That code does not match. Ask the owner to show the code on their claim page.',
  LOCKED: 'Too many wrong codes. This handover is locked for 15 minutes — ask a supervisor if the owner is waiting.',
  CODE_USED: 'That code was already used. Check the item is still with you before releasing it.',
  ALREADY_RECOVERED: 'This item is already recorded as returned.',
  BAD_STATUS: 'That status is not allowed here.',
  BAD_ROLE: 'Choose member, staff or admin.',
  NO_SUCH_USER: 'No account with that email. They must sign in once before you can give them a role.',
  CANNOT_DEMOTE_SELF: 'You cannot remove your own admin role.',
  BAD_DECISION: 'Choose approve, reject or move to review.',
  THREAD_CLOSED: 'This thread is read-only now. If something is still wrong, report the listing.',
  EMPTY: 'Write something first.',
  TOO_LONG: 'Keep it under 2000 characters.',
  BLOCKED: 'That message was held back.',
  BAD_DISPOSITION: 'Choose what happened to the item.',
  NOTE_REQUIRED: 'Write a short note. The audit log needs a reason.',
  ALREADY_DISPOSED: 'This item already has a disposition recorded.',
  ALREADY_RETURNED: 'This item was returned to its owner, so it cannot be disposed of.',
  WITNESS_REQUIRED: 'This category is released by two people. Choose the staff member who is countersigning.',
  WITNESS_IS_SELF: 'You cannot countersign your own handover.',
  WITNESS_NOT_STAFF: 'That account is not staff. Pick a staff member from the list.',
  HAS_APPROVED_CLAIM: 'An approved claim is waiting to be collected. Confirm or withdraw it before archiving or disposing of the item.',
};

export function errorText(code: string | undefined): string {
  if (!code) return 'Something went wrong. Try again.';
  return ERRORS[code] ?? code;
}

export const CATEGORIES = [
  { value: 'electronics', label: 'Electronics' },
  { value: 'bags', label: 'Bags & backpacks' },
  { value: 'documents', label: 'Documents & cards' },
  { value: 'accessories', label: 'Accessories' },
  { value: 'clothing', label: 'Clothing' },
  { value: 'keys', label: 'Keys' },
  { value: 'books', label: 'Books & stationery' },
  { value: 'sports', label: 'Sports gear' },
  { value: 'other', label: 'Other' },
] as const;

export function categoryLabel(value: string): string {
  return CATEGORIES.find((c) => c.value === value)?.label ?? 'Other';
}

export const STATUS_LABEL: Record<string, string> = {
  available: 'Open',
  claimed: 'Claim approved',
  recovered: 'Returned',
  pending_moderation: 'In review',
  quarantined: 'At the desk',
  expired: 'Expired',
  archived: 'Archived',
  submitted: 'Submitted',
  under_review: 'Under review',
  approved: 'Approved',
  rejected: 'Not approved',
  withdrawn: 'Withdrawn',
};
