import { describe, expect, it } from 'vitest';
import {
  buildWhatsAppLink,
  claimEnquiryMessage,
  itemEnquiryMessage,
  normaliseDeskNumber,
  shorten,
} from '../../src/lib/whatsapp';
import {
  decodeBase64Url,
  isGoneStatus,
  normaliseSubscription,
  pushPayload,
  safeLink,
  subscriptionForRpc,
  summariseDelivery,
  vapidConfig,
} from '../../src/lib/push';

// A real-shaped VAPID pair: base64url of 65 and 32 bytes.
const PUB = Buffer.alloc(65, 7).toString('base64url');
const PRIV = Buffer.alloc(32, 9).toString('base64url');

describe('normaliseDeskNumber', () => {
  it('keeps a clean international number', () => {
    expect(normaliseDeskNumber('919876543210')).toBe('919876543210');
  });

  it('strips +, spaces, dashes, dots and brackets', () => {
    expect(normaliseDeskNumber('+91 98765-43210')).toBe('919876543210');
    expect(normaliseDeskNumber('(+91) 98765.43210')).toBe('919876543210');
    expect(normaliseDeskNumber('0091 98765 43210')).toBe('919876543210');
  });

  it('refuses a number that cannot be international', () => {
    expect(normaliseDeskNumber('98765 43210')).toBeNull(); // 10 digits, ambiguous
    expect(normaliseDeskNumber('09876543210')).toBeNull(); // leading zero
    expect(normaliseDeskNumber('+91 9876')).toBeNull(); // too short
    expect(normaliseDeskNumber('+91 98765 43210 1111')).toBeNull(); // too long
    expect(normaliseDeskNumber('call the desk')).toBeNull();
    expect(normaliseDeskNumber('')).toBeNull();
    expect(normaliseDeskNumber(null)).toBeNull();
    expect(normaliseDeskNumber(undefined)).toBeNull();
  });
});

describe('buildWhatsAppLink', () => {
  it('builds a wa.me link with an encoded message', () => {
    const href = buildWhatsAppLink('+91 98765 43210', 'Hi desk, about LF-2026-0007');
    expect(href).toBe(`https://wa.me/919876543210?text=${encodeURIComponent('Hi desk, about LF-2026-0007')}`);
  });

  it('encodes characters that would otherwise break the query', () => {
    const href = buildWhatsAppLink('919876543210', 'a&b=c?d#e');
    expect(href).toContain('%26');
    expect(href).toContain('%3F');
    expect(href).not.toContain('#');
  });

  it('returns null when the desk has no number', () => {
    expect(buildWhatsAppLink('', 'hello')).toBeNull();
    expect(buildWhatsAppLink(null, 'hello')).toBeNull();
  });

  it('returns null for an empty message rather than a link that says nothing', () => {
    expect(buildWhatsAppLink('919876543210', '   ')).toBeNull();
  });

  it('caps the message so wa.me does not silently truncate it', () => {
    const href = buildWhatsAppLink('919876543210', 'x'.repeat(2000));
    const text = decodeURIComponent(new URL(href as string).searchParams.get('text') ?? '');
    expect(text.length).toBe(900);
  });
});

describe('enquiry messages', () => {
  it('names the item by reference and public title', () => {
    const message = itemEnquiryMessage({
      ref: 'LF-2026-0007',
      title: 'Black wireless earbuds',
      siteUrl: 'https://lnf.example.com/',
      deskLabel: 'Main Gate & Security Desk',
    });
    expect(message).toContain('LF-2026-0007');
    expect(message).toContain('Black wireless earbuds');
    expect(message).toContain('https://lnf.example.com/items/LF-2026-0007');
    expect(message.startsWith('Hi Main Gate & Security Desk,')).toBe(true);
  });

  it('shortens a long title instead of pasting it whole', () => {
    const message = itemEnquiryMessage({
      ref: 'LF-2026-0007',
      title: 'a'.repeat(300),
      siteUrl: 'https://lnf.example.com',
    });
    expect(message.length).toBeLessThan(300);
    expect(message).toContain('…');
  });

  it('names the claim and the item, and nothing about the answer given', () => {
    const message = claimEnquiryMessage({
      claimRef: 'CLM-2026-0012',
      itemRef: 'LF-2026-0007',
      status: 'under_review',
      siteUrl: 'https://lnf.example.com',
    });
    expect(message).toContain('CLM-2026-0012');
    expect(message).toContain('LF-2026-0007');
    expect(message).toContain('under_review');
    expect(message).toContain('https://lnf.example.com/claims/CLM-2026-0012');
  });

  it('never carries a phone number of its own', () => {
    const message = itemEnquiryMessage({ ref: 'LF-2026-0007', title: 'Keys', siteUrl: 'https://x.test' });
    expect(message).not.toMatch(/\d{10}/);
  });
});

