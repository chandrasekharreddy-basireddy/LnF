import Link from 'next/link';
import type { PublicItem } from '@/lib/types';
import { CategoryIcon } from './category-icon';
import { StatusChip } from './status-chip';
import { categoryLabel } from '@/lib/copy';
import { formatDate } from '@/lib/validation';

export function ItemCard({ item }: { item: PublicItem }) {
  return (
    <Link href={`/items/${item.ref}`} className="item-card">
      <div className="thumb">
        {item.coverUrl ? (
          <img src={item.coverUrl} alt="" width={84} height={84} loading="lazy" />
        ) : (
          <CategoryIcon category={item.category} size={30} />
        )}
      </div>
      <div>
        <div className="row" style={{ gap: 6, marginBottom: 6 }}>
          <StatusChip status={item.status} />
          <span className={`chip ${item.type === 'lost' ? 'chip-lost' : 'chip-found'}`}>
            {item.type === 'lost' ? 'Lost' : 'Found'}
          </span>
          {item.isSample ? <span className="chip chip-quiet">Sample</span> : null}
        </div>
        <h3>{item.title}</h3>
        <div className="item-meta">
          <span>{categoryLabel(item.category)}</span>
          {item.zoneLabel ? <span>{item.zoneLabel}</span> : null}
          <span>{formatDate(item.eventDate)}</span>
        </div>
        <div className="item-ref" style={{ marginTop: 6 }}>
          {item.ref}
        </div>
      </div>
    </Link>
  );
}
