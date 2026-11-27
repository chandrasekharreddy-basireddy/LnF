import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { currentUser, isStaff } from '@/lib/data';
import { ImportForm } from '@/components/import-form';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Import the backlog', robots: { index: false, follow: false } };

export default async function ImportPage() {
  const user = await currentUser();
  if (!user) redirect('/sign-in?next=/staff/import');
  if (!isStaff(user)) redirect('/');

  return (
    <div className="section" style={{ marginTop: 8, maxWidth: 860 }}>
      <p className="eyebrow">
        <Link href="/staff">Desk</Link> · Import
      </p>
      <h1>The box behind the counter</h1>
      <p className="lede">
        A board launches with a backlog, not with six listings. Paste a spreadsheet of everything already in the box and
        it goes live in one pass — same validation, same ID-document quarantine as a single intake.
      </p>

      <div className="card" style={{ marginTop: 8 }}>
        <ImportForm />
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <p className="small" style={{ marginBottom: 6 }}>
          <strong>Before you import</strong>
        </p>
        <ul className="small muted" style={{ margin: 0, paddingLeft: 18 }}>
          <li>One row per item. Date format <code className="mono">YYYY-MM-DD</code>.</li>
          <li>The question is what a claimant must answer; the answer is hashed on arrival.</li>
          <li>Never put an ID number in the description — those rows are quarantined, not published.</li>
          <li>Photos come later: use the label printer or the item page to attach one.</li>
        </ul>
      </div>
    </div>
  );
}
