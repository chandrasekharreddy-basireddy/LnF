import { describe, expect, it } from 'vitest';

/**
 * The audit's two client-side findings, as pure logic so they can be tested
 * without a browser: a notification URL must not leave the origin, and a typed
 * reference must not be routed to the wrong place.
 */

const FALLBACK = '/';

function safePath(value: unknown): string {
  if (typeof value !== 'string') return FALLBACK;
  if (!value.startsWith('/') || value.startsWith('//')) return FALLBACK;
  if (value.includes('\\') || /\s/.test(value)) return FALLBACK;
  return value;
}

const ITEM_REF = /^LF-\d{4}-\d{4}$/;
const CLAIM_REF = /^CLM-\d{4}-\d{4}$/;

function referencePath(value: string): string | null {
  if (ITEM_REF.test(value)) return `/items/${value}`;
  if (CLAIM_REF.test(value)) return `/claims/${value}`;
  return null;
}

describe('service worker navigation target', () => {
  it('opens an internal path', () => {
    expect(safePath('/items/LF-2026-0007')).toBe('/items/LF-2026-0007');
  });

  it('refuses a protocol-relative URL, which is how an off-site redirect hides', () => {
    expect(safePath('//evil.example.com/login')).toBe(FALLBACK);
  });

  it('refuses absolute URLs, backslashes and whitespace', () => {
    expect(safePath('https://evil.example.com')).toBe(FALLBACK);
    expect(safePath('/\\evil.example.com')).toBe(FALLBACK);
    expect(safePath('/items/ LF')).toBe(FALLBACK);
    expect(safePath(null)).toBe(FALLBACK);
    expect(safePath(42)).toBe(FALLBACK);
  });
});

describe('typed reference routing', () => {
  it('sends each shape to its own page', () => {
    expect(referencePath('LF-2026-0007')).toBe('/items/LF-2026-0007');
    expect(referencePath('CLM-2026-0002')).toBe('/claims/CLM-2026-0002');
  });

  it('does not invent a route for something that is not a reference', () => {
    expect(referencePath('HELLO')).toBeNull();
    expect(referencePath('CLM-2026')).toBeNull();
    expect(referencePath('')).toBeNull();
  });
});
