/**
 * Two small pieces of Python float behaviour that the reference
 * implementation's output depends on.
 *
 * - {@link pyRound}: Python's `round(x, ndigits)`, which rounds the *exact*
 *   binary value of the double to the nearest decimal with ties to even.
 *   `Math.round(x * 1000) / 1000` differs on exact ties: Python gives
 *   `round(0.0625, 3) == 0.062`, naive JS rounding gives `0.063`.
 * - {@link pyFloatRepr}: Python's `repr(float)` for the values that occur
 *   here (a rounded mean), which always shows a decimal point (`2.0`).
 */

const view = new DataView(new ArrayBuffer(8));

/**
 * Python's `round(x, ndigits)` for a finite double and `ndigits >= 0`:
 * correctly rounded decimal rounding of the exact binary value, ties to
 * even, then the nearest double to that decimal.
 */
export function pyRound(x: number, ndigits: number): number {
  if (!Number.isFinite(x) || x === 0) return x;
  view.setFloat64(0, x);
  const hi = view.getUint32(0);
  const lo = view.getUint32(4);
  const negative = hi >>> 31 === 1;
  const expBits = (hi >>> 20) & 0x7ff;
  let mant = (BigInt(hi & 0xfffff) << 32n) | BigInt(lo);
  let exp: number;
  if (expBits === 0) {
    exp = -1074; // subnormal
  } else {
    mant |= 1n << 52n;
    exp = expBits - 1075;
  }
  // |x| = mant * 2^exp exactly.  Scale by 10^ndigits and round the rational.
  const scale = 10n ** BigInt(ndigits);
  let num = mant * scale;
  let den = 1n;
  if (exp >= 0) num <<= BigInt(exp);
  else den <<= BigInt(-exp);
  let q = num / den;
  const twice = 2n * (num - q * den);
  if (twice > den || (twice === den && (q & 1n) === 1n)) q += 1n;
  // Python converts the rounded decimal string back with strtod (nearest
  // double); a correctly rounded IEEE division of two exact integers is
  // the same value.
  const result = Number(q) / Number(scale);
  return negative ? -result : result;
}

/**
 * Python's `repr()` of a float small enough to print in fixed notation:
 * the shortest round-trip digits, always with a decimal point.
 */
export function pyFloatRepr(x: number): string {
  if (Number.isInteger(x) && Math.abs(x) < 1e16) return `${x}.0`;
  return String(x);
}
