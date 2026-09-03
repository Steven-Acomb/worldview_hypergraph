/**
 * The pure-TypeScript SHA-256 against the FIPS 180-4 test vectors and
 * against node:crypto on random inputs (including multi-byte UTF-8 and
 * every length around the 64-byte block boundary).
 */

import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";

import { Sha256, sha256, sha256Hex, toHex } from "../src/index.js";

const encoder = new TextEncoder();

function reference(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/** Small deterministic PRNG so failures are reproducible. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randomBytes(rng: () => number, n: number): Uint8Array {
  const out = new Uint8Array(n);
  for (let i = 0; i < n; i++) out[i] = Math.floor(rng() * 256);
  return out;
}

/** A random string mixing 1-, 2-, 3-, and 4-byte UTF-8 sequences (no lone surrogates). */
function randomUnicode(rng: () => number, n: number): string {
  const ranges: Array<[number, number]> = [
    [0x20, 0x7e],
    [0xa0, 0x7ff],
    [0x800, 0xd7ff],
    [0xe000, 0xffff],
    [0x10000, 0x10ffff],
  ];
  let s = "";
  for (let i = 0; i < n; i++) {
    const [lo, hi] = ranges[Math.floor(rng() * ranges.length)] as [number, number];
    s += String.fromCodePoint(lo + Math.floor(rng() * (hi - lo + 1)));
  }
  return s;
}

describe("sha256", () => {
  it("matches the standard test vectors", () => {
    expect(sha256Hex("")).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
    expect(sha256Hex("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    // 448-bit message: exactly fills one block after padding spills into a second
    expect(sha256Hex("abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq")).toBe(
      "248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1",
    );
    // 896-bit message: two full blocks
    expect(
      sha256Hex(
        "abcdefghbcdefghicdefghijdefghijkefghijklfghijklmghijklmnhijklmnoijklmnopjklmnopqklmnopqrlmnopqrsmnopqrstnopqrstu",
      ),
    ).toBe("cf5b16a778af8380036ce59e7b0492370b249b11e8f07a51afac45037afee9d1");
  });

  it("hashes one million 'a' (many blocks, incremental)", () => {
    const h = new Sha256();
    const chunk = new Uint8Array(1000).fill(0x61);
    for (let i = 0; i < 1000; i++) h.update(chunk);
    expect(h.hexDigest()).toBe("cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0");
  });

  it("returns raw bytes from sha256() consistent with the hex form", () => {
    const bytes = sha256("abc");
    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(bytes.length).toBe(32);
    expect(toHex(bytes)).toBe(sha256Hex("abc"));
  });

  it("agrees with node:crypto on every length from 0 to 200 bytes", () => {
    const rng = mulberry32(1);
    for (let n = 0; n <= 200; n++) {
      const data = randomBytes(rng, n);
      expect(sha256Hex(data), `length ${n}`).toBe(reference(data));
    }
  });

  it("agrees with node:crypto on 300 random byte strings", () => {
    const rng = mulberry32(2);
    for (let i = 0; i < 300; i++) {
      const data = randomBytes(rng, Math.floor(rng() * 600));
      expect(sha256Hex(data), `iteration ${i}`).toBe(reference(data));
    }
  });

  it("agrees with node:crypto on 300 random multi-byte UTF-8 strings", () => {
    const rng = mulberry32(3);
    for (let i = 0; i < 300; i++) {
      const s = randomUnicode(rng, Math.floor(rng() * 80));
      const bytes = encoder.encode(s);
      expect(sha256Hex(s), `iteration ${i}: ${JSON.stringify(s)}`).toBe(reference(bytes));
      expect(sha256Hex(bytes)).toBe(reference(bytes));
    }
  });

  it("gives the same digest regardless of how the input is chunked", () => {
    const rng = mulberry32(4);
    for (let i = 0; i < 200; i++) {
      const data = randomBytes(rng, Math.floor(rng() * 400));
      const h = new Sha256();
      let offset = 0;
      while (offset < data.length) {
        const take = Math.min(data.length - offset, Math.floor(rng() * 70));
        h.update(data.subarray(offset, offset + take));
        offset += take;
      }
      expect(h.hexDigest(), `iteration ${i}`).toBe(reference(data));
    }
  });

  it("refuses to be reused after digest()", () => {
    const h = new Sha256().update(new Uint8Array([1, 2, 3]));
    h.digest();
    expect(() => h.digest()).toThrow();
    expect(() => h.update(new Uint8Array([4]))).toThrow();
  });
});
