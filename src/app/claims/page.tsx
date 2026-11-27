import type { Metadata } from 'next';
import Link from 'next/link';
import { currentUser, myClaims } from '@/lib/data';
import { StatusChip } from '@/components/status-chip';
import { EmptyState } from '@/components/empty-state';
import { EMPTY } from '@/lib/copy';
import { formatDate } from '@/lib/validation';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'My claims', robots: { index: false, follow: false } };

export default async function ClaimsPage() {
  const user = await currentUser();
  if (!user) {
    return (
      <div className="section" style={{ maxWidth: 520 }}>
        <h1>My claims</h1>
        <p className="lede">Sign in to see the claims you have made and their handover codes.</p>
        <Link className="btn" href="/sign-in?next=/claims">
          Sign in
        </Link>
      </div>
    );
  }

  const claims = await myClaims();

  return (
    <div className="section" style={{ marginTop: 8 }}>
      <p className="eyebrow">Your account</p>
      <h1>My claims</h1>

      {claims.length ? (
        <div className="panel" style={{ marginTop: 16 }}>
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th scope="col">Claim</th>
                  <th scope="col">Item</th>
                  <th scope="col">Status</th>
                  <th scope="col">Submitted</th>
                  <th scope="col">
                    <span className="sr-only">Open</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {claims.map((c) => (
                  <tr key={c.ref}>
                    <td className="mono">{c.ref}</td>
                    <td>
                      <div>{c.itemTitle}</div>
                      <div className="item-ref">{c.itemRef}</div>
                    </td>
                    <td>
                      <StatusChip status={c.status} />
                    </td>
                    <td>{formatDate(c.createdAt)}</td>
                    <td>
                      <Link className="btn btn-secondary btn-sm" href={`/claims/${c.ref}`}>
                        Open
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <div style={{ marginTop: 16 }}>
          <EmptyState
            title={EMPTY.claims.title}
            body={EMPTY.claims.body}
            action={{ href: '/browse', label: 'Find your item' }}
          />
        </div>
      )}
    </div>
  );
}
