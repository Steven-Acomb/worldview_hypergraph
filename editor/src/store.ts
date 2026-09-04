/**
 * Central store: the working document, selection, and an undo/redo
 * history.  Every mutation produces a new document object (the old one
 * is kept for undo), bumps `version`, and notifies subscribers.
 *
 * The store knows nothing about the DOM and nothing about identities or
 * queries; those are computed from the document in `derived.ts`.
 */

import type { Argument, JsonObject, Mode, Statement, WorldviewDocument } from "worldview-core";
import { FORMAT, FORMAT_VERSION, worldviewFromDict, worldviewToDict } from "worldview-core";

export type Selection = { kind: "statement" | "argument"; id: string } | null;

export interface StatementPatch {
  id?: string;
  text?: string;
  mode?: Mode;
  meta?: JsonObject | undefined;
  ext?: JsonObject | undefined;
}

export interface ArgumentPatch {
  id?: string;
  premises?: string[];
  conclusions?: string[];
  justification?: string;
  rule?: string | undefined;
  meta?: JsonObject | undefined;
  ext?: JsonObject | undefined;
}

export interface HeaderPatch {
  name?: string | undefined;
  description?: string | undefined;
  meta?: JsonObject | undefined;
  ext?: JsonObject | undefined;
}

export interface EditOptions {
  /**
   * Group this edit with the previous one when both carry the same key and
   * the previous one happened less than `COALESCE_MS` ago.  A burst of
   * keystrokes into one field is then a single undo step instead of one
   * step per debounced commit.
   */
  coalesce?: string;
}

export type Listener = (store: Store) => void;

const HISTORY_LIMIT = 200;
/** Edits with the same coalesce key closer together than this merge into one undo step. */
export const COALESCE_MS = 1500;

export function emptyDocument(name = "Untitled worldview"): WorldviewDocument {
  return { format: FORMAT, version: FORMAT_VERSION, name, statements: [], arguments: [] };
}

export function cloneDocument(doc: WorldviewDocument): WorldviewDocument {
  return JSON.parse(JSON.stringify(doc)) as WorldviewDocument;
}

/**
 * Serialize in the canonical on-disk layout.  The key order (format,
 * version, name, description, meta, ext, statements, arguments; id, text,
 * mode, meta, ext; id, premises, conclusions, justification, rule, meta,
 * ext) comes from the SDK, so a saved file matches what the reference CLI
 * emits.
 */
export function serializeDocument(doc: WorldviewDocument): string {
  return JSON.stringify(worldviewToDict(worldviewFromDict(doc)), null, 2) + "\n";
}

export class Store {
  doc: WorldviewDocument;
  version = 0;
  /** Where the document came from, for display: a file name or example name. */
  sourceName: string | null = null;
  dirty = false;
  selection: Selection = null;
  /** Clock used for coalescing; replaceable in tests. */
  now: () => number = () => Date.now();
  private past: WorldviewDocument[] = [];
  private future: WorldviewDocument[] = [];
  private listeners = new Set<Listener>();
  private lastCoalesce: string | null = null;
  private lastCoalesceAt = 0;

  constructor(doc?: WorldviewDocument) {
    this.doc = doc ? cloneDocument(doc) : emptyDocument();
  }

  // ------------------------------------------------------------ plumbing

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(): void {
    for (const fn of this.listeners) fn(this);
  }

  /**
   * Install `next` as the document.  The selection is updated *before*
   * subscribers run, so a rename never renders an intermediate state in
   * which the selected id does not exist, and a selection whose target
   * has gone (deleted directly or as a side effect) is dropped.
   */
  private commit(next: WorldviewDocument, opts: EditOptions = {}, selection?: Selection): void {
    const key = opts.coalesce ?? null;
    const t = this.now();
    const merge = key !== null && key === this.lastCoalesce && t - this.lastCoalesceAt <= COALESCE_MS && this.past.length > 0;
    if (!merge) {
      this.past.push(this.doc);
      if (this.past.length > HISTORY_LIMIT) this.past.shift();
    }
    this.lastCoalesce = key;
    this.lastCoalesceAt = t;
    this.future = [];
    this.doc = next;
    this.version++;
    this.dirty = true;
    if (selection !== undefined) this.selection = selection;
    this.reconcileSelection();
    this.emit();
  }

