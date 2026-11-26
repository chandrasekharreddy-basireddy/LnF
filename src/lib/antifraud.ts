/**
 * Client-side mirror of `public.scan_message()`. This exists to explain a block
 * before the request is made; the SQL version is what actually enforces it.
 */
export type ScanFlag = { category: 'extortion' | 'contact' | 'id_number'; reason: string };

const PATTERNS: { category: ScanFlag['category']; reason: string; test: RegExp }[] = [
  {
    category: 'extortion',
    reason: 'Asks for payment or moves the conversation off the board',
    test: /(venmo|zelle|(^|[^a-z])upi([^a-z]|$)|paytm|gpay|phonepe|bhim|gift\s?card|ransom|reward\s?fee|pay\s?me|send\s?money|whatsapp\s?me|telegram|western\s?union|bit\.ly|tinyurl)/i,
  },
  {
    category: 'contact',
    reason: 'Contains a phone number or email address',
    test: /([a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}|(^|[^0-9])(\+?91)?[6-9][0-9]{9}([^0-9]|$))/i,
  },
  {
    category: 'id_number',
    reason: 'Contains an identity or card number',
    test: /([2-9][0-9]{3}\s?[0-9]{4}\s?[0-9]{4}|[A-Z]{5}[0-9]{4}[A-Z])/,
  },
];

export function scanText(text: string): { blocked: boolean; flags: ScanFlag[] } {
  const flags = PATTERNS.filter((pattern) => pattern.test.test(text)).map(({ category, reason }) => ({
    category,
    reason,
  }));
  return { blocked: flags.length > 0, flags };
}

/** Shown above the message box: what will not get through, and why. */
export const THREAD_RULES = [
  'Everything here is read on the board. Nobody sees an email address.',
  'Never pay for an item. Any request for money is a scam and is blocked automatically.',
  'Do not paste a phone number, an email address, or an ID number — the desk relays instead.',
] as const;
