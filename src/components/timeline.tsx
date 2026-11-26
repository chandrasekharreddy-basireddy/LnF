import type { ClaimStatus } from '@/lib/types';
import { STATUS_LABEL } from '@/lib/copy';
import { formatDateTime } from '@/lib/validation';

const ORDER: ClaimStatus[] = ['submitted', 'under_review', 'approved'];

export function Timeline({ events }: { events: { status: ClaimStatus; note: string | null; at: string }[] }) {
  const reached = new Set(events.map((e) => e.status));
  const rejected = reached.has('rejected');

  const steps = ORDER.map((status, index) => {
    const event = events.find((e) => e.status === status);
    const done = Boolean(event);
    const current = !done && index > 0 && Boolean(events.find((e) => e.status === ORDER[index - 1]));
    return { status, event, done, current };
  });

  return (
    <ol className="timeline">
      {steps.map((step) => (
        <li key={step.status} className={step.done ? 'done' : step.current ? 'current' : ''}>
          <span className="node" aria-hidden="true">
            {step.done ? '✓' : ''}
          </span>
          <div className="t-body">
            <strong>{STATUS_LABEL[step.status] ?? step.status}</strong>
            <span>
              {step.event ? formatDateTime(step.event.at) : step.current ? 'Waiting on the desk' : 'Not yet'}
              {step.event?.note ? ` — ${step.event.note}` : ''}
            </span>
          </div>
        </li>
      ))}
      {rejected ? (
        <li className="done">
          <span className="node" aria-hidden="true">
            ✕
          </span>
          <div className="t-body">
            <strong>Not approved</strong>
            <span>
              {formatDateTime(events.find((e) => e.status === 'rejected')?.at)}
              {events.find((e) => e.status === 'rejected')?.note
                ? ` — ${events.find((e) => e.status === 'rejected')?.note}`
                : ''}
            </span>
          </div>
        </li>
      ) : null}
    </ol>
  );
}
