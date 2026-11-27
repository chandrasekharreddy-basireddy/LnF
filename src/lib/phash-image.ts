import sharp from 'sharp';
import { DHASH_HEIGHT, DHASH_WIDTH, dhashFromGray, toSigned64 } from './phash';

/**
 * The 64-bit difference hash of an image, as the signed bigint Postgres stores.
 *
 * Sharp does the resampling and the greyscale conversion; the arithmetic is in
 * phash.ts, which is pure and unit-tested. Only the normalised webp that
 * processAndUploadPhotos already produced is ever hashed, so the hash describes
 * exactly the photo a visitor will see.
 */
export async function dhashFromImage(input: Buffer): Promise<bigint> {
  const { data } = await sharp(input, { failOn: 'error', limitInputPixels: 16_777_216 })
    .rotate()
    .resize(DHASH_WIDTH, DHASH_HEIGHT, { fit: 'fill' })
    .greyscale()
    .raw()
    .toBuffer({ resolveWithObject: true });

  return toSigned64(dhashFromGray(data));
}
