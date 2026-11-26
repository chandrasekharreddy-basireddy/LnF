import type { ReactNode } from 'react';

export function Banner({
  tone = 'info',
  title,
  children,
}: {
  tone?: 'info' | 'safety' | 'warn' | 'danger' | 'ok';
  title?: string;
  children: ReactNode;
}) {
  return (
    <div className={`banner banner-${tone}`} role={tone === 'danger' || tone === 'warn' ? 'alert' : undefined}>
      <div>
        {title ? <strong>{title}</strong> : null}
        <div>{children}</div>
      </div>
    </div>
  );
}
