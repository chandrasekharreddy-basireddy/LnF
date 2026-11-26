import { Skeleton, SkeletonPage, SkeletonRows } from '@/components/skeleton';

export default function Loading() {
  return (
    <SkeletonPage>
      <div className="section" style={{ marginTop: 8 }}>
        <Skeleton height={12} width="90px" />
        <div style={{ marginTop: 10 }}>
          <Skeleton height={32} width="200px" />
        </div>
        <div className="panel" style={{ marginTop: 20 }}>
          <div className="panel-body">
            <SkeletonRows rows={4} />
          </div>
        </div>
      </div>
    </SkeletonPage>
  );
}
