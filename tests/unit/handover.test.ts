import { describe, expect, it } from 'vitest';
import { extractCode } from '../../src/components/scan-console';

describe('extractCode', () => {
  it('reads a custody reference out of a URL', () => {
    expect(extractCode('https://lnf.example.com/staff/scan/LF-2026-0007')).toBe('LF-2026-0007');
  });

  it('reads a claim reference', () => {
    expect(extractCode('CLM-2026-0012')).toBe('CLM-2026-0012');
  });

  it('reads a six-character handover code and upper-cases it', () => {
    expect(extractCode('k7m2qp')).toBe('K7M2QP');
  });

  it('ignores text that is not a code', () => {
    expect(extractCode('blue bottle')).toBeNull();
    expect(extractCode('LF-2026')).toBeNull();
  });
});
