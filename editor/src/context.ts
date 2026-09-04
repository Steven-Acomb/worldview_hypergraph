/**
 * What every view receives on each render, and the actions views may
 * trigger.  Views never touch the store's mutation methods for anything
 * that needs confirmation, file access, or UI state; they go through
 * `Actions`, which the App implements.
 */

import type { WorldviewDocument } from "worldview-core";
import type { Derived } from "./derived.js";
import type { RecentEntry } from "./persist.js";
import type { Selection, Store } from "./store.js";
import type { Child } from "./ui.js";

export type Tab = "statements" | "arguments" | "overview" | "diff";
export type FocusMode = "off" | "up" | "down" | "both";
export type Theme = "system" | "light" | "dark";

export interface ExampleEntry {
  file: string;
  name: string;
  description: string;
  statements: number;
  arguments: number;
}

export interface UiState {
  tab: Tab;
  theme: Theme;
  rankdir: "LR" | "TB";
  showIds: boolean;
  lintOverlay: boolean;
  focusMode: FocusMode;
  /** argument hops, 1..8 or Infinity */
  focusDepth: number;
  focusId: string | null;
  /** depth for the inspector's rests-on / supports trees, 1..8 or Infinity */
  inspectorDepth: number;
  /** narrow layouts only: whether the right panel drawer is open */
  rightOpen: boolean;
}

export type ReadResult = { ok: true; doc: WorldviewDocument; problems: string[] } | { ok: false; error: string };

export interface Actions {
  // selection and navigation
  select(sel: Selection, opts?: { center?: boolean }): void;
  setTab(tab: Tab): void;
  setFocus(patch: Partial<Pick<UiState, "focusMode" | "focusDepth" | "focusId">>): void;
  setInspectorDepth(depth: number): void;
  fitGraph(): void;

  // document lifecycle
  newDocument(): Promise<void>;
  openPicker(): void;
  openFile(file: File): Promise<void>;
  readFile(file: File): Promise<ReadResult>;
  save(): void;
  undo(): void;
  redo(): void;
  listExamples(): Promise<ExampleEntry[]>;
  fetchExample(file: string): Promise<WorldviewDocument>;
  loadExample(file: string): Promise<void>;
  recents(): RecentEntry[];
  loadRecent(key: string): Promise<void>;
  forgetRecent(key: string): void;

  // edits that need UI
  addStatement(): void;
  addArgument(): void;
  deleteStatement(id: string): Promise<void>;
  deleteArgument(id: string): Promise<void>;

  // preferences
  setTheme(theme: Theme): void;
  toggleRankdir(): void;
  toggleShowIds(): void;
  toggleLint(): void;
  toggleRight(): void;

  // overlays
  showHelp(): void;
  showProblems(): void;
  confirm(message: string, okLabel?: string): Promise<boolean>;
  toast(message: string, kind?: "info" | "error"): void;
  copy(text: string, what?: string): void;
  menu(anchor: HTMLElement, build: (close: () => void) => Child): void;
}

export interface Ctx {
  store: Store;
  derived: Derived;
  ui: UiState;
  actions: Actions;
}

export interface View {
  el: HTMLElement;
  update(ctx: Ctx): void;
}

export const DEPTH_ALL = Infinity;
export const MAX_DEPTH = 8;

export function depthLabel(d: number): string {
  return d === Infinity ? "all" : String(d);
}
