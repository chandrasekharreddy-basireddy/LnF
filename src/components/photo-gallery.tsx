'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { SignedPhoto } from '@/lib/types';

/**
 * Thumbnails plus a full-screen viewer. Keyboard: Escape closes, arrows move.
 * The images are already signed and short-lived, so nothing is fetched twice.
 */
export function PhotoGallery({ photos }: { photos: SignedPhoto[] }) {
  const [index, setIndex] = useState<number | null>(null);
  const closeRef = useRef<HTMLButtonElement | null>(null);

  const close = useCallback(() => setIndex(null), []);
  const step = useCallback(
    (delta: number) => {
      setIndex((current) => {
        if (current === null) return current;
        const next = (current + delta + photos.length) % photos.length;
        return next;
      });
    },
    [photos.length],
  );

  useEffect(() => {
    if (index === null) return;
    closeRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close();
      if (event.key === 'ArrowRight') step(1);
      if (event.key === 'ArrowLeft') step(-1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [index, close, step]);

  if (!photos.length) return null;
  const current = index === null ? null : photos[index];

  return (
    <>
      <div className="gallery-thumbs">
        {photos.map((photo, i) => (
          <button
            key={photo.url}
            type="button"
            onClick={() => setIndex(i)}
            aria-label={`Open ${photo.alt} (${i + 1} of ${photos.length})`}
          >
            <img
              src={photo.url}
              alt={photo.alt}
              width={photo.width ?? 640}
              height={photo.height ?? 480}
              loading={i === 0 ? 'eager' : 'lazy'}
              decoding="async"
            />
          </button>
        ))}
      </div>

      {current ? (
        <div className="lightbox" role="dialog" aria-modal="true" aria-label="Item photo">
          <div className="lightbox-bar">
            <span className="small">
              {index !== null ? index + 1 : 0} / {photos.length}
            </span>
            <button type="button" ref={closeRef} onClick={close}>
              Close
            </button>
          </div>
          <img src={current.url} alt={current.alt} />
          <div className="lightbox-bar">
            <button type="button" onClick={() => step(-1)} aria-label="Previous photo">
              ←
            </button>
            <figcaption>{current.alt}</figcaption>
            <button type="button" onClick={() => step(1)} aria-label="Next photo">
              →
            </button>
          </div>
        </div>
      ) : null}
    </>
  );
}