describe('shorten', () => {
  it('leaves a short string alone and collapses whitespace', () => {
    expect(shorten('  a   b  ', 20)).toBe('a b');
  });

  it('trims to the limit with an ellipsis', () => {
    const out = shorten('abcdefghij', 5);
    expect(out).toBe('abcd…');
    expect(out.length).toBe(5);
  });
});

describe('decodeBase64Url', () => {
  it('decodes base64url into the same bytes', () => {
    const bytes = decodeBase64Url('AQID');
    expect(bytes ? Array.from(bytes) : null).toEqual([1, 2, 3]);
  });

  it('accepts - and _', () => {
    const encoded = Buffer.from([251, 255]).toString('base64url');
    const bytes = decodeBase64Url(encoded);
    expect(bytes ? Array.from(bytes) : null).toEqual([251, 255]);
  });

  it('refuses anything that is not base64url', () => {
    expect(decodeBase64Url('not base64!')).toBeNull();
    expect(decodeBase64Url('')).toBeNull();
  });
});

describe('normaliseSubscription', () => {
  const good = {
    endpoint: 'https://fcm.googleapis.com/fcm/send/abc123:APA91b-fake-endpoint-value',
    keys: { p256dh: 'BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM', auth: 'tBHItJI5svbpez7KI4CCXg' },
  };

  it('accepts a real-shaped subscription', () => {
    const result = normaliseSubscription(good);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.endpoint).toBe(good.endpoint);
      expect(result.value.p256dh).toBe(good.keys.p256dh);
    }
  });

  it('refuses a non-https endpoint', () => {
    const result = normaliseSubscription({ ...good, endpoint: 'http://fcm.googleapis.com/fcm/send/abc123' });
    expect(result).toEqual({ ok: false, error: 'BAD_ENDPOINT' });
  });

  it('refuses an endpoint with whitespace in it', () => {
    const result = normaliseSubscription({ ...good, endpoint: `${good.endpoint} and then some` });
    expect(result).toEqual({ ok: false, error: 'BAD_ENDPOINT' });
  });

  it('refuses missing or short keys', () => {
    expect(normaliseSubscription({ endpoint: good.endpoint })).toEqual({ ok: false, error: 'BAD_SUBSCRIPTION' });
    expect(normaliseSubscription({ ...good, keys: { p256dh: 'short', auth: good.keys.auth } })).toEqual({
      ok: false,
      error: 'BAD_KEY',
    });
    expect(normaliseSubscription({ ...good, keys: { p256dh: good.keys.p256dh, auth: '' } })).toEqual({
      ok: false,
      error: 'BAD_KEY',
    });
  });

  it('refuses a key that is not base64url', () => {
    const result = normaliseSubscription({ ...good, keys: { ...good.keys, auth: 'not a key!!' } });
    expect(result).toEqual({ ok: false, error: 'BAD_KEY' });
  });

  it('refuses things that are not objects', () => {
    expect(normaliseSubscription(null)).toEqual({ ok: false, error: 'BAD_SUBSCRIPTION' });
    expect(normaliseSubscription('https://example.com')).toEqual({ ok: false, error: 'BAD_SUBSCRIPTION' });
    expect(normaliseSubscription([])).toEqual({ ok: false, error: 'BAD_SUBSCRIPTION' });
  });

  it('hands the database exactly the four arguments it takes, and truncates the UA', () => {
    const parsed = normaliseSubscription(good);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const rpc = subscriptionForRpc(parsed.value, 'x'.repeat(400));
    expect(Object.keys(rpc).sort()).toEqual(['p_auth', 'p_endpoint', 'p_p256dh', 'p_user_agent']);
    expect(rpc.p_user_agent?.length).toBe(300);
    expect(subscriptionForRpc(parsed.value, null).p_user_agent).toBeNull();
  });
});

