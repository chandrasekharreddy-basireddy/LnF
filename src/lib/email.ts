import { env } from './env';
import { supabaseServer } from './supabase-server';

/** Everything interpolated into an email body goes through here. */
const esc = (value: unknown): string =>
  String(value ?? '').replace(/[&<>"']/g, (ch) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch] as string,
  );

type Mail = { to: string; subject: string; html: string; text: string; tag?: string };

const wrap = (
  title: string,
  body: string,
  cta?: { label: string; href: string },
  options: { preheader?: string; footerNote?: string } = {},
) => `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${esc(title)}</title>
</head>
<body style="margin:0;padding:0;background:#f4f4f1;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#15211f">
  ${options.preheader ? `<div style="display:none;max-height:0;overflow:hidden;opacity:0">${esc(options.preheader)}</div>` : ''}
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f1;padding:28px 12px">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px">
        <tr><td style="padding:0 4px 14px">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
            <td style="font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:13px;font-weight:700;letter-spacing:-0.02em;color:#14524b">
              L&amp;F
            </td>
            <td align="right" style="font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:#6b7a75">
              ${esc(env.campusName)}
            </td>
          </tr></table>
        </td></tr>

        <tr><td style="background:#ffffff;border:1px solid #e2e4df;border-radius:14px;padding:28px">
          <h1 style="margin:0 0 14px;font-size:21px;line-height:1.28;letter-spacing:-0.01em;color:#12211e">${esc(title)}</h1>
          <div style="font-size:15px;line-height:1.62;color:#243430">${body}</div>
          ${cta ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:24px 0 6px"><tr>
              <td style="background:#14524b;border-radius:9px">
                <a href="${esc(cta.href)}" style="display:inline-block;padding:13px 20px;font-size:15px;font-weight:600;color:#ffffff;text-decoration:none">${esc(cta.label)}</a>
              </td></tr></table>` : ''}
        </td></tr>

        <tr><td style="padding:18px 6px 0;font-size:12px;line-height:1.6;color:#5b6b66">
          <strong style="color:#243430">Never pay to get an item back.</strong>
          Handovers happen at ${esc(env.deskLabel)}, against an approved claim.
          ${options.footerNote ? `<br><br>${options.footerNote}` : ''}
          <br><br>
          <span style="color:#8a938f">L&amp;F · ${esc(env.campusName)} · ${esc(env.supportEmail)}</span>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

export async function sendEmail(mail: Mail): Promise<{ ok: boolean; status: number | null }> {
  if (!env.brevoApiKey) {
    // the subject of a sign-in mail contains the code; the tag never does
    console.info('[email] BREVO_API_KEY not set — skipped:', mail.tag ?? 'untagged');
    return { ok: false, status: null };
  }
  try {
    const res = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      signal: AbortSignal.timeout(8000),
      headers: {
        'api-key': env.brevoApiKey,
        'content-type': 'application/json',
        accept: 'application/json',
      },
      body: JSON.stringify({
        sender: { email: env.brevoSenderEmail, name: env.brevoSenderName },
        to: [{ email: mail.to }],
        subject: mail.subject,
        htmlContent: mail.html,
        textContent: mail.text,
        tags: mail.tag ? [mail.tag] : undefined,
      }),
      cache: 'no-store',
    });
    return { ok: res.ok, status: res.status };
  } catch {
    return { ok: false, status: null };
  }
}

const codeBlock = (code: string) => `
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:18px 0 8px">
    <tr><td align="center" style="background:#e9f2ef;border:1px dashed #14524b;border-radius:12px;padding:18px">
      <span style="font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:34px;font-weight:700;letter-spacing:.34em;color:#0d3b36">${esc(code)}</span>
    </td></tr>
  </table>
  <p style="margin:0;font-size:12px;color:#5b6b66;text-align:center">Expires in 10 minutes · single use · never share it</p>`;

