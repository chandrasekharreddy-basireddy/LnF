'use client';

import { useActionState, useCallback, useEffect, useRef, useState } from 'react';
import { fetchThread, markThreadRead, type ThreadSnapshot } from '@/lib/actions/messages';
import { postMessage, type MessageState } from '@/lib/actions/messages';
import { supabaseBrowser } from '@/lib/supabase-browser';
import { SubmitButton } from './submit-button';
import { Banner } from './banner';

type Msg = ThreadSnapshot['messages'][number];

const initial: MessageState = { ok: false };

function when(iso: string): string {
  const date = new Date(iso);
  const now = new Date();
  const sameDay = date.toDateString() === now.toDateString();
  return sameDay
    ? date.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })
    : date.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }) +
        ' ' +
        date.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
}

/**
 * Live when Realtime can authenticate, polled when it cannot. The composer goes
 * through the server action either way, so moderation is identical to the rest
 * of the product.
 */
export function ChatThread({
  claimRef,
  claimId,
  initialMessages,
  locked,
  lockReason,
  backHref,
}: {
  claimRef: string;
  claimId: string;
  initialMessages: Msg[];
  locked: boolean;
  lockReason: string | null;
  backHref?: string;
}) {
  const [messages, setMessages] = useState<Msg[]>(initialMessages);
  const [state, action] = useActionState(postMessage, initial);
  const [live, setLive] = useState<'connecting' | 'live' | 'polling'>('connecting');
  // the interval reads the current mode without re-subscribing to it: putting
  // `live` in the dependency list tore the channel down and rebuilt it once per
  // connection, which is what the audit caught
  const liveRef = useRef(live);
  useEffect(() => {
    liveRef.current = live;
  }, [live]);
  const bottom = useRef<HTMLDivElement | null>(null);
  const lastCount = useRef(initialMessages.length);

  const merge = useCallback((incoming: Msg[]) => {
    setMessages((current) => {
      const seen = new Set(current.map((m) => m.id));
      const added = incoming.filter((m) => !seen.has(m.id));
      if (!added.length) return current;
      return [...current, ...added].sort((a, b) => a.at.localeCompare(b.at));
    });
  }, []);

  // mark read on open, and whenever the tab regains focus
  useEffect(() => {
    void markThreadRead(claimRef);
    const onFocus = () => void markThreadRead(claimRef);
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [claimRef]);

  // realtime, with a polling fallback that also covers a dropped socket
  useEffect(() => {
    let cancelled = false;
    let channel: ReturnType<ReturnType<typeof supabaseBrowser>['channel']> | null = null;

    try {
      const supabase = supabaseBrowser();
      channel = supabase
        .channel(`claim:${claimId}`)
        .on(
          'postgres_changes',
          { event: 'INSERT', schema: 'public', table: 'claim_messages', filter: `claim_id=eq.${claimId}` },
          () => {
            void fetchThread(claimRef).then((snapshot) => {
              if (!cancelled && snapshot.ok) merge(snapshot.messages);
            });
          },
        )
        .subscribe((status: string) => {
          if (cancelled) return;
          if (status === 'SUBSCRIBED') setLive('live');
        });
    } catch {
      // the settle timer below marks this as polling
    }

    // A live socket already pushes; a closed thread will never change; and a
    // background tab does not need a request every five seconds.
    const timer = locked
      ? null
      : window.setInterval(() => {
      if (document.hidden || liveRef.current === 'live') return;
      void fetchThread(claimRef).then((snapshot) => {
        if (cancelled || !snapshot.ok) return;
        merge(snapshot.messages);
      });
    }, 5000);

    const settle = window.setTimeout(() => {
      if (!cancelled) setLive((current) => (current === 'live' ? 'live' : 'polling'));
    }, 4000);

    return () => {
      cancelled = true;
      if (timer) window.clearInterval(timer);
      window.clearTimeout(settle);
      if (channel) void supabaseBrowser().removeChannel(channel);
    };
  }, [claimId, claimRef, merge, locked]);

  // pull once after a successful send, so the sender sees their own message
  const sentAt = state.ok ? state.sentAt : undefined;
  useEffect(() => {
    if (!sentAt) return;
    void fetchThread(claimRef).then((snapshot) => {
      if (snapshot.ok) merge(snapshot.messages);
    });
  }, [sentAt, claimRef, merge]);

  useEffect(() => {
    if (messages.length !== lastCount.current) {
      lastCount.current = messages.length;
      bottom.current?.scrollIntoView({ block: 'end', behavior: 'smooth' });
    }
  }, [messages.length]);

  return (
    <div className="chat">
      <div className="chat-head">
        <div>
          <strong>{claimRef}</strong>
          <p className="small muted" style={{ margin: 0 }}>
            {live === 'live' ? 'Live' : live === 'polling' ? 'Updating every few seconds' : 'Connecting…'}
          </p>
        </div>
        {backHref ? (
          <a className="small" href={backHref}>
            Back
          </a>
        ) : null}
      </div>

      <ol className="chat-log" aria-live="polite" aria-label="Conversation">
        {messages.length === 0 ? (
          <li className="chat-empty">
            <p className="small muted">
              Nothing here yet. Say hello — the desk relays between you and the finder, so neither of you sees an
              address.
            </p>
          </li>
        ) : (
          messages.map((message) => (
            <li key={message.id} className={`bubble ${message.mine ? 'bubble-mine' : 'bubble-theirs'}`}>
              <div className="bubble-meta">
                <span>{message.mine ? 'You' : message.role === 'staff' ? 'Desk' : message.role === 'finder' ? 'Finder' : 'Claimant'}</span>
                <time dateTime={message.at}>{when(message.at)}</time>
              </div>
              <p className="bubble-body">{message.body}</p>
            </li>
          ))
        )}
      </ol>
      <div ref={bottom} />

      {locked ? (
        <Banner tone="info">{lockReason ?? 'This thread is read-only.'}</Banner>
      ) : (
        <form className="chat-compose" action={action}>
          <input type="hidden" name="claim_ref" value={claimRef} />
          <input type="hidden" name="back_to" value={backHref ?? ''} />
          {state.error ? <Banner tone="danger">{state.error}</Banner> : null}
          <div className="row" style={{ gap: 8, alignItems: 'flex-end' }}>
            <label htmlFor="chat-body" className="sr-only">
              Message
            </label>
            <textarea
              id="chat-body"
              name="body"
              rows={2}
              maxLength={2000}
              required
              placeholder="Write a message…"
              style={{ flex: 1, resize: 'vertical' }}
            />
            <SubmitButton className="btn" pendingLabel="Sending…">
              Send
            </SubmitButton>
          </div>
          <p className="hint">
            Never share a phone number, an address or payment details. Anything that asks for money is blocked and
            reported to the desk.
          </p>
        </form>
      )}
    </div>
  );
}
