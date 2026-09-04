/**
 * Central store: the working document, selection, and an undo/redo
 * history.  Every mutation produces a new document object (the old one
 * is kept for undo), bumps `version`, and notifies subscribers.
 *
 * The store knows nothing about the DOM and nothing about identities or
 * queries; those are computed from the document in `derived.ts`.
 */

import type { Argument, JsonObject, Mode, Statement, WorldviewDocument } from "worldview-core";
import { FORMAT, FORMAT_VERSION } from "worldview-core";

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

export type Listener = (store: Store) => void;

const HISTORY_LIMIT = 200;

export function emptyDocument(name = "Untitled worldview"): WorldviewDocument {
  return { format: FORMAT, version: FORMAT_VERSION, name, statements: [], arguments: [] };
}

export function cloneDocument(doc: WorldviewDocument): WorldviewDocument {
  return JSON.parse(JSON.stringify(doc)) as WorldviewDocument;
}

/** Serialize in the canonical on-disk layout: header fields first, then statements, then arguments. */
export function serializeDocument(doc: WorldviewDocument): string {
  const ordered: Record<string, unknown> = { format: FORMAT, version: doc.version };
  if (doc.name !== undefined) ordered.name = doc.name;
  if (doc.description !== undefined) ordered.description = doc.description;
  if (doc.meta !== undefined) ordered.meta = doc.meta;
  if (doc.ext !== undefined) ordered.ext = doc.ext;
  ordered.statements = doc.statements.map(orderStatement);
  ordered.arguments = doc.arguments.map(orderArgument);
  return JSON.stringify(ordered, null, 2) + "\n";
}

function orderStatement(s: Statement): Statement {
  const out: Statement = { id: s.id, text: s.text, mode: s.mode };
  if (s.meta !== undefined) out.meta = s.meta;
  if (s.ext !== undefined) out.ext = s.ext;
  return out;
}

function orderArgument(a: Argument): Argument {
  const out: Argument = { id: a.id, premises: [...a.premises], conclusions: [...a.conclusions], justification: a.justification };
  if (a.rule !== undefined) out.rule = a.rule;
  if (a.meta !== undefined) out.meta = a.meta;
  if (a.ext !== undefined) out.ext = a.ext;
  return out;
}

export class Store {
  doc: WorldviewDocument;
  version = 0;
  /** Where the document came from, for display: a file name or example name. */
  sourceName: string | null = null;
  dirty = false;
  selection: Selection = null;
  private past: WorldviewDocument[] = [];
  private future: WorldviewDocument[] = [];
  private listeners = new Set<Listener>();

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

  private commit(next: WorldviewDocument): void {
    this.past.push(this.doc);
    if (this.past.length > HISTORY_LIMIT) this.past.shift();
    this.future = [];
    this.doc = next;
    this.version++;
    this.dirty = true;
    this.emit();
  }

  private mutate(fn: (draft: WorldviewDocument) => void): void {
    const next = cloneDocument(this.doc);
    fn(next);
    this.commit(next);
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
    this.reconcileSelection();
    this.emit();
    return true;
  }

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

  setHeader(patch: HeaderPatch): void {
    this.mutate((d) => {
      for (const key of ["name", "description", "meta", "ext"] as const) {
        if (!(key in patch)) continue;
        const v = patch[key];
        if (v === undefined) delete d[key];
        else (d as unknown as Record<string, unknown>)[key] = v;
      }
    });
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

  updateStatement(id: string, patch: StatementPatch): void {
    this.mutate((d) => {
      const s = d.statements.find((x) => x.id === id);
      if (!s) return;
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
      if (patch.id !== undefined && patch.id !== id) {
        renameStatementIn(d, id, patch.id);
      }
    });
    if (patch.id !== undefined && this.selection?.kind === "statement" && this.selection.id === id) {
      this.selection = { kind: "statement", id: patch.id };
      this.emit();
    }
  }

  renameStatement(id: string, newId: string): void {
    this.updateStatement(id, { id: newId });
  }

  /** Delete a statement and every reference to it.  Arguments left without conclusions are deleted too. */
  deleteStatement(id: string): void {
    this.mutate((d) => {
      d.statements = d.statements.filter((s) => s.id !== id);
      d.arguments = d.arguments
        .map((a) => ({
          ...a,
          premises: a.premises.filter((p) => p !== id),
          conclusions: a.conclusions.filter((c) => c !== id),
        }))
        .filter((a) => a.conclusions.length > 0);
    });
    if (this.selection?.kind === "statement" && this.selection.id === id) {
      this.selection = null;
      this.emit();
    }
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

  updateArgument(id: string, patch: ArgumentPatch): void {
    this.mutate((d) => {
      const a = d.arguments.find((x) => x.id === id);
      if (!a) return;
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
      if (patch.id !== undefined && patch.id !== id) a.id = patch.id;
    });
    if (patch.id !== undefined && this.selection?.kind === "argument" && this.selection.id === id) {
      this.selection = { kind: "argument", id: patch.id };
      this.emit();
    }
  }

  deleteArgument(id: string): void {
    this.mutate((d) => {
      d.arguments = d.arguments.filter((a) => a.id !== id);
    });
    if (this.selection?.kind === "argument" && this.selection.id === id) {
      this.selection = null;
      this.emit();
    }
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

function moveIn<T extends { id: string }>(list: T[], id: string, delta: number): void {
  const i = list.findIndex((x) => x.id === id);
  if (i < 0) return;
  const j = Math.max(0, Math.min(list.length - 1, i + delta));
  if (i === j) return;
  const [item] = list.splice(i, 1);
  list.splice(j, 0, item);
}
