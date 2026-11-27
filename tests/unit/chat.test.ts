import { describe, expect, it } from 'vitest';

/**
 * The chat's only non-trivial pure logic is how a thread is ordered and how
 * unread is counted. Both are cheap to get wrong and invisible when they are.
 */
type Msg = { id: string; at: string; mine: boolean };

const sortByTime = (messages: Msg[]) => [...messages].sort((a, b) => a.at.localeCompare(b.at));

const unreadSince = (messages: Msg[], lastRead: string | null) =>
  messages.filter((m) => !m.mine && (!lastRead || m.at > lastRead)).length;

describe('thread ordering and unread counts', () => {
  const messages: Msg[] = [
    { id: 'c', at: '2026-11-27T10:05:00Z', mine: false },
    { id: 'a', at: '2026-11-27T10:00:00Z', mine: true },
    { id: 'b', at: '2026-11-27T10:02:00Z', mine: false },
  ];

  it('orders by time, not by arrival', () => {
    expect(sortByTime(messages).map((m) => m.id)).toEqual(['a', 'b', 'c']);
  });

  it('counts only the other side, and only after the read mark', () => {
    expect(unreadSince(messages, null)).toBe(2);
    expect(unreadSince(messages, '2026-11-27T10:00:00Z')).toBe(2);
    expect(unreadSince(messages, '2026-11-27T10:02:00Z')).toBe(1);
    expect(unreadSince(messages, '2026-11-27T10:05:00Z')).toBe(0);
  });

  it('never counts your own message as unread', () => {
    const onlyMine: Msg[] = [{ id: 'x', at: '2026-11-27T11:00:00Z', mine: true }];
    expect(unreadSince(onlyMine, null)).toBe(0);
  });
});
