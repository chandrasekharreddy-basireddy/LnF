import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { currentUser, myConversations } from '@/lib/data';
import { EmptyState } from '@/components/empty-state';
import { StatusChip } from '@/components/status-chip';
import { formatDateTime } from '@/lib/validation';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Messages', robots: { index: false, follow: false } };

export default async function MessagesPage() {
  const user = await currentUser();
  if (!user) redirect('/sign-in?next=/messages');

  const threads = await myConversations();
  const totalUnread = threads.reduce((sum, t) => sum + Number(t.unread ?? 0), 0);

  return (
    <div className="section" style={{ marginTop: 8 }}>
      <p className="eyebrow">Messages</p>
      <h1>Threads</h1>
      <p className="lede" style={{ marginBottom: 20 }}>
        Every thread belongs to one claim. The desk sees both sides, and nobody sees an address.
        {totalUnread > 0 ? ` ${totalUnread} unread.` : ''}
      </p>

      {threads.length === 0 ? (
        <EmptyState
          title="No conversations yet"
          body="A thread opens when a claim is filed, or when the desk writes to you about a listing. There is nothing to catch up on."
          action={{ href: '/browse', label: 'Browse the board' }}
        />
      ) : (
        <ul className="thread-list">
          {threads.map((thread) => (
            <li key={thread.claimRef}>
              <Link className="thread-row" href={`/messages/${thread.claimRef}`}>
                <div className="thread-main">
                  <div className="row" style={{ gap: 8, marginBottom: 4 }}>
                    <strong>{thread.itemTitle || thread.itemRef}</strong>
                    {Number(thread.unread) > 0 ? <span className="chip chip-ok">{thread.unread} new</span> : null}
                    {thread.locked ? <span className="chip chip-quiet">closed</span> : null}
                  </div>
                  <p className="small muted" style={{ margin: 0 }}>
                    {thread.lastMessage ?? 'No messages yet — the desk will open the thread.'}
                  </p>
                  <p className="item-ref" style={{ marginTop: 4 }}>
                    {thread.claimRef} · {thread.myRole === 'staff' ? 'desk view' : thread.myRole}
                  </p>
                </div>
                <div className="thread-side">
                  <StatusChip status={thread.claimStatus} />
                  <span className="small muted">{formatDateTime(thread.lastAt)}</span>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
