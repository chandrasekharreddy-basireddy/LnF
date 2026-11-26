/**
 * Every retention window the product promises, in one place.
 * /legal/retention renders these numbers, and the housekeeping job in
 * supabase/migrations/0003_functions.sql enforces the same values.
 * Change them together or the published page becomes a lie.
 */
export const RETENTION = {
  listingDays: 90,
  purgeAfterExpiryDays: 30,
  notificationDays: 180,
  auditDays: 365,
  closedReportDays: 180,
  handoverCodeDays: 14,
} as const;

export const RETENTION_ROWS = [
  {
    record: 'Live listing (found item, lost report)',
    kept: `${RETENTION.listingDays} days from posting`,
    then: 'Hidden from the board, no longer claimable',
  },
  {
    record: 'Expired listing, its photos and description',
    kept: `${RETENTION.purgeAfterExpiryDays} days after it expires`,
    then: 'Deleted permanently, photos included',
  },
  {
    record: 'Claim record and its outcome',
    kept: 'While the account exists',
    then: 'Deleted with the account, or on request',
  },
  {
    record: 'Handover code',
    kept: `${RETENTION.handoverCodeDays} days or until used`,
    then: 'Invalid, code hash discarded',
  },
  {
    record: 'In-app notification',
    kept: `${RETENTION.notificationDays} days`,
    then: 'Deleted',
  },
  {
    record: 'Audit log (who did what at the desk)',
    kept: `${RETENTION.auditDays} days`,
    then: 'Deleted',
  },
  {
    record: 'Abuse report, once closed',
    kept: `${RETENTION.closedReportDays} days`,
    then: 'Deleted',
  },
] as const;
