import { Skeleton, SkeletonPage } from '@/components/skeleton';

export default function Loading() {
  return (
    <SkeletonPage>
      <div className="section" style={{ marginTop: 8, maxWidth: 780 }}>
        <Skeleton height={18} width="140px" />
        <div style={{ marginTop: 12 }}>
          <Skeleton height={34} width="min(460px, 90%)" />
        </div>
        <div style={{ marginTop: 10 }}>
          <Skeleton height={14} width="240px" />
        </div>
        <div style={{ marginTop: 24 }}>
          <Skeleton height={150} radius={12} />
        </div>
        <div className="split" style={{ marginTop: 28 }}>
          <div className="panel">
            <div className="panel-body">
              <Skeleton height={16} width="120px" />
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} style={{ marginTop: 18 }}>
                  <Skeleton height={14} width="40%" />
                  <div style={{ marginTop: 6 }}>
                    <Skeleton height={11} width="65%" />
                  </div>
                </div>
              ))}
            </div>
          </div>
          <Skeleton height={180} radius={12} />
        </div>
      </div>
    </SkeletonPage>
  );
}
