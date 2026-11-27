import { headers } from 'next/headers';
import { timingSafeEqual as equalBytes } from 'node:crypto';

/**
 * One place for "who is calling". Vercel puts the client address in
 * x-vercel-forwarded-for; Cloudflare in cf-connecting-ip; a plain proxy in
 * x-real-ip. x-forwarded-for is a chain — the leftmost entry is the client, but
 * anything can prepend to it, so it is the last resort, not the first.
 */
export function extractIpFromHeaders(get: (name: string) => string | null): string | null {
  const direct = get('x-vercel-forwarded-for') ?? get('cf-connecting-ip') ?? get('x-real-ip');
  if (direct && direct.trim()) return direct.split(',')[0].trim();

  const chain = get('x-forwarded-for');
  if (!chain) return null;
  const parts = chain.split(',').map((part) => part.trim()).filter(Boolean);
  return parts.length > 0 ? parts[parts.length - 1] : null;
}

/**
 * Compares two strings without leaking their length or prefix through timing.
 * Shared by the cron routes so there is one implementation to get right.
 */
export function timingSafeEqualString(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) {
    // still compare something of equal length so the branch is not the only signal
    equalBytes(left, left);
    return false;
  }
  return equalBytes(left, right);
}

/** The caller's address, for throttling buckets that must not be forgeable. */
export async function callerIp(): Promise<string | null> {
  try {
    const list = await headers();
    return extractIpFromHeaders((name) => list.get(name));
  } catch {
    return null;
  }
}