export const templates = {
  signInCode: (code: string, email: string, kind: 'signin' | 'signup' = 'signin') => ({
    subject:
      kind === 'signup'
        ? `${code} is your L&F sign-in code`
        : `${code} is your L&F sign-in code`,
    html: wrap(
      kind === 'signup' ? 'Welcome — here is your code' : 'Your sign-in code',
      `<p>Enter this code on the sign-in screen. It works once, for ten minutes.</p>
       ${codeBlock(code)}
       <p style="margin-top:14px;font-size:13px;color:#5b6b66">
         If you did not ask to sign in, ignore this email. Nobody can use the code without seeing it here.
       </p>`,
      { label: 'Or open L&F', href: `${env.siteUrl}/sign-in` },
      {
        preheader: `Your L&F code is ${code}`,
        footerNote: `Sent because someone entered <strong>${esc(email)}</strong> on the sign-in screen.`,
      },
    ),
    text: `Your L&F sign-in code is ${code}. It expires in 10 minutes and works once. ${env.siteUrl}/sign-in`,
    tag: 'sign-in-code',
  }),

  welcome: (name: string | null) => ({
    subject: 'You are in — how L&F works',
    html: wrap(
      name ? `Hello, ${name}` : 'You are in',
      `<p>Three things worth knowing before you use the board:</p>
       <ul style="padding-left:18px;margin:0 0 12px">
         <li style="margin-bottom:6px"><strong>Report it once.</strong> A lost report is a standing question — we email you when something similar is handed in.</li>
         <li style="margin-bottom:6px"><strong>Prove it, do not describe it.</strong> Claims are checked against the question the finder wrote, not against how well you describe the item.</li>
         <li><strong>Collect at the desk.</strong> One code, one handover, photo ID if the item is valuable. Nothing to pay, ever.</li>
       </ul>`,
      { label: 'Open the board', href: `${env.siteUrl}/browse` },
      { footerNote: 'You can turn match alerts off from your account page at any time.' },
    ),
    text: 'You are in. Report once, prove it, collect at the desk. Browse: ' + env.siteUrl + '/browse',
    tag: 'welcome',
  }),

  erasureConfirmed: (email: string) => ({
    subject: 'Your L&F account and records have been erased',
    html: wrap(
      'Erasure complete',
      `<p>Your L&amp;F account (<strong>${esc(email)}</strong>), along with your listings, uploaded photos, saved items and claims, has been deleted.</p>
       <p>Records the desk must keep for its own custody and audit trail are retained without your name or contact details.</p>
       <p style="font-size:13px;color:#5b6b66">No further emails will be sent to this address unless you choose to sign in again.</p>`,
    ),
    text: `Your L&F account (${email}) and associated personal records have been permanently deleted. No further emails will be sent unless you sign in again.`,
    tag: 'erasure-confirmed',
  }),

  itemPublished: (ref: string, title: string, kind: 'lost' | 'found') => ({
    subject: kind === 'found' ? `Handed in: ${title} (${ref})` : `Lost report live: ${title} (${ref})`,
    html: wrap(
      kind === 'found' ? 'Thank you — it is logged and on the board' : 'Your lost report is live',
      kind === 'found'
        ? `<p>Reference <strong>${esc(ref)}</strong> for <strong>${esc(title)}</strong>.</p>
           <p>Hand it to ${esc(env.deskLabel)} if you have not already. We will email you when it goes home.</p>
           <p style="font-size:13px;color:#5b6b66">Location data and camera details were removed from your photo.</p>`
        : `<p>Reference <strong>${esc(ref)}</strong> for <strong>${esc(title)}</strong>.</p>
           <p>We will alert you when a finder logs something similar. You can check the board any time.</p>`,
      { label: 'View the listing', href: `${env.siteUrl}/items/${esc(ref)}` },
    ),
    text: `Reference ${ref} — ${title}. ${env.siteUrl}/items/${ref}`,
    tag: 'item-published',
  }),

  claimReceived: (claimRef: string, itemRef: string) => ({
    subject: `Claim received: ${claimRef}`,
    html: wrap(
      'Your claim is with the desk',
      `<p>Claim <strong>${esc(claimRef)}</strong> for item <strong>${esc(itemRef)}</strong> was received.</p>
       <p>The desk reviews claims within two working days. You will get another email when there is a decision.</p>`,
      { label: 'Track this claim', href: `${env.siteUrl}/claims/${esc(claimRef)}` },
    ),
    text: `Claim ${claimRef} received for item ${itemRef}. Track it at ${env.siteUrl}/claims/${claimRef}`,
    tag: 'claim-received',
  }),

  claimDecided: (claimRef: string, approved: boolean, reason: string | null) => ({
    subject: approved ? `Claim approved: ${claimRef}` : `Claim update: ${claimRef}`,
    html: wrap(
      approved ? 'Approved — collect at the desk' : 'The desk could not approve this claim',
      approved
        ? `<p>Claim <strong>${esc(claimRef)}</strong> is approved. Open your claim page to see your handover code.</p>
           <p><strong>Show the code at ${esc(env.deskLabel)}.</strong> Do not share it — it is the only thing standing between the item and the wrong person.</p>`
        : `<p>Claim <strong>${esc(claimRef)}</strong> was not approved.</p>
           <p>${esc(reason ?? 'The desk could not verify ownership from what was submitted.')}</p>
           <p>You can reply to the desk from your claim page with more proof.</p>`,
      { label: 'Open my claim', href: `${env.siteUrl}/claims/${esc(claimRef)}` },
    ),
    text: `Claim ${claimRef}: ${approved ? 'approved' : 'not approved'}. ${env.siteUrl}/claims/${claimRef}`,
    tag: 'claim-decided',
  }),

  finderThanks: (ref: string, title: string) => ({
    subject: `It went home: ${title}`,
    html: wrap(
      'Your find found its owner',
      `<p><strong>${esc(title)}</strong> (${esc(ref)}) was returned to its owner today.</p>
       <p>That is one fewer person replacing something they could not afford to lose. Thank you.</p>`,
      { label: 'See the board', href: `${env.siteUrl}/browse` },
    ),
    text: `${title} (${ref}) was returned. Thank you.`,
    tag: 'finder-thanks',
  }),

  matchAlert: (lostTitle: string, foundRef: string, foundTitle: string) => ({
    subject: `Possible match for "${lostTitle}"`,
    html: wrap(
      'Something similar was handed in',
      `<p>A finder logged <strong>${esc(foundTitle)}</strong> and it looks close to your report <strong>${esc(lostTitle)}</strong>.</p>
       <p>Check the listing. If it is yours, start a claim and answer the verification question.</p>`,
      { label: 'Check the listing', href: `${env.siteUrl}/items/${esc(foundRef)}` },
    ),
    text: `Possible match: ${foundTitle} (${foundRef}). ${env.siteUrl}/items/${foundRef}`,
    tag: 'match-alert',
  }),
};


