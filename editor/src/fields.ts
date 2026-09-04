/**
 * Form field bindings.  The store re-renders views on every change, but a
 * field the user is typing into must keep its focus and its text, so each
 * binding exposes `sync()`: it pushes the current model value into the
 * element only when the element is not focused and has no pending edit.
 */

import type { JsonObject } from "worldview-core";
import { debounce, formatJsonField, parseJsonField } from "./logic.js";
import { h } from "./ui.js";

export interface Field {
  el: HTMLElement;
  /** Push the model value into the element unless the user is editing it. */
  sync(): void;
  /** Commit any pending edit now (before a save, for example). */
  flush(): void;
}

function isFocused(el: Element): boolean {
  return document.activeElement === el;
}

export interface TextFieldOptions {
  el: HTMLInputElement | HTMLTextAreaElement;
  get: () => string;
  set: (value: string) => void;
  /** Commit while typing after this many ms of quiet; blur always commits. */
  debounceMs?: number;
  /** Commit only on change (blur or Enter), never while typing. */
  commitOnChangeOnly?: boolean;
}

export function textField(opts: TextFieldOptions): Field {
  const { el } = opts;
  el.value = opts.get();
  let committed = el.value;
  const commit = (): void => {
    if (el.value === committed) return;
    committed = el.value;
    opts.set(el.value);
  };
  const d = debounce(commit, opts.debounceMs ?? 300);
  if (!opts.commitOnChangeOnly) {
    el.addEventListener("input", () => d.call());
  }
  el.addEventListener("change", () => {
    d.flush();
    commit();
  });
  el.addEventListener("blur", () => {
    d.flush();
    commit();
  });
  return {
    el,
    sync() {
      if (isFocused(el) || d.pending()) return;
      const v = opts.get();
      if (v !== el.value) {
        el.value = v;
        committed = v;
      }
    },
    flush() {
      d.flush();
      commit();
    },
  };
}

export interface JsonFieldOptions {
  el: HTMLTextAreaElement;
  errorEl: HTMLElement;
  kind: "meta" | "ext";
  get: () => JsonObject | undefined;
  set: (value: JsonObject | undefined) => void;
}

/** A textarea holding a JSON object; parsed on blur, committed only when valid. */
export function jsonField(opts: JsonFieldOptions): Field {
  const { el, errorEl } = opts;
  el.value = formatJsonField(opts.get());
  let lastText = el.value;
  let hasError = false;
  const commit = (): void => {
    if (el.value === lastText && !hasError) return;
    const r = parseJsonField(el.value, opts.kind);
    if (r.ok) {
      hasError = false;
      errorEl.textContent = "";
      errorEl.hidden = true;
      el.classList.remove("invalid");
      const before = JSON.stringify(opts.get() ?? null);
      const after = JSON.stringify(r.value ?? null);
      lastText = el.value;
      if (before !== after) opts.set(r.value);
    } else {
      hasError = true;
      errorEl.textContent = r.error;
      errorEl.hidden = false;
      el.classList.add("invalid");
    }
  };
  el.addEventListener("change", commit);
  el.addEventListener("blur", commit);
  return {
    el,
    sync() {
      if (isFocused(el) || hasError) return;
      const v = formatJsonField(opts.get());
      if (v !== el.value) {
        el.value = v;
        lastText = v;
      }
    },
    flush: commit,
  };
}

/** A labelled control with an optional hint/error line. */
export function labelled(label: string, control: HTMLElement, extra?: HTMLElement | null): HTMLElement {
  return h("label", { class: "field" }, h("span", { class: "field-label" }, label), control, extra ?? null);
}

export function errorLine(): HTMLElement {
  return h("div", { class: "field-error", hidden: true });
}
