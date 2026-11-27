import { describe, expect, it } from 'vitest';
import { safeInternalPath } from '../../src/lib/validation';

/**
 * The public flow leans on two invariants that are cheap to test and expensive
 * to get wrong: the post-verification redirect must stay on this origin, and the
 * claim cookie must be readable only by the server.
 */
describe('public claim flow', () => {
  it('returns to the claim it just created, not somewhere else', () => {
    expect(safeInternalPath('/claims/CLM-2026-0004?new=1')).toBe('/claims/CLM-2026-0004?new=1');
  });

  it('refuses an off-site destination after verifying an email', () => {
    for (const hostile of ['//evil.com', 'https://evil.com', '/\\evil.com', '/\t/evil.com']) {
      expect(safeInternalPath(hostile)).toBe('/account');
    }
  });
});
