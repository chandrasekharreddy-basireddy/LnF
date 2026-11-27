import { describe, expect, it } from 'vitest';
import { templates } from '../../src/lib/email';

describe('sign-in code email', () => {
  it('contains the code, in a monospace block, exactly twice', () => {
    const mail = templates.signInCode('428913', 'someone@campus.edu');
    const occurrences = mail.html.split('428913').length - 1;
    // once in the visible block, once in the hidden preheader
    expect(occurrences).toBe(2);
    expect(mail.html).toContain('letter-spacing:.34em');
  });

  it('names the address it was sent to, escaped', () => {
    const mail = templates.signInCode('428913', '<script>@campus.edu');
    expect(mail.html).toContain('&lt;script&gt;@campus.edu');
    expect(mail.html).not.toContain('<script>@campus.edu');
  });

  it('carries the anti-scam line every email in this product has', () => {
    const mail = templates.signInCode('428913', 'someone@campus.edu');
    expect(mail.html).toContain('Never pay to get an item back.');
    expect(mail.text).toContain('works once');
  });

  it('states the expiry and single use in the subject-adjacent copy', () => {
    const mail = templates.signInCode('428913', 'someone@campus.edu');
    expect(mail.subject).toContain('428913');
    expect(mail.html).toContain('Expires in 10 minutes');
    expect(mail.html).toContain('single use');
  });

  it('welcome email escapes a hostile name', () => {
    const mail = templates.welcome('<img src=x onerror=alert(1)>');
    expect(mail.html).not.toContain('<img src=x');
    expect(mail.html).toContain('&lt;img');
  });
});
