import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { currentUser, myItems, myPushState } from '@/lib/data';
import { env } from '@/lib/env';
import { vapidConfig } from '@/lib/push';
import { PushToggle } from '@/components/push-toggle';
import { buildWhatsAppLink } from '@/lib/whatsapp';
import { AccountForm, DeleteAccount } from '@/components/account-form';
import { StatusChip } from '@/components/status-chip';
import { formatDate } from '@/lib/validation';
import { signOut } from '@/lib/actions/auth';
import { ThemeToggle } from '@/components/theme-toggle';
import { cookies } from 'next/headers';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Your account', robots: { index: false, follow: false } };

export default async function AccountPage() {
  const user = await currentUser();
  if (!user) redirect('/sign-in?next=/account');
  const items = await myItems();
  const push = await myPushState();
  const pushConfigured = vapidConfig({
    publicKey: env.vapidPublicKey,
    privateKey: env.vapidPrivateKey,
    subject: env.vapidSubject,
  }).ok;
  const deskWhatsApp = buildWhatsAppLink(
    env.deskWhatsApp,
    `Hi ${env.deskLabel}, I have a question about my account on the L&F board.`,
  );
  const stored = (await cookies()).get('lnf-theme')?.value;
  const theme = stored === 'light' || stored === 'dark' ? stored : 'auto';

  return (
    <div className="section" style={{ marginTop: 8 }}>
      <div className="section-head">
        <div>
          <p className="eyebrow">Your account</p>
          <h1 style={{ marginBottom: 4 }}>{user.name || user.email}</h1>
          <p className="muted small">
            {user.email} · roles: {user.roles.join(', ') || 'member'}
          </p>
        </div>
        <form action={signOut}>
          <button className="btn btn-secondary btn-sm" type="submit">
            Sign out
          </button>
        </form>
      </div>

      <div className="split" style={{ marginTop: 20 }}>
        <div className="stack-lg">
          <section className="panel">
            <div className="panel-head">
              <strong>Your listings</strong>
            </div>
            <div className="panel-body">
              {items.length ? (
                <div className="table-wrap">
                  <table className="data">
                    <thead>
                      <tr>
                        <th scope="col">Item</th>
                        <th scope="col">Type</th>
                        <th scope="col">Status</th>
                        <th scope="col">Listed</th>
                        <th scope="col">
                          <span className="sr-only">Open</span>
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {items.map((i) => (
                        <tr key={i.id}>
                          <td>
                            <div>{i.title}</div>
                            <div className="item-ref">{i.ref_code}</div>
                          </td>
                          <td>{i.type === 'lost' ? 'Lost' : 'Found'}</td>
                          <td>
                            <StatusChip status={i.status} />
                          </td>
                          <td>{formatDate(i.created_at)}</td>
                          <td>
                            <div className="row" style={{ gap: 6 }}>
                              <Link className="btn btn-secondary btn-sm" href={`/items/${i.ref_code}`}>
                                View
                              </Link>
                              <Link className="btn btn-secondary btn-sm" href={`/items/${i.ref_code}/timeline`}>
                                Timeline
                              </Link>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="small muted">
                  Nothing yet. <Link href="/report/lost">Post a lost report</Link> or{' '}
                  <Link href="/report/found">hand something in</Link>.
                </p>
              )}
            </div>
          </section>

          <section className="panel">
            <div className="panel-head">
              <strong>Your details</strong>
            </div>
            <div className="panel-body">
              <AccountForm
                name={user.name ?? ''}
                phone={user.phone ?? ''}
                alerts={user.alertsOptIn}
                marketing={user.marketingOptIn ?? false}
              />
            </div>
          </section>

          <section className="panel">
            <div className="panel-head">
              <strong>Notifications on this device</strong>
            </div>
            <div className="panel-body stack">
              <p className="small muted">
                Email alerts are the checkbox above. This is web push: a notification when a claim is decided, a
                handover is confirmed, or a lost report gets a possible match. It is tied to this browser, not to an
                account key, and the desk cannot read it.
              </p>
              <PushToggle
                configured={pushConfigured}
                optIn={push.optIn}
                devices={push.devices}
                publicKey={pushConfigured ? env.vapidPublicKey : null}
              />
              {deskWhatsApp ? (
                <a className="btn btn-secondary btn-block" href={deskWhatsApp} target="_blank" rel="noopener noreferrer">
                  Message the desk on WhatsApp
                </a>
              ) : null}
            </div>
          </section>
        </div>

        <aside className="stack">
          <div className="panel">
            <div className="panel-head">
              <strong>Claims</strong>
            </div>
            <div className="panel-body stack">
              <p className="small">Track a claim, see its status and collect your handover code.</p>
              <Link className="btn btn-secondary btn-block" href="/claims">
                My claims
              </Link>
              <Link className="btn btn-secondary btn-block" href="/account/saved">
                Saved items and searches
              </Link>
            </div>
          </div>

          <div className="panel">
            <div className="panel-head">
              <strong>Appearance</strong>
            </div>
            <div className="panel-body stack">
              <p className="small muted">
                Auto follows your device. Light and dark override it until you change it back.
              </p>
              <ThemeToggle current={theme} />
            </div>
          </div>

          <div className="panel">
            <div className="panel-head">
              <strong>Delete your data</strong>
            </div>
            <div className="panel-body">
              <DeleteAccount />
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
