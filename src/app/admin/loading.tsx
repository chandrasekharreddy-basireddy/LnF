import { Skeleton, SkeletonPage, SkeletonRows } from '@/components/skeleton';

export default function Loading() {
  return (
    <SkeletonPage>
      <div className="section" style={{ marginTop: 8 }}>
        <Skeleton height={12} width="70px" />
        <div style={{ marginTop: 10 }}>
          <Skeleton height={32} width="300px" />
        </div>
        <div className="stat-strip" style={{ margin: '24px 0' }}>
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="stat">
              <Skeleton height={26} width="70px" />
              <div style={{ marginTop: 8 }}>
                <Skeleton height={10} width="110px" />
              </div>
            </div>
          ))}
        </div>
        <div className="panel">
          <div className="panel-body">
            <SkeletonRows rows={6} />
          </div>
        </div>
      </div>
    </SkeletonPage>
  );
}
