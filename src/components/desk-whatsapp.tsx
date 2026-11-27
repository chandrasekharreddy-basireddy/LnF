import { buildWhatsAppLink } from '@/lib/whatsapp';
import { env } from '@/lib/env';

/**
 * A panel that opens WhatsApp with a message already typed.
 *
 * Rendered only when the deployment has a desk number configured — a button
 * that goes nowhere is worse than no button. The message is built on the
 * server, so the number never reaches the client bundle, and the person can
 * read and edit every word before anything is sent.
 */
export function DeskWhatsApp({ message, label = 'Message the desk' }: { message: string; label?: string }) {
  const href = buildWhatsAppLink(env.deskWhatsApp, message);
  if (!href) return null;

  return (
    <div className="panel">
      <div className="panel-head">
        <strong>WhatsApp the desk</strong>
      </div>
      <div className="panel-body stack">
        <p className="small muted">
          Opens your own WhatsApp with a message ready to send. Nothing is sent until you press send, and the desk only
          sees what you write.
        </p>
        <a className="btn btn-secondary btn-block" href={href} target="_blank" rel="noopener noreferrer">
          {label}
        </a>
      </div>
    </div>
  );
}
