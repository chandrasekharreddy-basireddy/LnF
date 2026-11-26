import { Skeleton, SkeletonPage, SkeletonRows } from '@/components/skeleton';

export default function Loading() {
  return (
    <SkeletonPage>
      <div className="section" style={{ marginTop: 8 }}>
        <Skeleton height={12} width="90px" />
        <div style={{ marginTop: 10 }}>
          <Skeleton height={32} width="280px" />
        </div>
        <div className="grid grid-3" style={{ margin: '24px 0' }}>
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="stat">
              <Skeleton height={26} width="60px" />
              <div style={{ marginTop: 8 }}>
                <Skeleton height={10} width="120px" />
              </div>
            </div>
          ))}
        </div>
        <div className="panel">
          <div className="panel-head">
            <Skeleton height={14} width="220px" />
          </div>
          <div className="panel-body">
            <SkeletonRows rows={5} />
          </div>
        </div>
      </div>
    </SkeletonPage>
  );
}
