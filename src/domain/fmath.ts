/**
 * Pure-JavaScript exp and log (ports of fdlibm e_exp.c and e_log.c).
 * JavaScript arithmetic is correctly rounded on every platform, but the engine's native
 * Math.exp/Math.log are compiled C++ and can differ in the last bit between arm64 and x64.
 * The simulator uses these so a seed gives byte-identical frames on any machine.
 */

const f64 = new Float64Array(1);
const u32 = new Uint32Array(f64.buffer); // little-endian: u32[0] low word, u32[1] high word

const LN2_HI = 6.93147180369123816490e-1;
const LN2_LO = 1.90821492927058770002e-10;
const TWO54 = 1.8014398509481984e16;
const LG1 = 6.666666666666735130e-1;
const LG2 = 3.999999999940941908e-1;
const LG3 = 2.857142874366239149e-1;
const LG4 = 2.222219843214978396e-1;
const LG5 = 1.818357216161805012e-1;
const LG6 = 1.531383769920937332e-1;
const LG7 = 1.479819860511658591e-1;

export function flog(xIn: number): number {
  let x = xIn;
  f64[0] = x;
  let hx = u32[1] | 0;
  const lx = u32[0];
  let k = 0;
  if (hx < 0x00100000) {
    if (((hx & 0x7fffffff) | lx) === 0) return -Infinity;
    if (hx < 0) return NaN;
    k -= 54;
    x *= TWO54;
    f64[0] = x;
    hx = u32[1] | 0;
  }
  if (hx >= 0x7ff00000) return x + x;
  k += (hx >> 20) - 1023;
  hx &= 0x000fffff;
  let i = (hx + 0x95f64) & 0x100000;
  f64[0] = x;
  u32[1] = hx | (i ^ 0x3ff00000);
  x = f64[0];
  k += i >> 20;
  const f = x - 1.0;
  if ((0x000fffff & (2 + hx)) < 3) {
    if (f === 0) {
      if (k === 0) return 0;
      return k * LN2_HI + k * LN2_LO;
    }
    const R = f * f * (0.5 - 0.33333333333333333 * f);
    if (k === 0) return f - R;
    return k * LN2_HI - (R - k * LN2_LO - f);
  }
  const s = f / (2.0 + f);
  const dk = k;
  const z = s * s;
  i = hx - 0x6147a;
  const w = z * z;
  const j = 0x6b851 - hx;
  const t1 = w * (LG2 + w * (LG4 + w * LG6));
  const t2 = z * (LG1 + w * (LG3 + w * (LG5 + w * LG7)));
  i |= j;
  const R = t2 + t1;
  if (i > 0) {
    const hfsq = 0.5 * f * f;
    if (k === 0) return f - (hfsq - s * (hfsq + R));
    return dk * LN2_HI - (hfsq - (s * (hfsq + R) + dk * LN2_LO) - f);
  }
  if (k === 0) return f - s * (f - R);
  return dk * LN2_HI - (s * (f - R) - dk * LN2_LO - f);
}

const O_THRESHOLD = 7.09782712893383973096e2;
const U_THRESHOLD = -7.45133219101941108420e2;
const INV_LN2 = 1.44269504088896338700;
const P1 = 1.66666666666666019037e-1;
const P2 = -2.77777777770155933842e-3;
const P3 = 6.61375632143793436117e-5;
const P4 = -1.65339022054652515390e-6;
const P5 = 4.13813679705723846039e-8;
const TWOM1000 = 9.33263618503218878990e-302;

export function fexp(xIn: number): number {
  let x = xIn;
  f64[0] = x;
  let hx = u32[1];
  const xsb = (hx >>> 31) & 1;
  hx &= 0x7fffffff;
  if (hx >= 0x40862e42) {
    if (hx >= 0x7ff00000) {
      if (((hx & 0xfffff) | u32[0]) !== 0) return x + x;
      return xsb === 0 ? x : 0.0;
    }
    if (x > O_THRESHOLD) return Infinity;
    if (x < U_THRESHOLD) return 0;
  }
  let hi = 0;
  let lo = 0;
  let k = 0;
  if (hx > 0x3fd62e42) {
    if (hx < 0x3ff0a2b2) {
      hi = xsb === 0 ? x - LN2_HI : x + LN2_HI;
      lo = xsb === 0 ? LN2_LO : -LN2_LO;
      k = 1 - xsb - xsb;
    } else {
      k = (INV_LN2 * x + (xsb === 0 ? 0.5 : -0.5)) | 0;
      const t = k;
      hi = x - t * LN2_HI;
      lo = t * LN2_LO;
    }
    x = hi - lo;
  } else if (hx < 0x3e300000) {
    return 1 + x;
  }
  const t = x * x;
  const c = x - t * (P1 + t * (P2 + t * (P3 + t * (P4 + t * P5))));
  if (k === 0) return 1 - ((x * c) / (c - 2.0) - x);
  let y = 1 - (lo - (x * c) / (2.0 - c) - hi);
  if (k >= -1021) {
    f64[0] = y;
    u32[1] = (u32[1] + (k << 20)) >>> 0;
    return f64[0];
  }
  f64[0] = y;
  u32[1] = (u32[1] + ((k + 1000) << 20)) >>> 0;
  y = f64[0];
  return y * TWOM1000;
}