  /**
   * Apply `fn` to a copy and commit it.  `fn` may return false to abort;
   * an edit that changes nothing is dropped too, so the history never
   * holds no-op steps.
   */
  private mutate(fn: (draft: WorldviewDocument) => void | boolean, opts?: EditOptions, selection?: Selection): boolean {
    const before = JSON.stringify(this.doc);
    const next = JSON.parse(before) as WorldviewDocument;
    if (fn(next) === false) return false;
    if (JSON.stringify(next) === before) return false;
    this.commit(next, opts, selection);
    return true;
  }

  // ------------------------------------------------------------ history

  get canUndo(): boolean {
    return this.past.length > 0;
  }

  get canRedo(): boolean {
    return this.future.length > 0;
  }

  undo(): boolean {
    const prev = this.past.pop();
    if (!prev) return false;
    this.future.push(this.doc);
    this.doc = prev;
    this.version++;
    this.dirty = true;
    this.lastCoalesce = null;
    this.reconcileSelection();
    this.emit();
    return true;
  }

  redo(): boolean {
    const next = this.future.pop();
    if (!next) return false;
    this.past.push(this.doc);
    this.doc = next;
    this.version++;
    this.dirty = true;
    this.lastCoalesce = null;
    this.reconcileSelection();
    this.emit();
    return true;
  }

  /** Drop the selection when the selected statement or argument no longer exists. */
  private reconcileSelection(): void {
    const sel = this.selection;
    if (!sel) return;
    const list = sel.kind === "statement" ? this.doc.statements : this.doc.arguments;
    if (!list.some((x) => x.id === sel.id)) this.selection = null;
  }

  // ------------------------------------------------------------ document

  /** Replace the whole document (open, new, example).  Clears history. */
  replace(doc: WorldviewDocument, sourceName: string | null, opts: { dirty?: boolean } = {}): void {
    this.doc = cloneDocument(doc);
    this.past = [];
    this.future = [];
    this.lastCoalesce = null;
    this.version++;
    this.sourceName = sourceName;
    this.dirty = opts.dirty ?? false;
    this.selection = null;
    this.emit();
  }

  markSaved(): void {
    this.dirty = false;
    this.emit();
  }

  serialize(): string {
    return serializeDocument(this.doc);
  }

  // ------------------------------------------------------------ selection

  select(sel: Selection): void {
    if (sel && this.selection && sel.kind === this.selection.kind && sel.id === this.selection.id) return;
    if (!sel && !this.selection) return;
    this.selection = sel;
    this.emit();
  }

  // ------------------------------------------------------------ header

  setHeader(patch: HeaderPatch, opts?: EditOptions): void {
    this.mutate((d) => {
      for (const key of ["name", "description", "meta", "ext"] as const) {
        if (!(key in patch)) continue;
        const v = patch[key];
        if (v === undefined) delete d[key];
        else (d as unknown as Record<string, unknown>)[key] = v;
      }
    }, opts);
  }

  // ------------------------------------------------------------ statements

  freshStatementId(base = "s"): string {
    const taken = new Set(this.doc.statements.map((s) => s.id));
    let n = this.doc.statements.length + 1;
    while (taken.has(`${base}-${n}`)) n++;
    return `${base}-${n}`;
  }

  freshArgumentId(base = "a"): string {
    const taken = new Set(this.doc.arguments.map((a) => a.id));
    let n = this.doc.arguments.length + 1;
    while (taken.has(`${base}-${n}`)) n++;
    return `${base}-${n}`;
  }

  addStatement(partial: Partial<Statement> = {}): string {
    const id = partial.id ?? this.freshStatementId();
    const s: Statement = { id, text: partial.text ?? "", mode: partial.mode ?? "is" };
    if (partial.meta !== undefined) s.meta = partial.meta;
    if (partial.ext !== undefined) s.ext = partial.ext;
    this.mutate((d) => {
      d.statements.push(s);
    });
    return id;
  }

