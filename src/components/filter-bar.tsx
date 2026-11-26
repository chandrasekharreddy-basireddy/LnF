import { CATEGORIES } from '@/lib/copy';
import type { SearchParams } from '@/lib/data';

export function FilterBar({
  params,
  zones,
}: {
  params: SearchParams;
  zones: { code: string; name: string }[];
}) {
  return (
    <form className="card" method="get" action="/browse" role="search" aria-label="Filter listings">
      <div className="filters">
        <div className="field" style={{ gridColumn: '1 / -1' }}>
          <label htmlFor="f-q">Search</label>
          <input
            id="f-q"
            type="search"
            name="q"
            defaultValue={params.q ?? ''}
            placeholder="black airpods, blue bottle, library"
            autoComplete="off"
          />
        </div>
        <div className="field">
          <label htmlFor="f-type">Type</label>
          <select id="f-type" name="type" defaultValue={params.type ?? ''}>
            <option value="">Lost and found</option>
            <option value="found">Found items</option>
            <option value="lost">Lost reports</option>
          </select>
        </div>
        <div className="field">
          <label htmlFor="f-category">Category</label>
          <select id="f-category" name="category" defaultValue={params.category ?? ''}>
            <option value="">Any category</option>
            {CATEGORIES.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="f-zone">Zone</label>
          <select id="f-zone" name="zone" defaultValue={params.zone ?? ''}>
            <option value="">Anywhere on campus</option>
            {zones.map((z) => (
              <option key={z.code} value={z.code}>
                {z.name}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="f-sort">Sort</label>
          <select id="f-sort" name="sort" defaultValue={params.sort ?? 'best'}>
            <option value="best">Best match</option>
            <option value="newest">Newest first</option>
          </select>
        </div>
        <div className="field">
          <label htmlFor="f-from">From date</label>
          <input id="f-from" type="date" name="from" defaultValue={params.from ?? ''} />
        </div>
        <div className="field">
          <label htmlFor="f-to">To date</label>
          <input id="f-to" type="date" name="to" defaultValue={params.to ?? ''} />
        </div>
        <div className="field">
          <label htmlFor="f-status">Status</label>
          <select id="f-status" name="status" defaultValue={params.status ?? ''}>
            <option value="">Open and returned</option>
            <option value="available">Open only</option>
            <option value="recovered">Returned only</option>
          </select>
        </div>
      </div>
      <div className="filter-actions" style={{ marginTop: 16 }}>
        <button className="btn" type="submit">
          Apply filters
        </button>
        <a className="btn btn-ghost btn-sm" href="/browse">
          Clear
        </a>
      </div>
    </form>
  );
}
