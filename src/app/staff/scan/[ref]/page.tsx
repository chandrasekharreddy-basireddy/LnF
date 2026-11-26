import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { currentUser, isStaff, staffItem } from '@/lib/data';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Scan', robots: { index: false, follow: false } };

export default async function ScanResultPage({ params }: { params: Promise<{ ref: string }> }) {
  const user = await currentUser();
  if (!user) redirect('/sign-in?next=/staff/scan');
  if (!isStaff(user)) redirect('/');

  const { ref } = await params;
  const detail = await staffItem(ref);

  if (detail) redirect(`/staff/items/${detail.item.ref}`);

  return (
    <div className="section" style={{ maxWidth: 520 }}>
      <Link className="small" href="/staff/scan">
        ← Scan again
      </Link>
      <h1 style={{ marginTop: 8 }}>No item for “{ref}”</h1>
      <p className="lede">
        That code is not a custody reference. A handover code belongs to a claim, not an item — open the claim from the
        desk queue and confirm the release there.
      </p>
      <div className="row" style={{ marginTop: 16 }}>
        <Link className="btn" href="/staff/scan">
          Try another code
        </Link>
        <Link className="btn btn-secondary" href="/staff">
          Back to the desk
        </Link>
      </div>
    </div>
  );
}
