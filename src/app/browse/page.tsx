import type { Metadata } from 'next';
import Link from 'next/link';
import { searchItems, zones } from '@/lib/data';
import { FilterBar } from '@/components/filter-bar';
import { ItemCard } from '@/components/item-card';
import { Pagination } from '@/components/pagination';
import { EmptyState } from '@/components/empty-state';
import { CategoryIcon } from '@/components/category-icon';
import { EMPTY } from '@/lib/copy';
import { SaveSearchForm } from '@/components/save-controls';
import { Banner } from '@/components/banner';
import { currentUser } from '@/lib/data';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Browse the board',
  description: 'Everything handed in and everything reported lost, filterable by category, zone and date.',
};

type Params = Promise<Record<string, string | string[] | undefined>>;

function one(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}

export default async function BrowsePage({ searchParams }: { searchParams: Params }) {
  const sp = await searchParams;
  const q = one(sp.q);
  const type = one(sp.type);
  const category = one(sp.category);
  const zone = one(sp.zone);
  const from = one(sp.from);
  const to = one(sp.to);
  const status = one(sp.status);
  const sort = one(sp.sort);
  const page = Math.max(Number(one(sp.page) ?? 1) || 1, 1);

  const [result, zoneList, user] = await Promise.all([
    searchItems({ q, type, category, zone, from, to, status, sort, page, limit: 18 }),
    zones(),
    currentUser(),
  ]);

  const hasFilters = Boolean(q || type || category || zone || from || to || status);
  const unreachable = result.ok === false;

  return (
    <>
      <div className="section-head" style={{ marginTop: 8 }}>
        <div>
          <p className="eyebrow">The board</p>
          <h1 style={{ marginBottom: 4 }}>Browse what has been handed in</h1>
          <p className="muted small">
            {unreachable
              ? 'The board could not be read just now.'
              : `${result.total} listing${result.total === 1 ? '' : 's'}${hasFilters ? ' match your filters' : ' on the board'}.`}
          </p>
        </div>
        <Link className="btn btn-sm" href="/report/found">
          Hand something in
        </Link>
      </div>

      {unreachable ? (
        <div style={{ marginBottom: 16 }}>
          <Banner tone="warn" title="The board did not load">
            This is not an empty board — the listings could not be fetched. Reload in a moment; if it keeps happening,
            the desk can look up your reference directly.
          </Banner>
        </div>
      ) : null}

      <FilterBar params={{ q, type, category, zone, from, to, status, sort }} zones={zoneList} />

      {user && hasFilters ? (
        <div className="card" style={{ marginTop: 16 }}>
          <SaveSearchForm q={q} type={type} category={category} zone={zone} />
        </div>
      ) : null}

      <div style={{ marginTop: 24 }}>
        {result.items.length ? (
          <>
            <div className="item-grid">
              {result.items.map((item) => (
                <ItemCard key={item.id} item={item} />
              ))}
            </div>
            <Pagination
              page={page}
              total={result.total}
              limit={result.limit}
              params={{ q, type, category, zone, from, to, status, sort }}
            />
          </>
        ) : unreachable ? null : hasFilters ? (
          <EmptyState
            icon={<CategoryIcon category="other" size={34} />}
            title={EMPTY.browseNone.title}
            body={EMPTY.browseNone.body}
            action={{ href: '/browse', label: 'Clear filters' }}
          />
        ) : (
          <EmptyState
            icon={<CategoryIcon category="other" size={34} />}
            title={EMPTY.browseBlank.title}
            body={EMPTY.browseBlank.body}
            action={{ href: '/report/lost', label: 'Post a lost report' }}
          />
        )}
      </div>
    </>
  );
}
