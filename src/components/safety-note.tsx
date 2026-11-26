import { SAFETY } from '@/lib/copy';

export function SafetyNote({ compact = false }: { compact?: boolean }) {
  if (compact) {
    return (
      <p className="small muted" style={{ marginTop: 12 }}>
        <strong style={{ color: 'var(--ink)' }}>{SAFETY.noPay}</strong> {SAFETY.collect} Never share a handover code
        before you are at the counter.
      </p>
    );
  }
  return (
    <div className="banner banner-safety">
      <div>
        <strong>{SAFETY.noPay}</strong>
        <p style={{ margin: '4px 0 8px' }}>{SAFETY.noPayDetail}</p>
        <strong>{SAFETY.collect}</strong>
        <p style={{ margin: '4px 0 8px' }}>{SAFETY.collectDetail}</p>
        <strong>{SAFETY.dontPost}</strong>
        <p style={{ margin: '4px 0 0' }}>{SAFETY.dontPostDetail}</p>
      </div>
    </div>
  );
}
