import Link from 'next/link';

export function Pagination({
  page,
  total,
  limit,
  params,
}: {
  page: number;
  total: number;
  limit: number;
  params: Record<string, string | undefined>;
}) {
  const pages = Math.max(Math.ceil(total / limit), 1);
  if (pages <= 1) return null;

  const href = (p: number) => {
    const usp = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => {
      if (v) usp.set(k, v);
    });
    usp.set('page', String(p));
    return `/browse?${usp.toString()}`;
  };

  return (
    <nav className="row" aria-label="Pagination" style={{ marginTop: 24 }}>
      {page > 1 ? (
        <Link className="btn btn-secondary btn-sm" href={href(page - 1)} rel="prev">
          Previous
        </Link>
      ) : null}
      <span className="small muted">
        Page {page} of {pages} · {total} listing{total === 1 ? '' : 's'}
      </span>
      {page < pages ? (
        <Link className="btn btn-secondary btn-sm" href={href(page + 1)} rel="next">
          Next
        </Link>
      ) : null}
    </nav>
  );
}
