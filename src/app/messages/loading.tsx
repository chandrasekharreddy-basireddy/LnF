import { SkeletonRows } from '@/components/skeleton';

export default function Loading() {
  return (
    <div className="wrap section">
      <div className="skeleton" style={{ height: 34, width: 260, marginBottom: 12 }} />
      <SkeletonRows rows={4} />
    </div>
  );
}
