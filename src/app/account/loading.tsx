import { Skeleton, SkeletonPage, SkeletonRows } from '@/components/skeleton';

export default function Loading() {
  return (
    <SkeletonPage>
      <div className="section" style={{ marginTop: 8 }}>
        <Skeleton height={12} width="90px" />
        <div style={{ marginTop: 10 }}>
          <Skeleton height={32} width="240px" />
        </div>
        <div className="split" style={{ marginTop: 20 }}>
          <div className="panel">
            <div className="panel-head">
              <Skeleton height={14} width="120px" />
            </div>
            <div className="panel-body">
              <SkeletonRows rows={3} />
            </div>
          </div>
          <Skeleton height={160} radius={12} />
        </div>
      </div>
    </SkeletonPage>
  );
}
