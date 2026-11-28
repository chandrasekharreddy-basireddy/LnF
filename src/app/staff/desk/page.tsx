import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { currentUser, deskSheet, isStaff } from '@/lib/data';
import { Banner } from '@/components/banner';
import { DeskSheetSave } from '@/components/desk-sheet';
import { toRow } from '@/lib/offline';
import { formatDateTime } from '@/lib/validation';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Desk sheet', robots: { index: false, follow: false } };

/**
 * The board, in a shape a browser can keep.
 *
 * The page asks one question of the database (`desk_sheet`, migration 0035) and
 * draws what comes back. It decides nothing: a caller who is not staff gets
 * NOT_STAFF from Postgres, which is a null here, and the page says so without
 * pretending the network failed.
 */
export default async function DeskSheetPage() {
  const user = await currentUser();
  if (!user) redirect('/sign-in?next=/staff/desk');
  if (!isStaff(user)) redirect('/');

  const payload = await deskSheet(300);
  const raw = Array.isArray(payload?.rows) ? payload.rows : [];
  const rows = raw
    .map((row) => toRow(row))
    .filter((row): row is NonNullable<typeof row> => row !== null);
  const generatedAt = typeof payload?.generatedAt === 'string' ? payload.generatedAt : null;

  return (
    <div className="section" style={{ marginTop: 8 }}>
      <Link className="small" href="/staff">
        ← Desk
      </Link>
      <div className="section-head" style={{ marginTop: 8 }}>
        <div>
          <p className="eyebrow">Offline</p>
          <h1 style={{ marginBottom: 4 }}>The desk sheet</h1>
          <p className="muted small">
            Every item on the board right now, as a list small enough to keep in this browser. Save it while the
            network is up; the counter can then answer &ldquo;is this here?&rdquo; when it drops. It is a copy, so it
            ages — the offline page says how old it is, and stops showing it after a day.
          </p>
        </div>
        {payload ? <span className="chip chip-quiet">{rows.length} on the board</span> : null}
      </div>

      {payload === null ? (
        <div className="card text-center" style={{ padding: 32 }}>
          <h3>We could not build the sheet</h3>
          <p className="muted small">
            The database refused the request, or it is unreachable. Nothing was changed. Reload in a moment; the desk
            queue on <Link href="/staff">the desk page</Link> is unaffected.
          </p>
        </div>
      ) : (
        <>
          <div style={{ margin: '18px 0' }}>
            <Banner tone="info" title="A saved sheet is public-equivalent, and it ages">
              It carries the reference, title, category, where it was found and when it came in — the same facts a
              visitor reads on the board. No reporter, no contact, no verification answer, no claim. If the desk needs
              any of that, it still needs the network.
            </Banner>
          </div>

          <DeskSheetSave rows={rows} generatedAt={generatedAt} />

          <section className="panel" style={{ marginTop: 24 }}>
            <div className="panel-head">
              <strong>On the board now</strong>
              {generatedAt ? (
                <span className="small muted">built {formatDateTime(generatedAt)}</span>
              ) : null}
            </div>
            <div className="panel-body">
              {rows.length === 0 ? (
                <p className="muted small">The board is empty, so there is nothing worth saving.</p>
              ) : (
                <div className="table-wrap">
                  <table className="data">
                    <thead>
                      <tr>
                        <th scope="col">Reference</th>
                        <th scope="col">Item</th>
                        <th scope="col">Category</th>
                        <th scope="col">Found at</th>
                        <th scope="col">Status</th>
                        <th scope="col">Held since</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((row) => (
                        <tr key={row.ref}>
                          <td>
                            <Link href={`/items/${row.ref}`}>{row.ref}</Link>
                          </td>
                          <td>{row.title}</td>
                          <td>{row.category}</td>
                          <td>{row.zone ?? row.spot ?? '—'}</td>
                          <td>{row.status === 'claimed' ? 'Claimed' : 'Available'}</td>
                          <td className="small muted">{row.heldSince ? formatDateTime(row.heldSince) : '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </section>
        </>
      )}
    </div>
  );
}
