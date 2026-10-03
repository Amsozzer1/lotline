/** Seeded, platform-independent randomness: integer hashing, sfc32 and Box-Muller normals. */

function mix32(x: number): number {
  let h = x >>> 0;
  h ^= h >>> 16;
  h = Math.imul(h, 0x7feb352d);
  h ^= h >>> 15;
  h = Math.imul(h, 0x846ca68b);
  h ^= h >>> 16;
  return h >>> 0;
}

/** Hash a list of non-negative integers to a 32-bit seed. */
export function hashInts(...xs: number[]): number {
  let h = 0x811c9dc5;
  for (const x of xs) {
    const lo = x >>> 0;
    const hi = Math.floor(x / 4294967296) >>> 0;
    h = mix32(Math.imul(h ^ mix32(lo), 0x01000193) ^ hi);
  }
  return h >>> 0;
}

// Stream tags, so different uses of the same (seed, tool, index) never share a stream.
export const TAG_RUN = 1;
export const TAG_VERSION = 2;
export const TAG_SCHEDULE = 3;
export const TAG_PATTERN = 4;
export const TAG_BOOTSTRAP = 5;

export class Rng {
  private a: number;
  private b: number;
  private c: number;
  private d: number;
  private spare = 0;
  private hasSpare = false;

  constructor(seed32: number) {
    this.a = mix32(seed32 ^ 0x9e3779b9);
    this.b = mix32(seed32 ^ 0x243f6a88);
    this.c = mix32(seed32 ^ 0xb7e15162);
    this.d = 1;
    for (let i = 0; i < 15; i++) this.nextU32();
  }

  nextU32(): number {
    const t = (((this.a + this.b) | 0) + this.d) | 0;
    this.d = (this.d + 1) | 0;
    this.a = this.b ^ (this.b >>> 9);
    this.b = (this.c + (this.c << 3)) | 0;
    this.c = (this.c << 21) | (this.c >>> 11);
    this.c = (this.c + t) | 0;
    return t >>> 0;
  }

  /** Uniform on the open interval (0, 1). */
  uniform(): number {
    return (this.nextU32() + 0.5) / 4294967296;
  }

  /** Integer uniform on [lo, hi], inclusive. */
  int(lo: number, hi: number): number {
    return lo + Math.floor(this.uniform() * (hi - lo + 1));
  }

  /** Standard normal (Box-Muller, caching the second value). */
  normal(): number {
    if (this.hasSpare) {
      this.hasSpare = false;
      return this.spare;
    }
    const r = Math.sqrt(-2 * Math.log(this.uniform()));
    const th = 2 * Math.PI * this.uniform();
    this.spare = r * Math.sin(th);
    this.hasSpare = true;
    return r * Math.cos(th);
  }
}
