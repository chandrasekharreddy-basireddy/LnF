/**
 * WhatsApp click-to-chat.
 *
 * The platform does not run WhatsApp Business and does not message anyone. It
 * builds a `wa.me` link that opens the person's own WhatsApp with a message
 * already typed, addressed to the desk. That is the whole feature: no phone
 * number is stored, nothing is sent on the platform's behalf, and the person
 * can read and edit every word before it leaves their phone.
 *
 * Everything here is pure so it can be tested without a browser.
 */

/**
 * A full international number, digits only, no leading zero.
 *
 * 11 is the floor on purpose: country code plus a national number is 11 digits
 * in the shortest common case (1 + 10), and a bare 10-digit Indian mobile
 * number is exactly the mistake that builds a link to the wrong country. 15 is
 * the E.164 ceiling.
 */
const INTERNATIONAL = /^[1-9]\d{10,14}$/;

/**
 * Turns "+91 98765 43210" or "(+91) 98765-43210" into "919876543210".
 * Returns null for anything that is not a plausible international number —
 * a link built from a broken number is worse than no link.
 */
export function normaliseDeskNumber(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const digits = raw
    .replace(/[\s()\-.]/g, '')
    .replace(/^\+/, '')
    .replace(/^00/, '');
  if (!INTERNATIONAL.test(digits)) return null;
  return digits;
}

export type WhatsAppLink = { href: string; label: string };

/**
 * Builds the link, or null when the deployment has no desk number configured.
 * The message is trimmed to 900 characters: wa.me silently truncates long
 * text, and a half-sentence is worse than a short one.
 */
export function buildWhatsAppLink(
  deskNumber: string | null | undefined,
  message: string,
): string | null {
  const digits = normaliseDeskNumber(deskNumber);
  const text = message.replace(/\s+/g, ' ').trim().slice(0, 900);
  if (!digits || text.length === 0) return null;
  return `https://wa.me/${digits}?text=${encodeURIComponent(text)}`;
}

/** Titles are public, but a 120-character title makes an unusable message. */
export function shorten(text: string, max = 70): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (clean.length <= max) return clean;
  return `${clean.slice(0, max - 1).trimEnd()}…`;
}

/**
 * The message a visitor sends about one listing. It carries the public
 * reference and the public title only — never the verification answer, the
 * finder's contact, or anything the listing page does not already show.
 */
export function itemEnquiryMessage(input: {
  ref: string;
  title: string;
  siteUrl: string;
  deskLabel?: string;
}): string {
  const base = input.siteUrl.replace(/\/$/, '');
  const who = input.deskLabel ? `Hi ${input.deskLabel}, ` : 'Hi, ';
  return `${who}I am asking about ${input.ref} (${shorten(input.title)}) on the L&F board. ${base}/items/${input.ref}`;
}

/**
 * The message a claimant sends about their own claim. It carries the claim
 * reference and the item reference — both of which the claimant already
 * sees — and nothing about the answer they gave.
 */
export function claimEnquiryMessage(input: {
  claimRef: string;
  itemRef: string;
  status: string;
  siteUrl: string;
  deskLabel?: string;
}): string {
  const base = input.siteUrl.replace(/\/$/, '');
  const who = input.deskLabel ? `Hi ${input.deskLabel}, ` : 'Hi, ';
  return `${who}my claim ${input.claimRef} (${input.status}) for item ${input.itemRef} on the L&F board. ${base}/claims/${input.claimRef}`;
}