/* ------------------------------------------------------------------ outbox */

export type OutboxEvent =
  | 'item_published'
  | 'claim_received'
  | 'claim_decided'
  | 'finder_thanks'
  | 'match_alert'
  | 'erasure_confirmed';

export type RenderedMail = { subject: string; html: string; text: string; tag?: string };

/** Rebuilds the exact email from the payload stored in the outbox. */
export function renderOutboxMail(eventType: string, payload: Record<string, unknown>): RenderedMail | null {
  const text = (key: string, fallback = '') => String(payload[key] ?? fallback);
  switch (eventType) {
    case 'erasure_confirmed':
      return templates.erasureConfirmed(text('email'));
    case 'item_published':
      return templates.itemPublished(text('ref'), text('title', 'Your item'), text('kind') === 'lost' ? 'lost' : 'found');
    case 'claim_received':
      return templates.claimReceived(text('claimRef'), text('itemTitle'));
    case 'claim_decided':
      return templates.claimDecided(text('claimRef'), payload.approved === true, text('reason') || null);
    case 'finder_thanks':
      return templates.finderThanks(text('ref'), text('title'));
    case 'match_alert':
      return templates.matchAlert(text('lostTitle'), text('foundRef'), text('foundTitle'));
    default:
      return null;
  }
}

/**
 * Send now; if the provider refuses (or no key is configured), park the message
 * in `email_outbox` so the daily cron retries it. Returns what happened so a
 * caller can surface it without failing the user's action.
 */
export async function sendOrQueue(opts: {
  to: string | null | undefined;
  mail: RenderedMail;
  eventType: OutboxEvent;
  payload: Record<string, unknown>;
  dedupeKey: string;
}): Promise<'sent' | 'queued' | 'skipped'> {
  if (!opts.to) return 'skipped';

  // Without a provider there is nothing to retry: queueing would fill the outbox
  // with rows the drain can never deliver.
  if (!env.brevoApiKey) return 'skipped';

  const result = await sendEmail({ to: opts.to, ...opts.mail });
  if (result.ok) return 'sent';

  try {
    const supabase = await supabaseServer();
    const { error } = await supabase.rpc('queue_email_retry', {
      p_dedupe_key: opts.dedupeKey,
      p_event_type: opts.eventType,
      p_payload: opts.payload,
      p_to: opts.to,
    });
    if (!error) return 'queued';
  } catch {
    // the user's action must not fail because a retry could not be recorded
  }
  return 'skipped';
}
