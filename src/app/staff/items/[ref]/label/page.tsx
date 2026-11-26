import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import QRCode from 'qrcode';
import { currentUser, isStaff, staffItem } from '@/lib/data';
import { env } from '@/lib/env';
import { categoryLabel } from '@/lib/copy';
import { formatDate } from '@/lib/validation';
import { PrintButton } from '@/components/print-button';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Custody label', robots: { index: false, follow: false } };

export default async function LabelPage({ params }: { params: Promise<{ ref: string }> }) {
  const user = await currentUser();
  if (!user) redirect('/sign-in?next=/staff');
  if (!isStaff(user)) redirect('/');

  const { ref } = await params;
  const detail = await staffItem(ref);
  if (!detail) notFound();

  const item = detail.item;
  const scanUrl = `${env.siteUrl}/staff/scan/${item.ref}`;
  // Opaque reference only: the label carries no name, no email, no phone.
  const svg = await QRCode.toString(scanUrl, { type: 'svg', margin: 0, errorCorrectionLevel: 'M' });

  return (
    <div className="label-page">
      <div className="row no-print" style={{ justifyContent: 'space-between', marginBottom: 16 }}>
        <Link className="small" href={`/staff/items/${item.ref}`}>
          ← Back to the item
        </Link>
        <PrintButton />
      </div>

      <article className="custody-label">
        <header>
          <span className="label-desk">{env.deskLabel}</span>
          <span className="label-kind">{item.type === 'found' ? 'FOUND ITEM' : 'LOST REPORT'}</span>
        </header>

        <p className="label-ref">{item.ref}</p>

        <dl className="label-meta">
          <div>
            <dt>Category</dt>
            <dd>{categoryLabel(item.category)}</dd>
          </div>
          <div>
            <dt>Intake</dt>
            <dd>{formatDate(item.createdAt)}</dd>
          </div>
          <div>
            <dt>Expires</dt>
            <dd>{formatDate(item.eventDate)}</dd>
          </div>
        </dl>

        <div className="label-qr" dangerouslySetInnerHTML={{ __html: svg }} />
        <p className="label-foot">Scan at the desk · no personal data on this tag</p>
      </article>

      <p className="small muted no-print" style={{ marginTop: 16, maxWidth: '48ch' }}>
        Print at 100% on a 2&quot; × 3&quot; thermal label. The QR resolves to the staff page for this reference and is
        useless without a staff session.
      </p>
    </div>
  );
}
