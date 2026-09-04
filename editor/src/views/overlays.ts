/**
 * Modal dialogs, confirm prompts, drop-down menus, and toasts.  One
 * instance lives in the App; Escape closes the topmost thing via
 * `closeTop()`.
 */

import { h } from "../ui.js";
import type { Child } from "../ui.js";

export class Overlays {
  readonly el = h("div", { class: "overlays" });
  private readonly toasts = h("div", { class: "toasts", role: "status", "aria-live": "polite" });
  private modal: HTMLElement | null = null;
  private modalClose: (() => void) | null = null;
  private menuClose: (() => void) | null = null;
  private menuAnchor: HTMLElement | null = null;

  constructor() {
    this.el.append(this.toasts);
  }

  get isOpen(): boolean {
    return this.modal !== null || this.menuClose !== null;
  }

  // ---------------------------------------------------------------- modals

  showModal(title: string, body: Child, opts: { actions?: HTMLElement[]; wide?: boolean; onClose?: () => void } = {}): HTMLElement {
    this.closeModal();
    const close = (): void => this.closeModal();
    const box = h(
      "div",
      { class: "modal" + (opts.wide ? " wide" : ""), role: "dialog", "aria-modal": "true", "aria-label": title },
      h("div", { class: "modal-head" }, h("h2", null, title), h("button", { class: "btn icon", title: "Close (Esc)", "aria-label": "Close", onclick: close }, "×")),
      h("div", { class: "modal-body" }, body),
      opts.actions ? h("div", { class: "modal-actions" }, ...opts.actions) : null,
    );
    const backdrop = h(
      "div",
      {
        class: "modal-backdrop",
        onmousedown: (e: MouseEvent) => {
          if (e.target === backdrop) close();
        },
      },
      box,
    );
    this.el.append(backdrop);
    this.modal = backdrop;
    this.modalClose = opts.onClose ?? null;
    const focusable = box.querySelector<HTMLElement>(".modal-actions button, .modal-body button, .modal-body input");
    (focusable ?? box.querySelector<HTMLElement>("button"))?.focus();
    return box;
  }

  closeModal(): void {
    if (!this.modal) return;
    this.modal.remove();
    this.modal = null;
    const cb = this.modalClose;
    this.modalClose = null;
    cb?.();
  }

  confirm(message: string, okLabel = "OK"): Promise<boolean> {
    return new Promise((resolve) => {
      let done = false;
      const finish = (v: boolean): void => {
        if (done) return;
        done = true;
        this.closeModal();
        resolve(v);
      };
      const ok = h("button", { class: "btn primary", onclick: () => finish(true) }, okLabel);
      const cancel = h("button", { class: "btn", onclick: () => finish(false) }, "Cancel");
      this.showModal("Confirm", h("p", null, message), { actions: [cancel, ok], onClose: () => finish(false) });
      ok.focus();
    });
  }

  // ----------------------------------------------------------------- menus

  menu(anchor: HTMLElement, build: (close: () => void) => Child): void {
    if (this.menuClose && this.menuAnchor === anchor) {
      this.closeMenu(); // clicking the same button again closes its menu
      return;
    }
    this.closeMenu();
    const popover = h("div", { class: "menu", role: "menu" });
    const close = (): void => {
      popover.remove();
      document.removeEventListener("mousedown", onDown, true);
      window.removeEventListener("resize", close);
      anchor.setAttribute("aria-expanded", "false");
      this.menuClose = null;
      this.menuAnchor = null;
    };
    const onDown = (e: MouseEvent): void => {
      const t = e.target as Node;
      if (!popover.contains(t) && !anchor.contains(t)) close();
    };
    popover.append(...toArray(build(close)));
    const r = anchor.getBoundingClientRect();
    popover.style.top = `${r.bottom + 4}px`;
    popover.style.left = `${Math.max(4, Math.min(r.left, window.innerWidth - 340))}px`;
    this.el.append(popover);
    document.addEventListener("mousedown", onDown, true);
    window.addEventListener("resize", close);
    this.menuClose = close;
    this.menuAnchor = anchor;
    anchor.setAttribute("aria-expanded", "true");
    popover.querySelector<HTMLElement>("button")?.focus();
  }

  closeMenu(): void {
    this.menuClose?.();
  }

  /** Close whatever is on top; true if something was closed. */
  closeTop(): boolean {
    if (this.menuClose) {
      this.closeMenu();
      return true;
    }
    if (this.modal) {
      this.closeModal();
      return true;
    }
    return false;
  }

  // ---------------------------------------------------------------- toasts

  toast(message: string, kind: "info" | "error" = "info", ms = kind === "error" ? 8000 : 4500): void {
    const t = h("div", { class: `toast ${kind}` }, h("span", null, message), h("button", { class: "btn icon", title: "Dismiss", "aria-label": "Dismiss", onclick: () => t.remove() }, "×"));
    this.toasts.append(t);
    while (this.toasts.children.length > 4) this.toasts.firstElementChild?.remove();
    setTimeout(() => t.remove(), ms);
  }
}

function toArray(c: Child): Node[] {
  const out: Node[] = [];
  const walk = (x: Child): void => {
    if (x == null || x === false) return;
    if (Array.isArray(x)) x.forEach(walk);
    else if (x instanceof Node) out.push(x);
    else out.push(document.createTextNode(String(x)));
  };
  walk(c);
  return out;
}
