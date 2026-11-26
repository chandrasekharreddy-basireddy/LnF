import { STATUS_LABEL } from '@/lib/copy';

const TONE: Record<string, string> = {
  available: 'chip chip-ok',
  claimed: 'chip chip-warn',
  recovered: 'chip chip-quiet',
  pending_moderation: 'chip chip-warn',
  quarantined: 'chip chip-quiet',
  expired: 'chip chip-quiet',
  archived: 'chip chip-quiet',
  submitted: 'chip chip-warn',
  under_review: 'chip chip-warn',
  approved: 'chip chip-ok',
  rejected: 'chip chip-danger',
  withdrawn: 'chip chip-quiet',
};

export function StatusChip({ status, label }: { status: string; label?: string }) {
  return <span className={TONE[status] ?? 'chip'}>{label ?? STATUS_LABEL[status] ?? status}</span>;
}
