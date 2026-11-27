import { describe, expect, it } from 'vitest';
import {
  DHASH_HEIGHT,
  DHASH_WIDTH,
  MAX_DISTANCE,
  MATCH_THRESHOLD,
  PHOTO_FALLOFF_BITS,
  PHOTO_GATE_BITS,
  PHOTO_WEIGHT,
  dhashFromGray,
  explainMatch,
  hamming64,
  isPhotoCandidate,
  photoSimilarity,
  scorePair,
  toSigned64,
} from '../../src/lib/phash';

/** A 9×8 grid built from one row pattern, so every row hashes the same way. */
function gridFromRow(row: number[]): number[] {
  const out: number[] = [];
  for (let r = 0; r < DHASH_HEIGHT; r++) out.push(...row);
  return out;
}

const RAMP = [0, 32, 64, 96, 128, 160, 192, 224, 255];
const REVERSE = [...RAMP].reverse();
const FLAT = [120, 120, 120, 120, 120, 120, 120, 120, 120];

describe('dhashFromGray', () => {
  it('sets every bit for a left-to-right brightening ramp', () => {
    expect(dhashFromGray(gridFromRow(RAMP))).toBe((1n << 64n) - 1n);
  });

  it('sets no bit for the inverse', () => {
    expect(dhashFromGray(gridFromRow(REVERSE))).toBe(0n);
  });

  it('sets no bit where neighbours are equal, so a flat image is 0', () => {
    expect(dhashFromGray(gridFromRow(FLAT))).toBe(0n);
  });

  it('compares only neighbours, not the whole row', () => {
    // one brightening step in the middle of each row: bit 3 of that row's byte
    const row = [100, 100, 100, 100, 200, 100, 100, 100, 100];
    const hash = dhashFromGray(gridFromRow(row));
    const byte = 1n << BigInt(8 - 1 - 3); // bit index 3 inside the row, MSB-first
    let expected = 0n;
    for (let r = 0; r < DHASH_HEIGHT; r++) expected |= byte << BigInt(8 * (DHASH_HEIGHT - 1 - r));
    expect(hash).toBe(expected);
  });

  it('keeps rows independent', () => {
    const topRamp = [...RAMP, ...REVERSE, ...RAMP, ...REVERSE, ...RAMP, ...REVERSE, ...RAMP, ...REVERSE];
    const hash = dhashFromGray(topRamp);
    // alternating full and empty rows: 0xFF, 0x00, 0xFF, ...
    expect(hash).toBe(0xff00ff00ff00ff00n);
  });

  it('rejects a grid that is not 9×8', () => {
    expect(() => dhashFromGray(new Array(64).fill(0))).toThrow(/72 samples/);
    expect(() => dhashFromGray(new Array(72).fill(0), 8, 8)).toThrow(/9×8/);
  });

  it('takes a Uint8Array as well as a plain array', () => {
    expect(dhashFromGray(Uint8Array.from(gridFromRow(RAMP)))).toBe((1n << 64n) - 1n);
  });

  it('produces the same hash for the same picture twice', () => {
    const a = dhashFromGray(gridFromRow(RAMP));
    const b = dhashFromGray(gridFromRow(RAMP));
    expect(a).toBe(b);
  });
});

describe('toSigned64', () => {
  it('leaves a small hash alone', () => {
    expect(toSigned64(1234n)).toBe(1234n);
  });

  it('wraps a hash with bit 63 set into the negative range Postgres stores', () => {
    expect(toSigned64(1n << 63n)).toBe(-(1n << 63n));
    expect(toSigned64((1n << 64n) - 1n)).toBe(-1n);
  });

  it('round-trips through hamming: the sign is only a label', () => {
    const all = toSigned64((1n << 64n) - 1n);
    expect(all).toBe(-1n);
    expect(hamming64(all, 0n)).toBe(MAX_DISTANCE);
  });
});

describe('hamming64', () => {
  it('is zero for identical hashes', () => {
    expect(hamming64(0x1234n, 0x1234n)).toBe(0);
  });

  it('counts a single differing bit', () => {
    expect(hamming64(0n, 1n)).toBe(1);
    expect(hamming64(0n, 1n << 63n)).toBe(1);
  });

  it('counts every bit between complementary patterns', () => {
    expect(hamming64(0n, (1n << 64n) - 1n)).toBe(64);
  });

  it('is symmetric and never exceeds 64', () => {
    const a = 0x0f0f0f0f0f0f0f0fn;
    const b = 0xf0f0f0f0f0f0f0f0n;
    expect(hamming64(a, b)).toBe(64);
    expect(hamming64(a, b)).toBe(hamming64(b, a));
    expect(hamming64(0xdeadbeefn, 0xcafebaben)).toBeLessThanOrEqual(64);
  });

  it('treats negative (signed) hashes as their 64-bit pattern', () => {
    expect(hamming64(-1n, 0n)).toBe(64);
    expect(hamming64(-1n, -2n)).toBe(1);
  });
});

describe('photoSimilarity', () => {
  it('is 1 for identical photos', () => {
    expect(photoSimilarity(0)).toBe(1);
  });

  it('is 0 once the photos are 24 or more bits apart', () => {
    expect(photoSimilarity(PHOTO_FALLOFF_BITS)).toBe(0);
    expect(photoSimilarity(40)).toBe(0);
  });

  it('falls off linearly in between', () => {
    expect(photoSimilarity(12)).toBeCloseTo(0.5, 6);
    expect(photoSimilarity(6)).toBeCloseTo(0.75, 6);
  });

  it('is 0 when there is no hash on one side', () => {
    expect(photoSimilarity(null)).toBe(0);
    expect(photoSimilarity(undefined)).toBe(0);
  });

  it('clamps a nonsense distance instead of inventing a score', () => {
    expect(photoSimilarity(-5)).toBe(1);
    expect(photoSimilarity(Number.NaN)).toBe(0);
  });
});

