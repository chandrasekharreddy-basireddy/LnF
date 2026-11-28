import { describe, expect, it } from 'vitest';
import { renderOutboxMail } from '../../src/lib/email';

/**
 * The erasure email is the last thing an erased person receives. If the outbox
 * cannot rebuild it, the retry drain drops it silently and the person is left
 * believing their data is still there.
 */
describe('erasure confirmation', () => {
  it('renders from the outbox payload', () => {
    const mail = renderOutboxMail('erasure_confirmed', { email: 'ananya@campus.edu' });
    expect(mail).not.toBeNull();
    expect(mail?.subject).toMatch(/erased/i);
    expect(mail?.text).toContain('ananya@campus.edu');
    expect(mail?.tag).toBe('erasure-confirmed');
  });

  it('says no further mail will be sent, because that is the promise', () => {
    const mail = renderOutboxMail('erasure_confirmed', { email: 'x@y.z' });
    expect(mail?.text.toLowerCase()).toContain('no further emails');
  });
});

describe('publish notice', () => {
  it('renders for both kinds', () => {
    expect(renderOutboxMail('item_published', { ref: 'LF-2026-0001', title: 'Blue bottle', kind: 'found' })).not.toBeNull();
    expect(renderOutboxMail('item_published', { ref: 'LF-2026-0002', title: 'Grey bag', kind: 'lost' })).not.toBeNull();
  });
});
