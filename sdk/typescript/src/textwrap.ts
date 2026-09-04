/**
 * A faithful port of Python's `textwrap.wrap(text, width)` with its default
 * options, because the export module's labels must match the reference
 * implementation character for character.
 *
 * Python's defaults, all reproduced here:
 *
 * - `expand_tabs`: tabs become spaces to the next multiple of 8 columns
 *   (the column resets after `\n` and `\r`).
 * - `replace_whitespace`: each of the six ASCII whitespace characters
 *   becomes a single space.
 * - Chunks are split by `TextWrapper.wordsep_re`: runs of ASCII
 *   whitespace, em-dashes between words, and words that may be broken
 *   after a hyphen (`break_on_hyphens`).
 * - Greedy filling; `drop_whitespace` drops whitespace chunks at the
 *   start and end of a line (Python's `str.strip()`, so any Unicode
 *   whitespace counts there); `break_long_words` splits a chunk longer
 *   than the width, preferably after its last hyphen.
 * - Lengths and slices are in code points, as Python's `len()` and
 *   slicing count them.
 */

import { WHITESPACE } from "./canon.js";

/** Python's `string.whitespace`: what `wordsep_re` splits on. */
const ASCII_WS = " \t\n\u000b\u000c\r";

/** Code points for which Python's `str.isspace()` is true (the same set `canon` uses). */
const PY_SPACE = new Set<string>(Array.from(WHITESPACE));

const WS = "[ \\t\\n\\u000b\\u000c\\r]";
const NWS = "[^ \\t\\n\\u000b\\u000c\\r]";
/** Python's `\w` for str patterns: `str.isalnum()` or underscore. */
const WORD = "[\\p{L}\\p{N}_]";
/** `word_punct = [\w!"'&.,?]` */
const WP = "[\\p{L}\\p{N}_!\"'&.,?]";
/** `letter = [^\d\W]`: a word character that is not a decimal digit. */
const LT = "[\\p{L}\\p{Nl}\\p{No}_]";

/**
 * `TextWrapper.wordsep_re`, with the verbose-mode whitespace removed and
 * `\Z` written as `$` (no multiline flag, so it is end of input).
 */
const WORDSEP = new RegExp(
  `(${WS}+` +
    `|(?<=${WP})-{2,}(?=${WORD})` +
    `|${NWS}+?(?:` +
    `-(?:(?<=${LT}{2}-)|(?<=${LT}-${LT}-))(?=${LT}-?${LT})` +
    `|(?=${WS}|$)` +
    `|(?<=${WP})(?=-{2,}${WORD})` +
    `))`,
  "gu",
);

/** Python's `str.expandtabs(8)`. */
function expandTabs(text: string, tabsize = 8): string {
  let out = "";
  let col = 0;
  for (const ch of text) {
    if (ch === "\t") {
      const incr = tabsize - (col % tabsize);
      out += " ".repeat(incr);
      col += incr;
    } else {
      out += ch;
      col = ch === "\n" || ch === "\r" ? 0 : col + 1;
    }
  }
  return out;
}

/** `TextWrapper._munge_whitespace`. */
function mungeWhitespace(text: string): string {
  let out = "";
  for (const ch of expandTabs(text)) out += ASCII_WS.includes(ch) ? " " : ch;
  return out;
}

/** `re.split(wordsep_re, text)` with the empty pieces removed (`TextWrapper._split`). */
function splitChunks(text: string): string[] {
  const chunks: string[] = [];
  let last = 0;
  WORDSEP.lastIndex = 0;
  for (;;) {
    const m = WORDSEP.exec(text);
    if (m === null) break;
    if (m.index > last) chunks.push(text.slice(last, m.index));
    if (m[0].length === 0) {
      // The pattern cannot match the empty string; this only guards against an endless loop.
      WORDSEP.lastIndex++;
      continue;
    }
    chunks.push(m[0]);
    last = m.index + m[0].length;
  }
  if (last < text.length) chunks.push(text.slice(last));
  return chunks;
}

/** `len()` in code points. */
function cpLen(s: string): number {
  let n = 0;
  for (const _ of s) n++;
  return n;
}

/** `chunk.strip() == ""` with Python's Unicode notion of whitespace. */
function isBlank(s: string): boolean {
  for (const ch of s) if (!PY_SPACE.has(ch)) return false;
  return true;
}

/** `TextWrapper._handle_long_word` for `break_long_words=True, break_on_hyphens=True`. */
function handleLongWord(reversedChunks: string[], curLine: string[], curLen: number, width: number): void {
  const spaceLeft = width < 1 ? 1 : width - curLen;
  if (spaceLeft > 0) {
    // Put as much of the next chunk onto the current line as will fit (Python 3.12+
    // does nothing when the line is already full).
    const chunk = Array.from(reversedChunks[reversedChunks.length - 1] as string);
    let end = spaceLeft;
    if (chunk.length > spaceLeft) {
      // Break after the last hyphen, but only if there are non-hyphens before it.
      const hyphen = chunk.slice(0, spaceLeft).lastIndexOf("-");
      if (hyphen > 0 && chunk.slice(0, hyphen).some((c) => c !== "-")) end = hyphen + 1;
    }
    curLine.push(chunk.slice(0, end).join(""));
    reversedChunks[reversedChunks.length - 1] = chunk.slice(end).join("");
  } else if (curLine.length === 0) {
    // Unreachable with a positive width, kept for fidelity with the reference.
    curLine.push(reversedChunks.pop() as string);
  }
}

/**
 * `textwrap.wrap(text, width=width)`: the wrapped lines, without a final
 * newline, or an empty array when the text has no non-whitespace.
 *
 * Throws {@link RangeError} for `width <= 0`, as Python raises `ValueError`.
 */
export function wrap(text: string, width: number): string[] {
  const chunks = splitChunks(mungeWhitespace(text));
  if (width <= 0) throw new RangeError(`invalid width ${width} (must be > 0)`);
  chunks.reverse();
  const lines: string[] = [];
  while (chunks.length > 0) {
    const curLine: string[] = [];
    let curLen = 0;
    // First chunk on line is whitespace: drop it, unless this is the very beginning of the text.
    if (lines.length > 0 && isBlank(chunks[chunks.length - 1] as string)) chunks.pop();
    while (chunks.length > 0) {
      const l = cpLen(chunks[chunks.length - 1] as string);
      if (curLen + l <= width) {
        curLine.push(chunks.pop() as string);
        curLen += l;
      } else {
        break;
      }
    }
    // The current line is full, and the next chunk is too big to fit on any line.
    if (chunks.length > 0 && cpLen(chunks[chunks.length - 1] as string) > width) {
      handleLongWord(chunks, curLine, curLen, width);
      curLen = curLine.reduce((n, c) => n + cpLen(c), 0);
    }
    // If the last chunk on this line is all whitespace, drop it.
    if (curLine.length > 0 && isBlank(curLine[curLine.length - 1] as string)) {
      curLen -= cpLen(curLine[curLine.length - 1] as string);
      curLine.pop();
    }
    if (curLine.length > 0) lines.push(curLine.join(""));
  }
  return lines;
}
