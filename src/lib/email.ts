import { env } from './env';

/** Everything interpolated into an email body goes through here. */
const esc = (value: unknown): string =>
  String(value ?? '').replace(/[&<>"']/g, (ch) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch] as string,
  );

type Mail = { to: string; subject: string; html: string; text: string; tag?: string };

const wrap = (title: string, body: string, cta?: { label: string; href: string }) => `<!doctype html>
<html><body style="margin:0;padding:24px;background:#f4f4f1;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#15211f">
  <table role="presentation" width="100%" style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:12px;padding:28px">
    <tr><td>
      <p style="margin:0 0 4px;font-size:13px;letter-spacing:.08em;text-transform:uppercase;color:#5b6b66">L&amp;F · ${esc(env.campusName)}</p>
      <h1 style="margin:0 0 16px;font-size:21px;line-height:1.3">${esc(title)}</h1>
      <div style="font-size:15px;line-height:1.6;color:#243430">${body}</div>
      ${cta ? `<p style="margin:24px 0 8px"><a href="${cta.href}" style="background:#14524b;color:#fff;text-decoration:none;padding:12px 18px;border-radius:8px;display:inline-block;font-weight:600">${esc(cta.label)}</a></p>` : ''}
      <hr style="border:none;border-top:1px solid #e6e6e1;margin:24px 0">
      <p style="margin:0;font-size:12px;color:#5b6b66;line-height:1.6">
        Never pay to get an item back. Collect from ${esc(env.deskLabel)}.<br>
        This is a service message about your L&amp;F account.
      </p>
    </td></tr>
  </table>
</body></html>`;

export async function sendEmail(mail: Mail): Promise<{ ok: boolean; status: number | null }> {
  if (!env.brevoApiKey) {
    console.info('[email] BREVO_API_KEY not set — skipped:', mail.subject);
    return { ok: false, status: null };
  }
  try {
    const res = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
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

export const templates = {
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

  claimReceived: (claimRef: string, itemTitle: string) => ({
    subject: `Claim received: ${claimRef}`,
    html: wrap(
      'Your claim is with the desk',
      `<p>Claim <strong>${esc(claimRef)}</strong> for <strong>${esc(itemTitle)}</strong> was received.</p>
       <p>The desk reviews claims within two working days. You will get another email when there is a decision.</p>`,
      { label: 'Track this claim', href: `${env.siteUrl}/claims/${esc(claimRef)}` },
    ),
    text: `Claim ${claimRef} received for ${itemTitle}. Track it at ${env.siteUrl}/claims/${claimRef}`,
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
