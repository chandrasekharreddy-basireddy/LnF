/**
 * Web push — the pure half.
 *
 * Nothing here touches the network or the `web-push` library, so it can be
 * imported by a client component (the browser needs `decodeBase64Url` for the
 * VAPID key) and tested in Node.
 *
 * The server half that actually encrypts and sends lives in `push-send.ts`,
 * because `web-push` must never be pulled into a client bundle.
 */

export type PushKeys = { p256dh: string; auth: string };

export type SubscriptionInput = {
  endpoint: string;
  keys: PushKeys;
};

export type NormalisedSubscription = {
  endpoint: string;
  p256dh: string;
  auth: string;
};

export type NormaliseResult =
  | { ok: true; value: NormalisedSubscription }
  | { ok: false; error: string };

const BASE64URL = /^[A-Za-z0-9_-]+={0,2}$/;

/**
 * Decodes base64url (the encoding a push service and VAPID both use).
 * Returns null on anything that is not clean base64url — the browser would
 * throw on a malformed `applicationServerKey`, and so should we.
 */
export function decodeBase64Url(value: string): Uint8Array | null {
  if (!value || !BASE64URL.test(value)) return null;
  const normalised = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalised.padEnd(Math.ceil(normalised.length / 4) * 4, '=');
  try {
    const binary = atob(padded);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return bytes;
  } catch {
    return null;
  }
}

function readString(source: Record<string, unknown>, key: string): string | null {
  const value = source[key];
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/**
 * Validates what the browser posts back from `pushManager.subscribe()`.
 * An endpoint is a bearer URL issued by the push service: https only, no
 * whitespace, a bounded length. The two keys are base64url of bounded length.
 */
export function normaliseSubscription(input: unknown): NormaliseResult {
  if (typeof input !== 'object' || input === null) {
    return { ok: false, error: 'BAD_SUBSCRIPTION' };
  }
  const raw = input as Record<string, unknown>;
  const endpoint = readString(raw, 'endpoint');
  const keysRaw = raw.keys;
  if (!endpoint || typeof keysRaw !== 'object' || keysRaw === null) {
    return { ok: false, error: 'BAD_SUBSCRIPTION' };
  }
  const keys = keysRaw as Record<string, unknown>;
  const p256dh = readString(keys, 'p256dh');
  const auth = readString(keys, 'auth');

  if (!endpoint.startsWith('https://') || /\s/.test(endpoint) || endpoint.length < 20 || endpoint.length > 2000) {
    return { ok: false, error: 'BAD_ENDPOINT' };
  }
  if (!p256dh || !BASE64URL.test(p256dh) || p256dh.length < 16 || p256dh.length > 200) {
    return { ok: false, error: 'BAD_KEY' };
  }
  if (!auth || !BASE64URL.test(auth) || auth.length < 8 || auth.length > 100) {
    return { ok: false, error: 'BAD_KEY' };
  }

  return {
    ok: true,
    value: { endpoint, p256dh, auth },
  };
}

/** The subscription as the database wants it, with the UA folded in. */
export function subscriptionForRpc(
  subscription: NormalisedSubscription,
  userAgent?: string | null,
): { p_endpoint: string; p_p256dh: string; p_auth: string; p_user_agent: string | null } {
  return {
    p_endpoint: subscription.endpoint,
    p_p256dh: subscription.p256dh,
    p_auth: subscription.auth,
    p_user_agent: userAgent ? userAgent.slice(0, 300) : null,
  };
}

export type NotificationForPush = {
  id: string;
  kind: string;
  title: string;
  body: string;
  link: string | null;
};

export type PushPayload = {
  title: string;
  body: string;
  url: string;
  tag: string;
  kind: string;
};

/**
 * A notification is a page-shaped thing; a push is a line on a lock screen.
 * This trims both fields, drops any link that is not a path on this site (an
 * absolute URL in a notification is an open redirect with extra steps), and
 * gives each notification a stable tag so a repeat replaces rather than stacks.
 */
export function pushPayload(notification: NotificationForPush): PushPayload {
  const title = notification.title.replace(/\s+/g, ' ').trim().slice(0, 80) || 'L&F';
  const body = notification.body.replace(/\s+/g, ' ').trim().slice(0, 200) || 'Open the board for details.';
  return {
    title,
    body,
    url: safeLink(notification.link),
    tag: `${notification.kind}:${notification.id}`.slice(0, 120),
    kind: notification.kind,
  };
}

/** Only a same-site path is allowed; anything else falls back to the board. */
export function safeLink(link: string | null | undefined): string {
  if (!link) return '/';
  const trimmed = link.trim();
  if (!trimmed.startsWith('/') || trimmed.startsWith('//')) return '/';
  if (/[\r\n]/.test(trimmed)) return '/';
  return trimmed.slice(0, 300);
}

export type VapidInput = {
  publicKey?: string;
  privateKey?: string;
  subject?: string;
};

export type VapidConfig =
  | { ok: true; publicKey: string; privateKey: string; subject: string }
  | { ok: false; reason: string };

/**
 * VAPID keys are the identity the push service verifies. A public key is an
 * uncompressed P-256 point (65 bytes); the private key is a scalar (32 bytes).
 * A half-configured deployment is refused rather than half-working: the reason
 * is returned so the cron can say why nothing was sent.
 */
export function vapidConfig(input: VapidInput): VapidConfig {
  const publicKey = (input.publicKey ?? '').trim();
  const privateKey = (input.privateKey ?? '').trim();
  const subject = (input.subject ?? '').trim();

  if (!publicKey || !privateKey) return { ok: false, reason: 'VAPID_KEYS_NOT_SET' };
  if (!subject) return { ok: false, reason: 'VAPID_SUBJECT_NOT_SET' };
  if (!/^(mailto:|https:\/\/)/.test(subject)) return { ok: false, reason: 'VAPID_SUBJECT_INVALID' };

  const pub = decodeBase64Url(publicKey);
  const priv = decodeBase64Url(privateKey);
  if (!pub || pub.length !== 65) return { ok: false, reason: 'VAPID_PUBLIC_KEY_INVALID' };
  if (!priv || priv.length !== 32) return { ok: false, reason: 'VAPID_PRIVATE_KEY_INVALID' };

  return { ok: true, publicKey, privateKey, subject };
}

/** A push service says 404 or 410 when the subscription is dead for good. */
export function isGoneStatus(status: number | undefined): boolean {
  return status === 404 || status === 410;
}

/** The delivery state a notification should end in, given per-device results. */
export function summariseDelivery(results: { ok: boolean; gone?: boolean }[]): 'sent' | 'failed' | 'skipped' {
  if (results.length === 0) return 'skipped';
  return results.some((r) => r.ok) ? 'sent' : 'failed';
}
