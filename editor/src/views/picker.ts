/**
 * A searchable statement picker: an input that lists matching statements
 * (id and text) below it, keyboard navigable.  Used by the argument form
 * to add premises and conclusions.
 */

import type { Statement } from "worldview-core";
import { searchStatements } from "../logic.js";
import { ellipsis, h, replaceChildren } from "../ui.js";

export interface PickerOptions {
  placeholder: string;
  statements: () => Statement[];
  exclude: () => Iterable<string>;
  onPick: (id: string) => void;
}

export function createPicker(opts: PickerOptions): HTMLElement {
  const input = h("input", {
    type: "text",
    class: "picker-input",
    placeholder: opts.placeholder,
    "aria-label": opts.placeholder,
    role: "combobox",
    "aria-expanded": "false",
    "aria-autocomplete": "list",
    autocomplete: "off",
    spellcheck: false,
  });
  const list = h("div", { class: "picker-list", role: "listbox", hidden: true });
  const root = h("div", { class: "picker" }, input, list);
  let results: Statement[] = [];
  let active = -1;
  let open = false;

  const render = (): void => {
    results = searchStatements(opts.statements(), input.value, opts.exclude());
    if (active >= results.length) active = results.length - 1;
    if (active < 0 && results.length) active = 0;
    replaceChildren(
      list,
      results.length
        ? results.map((s, i) =>
            h(
              "div",
              {
                class: "picker-item" + (i === active ? " active" : ""),
                role: "option",
                "aria-selected": i === active ? "true" : "false",
                onmousedown: (e: MouseEvent) => e.preventDefault(), // keep the input focused
                onclick: () => pick(i),
                onmousemove: () => {
                  if (active !== i) {
                    active = i;
                    highlight();
                  }
                },
              },
              h("span", { class: "mono" }, s.id),
              h("span", { class: `badge mode-${s.mode}` }, s.mode),
              h("span", { class: "picker-text" }, ellipsis(s.text, 70)),
            ),
          )
        : h("div", { class: "picker-empty" }, opts.statements().length ? "No matching statement" : "No statements yet"),
    );
    list.hidden = !open;
  };
  const highlight = (): void => {
    [...list.children].forEach((c, i) => c.classList.toggle("active", i === active));
    list.children[active]?.scrollIntoView({ block: "nearest" });
  };
  const show = (): void => {
    open = true;
    input.setAttribute("aria-expanded", "true");
    render();
  };
  const hide = (): void => {
    open = false;
    input.setAttribute("aria-expanded", "false");
    list.hidden = true;
  };
  const pick = (i: number): void => {
    const s = results[i];
    if (!s) return;
    opts.onPick(s.id);
    input.value = "";
    active = -1;
    render();
  };

  input.addEventListener("focus", show);
  input.addEventListener("input", () => {
    active = -1;
    show();
  });
  input.addEventListener("blur", hide);
  input.addEventListener("keydown", (e: KeyboardEvent) => {
    if (!open && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
      show();
      e.preventDefault();
      return;
    }
    if (e.key === "ArrowDown") {
      active = Math.min(results.length - 1, active + 1);
      highlight();
      e.preventDefault();
    } else if (e.key === "ArrowUp") {
      active = Math.max(0, active - 1);
      highlight();
      e.preventDefault();
    } else if (e.key === "Enter") {
      if (open && active >= 0) pick(active);
      e.preventDefault();
    } else if (e.key === "Escape") {
      if (open) {
        hide();
        e.stopPropagation();
      } else {
        input.blur();
      }
    }
  });
  return root;
}
