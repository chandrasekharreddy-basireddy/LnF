import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { claimThread, currentUser } from '@/lib/data';
import { ChatThread } from '@/components/chat-thread';
import { StatusChip } from '@/components/status-chip';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Conversation', robots: { index: false, follow: false } };

export default async function ThreadPage({ params }: { params: Promise<{ ref: string }> }) {
  const { ref } = await params;
  const user = await currentUser();
  if (!user) redirect(`/sign-in?next=/messages/${ref}`);

  const thread = await claimThread(ref);
  if (!thread) notFound();

  return (
    <div className="section" style={{ marginTop: 8, maxWidth: 780 }}>
      <p className="eyebrow">
        <Link href="/messages">Messages</Link> · {thread.claimRef}
      </p>
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'start', gap: 12, marginBottom: 8 }}>
        <div>
          <h1 style={{ marginBottom: 4 }}>{thread.itemTitle || thread.itemRef}</h1>
          <p className="small muted" style={{ margin: 0 }}>
            {thread.counterparty}
          </p>
        </div>
        <StatusChip status={thread.claimStatus} />
      </div>

      <ChatThread
        claimRef={thread.claimRef}
        claimId={thread.claimId}
        initialMessages={thread.messages}
        locked={thread.locked}
        lockReason={thread.lockReason}
        backHref="/messages"
      />

      <p className="small muted" style={{ marginTop: 12 }}>
        Collection happens at the desk against an approved claim.{' '}
        <Link href={`/claims/${thread.claimRef}`}>Claim status and handover code</Link>
      </p>
    </div>
  );
}
