import type { ClaimThread } from '@/lib/types';
import { THREAD_RULES } from '@/lib/antifraud';
import { formatDateTime } from '@/lib/validation';
import { Banner } from './banner';
import { MessageForm } from './message-form';

const LABEL: Record<string, string> = {
  claimant: 'Claimant',
  finder: 'Finder',
  staff: 'Campus desk staff',
};

export function ClaimThreadPanel({
  thread,
  claimRef,
  backTo,
}: {
  thread: ClaimThread | null;
  claimRef: string;
  backTo?: string;
}) {
  if (!thread) return null;

  return (
    <section className="panel">
      <div className="panel-head" style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
        <strong>Messages</strong>
        <span className="small muted">{thread.messages.length} in the thread</span>
      </div>
      <div className="panel-body stack">
        <div className="banner banner-safety">
          <div>
            <strong>Keep it on the board</strong>
            <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>
              {THREAD_RULES.map((rule) => (
                <li key={rule} className="small">
                  {rule}
                </li>
              ))}
            </ul>
          </div>
        </div>

        {thread.messages.length ? (
          <ol className="stack" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {thread.messages.map((message) => (
              <li
                key={message.id}
                className="card card-tight"
                style={{ borderColor: message.mine ? 'var(--brand)' : 'var(--line)' }}
              >
                <div className="row" style={{ justifyContent: 'space-between', gap: 8 }}>
                  <strong className="small">{LABEL[message.role] ?? 'Someone'}</strong>
                  <span className="small muted">{formatDateTime(message.at)}</span>
                </div>
                <p className="small" style={{ marginTop: 6, whiteSpace: 'pre-wrap' }}>
                  {message.body}
                </p>
                {message.quarantined ? (
                  <p className="small" style={{ color: 'var(--danger)' }}>
                    Held back from the other party{message.flaggedReason ? `: ${message.flaggedReason}` : ''}. The desk
                    can still see it.
                  </p>
                ) : null}
              </li>
            ))}
          </ol>
        ) : (
          <p className="small muted">
            Nothing here yet. Ask the desk a question, or add something that helps them check your claim.
          </p>
        )}

        {thread.locked ? (
          <Banner tone="warn" title="Thread closed">
            {thread.lockReason ?? 'This thread is read-only.'}
          </Banner>
        ) : (
          <MessageForm claimRef={claimRef} backTo={backTo} />
        )}
      </div>
    </section>
  );
}