describe('isPhotoCandidate', () => {
  it('lets a close photo past the gate', () => {
    expect(isPhotoCandidate(0)).toBe(true);
    expect(isPhotoCandidate(PHOTO_GATE_BITS)).toBe(true);
  });

  it('does not let a loose photo past it', () => {
    expect(isPhotoCandidate(PHOTO_GATE_BITS + 1)).toBe(false);
    expect(isPhotoCandidate(32)).toBe(false);
  });

  it('is false when either listing has no photo', () => {
    expect(isPhotoCandidate(null)).toBe(false);
    expect(isPhotoCandidate(undefined)).toBe(false);
  });
});

describe('scorePair', () => {
  const base = { titleSimilarity: 0.4, sameCategory: true, sameZone: false, dayGap: 0 };

  it('adds the four documented terms', () => {
    const score = scorePair({ ...base, photoDistance: null });
    expect(score.title).toBe(0.4);
    expect(score.category).toBe(0.25);
    expect(score.zone).toBe(0);
    expect(score.date).toBeCloseTo(0.1, 6);
    expect(score.base).toBeCloseTo(0.4 * 0.55 + 0.25 + 0.1, 6);
    expect(score.photo).toBe(0);
    expect(score.score).toBe(score.base);
  });

  it('adds exactly PHOTO_WEIGHT for an identical photo', () => {
    const without = scorePair({ ...base, photoDistance: null });
    const withPhoto = scorePair({ ...base, photoDistance: 0 });
    expect(withPhoto.score - without.score).toBeCloseTo(PHOTO_WEIGHT, 3);
    expect(withPhoto.photo).toBe(1);
  });

  it('adds half the weight at half the similarity', () => {
    const without = scorePair({ ...base, photoDistance: null });
    const withPhoto = scorePair({ ...base, photoDistance: 12 });
    expect(withPhoto.score - without.score).toBeCloseTo(PHOTO_WEIGHT / 2, 3);
  });

  it('leaves a score alone when a photo is too far apart to matter', () => {
    const without = scorePair({ ...base, photoDistance: null });
    const far = scorePair({ ...base, photoDistance: 30 });
    expect(far.photo).toBe(0);
    expect(far.score).toBe(without.score);
  });

  it('never exceeds 1', () => {
    const score = scorePair({ titleSimilarity: 1, sameCategory: true, sameZone: true, dayGap: 0, photoDistance: 0 });
    expect(score.score).toBe(1);
  });

  it('lets a photo alone carry a pair over the threshold', () => {
    // nothing in common except the photo, filed on the same day
    const photoOnly = scorePair({ titleSimilarity: 0.05, sameCategory: false, sameZone: false, dayGap: 0, photoDistance: 0 });
    expect(photoOnly.score).toBeGreaterThanOrEqual(MATCH_THRESHOLD);
    expect(photoOnly.alert).toBe(true);
  });

  it('does not alert on a photo that is merely similar when nothing else lines up', () => {
    const loose = scorePair({ titleSimilarity: 0.05, sameCategory: false, sameZone: false, dayGap: 0, photoDistance: 16 });
    expect(loose.score).toBeLessThan(MATCH_THRESHOLD);
    expect(loose.alert).toBe(false);
  });

  it('gives the date term no credit beyond 30 days', () => {
    expect(scorePair({ ...base, dayGap: 30 }).date).toBe(0);
    expect(scorePair({ ...base, dayGap: 45 }).date).toBe(0);
  });

  it('rounds to three decimals, like the numeric(4,3) column', () => {
    const score = scorePair({ titleSimilarity: 0.123456, sameCategory: false, sameZone: false, dayGap: 7 });
    expect(score.score).toBe(Math.round(score.score * 1000) / 1000);
    expect(String(score.score).split('.')[1]?.length ?? 0).toBeLessThanOrEqual(3);
  });

  it('treats a missing title similarity as zero rather than NaN', () => {
    const score = scorePair({ titleSimilarity: Number.NaN, sameCategory: false, sameZone: false, dayGap: 0 });
    expect(Number.isNaN(score.score)).toBe(false);
    expect(score.title).toBe(0);
  });
});

describe('explainMatch', () => {
  it('names the strongest reason first', () => {
    expect(explainMatch({ title: 0.8, sameCategory: true, sameZone: false, distance: 4 })).toContain('titles match closely');
  });

  it('names the photo distance when the photo is what matched', () => {
    const text = explainMatch({ title: 0.05, sameCategory: false, sameZone: false, distance: 3 });
    expect(text).toBe('the photos are 3 of 64 bits apart');
  });

  it('never claims a photo reason for a distant photo', () => {
    expect(explainMatch({ title: 0, sameCategory: false, sameZone: false, distance: 40 })).toBe('the dates are close');
    expect(explainMatch({ title: 0, sameCategory: false, sameZone: false, distance: null })).toBe('the dates are close');
  });
});

describe('the constants match the SQL', () => {
  // scripts/check-photo-matching-migration.py asserts the same numbers against
  // refresh_matches(); these keep the TypeScript side honest.
  it('are the documented ones', () => {
    expect(DHASH_WIDTH).toBe(9);
    expect(DHASH_HEIGHT).toBe(8);
    expect(PHOTO_FALLOFF_BITS).toBe(24);
    expect(PHOTO_WEIGHT).toBe(0.35);
    expect(PHOTO_GATE_BITS).toBe(12);
    expect(MATCH_THRESHOLD).toBe(0.35);
    expect(MAX_DISTANCE).toBe(64);
  });
});
