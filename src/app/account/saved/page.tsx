import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { currentUser, mySavedItems, mySavedSearches } from '@/lib/data';
import { ItemCard } from '@/components/item-card';
import { EmptyState } from '@/components/empty-state';
import { DeleteSearchButton } from '@/components/save-controls';
import { formatDate } from '@/lib/validation';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Saved', robots: { index: false, follow: false } };

export default async function SavedPage() {
  const user = await currentUser();
  if (!user) redirect('/sign-in?next=/account/saved');

  const [items, searches] = await Promise.all([mySavedItems(), mySavedSearches()]);

  return (
    <div className="section" style={{ marginTop: 8 }}>
      <Link className="small" href="/account">
        ← Account
      </Link>
      <h1 style={{ marginTop: 8 }}>Saved</h1>
      <p className="muted small">
        Items you kept an eye on, and the searches you do not want to retype. Both are private to you.
      </p>

      <section style={{ marginTop: 28 }}>
        <div className="section-head">
          <h2>Saved items</h2>
          <span className="small muted">{items.length} kept</span>
        </div>
        {items.length ? (
          <div className="item-grid">
            {items.map((item) => (
              <ItemCard key={item.id} item={item} />
            ))}
          </div>
        ) : (
          <EmptyState
            title="Nothing saved yet"
            body="Open any listing and tap Save. It appears here, and you can claim it whenever you are ready."
            action={{ href: '/browse', label: 'Browse the board' }}
          />
        )}
      </section>

      <section style={{ marginTop: 36 }}>
        <div className="section-head">
          <h2>Saved searches</h2>
          <span className="small muted">{searches.length} watching</span>
        </div>
        {searches.length ? (
          <div className="panel">
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr>
                    <th scope="col">Name</th>
                    <th scope="col">Filters</th>
                    <th scope="col">Last checked</th>
                    <th scope="col">
                      <span className="sr-only">Remove</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {searches.map((search) => (
                    <tr key={search.id}>
                      <td>{search.label}</td>
                      <td className="small muted">
                        {[search.query, search.type, search.category, search.zone].filter(Boolean).join(' · ') ||
                          'everything'}
                      </td>
                      <td>{search.lastNotifiedAt ? formatDate(search.lastNotifiedAt) : 'not yet'}</td>
                      <td>
                        <DeleteSearchButton id={search.id} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : (
          <EmptyState
            title="No saved searches"
            body="Search the board, then tap Save this search. You get one notification when something new matches — not a feed."
            action={{ href: '/browse?type=lost', label: 'Try a search' }}
          />
        )}
      </section>
    </div>
  );
}
