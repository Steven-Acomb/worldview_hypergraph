/**
 * SVG rendering of the hypergraph with pan/zoom, selection highlighting,
 * focus mode controls, and memoised layout.  The layout is recomputed only
 * when the document version, focus, showIds, or rankdir changes; selection
 * changes just re-tint the existing elements.
 */

import type { Actions, Ctx, FocusMode, View } from "../context.js";
import { MAX_DEPTH } from "../context.js";
import { h, plural, svg } from "../ui.js";
import { ARG_SIZE, LINE_H, PAD_Y, argumentKey, buildModel, layoutModel, statementKey } from "./layout.js";
import type { LaidOutEdge, LaidOutNode, Layout } from "./layout.js";

type NodeState = "" | "selected" | "up" | "down" | "both" | "dim";
type EdgeState = "" | "sel" | "up" | "down" | "both" | "dim";

const MIN_ZOOM = 0.04;
const MAX_ZOOM = 4;
const CLICK_SLOP = 4;
/** graphs with at least this many nodes are not re-laid out while typing */
const DEFER_NODES = 300;

export class GraphView implements View {
  readonly el: HTMLElement;
  private readonly svgEl: SVGSVGElement;
  private readonly viewport: SVGGElement;
  private readonly edgeLayer: SVGGElement;
  private readonly nodeLayer: SVGGElement;
  private readonly hiddenLabel = h("span", { class: "muted small" });
  private readonly modeSel: HTMLSelectElement;
  private readonly depthRange: HTMLInputElement;
  private readonly depthAll: HTMLInputElement;
  private readonly depthLabel = h("span", { class: "mono small" });
  private readonly focusName = h("span", { class: "mono small focus-name" });
  private readonly emptyMsg = h("div", { class: "graph-empty", hidden: true });

  private layout: Layout | null = null;
  private layoutKey = "";
  private focusKey = "";
  private rankdir = "";
  private nodeEls = new Map<string, SVGGElement>();
  private edgeEls: Array<{ el: SVGPathElement; edge: LaidOutEdge }> = [];
  private nodeByKey = new Map<string, LaidOutNode>();
  private tx = 0;
  private ty = 0;
  private k = 1;
  private fitPending = true;
  private ctx: Ctx | null = null;
  private highlightKey = "";
  /** true when a relayout was skipped because the user was typing (large graphs only) */
  stale = false;

  constructor(private readonly actions: Actions) {
    const marker = (id: string, cls: string): SVGMarkerElement =>
      svg(
        "marker",
        { id, viewBox: "0 0 10 10", refX: "9", refY: "5", markerWidth: "7", markerHeight: "7", orient: "auto-start-reverse", markerUnits: "strokeWidth" },
        svg("path", { d: "M 0 0 L 10 5 L 0 10 z", class: `arrow ${cls}` }),
      );
    this.edgeLayer = svg("g", { class: "edges" });
    this.nodeLayer = svg("g", { class: "nodes" });
    this.viewport = svg("g", { class: "viewport" }, this.edgeLayer, this.nodeLayer);
    this.svgEl = svg(
      "svg",
      { class: "graph-svg", role: "img", "aria-label": "Hypergraph of statements and arguments" },
      svg("defs", null, marker("arrow", ""), marker("arrow-sel", "sel"), marker("arrow-up", "up"), marker("arrow-down", "down"), marker("arrow-both", "both"), marker("arrow-dim", "dim")),
      svg("rect", { class: "graph-bg", width: "100%", height: "100%" }),
      this.viewport,
    );

    this.modeSel = h(
      "select",
      { class: "select small", title: "Focus mode: show only the neighbourhood of the focused statement", "aria-label": "Focus mode", onchange: () => actions.setFocus({ focusMode: this.modeSel.value as FocusMode }) },
      h("option", { value: "off" }, "Focus: off"),
      h("option", { value: "up" }, "Focus: rests on"),
      h("option", { value: "down" }, "Focus: supports"),
      h("option", { value: "both" }, "Focus: both"),
    );
    this.depthRange = h("input", {
      type: "range",
      min: "1",
      max: String(MAX_DEPTH),
      step: "1",
      class: "range",
      title: "Focus depth in argument hops",
      oninput: () => {
        this.depthAll.checked = false;
        actions.setFocus({ focusDepth: Number(this.depthRange.value) });
      },
    });
    this.depthAll = h("input", {
      type: "checkbox",
      onchange: () => actions.setFocus({ focusDepth: this.depthAll.checked ? Infinity : Number(this.depthRange.value) }),
    });

    const controls = h(
      "div",
      { class: "graph-controls" },
      this.modeSel,
      h("label", { class: "range-label", title: "Focus depth in argument hops" }, "depth", this.depthRange, this.depthLabel),
      h("label", { class: "check", title: "Whole closure, no depth limit" }, this.depthAll, "all"),
      this.focusName,
      this.hiddenLabel,
      h("span", { class: "spacer" }),
      h("button", { class: "btn small", title: "Zoom out", "aria-label": "Zoom out", onclick: () => this.zoomBy(1 / 1.3) }, "−"),
      h("button", { class: "btn small", title: "Zoom in", "aria-label": "Zoom in", onclick: () => this.zoomBy(1.3) }, "+"),
      h("button", { class: "btn small", title: "Fit the whole graph in view (F)", onclick: () => this.fit() }, "Fit"),
    );
    this.el = h("section", { class: "canvas" }, controls, h("div", { class: "graph-wrap" }, this.svgEl, this.emptyMsg));
    this.bindPanZoom();
  }

