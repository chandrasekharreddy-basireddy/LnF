import { describe, expect, it } from 'vitest';
import { renderOutboxMail, templates } from '../../src/lib/email';

describe('email rendering', () => {
  it('escapes a hostile item title in the HTML body', () => {
    const mail = templates.itemPublished('LF-2026-0007', '<script>alert(1)</script>', 'found');
    expect(mail.html).not.toContain('<script>alert(1)</script>');
    expect(mail.html).toContain('&lt;script&gt;');
  });

  it('escapes a desk note on a rejection', () => {
    const mail = templates.claimDecided('CLM-2026-0001', false, '<img src=x onerror=alert(1)>');
    expect(mail.html).not.toContain('<img src=x');
  });

  it('keeps plain text unescaped so the fallback reads correctly', () => {
    const mail = templates.itemPublished('LF-2026-0007', 'Bag & bottle', 'found');
    expect(mail.text).toContain('Bag & bottle');
  });

  it('rebuilds every outbox event type', () => {
    const cases: [string, Record<string, unknown>][] = [
      ['item_published', { ref: 'LF-2026-0007', title: 'Earbuds', kind: 'found' }],
      ['claim_received', { claimRef: 'CLM-2026-0001', itemTitle: 'LF-2026-0007' }],
      ['claim_decided', { claimRef: 'CLM-2026-0001', approved: true, reason: '' }],
      ['finder_thanks', { ref: 'LF-2026-0007', title: 'Earbuds' }],
      ['match_alert', { lostTitle: 'Earbuds', foundRef: 'LF-2026-0008', foundTitle: 'Buds' }],
    ];
    for (const [event, payload] of cases) {
      const mail = renderOutboxMail(event, payload);
      expect(mail, event).not.toBeNull();
      expect(mail?.subject.length, event).toBeGreaterThan(4);
      expect(mail?.html, event).toContain('L&amp;F');
    }
  });

  it('returns null for an unknown event rather than sending something empty', () => {
    expect(renderOutboxMail('made_up_event', {})).toBeNull();
  });
});
