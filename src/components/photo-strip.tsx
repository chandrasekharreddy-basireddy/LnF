import type { SignedPhoto } from '@/lib/types';

export function PhotoStrip({ photos }: { photos: SignedPhoto[] }) {
  if (!photos.length) return null;
  return (
    <div className="photo-strip">
      {photos.map((p) => (
        <figure key={p.url}>
          <img
            src={p.url}
            alt={p.alt}
            width={p.width ?? 640}
            height={p.height ?? 480}
            loading="lazy"
            decoding="async"
          />
        </figure>
      ))}
    </div>
  );
}
