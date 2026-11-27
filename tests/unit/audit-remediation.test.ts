import { describe, expect, it } from 'vitest';
import { extractIpFromHeaders } from '../../src/lib/http';
import { isValidDate, todayISO } from '../../src/lib/validation';
import { extractCode } from '../../src/components/scan-console';

const from = (map: Record<string, string>) => (name: string) => map[name] ?? null;

describe('isValidDate', () => {
  it('accepts real dates', () => {
    expect(isValidDate('2026-11-28')).toBe(true);
    expect(isValidDate('2024-02-29')).toBe(true);
  });

  it('rejects dates the Date object would roll over', () => {
    expect(isValidDate('2026-02-30')).toBe(false);
    expect(isValidDate('2026-04-31')).toBe(false);
    expect(isValidDate('2025-02-29')).toBe(false);
  });

  it('rejects the wrong shape', () => {
    expect(isValidDate('28/11/2026')).toBe(false);
    expect(isValidDate('2026-1-1')).toBe(false);
  });
});

describe('todayISO', () => {
  it('returns the campus date, not UTC', () => {
    const value = todayISO();
    expect(value).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    // at any moment, IST is either the same day as UTC or one ahead
    const utc = new Date().toISOString().slice(0, 10);
    const diff = (new Date(`${value}T00:00:00Z`).getTime() - new Date(`${utc}T00:00:00Z`).getTime()) / 86_400_000;
    expect([0, 1]).toContain(diff);
  });
});

describe('extractIpFromHeaders', () => {
  it('prefers the platform headers over a forgeable chain', () => {
    expect(extractIpFromHeaders(from({ 'x-vercel-forwarded-for': '203.0.113.9', 'x-forwarded-for': '1.2.3.4' }))).toBe('203.0.113.9');
    expect(extractIpFromHeaders(from({ 'cf-connecting-ip': '198.51.100.7' }))).toBe('198.51.100.7');
    expect(extractIpFromHeaders(from({ 'x-real-ip': '192.0.2.5' }))).toBe('192.0.2.5');
  });

  it('falls back to the rightmost forwarded entry, which the client cannot set', () => {
    expect(extractIpFromHeaders(from({ 'x-forwarded-for': '9.9.9.9, 203.0.113.4' }))).toBe('203.0.113.4');
  });

  it('returns null when nothing is present', () => {
    expect(extractIpFromHeaders(from({}))).toBeNull();
  });
});

describe('extractCode', () => {
  it('does not pick a code out of a phrase', () => {
    expect(extractCode('black camera')).toBeNull();
    expect(extractCode('found near the gate')).toBeNull();
    expect(extractCode('LF-2026-0007 please')).toBe('LF-2026-0007');
  });

  it('accepts a bare six-character string, because that is what a code looks like', () => {
    // "THANKS" is shape-valid; the server is what rejects it (no such code, and
    // five wrong tries lock the handover). The client must not pretend to be the
    // authority here.
    expect(extractCode('thanks')).toBe('THANKS');
  });

  it('still reads a real code', () => {
    expect(extractCode('K7M2QP')).toBe('K7M2QP');
  });
});
