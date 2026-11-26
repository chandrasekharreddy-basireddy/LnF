import { Skeleton, SkeletonPage } from '@/components/skeleton';

export default function Loading() {
  return (
    <SkeletonPage>
      <div className="section" style={{ marginTop: 8 }}>
        <div className="split">
          <div>
            <Skeleton height={22} width="160px" radius={999} />
            <div style={{ marginTop: 14 }}>
              <Skeleton height={38} width="min(520px, 95%)" />
            </div>
            <div style={{ marginTop: 12 }}>
              <Skeleton height={16} />
            </div>
            <div style={{ marginTop: 8 }}>
              <Skeleton height={16} width="80%" />
            </div>
            <div style={{ marginTop: 22 }}>
              <Skeleton height={280} radius={12} />
            </div>
            <div className="kv" style={{ marginTop: 24 }}>
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} height={16} />
              ))}
            </div>
          </div>
          <aside className="stack">
            <div className="panel">
              <div className="panel-head">
                <Skeleton height={14} width="120px" />
              </div>
              <div className="panel-body">
                <Skeleton height={46} />
                <div style={{ marginTop: 10 }}>
                  <Skeleton height={46} />
                </div>
              </div>
            </div>
            <Skeleton height={140} radius={12} />
          </aside>
        </div>
      </div>
    </SkeletonPage>
  );
}
