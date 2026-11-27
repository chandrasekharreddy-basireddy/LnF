'use client';

const MAX_FILES = 3;
const MAX_DIMENSION = 1600;
const QUALITY = 0.8;
const MAX_TOTAL_BYTES = 3.8 * 1024 * 1024; // stay safely under Vercel's 4.5 MB serverless limit

/**
 * Compresses selected images on the client via Canvas before form submission:
 * keeps payloads under Vercel's 4.5 MB limit, speeds up mobile uploads, and
 * reduces Supabase Free Storage usage. Server-side sharp still re-encodes and
 * strips EXIF metadata as the authoritative security boundary.
 */
export async function compressSelectedPhotos(input: HTMLInputElement): Promise<string | null> {
  const raw = Array.from(input.files ?? []);
  if (!raw.length) return null;
  if (raw.length > MAX_FILES) {
    input.value = '';
    return `Choose at most ${MAX_FILES} photos.`;
  }

  const dt = new DataTransfer();
  let totalBytes = 0;

  for (const file of raw) {
    let out: File = file;
    try {
      const bitmap = await createImageBitmap(file);
      const scale = Math.min(1, MAX_DIMENSION / Math.max(bitmap.width, bitmap.height));
      const width = Math.max(1, Math.round(bitmap.width * scale));
      const height = Math.max(1, Math.round(bitmap.height * scale));
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.drawImage(bitmap, 0, 0, width, height);
        const blob = await new Promise<Blob | null>((resolve) =>
          canvas.toBlob((b) => resolve(b), 'image/webp', QUALITY),
        );
        if (blob && blob.size > 0 && blob.size < file.size) {
          const base = file.name.replace(/\.[^.]+$/, '') || 'photo';
          out = new File([blob], `${base}.webp`, { type: 'image/webp' });
        }
      }
      bitmap.close();
    } catch {
      // Fall back to original file if browser cannot decode (server validates via sharp)
    }

    totalBytes += out.size;
    dt.items.add(out);
  }

  if (totalBytes > MAX_TOTAL_BYTES) {
    input.value = '';
    return 'Those photos are too large together (over 3.8 MB after compression). Choose smaller images or fewer photos.';
  }

  input.files = dt.files;
  return null;
}