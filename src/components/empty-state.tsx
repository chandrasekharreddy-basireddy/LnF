import Link from 'next/link';
import type { ReactNode } from 'react';

export function EmptyState({
  title,
  body,
  action,
  icon,
}: {
  title: string;
  body: string;
  action?: { href: string; label: string };
  icon?: ReactNode;
}) {
  return (
    <div className="card text-center" style={{ padding: '40px 24px' }}>
      {icon ? <div style={{ marginBottom: 12, display: 'flex', justifyContent: 'center' }}>{icon}</div> : null}
      <h2 style={{ marginBottom: 8 }}>{title}</h2>
      <p className="muted" style={{ maxWidth: '52ch', margin: '0 auto 18px' }}>
        {body}
      </p>
      {action ? (
        <Link className="btn btn-secondary" href={action.href}>
          {action.label}
        </Link>
      ) : null}
    </div>
  );
}
