/**
 * Geometry-matched placeholders. A spinner over blank space tells the user
 * nothing; a block the same shape as the content says "this is arriving".
 */
export function Skeleton({ height = 16, width = '100%', radius = 8 }: { height?: number; width?: string; radius?: number }) {
  return <div className="skeleton" style={{ height, width, borderRadius: radius }} aria-hidden="true" />;
}

export function SkeletonCard() {
  return (
    <div className="card" aria-hidden="true">
      <Skeleton height={140} radius={10} />
      <div style={{ marginTop: 12 }}>
        <Skeleton height={18} width="70%" />
        <div style={{ marginTop: 8 }}>
          <Skeleton height={12} width="45%" />
        </div>
      </div>
    </div>
  );
}

export function SkeletonRows({ rows = 5 }: { rows?: number }) {
  return (
    <div className="stack" aria-hidden="true">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="row" style={{ gap: 12 }}>
          <Skeleton height={44} width="44px" radius={10} />
          <div style={{ flex: 1 }}>
            <Skeleton height={14} width={`${60 + ((i * 7) % 30)}%`} />
            <div style={{ marginTop: 6 }}>
              <Skeleton height={10} width="30%" />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

export function SkeletonPage({ children }: { children: React.ReactNode }) {
  return (
    <div aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading…</span>
      {children}
    </div>
  );
}
