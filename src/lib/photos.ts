import sharp from 'sharp';
import { supabaseServer } from './supabase-server';
import { dhashFromImage } from './phash-image';

const MAX_BYTES = 5 * 1024 * 1024;
const MAX_FILES = 3;
const ALLOWED = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'];

export type UploadOutcome = { inserted: number; hashed: number; skipped: string[] };

/**
 * Re-encodes every upload through sharp before it leaves the server:
 * orientation is baked in, the image is resized, and all EXIF/GPS/camera
 * metadata is dropped because sharp only keeps what it is told to keep.
 */
export async function processAndUploadPhotos(
  files: File[],
  userId: string,
  ref: string,
  title: string,
): Promise<UploadOutcome> {
  const outcome: UploadOutcome = { inserted: 0, hashed: 0, skipped: [] };
  const supabase = await supabaseServer();
  const accepted = files.filter((f) => f && f.size > 0).slice(0, MAX_FILES);
  if (!accepted.length) return outcome;

  const { data: item } = await supabase
    .from('items')
    .select('id')
    .eq('ref_code', ref)
    .maybeSingle();
  if (!item?.id) {
    outcome.skipped.push('listing not found');
    return outcome;
  }

  for (let i = 0; i < accepted.length; i++) {
    const file = accepted[i];
    if (!ALLOWED.includes(file.type)) {
      outcome.skipped.push(`${file.name}: only JPG, PNG or WebP`);
      continue;
    }
    if (file.size > MAX_BYTES) {
      outcome.skipped.push(`${file.name}: larger than 5 MB`);
      continue;
    }

    try {
      const input = Buffer.from(await file.arrayBuffer());
      const output = await sharp(input, { failOn: 'error', limitInputPixels: 16_777_216 })
        .rotate()
        .resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true })
        .webp({ quality: 78 })
        .toBuffer();
      const meta = await sharp(output).metadata();

      const path = `${userId}/${ref}/${Date.now()}-${i}.webp`;
      const { error } = await supabase.storage.from('item-photos').upload(path, output, {
        contentType: 'image/webp',
        upsert: false,
      });
      if (error) {
        outcome.skipped.push(`${file.name}: upload failed`);
        continue;
      }

      const altRaw = `${title} — view ${i + 1}`;
      const alt = altRaw.length < 4 ? 'Item photo' : altRaw.slice(0, 200);
      const { error: rowError } = await supabase.from('item_images').insert({
        item_id: item.id,
        storage_path: path,
        alt_text: alt,
        width: meta.width ?? null,
        height: meta.height ?? null,
        position: i,
      });
      if (rowError) {
        // the object is already in the bucket: remove it rather than leave an orphan
        await supabase.storage.from('item-photos').remove([path]);
        outcome.skipped.push(`${file.name}: could not attach to listing`);
        continue;
      }
      outcome.inserted += 1;

      // A hash is a bonus, never a condition of a successful upload: the photo
      // is already stored and attached by this point.
      try {
        const hash = await dhashFromImage(output);
        const { data: hashed } = await supabase.rpc('set_item_photo_hash', {
          p_storage_path: path,
          p_phash: hash.toString(),
        });
        if ((hashed as { ok?: boolean } | null)?.ok) outcome.hashed += 1;
      } catch {
        // matching falls back to text and category for this listing
      }
    } catch {
      outcome.skipped.push(`${file.name}: could not be read as an image`);
    }
  }

  // create_item() scored this listing before its photos existed. With a hash in
  // place the pair can now be scored on the photo too. The function checks that
  // the caller may re-score this listing; a refusal is not an upload failure.
  if (outcome.hashed > 0) {
    try {
      await supabase.rpc('recompute_item_matches', { p_ref: ref });
    } catch {
      // the next listing that matches will still be scored against this one
    }
  }

  return outcome;
}
