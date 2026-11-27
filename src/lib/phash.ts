/**
 * Photo similarity, as arithmetic a person can check.
 *
 * A difference hash (dHash) shrinks a photo to a 9×8 greyscale grid and records
 * which neighbour is brighter: 64 bits, one per adjacent pair. Two photos of the
 * same object land within a few bits of each other; two photos of different
 * objects usually differ in about half of them. That is the whole model — no
 * embeddings, no service, no training set, and nothing that cannot be explained
 * to a claimant in one sentence.
 *
 * This module is pure so the numbers can be tested, and it is the reference the
 * SQL in migration 0029 mirrors:
 *
 *   base  = 0.55·title + 0.25·category + 0.10·zone + up to 0.10·date
 *   photo = max(0, 1 − distance/24)
 *   score = min(1, base + 0.35·photo)
 *
 * Keep PHOTO_WEIGHT, PHOTO_FALLOFF_BITS and MATCH_THRESHOLD in step with
 * refresh_matches() in supabase/migrations/0029_photo_matching.sql. The database
 * check (scripts/check-photo-matching-migration.py) asserts the SQL side; the
 * unit tests assert this side.
 */

export const DHASH_WIDTH = 9;
export const DHASH_HEIGHT = 8;
export const DHASH_BITS = (DHASH_WIDTH - 1) * DHASH_HEIGHT; // 64 comparisons
export const MAX_DISTANCE = 64;

/** Distance at which two hashes read as unrelated. */
export const PHOTO_FALLOFF_BITS = 24;
/** How much a perfect photo match can add to the score. */
export const PHOTO_WEIGHT = 0.35;
/** Distance at which a pair is allowed past the category/title gate. */
export const PHOTO_GATE_BITS = 12;
/** Below this, a pair is not a possible match. */
export const MATCH_THRESHOLD = 0.35;
/** Beyond this many days apart, two events are not compared at all. */
export const DAY_WINDOW = 45;

const TWO_63 = 1n << 63n;
const TWO_64 = 1n << 64n;
const MASK_64 = TWO_64 - 1n;

/**
 * dHash from a greyscale grid of exactly 9×8 samples, row-major.
 *
 * Bit (row·8 + col) is set when the pixel to the right is brighter than its
 * neighbour, so a left-to-right brightening ramp is all ones and its inverse is
 * all zeros. Bit 63 is the top-left comparison, so the hex form reads in reading
 * order.
 */
export function dhashFromGray(gray: Uint8Array | number[], width = DHASH_WIDTH, height = DHASH_HEIGHT): bigint {
  if (width !== DHASH_WIDTH || height !== DHASH_HEIGHT) {
    throw new Error(`dhash expects a ${DHASH_WIDTH}×${DHASH_HEIGHT} grid, got ${width}×${height}`);
  }
  if (gray.length !== width * height) {
    throw new Error(`dhash expects ${width * height} samples, got ${gray.length}`);
  }

  let hash = 0n;
  for (let row = 0; row < height; row++) {
    for (let col = 0; col < width - 1; col++) {
      const left = gray[row * width + col];
      const right = gray[row * width + col + 1];
      if (right > left) {
        hash |= 1n << BigInt(63 - (row * (width - 1) + col));
      }
    }
  }
  return hash;
}

/** The same 64 bits as Postgres bigint sees them: bit 63 is the sign. */
export function toSigned64(hash: bigint): bigint {
  const pattern = hash & MASK_64;
  return pattern >= TWO_63 ? pattern - TWO_64 : pattern;
}

export function hamming64(a: bigint, b: bigint): number {
  let x = (a ^ b) & MASK_64;
  let count = 0;
  while (x) {
    x &= x - 1n;
    count += 1;
  }
  return count;
}

/** 1 when the photos are bit-identical, 0 once they are 24 or more bits apart. */
export function photoSimilarity(distance: number | null | undefined): number {
  if (distance === null || distance === undefined || Number.isNaN(distance)) return 0;
  const clamped = Math.min(Math.max(distance, 0), MAX_DISTANCE);
  return Math.max(0, 1 - clamped / PHOTO_FALLOFF_BITS);
}

/** Whether a photo alone is enough to look at the pair. */
export function isPhotoCandidate(distance: number | null | undefined): boolean {
  return typeof distance === 'number' && distance <= PHOTO_GATE_BITS;
}

export type PairInput = {
  /** Trigram similarity of the two titles, 0..1. */
  titleSimilarity: number;
  sameCategory: boolean;
  sameZone: boolean;
  /** Absolute difference in days between the two events. */
  dayGap: number;
  /** Hamming distance between the nearest photos, null when either has none. */
  photoDistance?: number | null;
};

export type PairScore = {
  title: number;
  category: number;
  zone: number;
  date: number;
  base: number;
  photo: number;
  distance: number | null;
  score: number;
  /** True when the pair clears MATCH_THRESHOLD. */
  alert: boolean;
};

function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}

/**
 * The one scorer. Both directions of a match go through here, and so does the
 * staff queue's explanation, so a score shown to a person is always reproducible
 * from the four numbers beside it.
 */
export function scorePair(input: PairInput): PairScore {
  const title = Math.min(Math.max(input.titleSimilarity || 0, 0), 1);
  const category = input.sameCategory ? 0.25 : 0;
  const zone = input.sameZone ? 0.1 : 0;
  const date = Math.max(0, 0.1 - Math.abs(input.dayGap) / 300);
  const base = title * 0.55 + category + zone + date;
  const distance = typeof input.photoDistance === 'number' ? input.photoDistance : null;
  const photo = photoSimilarity(distance);
  const score = round3(Math.min(1, base + PHOTO_WEIGHT * photo));
  return {
    title: round3(title),
    category,
    zone,
    date: round3(date),
    base: round3(base),
    photo: round3(photo),
    distance,
    score,
    alert: score >= MATCH_THRESHOLD,
  };
}

export type MatchReason = {
  title: number;
  sameCategory: boolean;
  sameZone: boolean;
  distance: number | null;
};

/** A one-line reason for a pair, for the desk queue. */
export function explainMatch(input: MatchReason): string {
  const parts: string[] = [];
  if (input.title >= 0.5) parts.push('the titles match closely');
  else if (input.title > 0.2) parts.push('the titles are similar');
  if (input.sameCategory) parts.push('same category');
  if (input.sameZone) parts.push('same zone');
  if (input.distance !== null && input.distance <= PHOTO_GATE_BITS) {
    parts.push(`the photos are ${input.distance} of 64 bits apart`);
  }
  if (!parts.length) parts.push('the dates are close');
  return parts.join(', ');
}

export function explainPair(score: PairScore): string {
  return explainMatch({
    title: score.title,
    sameCategory: score.category > 0,
    sameZone: score.zone > 0,
    distance: score.distance,
  });
}
