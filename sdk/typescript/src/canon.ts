/**
 * Canonicalization and hashing primitives.
 *
 * These are the rules that decide when two pieces of text "say the same
 * thing" for identity purposes.  They are deliberately literal:
 *
 * - Unicode NFC normalization.
 * - Leading and trailing whitespace stripped.
 * - Every internal run of whitespace collapsed to a single ASCII space.
 * - No case folding, no punctuation stripping, no stemming.
 *
 * The hash is SHA-256 over a delimiter-safe encoding of its parts (each
 * part is prefixed with its byte length, netstring-style), so that
 * `H(a, b)` can never collide with `H(ab)` or with a different split of
 * the same characters.
 *
 * This module is a line-for-line port of `canon.py` in the Python
 * reference implementation and produces identical output.
 */

import { Sha256 } from "./sha256.js";

/**
 * The exact set of code points treated as whitespace by {@link canon}.
 *
 * Spelled out (rather than relying on `\s`, whose meaning differs between
 * languages) so that every implementation agrees.  It equals Python's
 * `str.isspace` set: Unicode categories Zs, Zl, Zp plus the ASCII and
 * Latin-1 control characters with bidi class WS, B, or S.  U+FEFF (BOM /
 * zero-width no-break space) and U+200B (zero-width space) are
 * deliberately *not* whitespace.
 */
export const WHITESPACE: string =
  "\u0009\u000a\u000b\u000c\u000d\u0020" + // TAB LF VT FF CR SPACE
  "\u001c\u001d\u001e\u001f" + // file/group/record/unit separators
  "\u0085\u00a0" + // NEL, NO-BREAK SPACE
  "\u1680" + // OGHAM SPACE MARK
  "\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a" + // EN QUAD .. HAIR SPACE
  "\u2028\u2029" + // LINE SEPARATOR, PARAGRAPH SEPARATOR
  "\u202f\u205f\u3000"; // NARROW NBSP, MEDIUM MATHEMATICAL SPACE, IDEOGRAPHIC SPACE

const WS_CLASS =
  "[" +
  Array.from(WHITESPACE, (c) => "\\u" + (c.codePointAt(0) as number).toString(16).padStart(4, "0")).join("") +
  "]";
const WS_RUN = new RegExp(WS_CLASS + "+", "gu");
const WS_EDGES = new RegExp("^" + WS_CLASS + "+|" + WS_CLASS + "+$", "gu");
const WS_ANY = new RegExp(WS_CLASS, "u");

/**
 * Canonical form of a piece of natural-language text.
 *
 * 1. Unicode NFC normalization.
 * 2. Strip leading and trailing whitespace (see {@link WHITESPACE}).
 * 3. Collapse every internal run of whitespace to a single U+0020.
 */
export function canon(text: string): string {
  const nfc = text.normalize("NFC");
  return nfc.replace(WS_EDGES, "").replace(WS_RUN, " ");
}

/** True if the string contains at least one {@link WHITESPACE} code point. */
export function containsWhitespace(text: string): boolean {
  return WS_ANY.test(text);
}

/** One argument to {@link H}: a string, or a list of strings. */
export type HashPart = string | readonly string[];

const encoder = new TextEncoder();
const COMMA = new Uint8Array([0x2c]);

/**
 * SHA-256 hex digest of the parts, delimiter-safe.
 *
 * Each argument is either a string or a list of strings.  A list is
 * encoded as its element count followed by its elements, so lists of
 * different lengths can never be confused with one another or with their
 * neighbours.  Callers are responsible for sorting lists whose order is
 * not meaningful.
 *
 * Encoding, byte for byte: for each part in order, if it is a string `s`
 * feed `${utf8(s).length}:` + utf8(s) + `,`; if it is a list of `n`
 * strings feed the string `#${n}` the same way, then each element the
 * same way.
 */
export function H(...parts: HashPart[]): string {
  const h = new Sha256();
  for (const part of parts) {
    if (typeof part === "string") {
      feed(h, part);
    } else {
      feed(h, `#${part.length}`);
      for (const item of part) {
        feed(h, item);
      }
    }
  }
  return h.hexDigest();
}

function feed(h: Sha256, s: string): void {
  // TextEncoder silently replaces a lone surrogate with U+FFFD, so two
  // different malformed strings would hash identically.  Python refuses to
  // UTF-8 encode such a string at all; do the same, loudly.
  for (const ch of s) {
    const cp = ch.codePointAt(0) as number;
    if (cp >= 0xd800 && cp <= 0xdfff) {
      throw new RangeError(`H: text contains a lone surrogate U+${cp.toString(16).toUpperCase()} and cannot be UTF-8 encoded`);
    }
  }
  const b = encoder.encode(s);
  h.update(encoder.encode(`${b.length}:`));
  h.update(b);
  h.update(COMMA);
}
