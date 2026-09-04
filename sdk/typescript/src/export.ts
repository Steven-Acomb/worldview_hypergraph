/**
 * Export a worldview as a picture description: Graphviz DOT or Mermaid.
 *
 * Statements are boxes; arguments are small diamond nodes; edges run
 * premise -> argument -> conclusion.  Nothing evaluative is drawn.
 *
 * Port of `export.py`.  The text is identical to the Python reference
 * implementation's, including its `textwrap.wrap` label wrapping.
 */

import type { Worldview } from "./model.js";
import { wrap } from "./textwrap.js";

function wrapLabel(text: string, width: number): string[] {
  const lines = wrap(text, width);
  return lines.length > 0 ? lines : [""];
}

function dotEscape(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

/** Options of {@link toDot}. */
export interface DotOptions {
  /** Put local ids in the labels (default true). */
  ids?: boolean;
  /** Wrap statement text at this many characters (default 36). */
  wrap?: number;
  /** Graphviz `rankdir`: LR, TB, RL, or BT (default "LR"). */
  rankdir?: string;
}

/**
 * Graphviz DOT source.  `ought` statements are drawn with a double border.
 *
 * Throws {@link RangeError} for `wrap <= 0` when there is a statement to wrap.
 */
export function toDot(wv: Worldview, options: DotOptions = {}): string {
  const ids = options.ids ?? true;
  const width = options.wrap ?? 36;
  const rankdir = options.rankdir ?? "LR";
  const sIndex = new Map(wv.statements.map((s, i) => [s.id, i] as const));
  const aIndex = new Map(wv.arguments.map((a, i) => [a.id, i] as const));
  const lines = [
    "digraph worldview {",
    `  rankdir=${rankdir};`,
    '  node [fontname="Helvetica", fontsize=10];',
    "  edge [arrowsize=0.7];",
  ];
  if (wv.name) lines.push(`  label="${dotEscape(wv.name)}"; labelloc=t;`);
  for (const s of wv.statements) {
    const parts = [...(ids ? [s.id] : []), ...wrapLabel(s.text, width)];
    const label = parts.map(dotEscape).join("\\n");
    const extra = s.mode === "ought" ? ", peripheries=2" : "";
    lines.push(`  s${sIndex.get(s.id)} [shape=box, style=rounded, label="${label}"${extra}];`);
  }
  for (const a of wv.arguments) {
    const parts = [...(ids ? [a.id] : []), ...(a.rule ? [a.rule] : [])];
    const label = parts.map(dotEscape).join("\\n");
    lines.push(`  a${aIndex.get(a.id)} [shape=diamond, fontsize=8, label="${label}"];`);
  }
  for (const a of wv.arguments) {
    const ai = aIndex.get(a.id);
    for (const p of a.premises) lines.push(`  s${sIndex.get(p)} -> a${ai};`);
    for (const c of a.conclusions) lines.push(`  a${ai} -> s${sIndex.get(c)};`);
  }
  lines.push("}");
  return lines.join("\n") + "\n";
}

function mermaidEscape(s: string): string {
  return s.replace(/"/g, "#quot;");
}

/** Options of {@link toMermaid}. */
export interface MermaidOptions {
  /** Put local ids in the labels (default true). */
  ids?: boolean;
  /** Wrap statement text at this many characters (default 36). */
  wrap?: number;
  /** Flowchart direction: LR, TB, RL, or BT (default "LR"). */
  direction?: string;
}

/**
 * Mermaid `flowchart` source.  `ought` statements get the class `ought`.
 *
 * Throws {@link RangeError} for `wrap <= 0` when there is a statement to wrap.
 */
export function toMermaid(wv: Worldview, options: MermaidOptions = {}): string {
  const ids = options.ids ?? true;
  const width = options.wrap ?? 36;
  const direction = options.direction ?? "LR";
  const sIndex = new Map(wv.statements.map((s, i) => [s.id, i] as const));
  const aIndex = new Map(wv.arguments.map((a, i) => [a.id, i] as const));
  const lines = [`flowchart ${direction}`];
  const oughts: string[] = [];
  for (const s of wv.statements) {
    const parts = [...(ids ? [s.id] : []), ...wrapLabel(s.text, width)];
    const label = parts.map(mermaidEscape).join("<br/>");
    lines.push(`  s${sIndex.get(s.id)}["${label}"]`);
    if (s.mode === "ought") oughts.push(`s${sIndex.get(s.id)}`);
  }
  for (const a of wv.arguments) {
    const parts = [...(ids ? [a.id] : []), ...(a.rule ? [a.rule] : [])];
    const label = parts.map(mermaidEscape).join("<br/>") || " ";
    lines.push(`  a${aIndex.get(a.id)}{{"${label}"}}`);
  }
  for (const a of wv.arguments) {
    const ai = aIndex.get(a.id);
    for (const p of a.premises) lines.push(`  s${sIndex.get(p)} --> a${ai}`);
    for (const c of a.conclusions) lines.push(`  a${ai} --> s${sIndex.get(c)}`);
  }
  lines.push("  classDef ought stroke-width:3px,stroke-dasharray:4 2;");
  if (oughts.length > 0) lines.push(`  class ${oughts.join(",")} ought;`);
  return lines.join("\n") + "\n";
}
