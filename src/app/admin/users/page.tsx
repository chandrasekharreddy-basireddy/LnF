import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { adminUsers, currentUser, isAdmin } from '@/lib/data';
import { RoleForm } from '@/components/admin-role-form';
import { EraseUserForm } from '@/components/admin-erase-form';
import { formatDate } from '@/lib/validation';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Users', robots: { index: false, follow: false } };

export default async function AdminUsersPage() {
  const user = await currentUser();
  if (!user) redirect('/sign-in?next=/admin/users');
  if (!isAdmin(user)) redirect('/admin');

  const users = await adminUsers();

  return (
    <div className="section" style={{ marginTop: 8 }}>
      <Link className="small" href="/admin">
        ← Admin
      </Link>
      <h1 style={{ marginTop: 8 }}>Users and roles</h1>
      <p className="muted small">
        Roles are server-assigned only. Nobody can grant themselves staff or admin access from the browser.
      </p>

      <div className="split" style={{ marginTop: 20 }}>
        <section className="panel">
          <div className="panel-head">
            <strong>{users.length} accounts</strong>
          </div>
          <div className="panel-body">
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr>
                    <th scope="col">Account</th>
                    <th scope="col">Roles</th>
                    <th scope="col">Joined</th>
                    <th scope="col">Erasure</th>
                  </tr>
                </thead>
                <tbody>
                  {users.map((u) => (
                    <tr key={u.id}>
                      <td>
                        <div>{u.name ?? 'No name'}</div>
                        <div className="small muted">{u.email}</div>
                      </td>
                      <td>
                        <div className="pill-row">
                          {u.roles.map((r) => (
                            <span key={r} className={`chip ${r === 'member' ? 'chip-quiet' : 'chip-ok'}`}>
                              {r}
                            </span>
                          ))}
                        </div>
                      </td>
                      <td>{formatDate(u.createdAt)}</td>
                      <td>
                        {u.id === user.id ? (
                          <span className="small muted">you</span>
                        ) : (
                          <EraseUserForm userId={u.id} email={u.email ?? 'this account'} />
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>

        <aside className="panel">
          <div className="panel-head">
            <strong>Change a role</strong>
          </div>
          <div className="panel-body">
            <RoleForm />
          </div>
        </aside>
      </div>
    </div>
  );
}
