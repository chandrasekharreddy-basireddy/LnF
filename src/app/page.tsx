import Link from 'next/link';
import { boardStats, searchItems } from '@/lib/data';
import { env } from '@/lib/env';
import { ItemCard } from '@/components/item-card';
import { SafetyNote } from '@/components/safety-note';
import { EmptyState } from '@/components/empty-state';
import { CategoryIcon } from '@/components/category-icon';

export const dynamic = 'force-dynamic';

export default async function HomePage() {
  const [stats, recent] = await Promise.all([
    boardStats(),
    searchItems({ sort: 'newest', limit: 6, page: 1 }),
  ]);

  const s = stats ?? {
    open_found: 0,
    open_lost: 0,
    recovered_total: 0,
    recovered_30d: 0,
    median_days_to_recovery: null,
  };
  const onBoard = recent.total;
  const recovered = s.recovered_total ?? 0;

  return (
    <>
      <section className="hero">
        <p className="eyebrow">
          {env.campusName} · lost and found
        </p>
        <h1>Lost something? It is probably already at the desk.</h1>
        <p className="lede">
          Search what has been handed in, claim what is yours with a question only you can answer, and collect it from{' '}
          {env.deskLabel}. No payments, no meeting strangers, no group chats.
        </p>

        <form className="searchbar" method="get" action="/browse" role="search">
          <label htmlFor="hero-q" className="sr-only">
            Search the board
          </label>
          <input
            id="hero-q"
            type="search"
            name="q"
            placeholder="black airpods, blue bottle, library"
            autoComplete="off"
          />
          <button className="btn" type="submit">
            Search
          </button>
        </form>

        <div className="hero-actions">
          <Link className="btn btn-secondary" href="/report/lost">
            I lost something
          </Link>
          <Link className="btn btn-secondary" href="/report/found">
            I found something
          </Link>
        </div>

        <div className="trust-row">
          <span>
            <i className="dot" aria-hidden="true" /> Handovers at {env.deskLabel}
          </span>
          <span>
            <i className="dot" aria-hidden="true" /> Answers verified, never published
          </span>
          <span>
            <i className="dot" aria-hidden="true" /> Photos stripped of location data
          </span>
        </div>

        <div className="stat-strip">
          <div className="stat">
            <b>{onBoard}</b>
            <span>Listings on the board</span>
          </div>
          <div className="stat">
            <b>{s.open_found}</b>
            <span>Waiting at the desk</span>
          </div>
          <div className="stat">
            <b>{recovered}</b>
            <span>Returned to owners</span>
          </div>
          <div className="stat">
            <b>{s.median_days_to_recovery != null ? `${s.median_days_to_recovery}d` : '—'}</b>
            <span>Median time to return</span>
          </div>
        </div>
      </section>

      <section className="section">
        <div className="section-head">
          <h2>Recently handed in</h2>
          <Link className="small" href="/browse">
            See everything →
          </Link>
        </div>

        {recent.items.length ? (
          <div className="item-grid">
            {recent.items.map((item) => (
              <ItemCard key={item.id} item={item} />
            ))}
          </div>
        ) : (
          <EmptyState
            icon={<CategoryIcon category="other" size={34} />}
            title="The board is new"
            body="Nothing has been handed in yet. Post a lost report now — finders search those first, and you will be emailed the moment something similar is logged."
            action={{ href: '/report/lost', label: 'Post a lost report' }}
          />
        )}
      </section>

      <section className="section">
        <div className="section-head">
          <h2>How it works</h2>
        </div>
        <div className="grid grid-3">
          <div className="card">
            <p className="eyebrow">Step 1</p>
            <h3>Report</h3>
            <p className="small muted">
              Lost something? Post what it looks like and where you last had it. Found something? Log it with one
              question only the owner could answer.
            </p>
          </div>
          <div className="card">
            <p className="eyebrow">Step 2</p>
            <h3>Claim</h3>
            <p className="small muted">
              Found a match? Answer the verification question. The desk compares your answer with what the finder
              recorded — a wrong answer never reveals the right one.
            </p>
          </div>
          <div className="card">
            <p className="eyebrow">Step 3</p>
            <h3>Collect</h3>
            <p className="small muted">
              Once approved you get a one-time handover code. Show it at {env.deskLabel} and the item is yours. Nothing
              to pay, ever.
            </p>
          </div>
        </div>
      </section>

      <section className="section">
        <SafetyNote />
      </section>
    </>
  );
}