  // ------------------------------------------------------------ rendering

  update(ctx: Ctx): void {
    this.ctx = ctx;
    const { store, derived, ui } = ctx;
    const focus = this.effectiveFocus(ctx);
    const focusKey = focus ? `${focus.mode}:${focus.depth}:${focus.id}` : "off";
    const key = `${store.version}|${focusKey}|${ui.showIds}|${ui.rankdir}`;

    this.modeSel.value = ui.focusMode;
    this.depthRange.value = String(ui.focusDepth === Infinity ? MAX_DEPTH : ui.focusDepth);
    this.depthAll.checked = ui.focusDepth === Infinity;
    this.depthLabel.textContent = ui.focusDepth === Infinity ? "∞" : String(ui.focusDepth);
    this.focusName.textContent = ui.focusMode !== "off" ? (focus ? `on ${focus.id}` : "(select a statement)") : "";

    if (key !== this.layoutKey && this.shouldDefer(key)) {
      this.stale = true;
    } else if (key !== this.layoutKey) {
      this.stale = false;
      const model = buildModel(store.doc, { focus, graph: derived.graph, showIds: ui.showIds });
      this.layout = layoutModel(model, ui.rankdir);
      const refit = this.fitPending || focusKey !== this.focusKey || ui.rankdir !== this.rankdir;
      this.layoutKey = key;
      this.focusKey = focusKey;
      this.rankdir = ui.rankdir;
      this.hiddenLabel.textContent = model.hiddenStatements ? `${plural(model.hiddenStatements, "statement")} hidden` : "";
      this.renderLayout(this.layout, ctx);
      this.emptyMsg.hidden = store.doc.statements.length > 0;
      this.emptyMsg.textContent = "No statements yet. Add one from the Statements tab, open a file, or load an example.";
      if (refit) this.fit();
      this.fitPending = false;
      this.highlightKey = "";
    }
    // Re-tint only when something the tint depends on changed; a re-render for
    // a tab switch or a panel toggle leaves the SVG alone.
    const sel = store.selection;
    const highlightKey = `${store.version}|${sel ? `${sel.kind}:${sel.id}` : ""}|${ui.lintOverlay}`;
    if (highlightKey !== this.highlightKey) {
      this.highlightKey = highlightKey;
      this.applyHighlight(ctx);
    }
  }

  /**
   * Relayout of a large graph takes hundreds of milliseconds; while the user
   * is typing into a field, and only the document version changed, wait
   * until the field is left (the App re-renders on focusout).
   */
  private shouldDefer(key: string): boolean {
    if (!this.layout || this.layout.nodes.length < DEFER_NODES) return false;
    const a = document.activeElement;
    const typing = !!a && (a.tagName === "TEXTAREA" || (a.tagName === "INPUT" && (a as HTMLInputElement).type === "text"));
    if (!typing) return false;
    return key.slice(key.indexOf("|")) === this.layoutKey.slice(this.layoutKey.indexOf("|"));
  }

