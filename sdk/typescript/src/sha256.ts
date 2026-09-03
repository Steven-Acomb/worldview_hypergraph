/**
 * SHA-256 in pure TypeScript.
 *
 * Synchronous and dependency-free, with no Node-only APIs, so the library
 * behaves identically in Node and in browsers.  The implementation follows
 * FIPS 180-4 directly; the test suite checks it against the standard test
 * vectors and against `node:crypto` on random inputs.
 */

const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

const INITIAL_STATE = new Uint32Array([
  0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
]);

const HEX = Array.from({ length: 256 }, (_, i) => i.toString(16).padStart(2, "0"));

const encoder = new TextEncoder();

/** Incremental SHA-256 hasher: `update()` any number of times, then `digest()` once. */
export class Sha256 {
  private readonly state = new Uint32Array(INITIAL_STATE);
  private readonly block = new Uint8Array(64);
  private readonly w = new Uint32Array(64);
  private blockLen = 0;
  private byteCount = 0;
  private finished = false;

  /** Absorb more input.  Returns `this` for chaining. */
  update(data: Uint8Array): this {
    if (this.finished) {
      throw new Error("Sha256: update() after digest()");
    }
    const n = data.length;
    this.byteCount += n;
    let offset = 0;
    if (this.blockLen > 0) {
      const take = Math.min(64 - this.blockLen, n);
      this.block.set(data.subarray(0, take), this.blockLen);
      this.blockLen += take;
      offset = take;
      if (this.blockLen === 64) {
        this.compress(this.block, 0);
        this.blockLen = 0;
      }
    }
    while (offset + 64 <= n) {
      this.compress(data, offset);
      offset += 64;
    }
    if (offset < n) {
      this.block.set(data.subarray(offset), 0);
      this.blockLen = n - offset;
    }
    return this;
  }

  /** Finish and return the 32-byte digest.  The hasher cannot be reused afterwards. */
  digest(): Uint8Array {
    if (this.finished) {
      throw new Error("Sha256: digest() called twice");
    }
    this.finished = true;
    const bitLength = this.byteCount * 8; // exact for inputs below 2^50 bytes
    const block = this.block;
    block[this.blockLen++] = 0x80;
    if (this.blockLen > 56) {
      block.fill(0, this.blockLen);
      this.compress(block, 0);
      this.blockLen = 0;
    }
    block.fill(0, this.blockLen, 56);
    const hi = Math.floor(bitLength / 0x1_0000_0000);
    const lo = bitLength >>> 0;
    block[56] = (hi >>> 24) & 0xff;
    block[57] = (hi >>> 16) & 0xff;
    block[58] = (hi >>> 8) & 0xff;
    block[59] = hi & 0xff;
    block[60] = (lo >>> 24) & 0xff;
    block[61] = (lo >>> 16) & 0xff;
    block[62] = (lo >>> 8) & 0xff;
    block[63] = lo & 0xff;
    this.compress(block, 0);

    const out = new Uint8Array(32);
    for (let i = 0; i < 8; i++) {
      const v = this.state[i];
      out[i * 4] = (v >>> 24) & 0xff;
      out[i * 4 + 1] = (v >>> 16) & 0xff;
      out[i * 4 + 2] = (v >>> 8) & 0xff;
      out[i * 4 + 3] = v & 0xff;
    }
    return out;
  }

  /** Finish and return the digest as 64 lowercase hex characters. */
  hexDigest(): string {
    return toHex(this.digest());
  }

  private compress(data: Uint8Array, offset: number): void {
    const w = this.w;
    let o = offset;
    for (let i = 0; i < 16; i++) {
      w[i] = ((data[o] << 24) | (data[o + 1] << 16) | (data[o + 2] << 8) | data[o + 3]) >>> 0;
      o += 4;
    }
    for (let i = 16; i < 64; i++) {
      const x = w[i - 15];
      const y = w[i - 2];
      const s0 = ((x >>> 7) | (x << 25)) ^ ((x >>> 18) | (x << 14)) ^ (x >>> 3);
      const s1 = ((y >>> 17) | (y << 15)) ^ ((y >>> 19) | (y << 13)) ^ (y >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }

    const st = this.state;
    let a = st[0];
    let b = st[1];
    let c = st[2];
    let d = st[3];
    let e = st[4];
    let f = st[5];
    let g = st[6];
    let h = st[7];

    for (let i = 0; i < 64; i++) {
      const S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
      const ch = (e & f) ^ (~e & g);
      const t1 = (h + S1 + ch + K[i] + w[i]) >>> 0;
      const S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + maj) >>> 0;
      h = g;
      g = f;
      f = e;
      e = (d + t1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (t1 + t2) >>> 0;
    }

    st[0] = (st[0] + a) >>> 0;
    st[1] = (st[1] + b) >>> 0;
    st[2] = (st[2] + c) >>> 0;
    st[3] = (st[3] + d) >>> 0;
    st[4] = (st[4] + e) >>> 0;
    st[5] = (st[5] + f) >>> 0;
    st[6] = (st[6] + g) >>> 0;
    st[7] = (st[7] + h) >>> 0;
  }
}

/** Lowercase hex encoding of a byte array. */
export function toHex(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i++) {
    s += HEX[bytes[i]];
  }
  return s;
}

function toBytes(data: Uint8Array | string): Uint8Array {
  return typeof data === "string" ? encoder.encode(data) : data;
}

/** One-shot SHA-256.  A string is hashed as its UTF-8 encoding. */
export function sha256(data: Uint8Array | string): Uint8Array {
  return new Sha256().update(toBytes(data)).digest();
}

/** One-shot SHA-256 as 64 lowercase hex characters.  A string is hashed as its UTF-8 encoding. */
export function sha256Hex(data: Uint8Array | string): string {
  return new Sha256().update(toBytes(data)).hexDigest();
}
