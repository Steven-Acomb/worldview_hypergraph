/**
 * Hypergraph -> drawable graph.  Statements become boxes, arguments become
 * small diamond nodes, and each argument contributes edges
 * premise -> argument -> conclusion.  Layout positions come from dagre.
 *
 * `buildModel` is pure (testable without a DOM); `layoutModel` calls dagre.
 */

import dagre from "@dagrejs/dagre";
import type { Graph, WorldviewDocument } from "worldview-core";
import { wrapText } from "../ui.js";

export type NodeKind = "statement" | "argument";

export interface ModelNode {
  key: string; // "s:<id>" or "a:<id>"
  kind: NodeKind;
  id: string;
  lines: string[];
  width: number;
  height: number;
}

export interface ModelEdge {
  from: string;
  to: string;
}

export interface GraphModel {
  nodes: ModelNode[];
  edges: ModelEdge[];
  /** statements omitted because of focus mode */
  hiddenStatements: number;
}

export interface FocusOptions {
  id: string;
  mode: "up" | "down" | "both";
  /** argument hops; Infinity for the whole closure */
  depth: number;
}

export interface ModelOptions {
  focus?: FocusOptions | null;
  graph?: Graph | null;
  showIds?: boolean;
  wrapWidth?: number;
  maxLines?: number;
}

export const CHAR_W = 6.6;
export const LINE_H = 15;
export const PAD_X = 12;
export const PAD_Y = 8;
export const ARG_SIZE = 26;

export function statementKey(id: string): string {
  return `s:${id}`;
}

export function argumentKey(id: string): string {
  return `a:${id}`;
}

export function buildModel(doc: WorldviewDocument, opts: ModelOptions = {}): GraphModel {
  const showIds = opts.showIds ?? true;
  const wrapWidth = opts.wrapWidth ?? 30;
  const maxLines = opts.maxLines ?? 4;
  const statementIds = new Set(doc.statements.map((s) => s.id));

  let visible: Set<string> | null = null;
  if (opts.focus && opts.graph && statementIds.has(opts.focus.id)) {
    visible = focusSet(opts.graph, opts.focus);
  }

  const nodes: ModelNode[] = [];
  for (const s of doc.statements) {
    if (visible && !visible.has(s.id)) continue;
    const lines = wrapText(s.text, wrapWidth, maxLines);
    const labelLines = showIds ? [s.id, ...lines] : lines;
    const longest = Math.max(...labelLines.map((l) => l.length), 4);
    nodes.push({
      key: statementKey(s.id),
      kind: "statement",
      id: s.id,
      lines: labelLines,
      width: Math.round(longest * CHAR_W + PAD_X * 2),
      height: Math.round(labelLines.length * LINE_H + PAD_Y * 2),
    });
  }
  const edges: ModelEdge[] = [];
  for (const a of doc.arguments) {
    const premises = a.premises.filter((p) => statementIds.has(p) && (!visible || visible.has(p)));
    const conclusions = a.conclusions.filter((c) => statementIds.has(c) && (!visible || visible.has(c)));
    if (!conclusions.length) continue;
    if (visible && a.premises.length && !premises.length) continue; // dangles entirely outside the focus
    const label = a.rule ? [a.id, a.rule] : [a.id];
    nodes.push({
      key: argumentKey(a.id),
      kind: "argument",
      id: a.id,
      lines: showIds ? label : a.rule ? [a.rule] : [],
      width: ARG_SIZE,
      height: ARG_SIZE,
    });
    for (const p of premises) edges.push({ from: statementKey(p), to: argumentKey(a.id) });
    for (const c of conclusions) edges.push({ from: argumentKey(a.id), to: statementKey(c) });
  }
  return { nodes, edges, hiddenStatements: visible ? doc.statements.length - visible.size : 0 };
}

/** Statements within `depth` argument hops of the focus statement, in the chosen direction(s). */
export function focusSet(graph: Graph, focus: FocusOptions): Set<string> {
  const out = new Set<string>([focus.id]);
  const dirs: Array<"up" | "down"> = focus.mode === "both" ? ["up", "down"] : [focus.mode];
  for (const dir of dirs) {
    let frontier = new Set<string>([focus.id]);
    let d = 0;
    while (frontier.size && d < focus.depth) {
      const next = new Set<string>();
      for (const s of frontier) {
        const adj = dir === "up" ? graph.predOf(s) : graph.succOf(s);
        for (const t of adj) {
          if (!out.has(t)) {
            out.add(t);
            next.add(t);
          }
        }
      }
      frontier = next;
      d++;
    }
  }
  return out;
}

export interface LaidOutNode extends ModelNode {
  x: number; // centre
  y: number;
}

export interface LaidOutEdge extends ModelEdge {
  points: Array<{ x: number; y: number }>;
}

export interface Layout {
  nodes: LaidOutNode[];
  edges: LaidOutEdge[];
  width: number;
  height: number;
}

export function layoutModel(model: GraphModel, rankdir: "LR" | "TB" = "LR"): Layout {
  const g = new dagre.graphlib.Graph({ multigraph: true });
  g.setGraph({ rankdir, nodesep: 18, ranksep: rankdir === "LR" ? 48 : 36, marginx: 24, marginy: 24 });
  g.setDefaultEdgeLabel(() => ({}));
  for (const n of model.nodes) g.setNode(n.key, { width: n.width, height: n.height });
  model.edges.forEach((e, i) => g.setEdge(e.from, e.to, {}, `e${i}`));
  dagre.layout(g);
  const nodes: LaidOutNode[] = model.nodes.map((n) => {
    const pos = g.node(n.key) as { x: number; y: number };
    return { ...n, x: pos.x, y: pos.y };
  });
  const edges: LaidOutEdge[] = model.edges.map((e, i) => {
    const info = g.edge(e.from, e.to, `e${i}`) as { points?: Array<{ x: number; y: number }> } | undefined;
    return { ...e, points: info?.points ?? [] };
  });
  const graphInfo = g.graph() as { width?: number; height?: number };
  return { nodes, edges, width: graphInfo.width ?? 0, height: graphInfo.height ?? 0 };
}