  /** The focus to use: the ui's focus, resolved to a statement that exists. */
  private effectiveFocus(ctx: Ctx): { id: string; mode: "up" | "down" | "both"; depth: number } | null {
    const { ui, store } = ctx;
    if (ui.focusMode === "off" || !ctx.derived.graph) return null;
    let id = ui.focusId;
    if (!id || !store.doc.statements.some((s) => s.id === id)) {
      id = store.doc.statements[0]?.id ?? null;
    }
    if (!id) return null;
    return { id, mode: ui.focusMode, depth: ui.focusDepth };
  }

  private renderLayout(layout: Layout, ctx: Ctx): void {
    this.nodeEls = new Map();
    this.nodeByKey = new Map();
    this.edgeEls = [];
    const nodeFrag = document.createDocumentFragment();
    for (const n of layout.nodes) {
      this.nodeByKey.set(n.key, n);
      const g = n.kind === "statement" ? this.statementNode(n, ctx) : this.argumentNode(n, ctx);
      this.nodeEls.set(n.key, g);
      nodeFrag.append(g);
    }
    const edgeFrag = document.createDocumentFragment();
    for (const e of layout.edges) {
      if (!e.points.length) continue;
      const d = e.points.map((p, i) => `${i ? "L" : "M"}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
      const path = svg("path", { class: "edge", d, "marker-end": "url(#arrow)" });
      this.edgeEls.push({ el: path, edge: e });
      edgeFrag.append(path);
    }
    this.edgeLayer.replaceChildren(edgeFrag);
    this.nodeLayer.replaceChildren(nodeFrag);
  }

  private statementNode(n: LaidOutNode, ctx: Ctx): SVGGElement {
    const { derived, ui } = ctx;
    const s = derived.statementById.get(n.id) ?? ctx.store.doc.statements.find((x) => x.id === n.id);
    const cls = ["node", "statement"];
    if (s?.mode === "ought") cls.push("ought");
    if (derived.foundationSet.has(n.id)) cls.push("foundation");
    if (derived.cyclic.has(n.id)) cls.push("cycle");
    const w = n.width;
    const hgt = n.height;
    const g = svg("g", { class: cls.join(" "), transform: `translate(${n.x},${n.y})`, "data-key": n.key });
    g.append(svg("title", null, `${n.id} [${s?.mode ?? "?"}]${derived.foundationSet.has(n.id) ? " (foundation)" : ""}${derived.cyclic.has(n.id) ? " (in a cycle)" : ""}${derived.ungrounded.has(n.id) ? " (ungrounded)" : ""}\n${s?.text ?? ""}`));
    g.append(svg("rect", { class: "box", x: -w / 2, y: -hgt / 2, width: w, height: hgt, rx: 5 }));
    if (s?.mode === "ought") g.append(svg("rect", { class: "box inner", x: -w / 2 + 3, y: -hgt / 2 + 3, width: w - 6, height: hgt - 6, rx: 3 }));
    const text = svg("text", { class: "label", x: 0, y: -hgt / 2 + PAD_Y + 11, "text-anchor": "middle" });
    n.lines.forEach((line, i) => {
      text.append(svg("tspan", { x: 0, dy: i === 0 ? 0 : LINE_H, class: ui.showIds && i === 0 ? "id" : "" }, line));
    });
    g.append(text);
    if (derived.cyclic.has(n.id)) {
      g.append(svg("g", { class: "badge-cycle", transform: `translate(${w / 2 - 2},${-hgt / 2 + 2})` }, svg("circle", { r: 8 }), svg("text", { "text-anchor": "middle", y: 3.5 }, "↻")));
    }
    if (derived.ungrounded.has(n.id)) {
      // shown only while the lint overlay is on (class toggled in applyHighlight)
      g.append(svg("g", { class: "badge-warn", transform: `translate(${-w / 2 + 2},${-hgt / 2 + 2})` }, svg("circle", { r: 8 }), svg("text", { "text-anchor": "middle", y: 3.5 }, "!")));
    }
    return g;
  }

  private argumentNode(n: LaidOutNode, ctx: Ctx): SVGGElement {
    const a = ctx.derived.argumentById.get(n.id) ?? ctx.store.doc.arguments.find((x) => x.id === n.id);
    const r = ARG_SIZE / 2;
    const g = svg("g", { class: "node argument", transform: `translate(${n.x},${n.y})`, "data-key": n.key });
    g.append(svg("title", null, `${n.id}${a?.rule ? ` [${a.rule}]` : ""}\n${a ? `${a.premises.join(", ") || "∅"} ⇒ ${a.conclusions.join(", ")}` : ""}\n${a?.justification ?? ""}`));
    g.append(svg("polygon", { class: "diamond", points: `0,${-r} ${r},0 0,${r} ${-r},0` }));
    if (n.lines.length) {
      const text = svg("text", { class: "arg-label", x: 0, y: r + 11, "text-anchor": "middle" });
      n.lines.forEach((line, i) => text.append(svg("tspan", { x: 0, dy: i === 0 ? 0 : 12, class: i === 0 && ctx.ui.showIds ? "id" : "rule" }, line)));
      g.append(text);
    }
    return g;
  }

  // ------------------------------------------------------------ highlight

  private applyHighlight(ctx: Ctx): void {
    const { store, derived } = ctx;
    const sel = store.selection;
    const nodeState = new Map<string, NodeState>();
    const argState = new Map<string, EdgeState>();
    let selectedKey: string | null = null;
    let dimOthers = false;

    if (sel?.kind === "statement" && this.nodeByKey.has(statementKey(sel.id))) {
      selectedKey = statementKey(sel.id);
      dimOthers = true;
      const g = derived.graph;
      if (g && g.statements.has(sel.id)) {
        const upSet = g.upstream(sel.id);
        const downSet = g.downstream(sel.id);
        for (const s of upSet) nodeState.set(statementKey(s), "up");
        for (const s of downSet) nodeState.set(statementKey(s), upSet.has(s) ? "both" : "down");
        for (const [aid, a] of g.arguments) {
          const isUp = a.conclusions.some((c) => c === sel.id || upSet.has(c));
          const isDown = a.premises.some((p) => p === sel.id || downSet.has(p));
          const st: EdgeState = isUp && isDown ? "both" : isUp ? "up" : isDown ? "down" : "dim";
          if (st !== "dim") {
            nodeState.set(argumentKey(aid), st);
            argState.set(aid, st);
          }
        }
      }
    } else if (sel?.kind === "argument" && this.nodeByKey.has(argumentKey(sel.id))) {
      selectedKey = argumentKey(sel.id);
      dimOthers = true;
      const a = derived.argumentById.get(sel.id) ?? store.doc.arguments.find((x) => x.id === sel.id);
      if (a) {
        for (const p of a.premises) nodeState.set(statementKey(p), "up");
        for (const c of a.conclusions) nodeState.set(statementKey(c), nodeState.get(statementKey(c)) === "up" ? "both" : "down");
        argState.set(sel.id, "sel");
      }
    }

    const lint = ctx.ui.lintOverlay;
    for (const [key, el] of this.nodeEls) {
      const st: NodeState = key === selectedKey ? "selected" : (nodeState.get(key) ?? (dimOthers ? "dim" : ""));
      if (st) el.setAttribute("data-state", st);
      else el.removeAttribute("data-state");
      if (key.startsWith("s:")) el.classList.toggle("ungrounded", lint && derived.ungrounded.has(key.slice(2)));
    }
    for (const { el, edge } of this.edgeEls) {
      const aid = (edge.from.startsWith("a:") ? edge.from : edge.to).slice(2);
      const st: EdgeState = argState.get(aid) ?? (dimOthers ? "dim" : "");
      if (st) el.setAttribute("data-state", st);
      else el.removeAttribute("data-state");
      el.setAttribute("marker-end", st ? `url(#arrow-${st})` : "url(#arrow)");
    }
    if (selectedKey) {
      // keep the selected node on top of its neighbours
      const el = this.nodeEls.get(selectedKey);
      if (el) this.nodeLayer.append(el);
    }
  }

  // -------------------------------------------------------------- viewing

  private size(): { w: number; h: number } {
    const r = this.svgEl.getBoundingClientRect();
    return { w: r.width || 800, h: r.height || 600 };
  }

  private applyTransform(): void {
    this.viewport.setAttribute("transform", `translate(${this.tx.toFixed(2)},${this.ty.toFixed(2)}) scale(${this.k.toFixed(4)})`);
  }

  fit(): void {
    if (!this.layout || !this.layout.nodes.length) {
      this.tx = 0;
      this.ty = 0;
      this.k = 1;
      this.applyTransform();
      return;
    }
    const { w, h: hh } = this.size();
    const pad = 24;
    const lw = Math.max(this.layout.width, 1);
    const lh = Math.max(this.layout.height, 1);
    this.k = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, Math.min((w - pad * 2) / lw, (hh - pad * 2) / lh, 1.25)));
    this.tx = (w - lw * this.k) / 2;
    this.ty = (hh - lh * this.k) / 2;
    this.applyTransform();
  }

