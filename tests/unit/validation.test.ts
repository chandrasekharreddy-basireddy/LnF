import { describe, expect, it } from 'vitest';
import { formatDate, isEmail, isValidDate, refLooksValid, safeInternalPath, todayISO } from '../../src/lib/validation';

describe('safeInternalPath', () => {
  it('keeps a same-origin path', () => {
    expect(safeInternalPath('/claims/CLM-2026-0001')).toBe('/claims/CLM-2026-0001');
  });

  it.each([
    ['//evil.com', 'protocol-relative'],
    ['https://evil.com', 'absolute'],
    ['/\\evil.com', 'backslash'],
    ['/\t/evil.com', 'tab, which the URL parser deletes'],
    ['/\n/evil.com', 'newline'],
    ['/\r/evil.com', 'carriage return'],
    ['/ok/\u0000/../..//evil.com', 'null byte'],
  ])('rejects %s (%s)', (value) => {
    expect(safeInternalPath(value)).toBe('/account');
  });

  it('falls back on empty input', () => {
    expect(safeInternalPath(null)).toBe('/account');
    expect(safeInternalPath('')).toBe('/account');
  });

  it('accepts a custom fallback', () => {
    expect(safeInternalPath('https://evil.com', '/browse')).toBe('/browse');
  });
});

describe('field helpers', () => {
  it('validates emails', () => {
    expect(isEmail('someone@campus.edu')).toBe(true);
    expect(isEmail('someone@campus')).toBe(false);
    expect(isEmail('not an email')).toBe(false);
  });

  it('validates ISO dates and rejects nonsense', () => {
    expect(isValidDate('2026-11-27')).toBe(true);
    expect(isValidDate('2026-13-01')).toBe(false);
    expect(isValidDate('27/11/2026')).toBe(false);
  });

  it('formats dates as dd/mm/yyyy', () => {
    expect(formatDate('2026-11-07')).toBe('07/11/2026');
    expect(formatDate(null)).toBe('—');
  });

  it('today is never in the future by its own clock', () => {
    expect(todayISO() <= todayISO()).toBe(true);
    expect(/^\d{4}-\d{2}-\d{2}$/.test(todayISO())).toBe(true);
  });

  it('recognises reference codes', () => {
    expect(refLooksValid('LF-2026-0007')).toBe(true);
    expect(refLooksValid('LF-26-7')).toBe(false);
  });
});
