import { describe, expect, it } from 'vitest';
import { scanText } from '../../src/lib/antifraud';

describe('scanText', () => {
  it('lets a normal reply through', () => {
    const result = scanText('I have the receipt from the day I bought it, can I bring it to the desk?');
    expect(result.blocked).toBe(false);
    expect(result.flags).toEqual([]);
  });

  it.each([
    ['send me 500 via UPI and I will hand it over', 'extortion'],
    ['pay me a reward fee first', 'extortion'],
    ['gift card only', 'extortion'],
    ['call me on 9876543210', 'contact'],
    ['mail me at someone@example.com', 'contact'],
    ['my number is 2345 6789 0123', 'id_number'],
    ['PAN ABCDE1234F', 'id_number'],
  ])('blocks %s as %s', (text, category) => {
    const result = scanText(text);
    expect(result.blocked).toBe(true);
    expect(result.flags.map((f) => f.category)).toContain(category);
  });

  it.each([
    ['call me on 98765 43210', 'contact'],
    ['+91-98765-43210', 'contact'],
    ['pan abcde1234f', 'id_number'],
    ['my aadhaar is 2345-6789-0123', 'id_number'],
  ])('catches the shapes a scammer actually writes: %s', (text, category) => {
    expect(scanText(text).flags.map((f) => f.category)).toContain(category);
  });

  it('does not fire on words that merely contain a trigger', () => {
    expect(scanText('The case has a small sticker on the back').blocked).toBe(false);
    expect(scanText('A U-shaped dent in the lid').blocked).toBe(false);
    expect(scanText('Found in the library, third aisle').blocked).toBe(false);
  });
});