  /** Pan so the node is centred; zoom in a little if the view is very far out. */
  centerOn(key: string): void {
    const n = this.nodeByKey.get(key);
    if (!n) return;
    const { w, h: hh } = this.size();
    if (this.k < 0.6) this.k = 0.9;
    this.tx = w / 2 - n.x * this.k;
    this.ty = hh / 2 - n.y * this.k;
    this.applyTransform();
  }

  requestFit(): void {
    this.fitPending = true;
  }

  private zoomBy(factor: number, cx?: number, cy?: number): void {
    const { w, h: hh } = this.size();
    const px = cx ?? w / 2;
    const py = cy ?? hh / 2;
    const nk = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, this.k * factor));
    // keep the point under the cursor fixed
    this.tx = px - ((px - this.tx) * nk) / this.k;
    this.ty = py - ((py - this.ty) * nk) / this.k;
    this.k = nk;
    this.applyTransform();
  }

  private bindPanZoom(): void {
    const el = this.svgEl;
    let dragging = false;
    let moved = false;
    let sx = 0;
    let sy = 0;
    let ox = 0;
    let oy = 0;
    let downKey: string | null = null;

    el.addEventListener("pointerdown", (e: PointerEvent) => {
      if (e.button !== 0) return;
      dragging = true;
      moved = false;
      sx = e.clientX;
      sy = e.clientY;
      ox = this.tx;
      oy = this.ty;
      downKey = (e.target as Element).closest?.("g.node")?.getAttribute("data-key") ?? null;
      el.setPointerCapture(e.pointerId);
    });
    el.addEventListener("pointermove", (e: PointerEvent) => {
      if (!dragging) return;
      const dx = e.clientX - sx;
      const dy = e.clientY - sy;
      if (!moved && Math.hypot(dx, dy) > CLICK_SLOP) moved = true;
      if (moved) {
        this.tx = ox + dx;
        this.ty = oy + dy;
        this.applyTransform();
        el.classList.add("panning");
      }
    });
    const finish = (e: PointerEvent): void => {
      if (!dragging) return;
      dragging = false;
      el.classList.remove("panning");
      try {
        el.releasePointerCapture(e.pointerId);
      } catch {
        /* already released */
      }
      if (moved) return;
      if (downKey) {
        const kind = downKey.startsWith("s:") ? "statement" : "argument";
        this.actions.select({ kind, id: downKey.slice(2) });
      } else {
        this.actions.select(null);
      }
    };
    el.addEventListener("pointerup", finish);
    el.addEventListener("pointercancel", () => {
      dragging = false;
      el.classList.remove("panning");
    });
    el.addEventListener(
      "wheel",
      (e: WheelEvent) => {
        e.preventDefault();
        const r = el.getBoundingClientRect();
        const factor = Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.0015));
        this.zoomBy(factor, e.clientX - r.left, e.clientY - r.top);
      },
      { passive: false },
    );
    el.addEventListener("dblclick", (e: MouseEvent) => {
      const key = (e.target as Element).closest?.("g.node")?.getAttribute("data-key");
      if (key) this.centerOn(key);
      else this.fit();
    });
    window.addEventListener("resize", () => {
      if (this.ctx && this.fitPending) this.fit();
    });
  }
}
