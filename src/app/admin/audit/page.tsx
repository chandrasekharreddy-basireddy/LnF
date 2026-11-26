import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { adminAudit, currentUser, isAdmin } from '@/lib/data';
import { formatDateTime } from '@/lib/validation';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Audit log', robots: { index: false, follow: false } };

export default async function AuditPage() {
  const user = await currentUser();
  if (!user) redirect('/sign-in?next=/admin/audit');
  if (!isAdmin(user)) redirect('/admin');

  const logs = await adminAudit(150);

  return (
    <div className="section" style={{ marginTop: 8 }}>
      <Link className="small" href="/admin">
        ← Admin
      </Link>
      <h1 style={{ marginTop: 8 }}>Audit log</h1>
      <p className="muted small">
        Append-only. Every claim decision, handover and role change is recorded here, server-side.
      </p>

      <div className="panel" style={{ marginTop: 20 }}>
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th scope="col">When</th>
                <th scope="col">Action</th>
                <th scope="col">Actor</th>
                <th scope="col">Resource</th>
                <th scope="col">Detail</th>
              </tr>
            </thead>
            <tbody>
              {logs.map((l) => (
                <tr key={l.id}>
                  <td className="nowrap">{formatDateTime(l.at)}</td>
                  <td>
                    <span className={`chip ${l.severity === 'alert' ? 'chip-danger' : l.severity === 'warn' ? 'chip-warn' : 'chip-quiet'}`}>
                      {l.action.replace(/_/g, ' ')}
                    </span>
                  </td>
                  <td className="small">{l.actor}</td>
                  <td className="small">
                    {l.resourceType ?? '—'}
                    {l.resourceId ? <div className="item-ref">{l.resourceId.slice(0, 8)}</div> : null}
                  </td>
                  <td className="small muted">
                    <code style={{ fontSize: '0.75rem' }}>{JSON.stringify(l.detail)}</code>
                  </td>
                </tr>
              ))}
              {logs.length === 0 ? (
                <tr>
                  <td colSpan={5} className="small muted">
                    No entries yet.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
