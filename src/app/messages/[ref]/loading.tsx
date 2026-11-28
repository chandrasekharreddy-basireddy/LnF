import { SkeletonRows } from '@/components/skeleton';

export default function Loading() {
  return (
    <div className="wrap section">
      <div className="skeleton" style={{ height: 30, width: 300, marginBottom: 16 }} />
      <SkeletonRows rows={5} />
    </div>
  );
}