  updateStatement(id: string, patch: StatementPatch, opts?: EditOptions): void {
    const renamed = patch.id !== undefined && patch.id !== id ? patch.id : null;
    const sel = this.selection;
    const nextSel: Selection | undefined = renamed !== null && sel?.kind === "statement" && sel.id === id ? { kind: "statement", id: renamed } : undefined;
    this.mutate(
      (d) => {
        const s = d.statements.find((x) => x.id === id);
        if (!s) return false;
        if (patch.text !== undefined) s.text = patch.text;
        if (patch.mode !== undefined) s.mode = patch.mode;
        if ("meta" in patch) {
          if (patch.meta === undefined) delete s.meta;
          else s.meta = patch.meta;
        }
        if ("ext" in patch) {
          if (patch.ext === undefined) delete s.ext;
          else s.ext = patch.ext;
        }
        if (renamed !== null) renameStatementIn(d, id, renamed);
        return true;
      },
      opts,
      nextSel,
    );
  }

  renameStatement(id: string, newId: string): void {
    this.updateStatement(id, { id: newId });
  }

  /** Delete a statement and every reference to it.  Arguments left without conclusions are deleted too. */
  deleteStatement(id: string): void {
    this.mutate((d) => {
      if (!d.statements.some((s) => s.id === id)) return false;
      d.statements = d.statements.filter((s) => s.id !== id);
      d.arguments = d.arguments
        .map((a) => ({
          ...a,
          premises: a.premises.filter((p) => p !== id),
          conclusions: a.conclusions.filter((c) => c !== id),
        }))
        .filter((a) => a.conclusions.length > 0);
      return true;
    });
  }

  moveStatement(id: string, delta: number): void {
    this.mutate((d) => moveIn(d.statements, id, delta));
  }

  // ------------------------------------------------------------ arguments

  addArgument(partial: Partial<Argument> = {}): string {
    const id = partial.id ?? this.freshArgumentId();
    const a: Argument = {
      id,
      premises: [...(partial.premises ?? [])],
      conclusions: [...(partial.conclusions ?? [])],
      justification: partial.justification ?? "",
    };
    if (partial.rule !== undefined) a.rule = partial.rule;
    if (partial.meta !== undefined) a.meta = partial.meta;
    if (partial.ext !== undefined) a.ext = partial.ext;
    this.mutate((d) => {
      d.arguments.push(a);
    });
    return id;
  }

  updateArgument(id: string, patch: ArgumentPatch, opts?: EditOptions): void {
    const renamed = patch.id !== undefined && patch.id !== id ? patch.id : null;
    const sel = this.selection;
    const nextSel: Selection | undefined = renamed !== null && sel?.kind === "argument" && sel.id === id ? { kind: "argument", id: renamed } : undefined;
    this.mutate(
      (d) => {
        const a = d.arguments.find((x) => x.id === id);
        if (!a) return false;
        if (patch.premises !== undefined) a.premises = [...patch.premises];
        if (patch.conclusions !== undefined) a.conclusions = [...patch.conclusions];
        if (patch.justification !== undefined) a.justification = patch.justification;
        if ("rule" in patch) {
          if (patch.rule === undefined || patch.rule === "") delete a.rule;
          else a.rule = patch.rule;
        }
        if ("meta" in patch) {
          if (patch.meta === undefined) delete a.meta;
          else a.meta = patch.meta;
        }
        if ("ext" in patch) {
          if (patch.ext === undefined) delete a.ext;
          else a.ext = patch.ext;
        }
        if (renamed !== null) a.id = renamed;
        return true;
      },
      opts,
      nextSel,
    );
  }

  deleteArgument(id: string): void {
    this.mutate((d) => {
      if (!d.arguments.some((a) => a.id === id)) return false;
      d.arguments = d.arguments.filter((a) => a.id !== id);
      return true;
    });
  }

  moveArgument(id: string, delta: number): void {
    this.mutate((d) => moveIn(d.arguments, id, delta));
  }
}

function renameStatementIn(d: WorldviewDocument, id: string, newId: string): void {
  for (const s of d.statements) if (s.id === id) s.id = newId;
  for (const a of d.arguments) {
    a.premises = a.premises.map((p) => (p === id ? newId : p));
    a.conclusions = a.conclusions.map((c) => (c === id ? newId : c));
  }
}

/** Move the item `delta` places; false when nothing changed. */
function moveIn<T extends { id: string }>(list: T[], id: string, delta: number): boolean {
  const i = list.findIndex((x) => x.id === id);
  if (i < 0) return false;
  const j = Math.max(0, Math.min(list.length - 1, i + delta));
  if (i === j) return false;
  const [item] = list.splice(i, 1);
  list.splice(j, 0, item);
  return true;
}
