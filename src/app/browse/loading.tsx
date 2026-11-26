import { Skeleton, SkeletonCard, SkeletonPage } from '@/components/skeleton';

export default function Loading() {
  return (
    <SkeletonPage>
      <div className="section" style={{ marginTop: 8 }}>
        <Skeleton height={12} width="90px" />
        <div style={{ marginTop: 10 }}>
          <Skeleton height={34} width="min(420px, 90%)" />
        </div>
        <div style={{ marginTop: 8 }}>
          <Skeleton height={14} width="180px" />
        </div>
      </div>
      <div className="card" style={{ marginTop: 8 }}>
        <Skeleton height={46} />
        <div className="filters" style={{ marginTop: 14 }}>
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} height={42} />
          ))}
        </div>
      </div>
      <div className="item-grid" style={{ marginTop: 24 }}>
        {Array.from({ length: 6 }).map((_, i) => (
          <SkeletonCard key={i} />
        ))}
      </div>
    </SkeletonPage>
  );
}
