/**
 * localStorage persistence: the working document (autosave), a short
 * list of recent documents, and UI preferences.  Every access is wrapped
 * in try/catch because storage can be missing, full, or blocked.
 */

import type { WorldviewDocument } from "worldview-core";

const DOC_KEY = "worldview-editor:doc:v1";
const RECENT_KEY = "worldview-editor:recent:v1";
const PREFS_KEY = "worldview-editor:prefs:v1";
const RECENT_LIMIT = 6;
const RECENT_MAX_BYTES = 1_500_000;

export interface SavedDoc {
  doc: WorldviewDocument;
  sourceName: string | null;
  dirty: boolean;
  savedAt: string;
}

export interface RecentEntry {
  key: string;
  name: string;
  sourceName: string | null;
  savedAt: string;
  statements: number;
  arguments: number;
  doc: WorldviewDocument;
}

export interface Prefs {
  theme?: "light" | "dark" | "system";
  rankdir?: "LR" | "TB";
  sidebarTab?: string;
  lintOverlay?: boolean;
  showIds?: boolean;
}

function read<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function write(key: string, value: unknown): boolean {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

export function loadWorkingDoc(): SavedDoc | null {
  const v = read<SavedDoc>(DOC_KEY);
  if (!v || typeof v !== "object" || !v.doc || !Array.isArray(v.doc.statements)) return null;
  return v;
}

export function saveWorkingDoc(doc: WorldviewDocument, sourceName: string | null, dirty: boolean, now = new Date()): boolean {
  return write(DOC_KEY, { doc, sourceName, dirty, savedAt: now.toISOString() } satisfies SavedDoc);
}

export function loadRecents(): RecentEntry[] {
  const v = read<RecentEntry[]>(RECENT_KEY);
  return Array.isArray(v) ? v.filter((e) => e && e.doc && Array.isArray(e.doc.statements)) : [];
}

/** Remember a document in the recent list, keyed by its source name (or its name). */
export function rememberRecent(doc: WorldviewDocument, sourceName: string | null, now = new Date()): RecentEntry[] {
  const key = sourceName ?? doc.name ?? "untitled";
  const entry: RecentEntry = {
    key,
    name: doc.name ?? key,
    sourceName,
    savedAt: now.toISOString(),
    statements: doc.statements.length,
    arguments: doc.arguments.length,
    doc,
  };
  if (JSON.stringify(doc).length > RECENT_MAX_BYTES) return loadRecents();
  const list = [entry, ...loadRecents().filter((e) => e.key !== key)].slice(0, RECENT_LIMIT);
  write(RECENT_KEY, list);
  return list;
}

export function forgetRecent(key: string): RecentEntry[] {
  const list = loadRecents().filter((e) => e.key !== key);
  write(RECENT_KEY, list);
  return list;
}

export function loadPrefs(): Prefs {
  return read<Prefs>(PREFS_KEY) ?? {};
}

export function savePrefs(patch: Prefs): Prefs {
  const next = { ...loadPrefs(), ...patch };
  write(PREFS_KEY, next);
  return next;
}