describe('pushPayload', () => {
  const base = { id: 'n1', kind: 'claim_update', title: 'Your claim was approved', body: 'Collect it at the desk.', link: '/claims/CLM-2026-0001' };

  it('keeps a same-site link', () => {
    expect(pushPayload(base).url).toBe('/claims/CLM-2026-0001');
  });

  it('falls back to the board for an absolute or protocol-relative link', () => {
    expect(pushPayload({ ...base, link: 'https://evil.example.com/x' }).url).toBe('/');
    expect(pushPayload({ ...base, link: '//evil.example.com' }).url).toBe('/');
    expect(pushPayload({ ...base, link: null }).url).toBe('/');
  });

  it('gives a stable tag so a repeat replaces the notification', () => {
    expect(pushPayload(base).tag).toBe('claim_update:n1');
  });

  it('trims title and body, and never returns an empty one', () => {
    const payload = pushPayload({ ...base, title: '  ', body: ' '.repeat(500) });
    expect(payload.title).toBe('L&F');
    expect(payload.body.length).toBeGreaterThan(0);
    expect(pushPayload({ ...base, title: 't'.repeat(300) }).title.length).toBe(80);
    expect(pushPayload({ ...base, body: 'b'.repeat(300) }).body.length).toBe(200);
  });

  it('strips newlines that would break a lock-screen line', () => {
    expect(pushPayload({ ...base, title: 'a\nb', body: 'c\r\nd' })).toMatchObject({ title: 'a b', body: 'c d' });
  });
});

describe('safeLink', () => {
  it('accepts a path and refuses everything else', () => {
    expect(safeLink('/items/LF-2026-0007')).toBe('/items/LF-2026-0007');
    expect(safeLink('javascript:alert(1)')).toBe('/');
    expect(safeLink('/a\nb')).toBe('/');
    expect(safeLink(undefined)).toBe('/');
  });
});

describe('vapidConfig', () => {
  it('accepts a correctly shaped pair', () => {
    const result = vapidConfig({ publicKey: PUB, privateKey: PRIV, subject: 'mailto:help@example.com' });
    expect(result.ok).toBe(true);
  });

  it('names what is missing', () => {
    expect(vapidConfig({ privateKey: PRIV, subject: 'mailto:a@b.c' })).toEqual({ ok: false, reason: 'VAPID_KEYS_NOT_SET' });
    expect(vapidConfig({ publicKey: PUB, privateKey: PRIV })).toEqual({ ok: false, reason: 'VAPID_SUBJECT_NOT_SET' });
  });

  it('refuses a subject that is not a contact URL', () => {
    expect(vapidConfig({ publicKey: PUB, privateKey: PRIV, subject: 'help@example.com' })).toEqual({
      ok: false,
      reason: 'VAPID_SUBJECT_INVALID',
    });
  });

  it('refuses a key of the wrong length', () => {
    const shortPub = Buffer.alloc(32, 1).toString('base64url');
    expect(vapidConfig({ publicKey: shortPub, privateKey: PRIV, subject: 'mailto:a@b.c' })).toEqual({
      ok: false,
      reason: 'VAPID_PUBLIC_KEY_INVALID',
    });
    expect(vapidConfig({ publicKey: PUB, privateKey: PUB, subject: 'mailto:a@b.c' })).toEqual({
      ok: false,
      reason: 'VAPID_PRIVATE_KEY_INVALID',
    });
  });
});

describe('delivery bookkeeping', () => {
  it('treats 404 and 410 as a dead subscription, and nothing else', () => {
    expect(isGoneStatus(404)).toBe(true);
    expect(isGoneStatus(410)).toBe(true);
    expect(isGoneStatus(429)).toBe(false);
    expect(isGoneStatus(undefined)).toBe(false);
  });

  it('calls a notification sent when at least one device took it', () => {
    expect(summariseDelivery([{ ok: false }, { ok: true }])).toBe('sent');
    expect(summariseDelivery([{ ok: false }, { ok: false }])).toBe('failed');
    expect(summariseDelivery([])).toBe('skipped');
  });
});
