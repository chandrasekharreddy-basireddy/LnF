'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

type Shortcut = { label: string; href: string; hint?: string };

const PUBLIC_SHORTCUTS: Shortcut[] = [
  { label: 'Browse everything', href: '/browse', hint: 'board' },
  { label: 'Report something lost', href: '/report/lost', hint: 'lost' },
  { label: 'Hand something in', href: '/report/found', hint: 'found' },
  { label: 'My claims', href: '/claims', hint: 'claims' },
  { label: 'Saved items and searches', href: '/account/saved', hint: 'saved' },
  { label: 'How it works', href: '/how-it-works', hint: 'help' },
  { label: 'Safety', href: '/safety', hint: 'help' },
];

const STAFF_SHORTCUTS: Shortcut[] = [
  { label: 'Desk queue', href: '/staff', hint: 'desk' },
  { label: 'Scan a tag', href: '/staff/scan', hint: 'desk' },
  { label: 'Disposal queue', href: '/staff/disposal', hint: 'desk' },
];

export function CommandPalette({ staff = false }: { staff?: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setOpen((value) => {
          if (value) setQuery('');
          return !value;
        });
      }
      if (event.key === 'Escape') {
        setOpen(false);
        setQuery('');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  const closePalette = () => {
    setOpen(false);
    setQuery('');
  };

  const shortcuts = staff ? [...STAFF_SHORTCUTS, ...PUBLIC_SHORTCUTS] : PUBLIC_SHORTCUTS;
  const trimmed = query.trim();
  const refMatch = trimmed.match(/^(LF|CLM)-\d{4}-\d{1,4}$/i);
  const filtered = shortcuts.filter(
    (shortcut) =>
      !trimmed ||
      shortcut.label.toLowerCase().includes(trimmed.toLowerCase()) ||
      (shortcut.hint ?? '').includes(trimmed.toLowerCase()),
  );

  const go = (href: string) => {
    setOpen(false);
    setQuery('');
    router.push(href);
  };

  return (
    <>
      <button
        type="button"
        className="theme-toggle"
        onClick={() => setOpen(true)}
        aria-label="Open quick search (Control or Command K)"
        title="Quick search (⌘K)"
      >
        ⌘K
      </button>

      {open ? (
        <div className="palette-layer">
          <button type="button" className="palette-backdrop" aria-label="Close quick search" onClick={closePalette} />
          <div className="palette" role="dialog" aria-modal="true" aria-label="Quick search">
            <input
              ref={inputRef}
              type="text"
              value={query}
              placeholder="Jump to a page, or paste a reference like LF-2026-0007"
              aria-label="Quick search"
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  if (refMatch) {
                    const upper = trimmed.toUpperCase();
                    go(upper.startsWith('LF') ? `/items/${upper}` : `/claims/${upper}`);
                  } else if (filtered[0]) {
                    go(filtered[0].href);
                  }
                }
              }}
            />
            <ul>
              {refMatch ? (
                <li>
                  <button type="button" onClick={() => go(trimmed.startsWith('CLM') ? `/claims/${trimmed}` : `/items/${trimmed}`)}>
                    Open {trimmed.toUpperCase()}
                    <span className="kbd">Enter</span>
                  </button>
                </li>
              ) : null}
              {filtered.map((shortcut) => (
                <li key={shortcut.href}>
                  <Link href={shortcut.href} onClick={closePalette}>
                    {shortcut.label}
                    <span className="kbd">{shortcut.hint}</span>
                  </Link>
                </li>
              ))}
              {!filtered.length && !refMatch ? <li className="small muted">Nothing matches “{trimmed}”.</li> : null}
            </ul>
            <div className="palette-foot">Enter opens the first result · Escape closes</div>
          </div>
        </div>
      ) : null}
    </>
  );
}
