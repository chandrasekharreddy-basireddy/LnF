import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { currentUser, isStaff } from '@/lib/data';
import { ScanConsole } from '@/components/scan-console';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Scan', robots: { index: false, follow: false } };

export default async function ScanPage() {
  const user = await currentUser();
  if (!user) redirect('/sign-in?next=/staff/scan');
  if (!isStaff(user)) redirect('/');

  return (
    <div className="section" style={{ marginTop: 8, maxWidth: 640 }}>
      <Link className="small" href="/staff">
        ← Desk
      </Link>
      <h1 style={{ marginTop: 8 }}>Scan a tag</h1>
      <p className="lede">
        Point the camera at a custody label, or type the reference. Scanning a handover code opens the item so you can
        confirm the release.
      </p>
      <div className="card" style={{ marginTop: 20 }}>
        <ScanConsole />
      </div>
    </div>
  );
}
