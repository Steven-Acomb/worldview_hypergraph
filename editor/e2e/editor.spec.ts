/**
 * End-to-end smoke suite for the editor, run by `npm run e2e` against the
 * production build served under the GitHub Pages sub-path (see
 * playwright.config.ts).  Every test starts from a fresh browser context,
 * so localStorage is empty and the editor loads its smallest example.
 *
 * Expected values are derived from the bundled example files through the
 * SDK rather than hard-coded, so the suite checks that the editor shows
 * what the SDK computes and does not break when an example is edited.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";
import type { Worldview, WorldviewDocument } from "worldview-core";
import { diff, foundations, parseWorldview, plan, sccs, validateDict, worldviewToDict } from "worldview-core";
import { BASE_PATH } from "../playwright.config";

const examplesDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "examples");

interface Example {
  file: string;
  doc: WorldviewDocument;
  wv: Worldview;
  statements: number;
  arguments: number;
  foundations: number;
  cycles: number;
  /** premise -> argument and argument -> conclusion edges drawn on the graph */
  edges: number;
  /** what the status bar shows for a valid document */
  counts: string;
}

const plural = (n: number, noun: string): string => `${n} ${noun}${n === 1 ? "" : "s"}`;

function example(file: string): Example {
  const doc = JSON.parse(readFileSync(path.join(examplesDir, file), "utf8")) as WorldviewDocument;
  expect(validateDict(doc), `${file} must be a valid example`).toEqual([]);
  const wv = parseWorldview(doc, file);
  const f = foundations(wv).length;
  const c = sccs(wv).length;
  return {
    file,
    doc,
    wv,
    statements: doc.statements.length,
    arguments: doc.arguments.length,
    foundations: f,
    cycles: c,
    edges: doc.arguments.reduce((n, a) => n + a.premises.length + a.conclusions.length, 0),
    counts: `${plural(doc.statements.length, "statement")} · ${plural(doc.arguments.length, "argument")} · ${plural(f, "foundation")} · ${plural(c, "cycle")}`,
  };
}

const walking = example("walking-to-work.json");
const fork = example("walking-to-work-fork.json");
const descartes = example("descartes-discourse-on-method.json");

// The task's fixture facts: the small example has 12 statements and the fork
// makes three edits (2 added / 1 removed / 2 rejustified statements as B).
expect(walking.statements, "walking-to-work.json has 12 statements").toBe(12);
expect(diff(walking.wv, fork.wv).summary.statements, "the documented fork edits").toMatchObject({ added: 2, removed: 1, rejustified: 2 });

async function loadExample(page: Page, ex: Example): Promise<void> {
  await page.getByRole("button", { name: /^Examples/ }).click();
  await page.locator(".menu-item", { has: page.locator(".menu-item-name", { hasText: new RegExp(`^${escapeRegExp(ex.doc.name ?? ex.file)}$`) }) }).click();
  await expect(page.locator(".toasts")).toContainText(`Loaded example ${ex.file}`);
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const rows = (page: Page): Locator => page.locator(".sidebar .row");
const status = (page: Page): Locator => page.locator(".status-valid");
const sidebarButton = (page: Page, name: string): Locator => page.locator(".sidebar").getByRole("button", { name, exact: true });

let errors: string[] = [];

test.beforeEach(async ({ page }) => {
  errors = [];
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("./");
  await expect(status(page)).toHaveText("Valid");
});

test.afterEach(() => {
  expect(errors, "console errors").toEqual([]);
});

test("loads under the Pages base path, lists the walking example, draws the graph", async ({ page }) => {
  expect(new URL(page.url()).pathname).toBe(BASE_PATH);
  await loadExample(page, walking);
  await expect(page.locator(".toolbar-title")).toHaveText(walking.doc.name!);
  await expect(rows(page)).toHaveCount(walking.statements);
  await expect(rows(page)).toHaveCount(12);
  await expect(page.locator(".statusbar")).toContainText(walking.counts);
  await expect(status(page)).toHaveText("Valid");
  // one node element per statement and per argument, one edge per premise and conclusion
  await expect(page.locator("svg.graph-svg g.node.statement")).toHaveCount(walking.statements);
  await expect(page.locator("svg.graph-svg g.node.argument")).toHaveCount(walking.arguments);
  await expect(page.locator("svg.graph-svg path.edge")).toHaveCount(walking.edges);
  await expect(page.locator("svg.graph-svg g.node.statement.foundation")).toHaveCount(walking.foundations);
  await expect(page.locator("svg.graph-svg g.node.statement.cycle")).toHaveCount(sccs(walking.wv).reduce((n, c) => n + c.members.length, 0));
  for (const s of walking.doc.statements) await expect(page.locator(`svg.graph-svg g.node[data-key="s:${s.id}"]`)).toHaveCount(1);
  for (const a of walking.doc.arguments) await expect(page.locator(`svg.graph-svg g.node[data-key="a:${a.id}"]`)).toHaveCount(1);
});

test("selecting need-raincoat shows its rests-on tree with a cycle marker", async ({ page }) => {
  await loadExample(page, walking);
  const target = "need-raincoat";
  const report = plan(walking.wv, target);
  const cycleMember = "habit-reports";
  expect(sccs(walking.wv).some((c) => c.members.includes(cycleMember))).toBe(true);
  expect(report.arguments).toContain("walk-for-health");

  await page.locator(`.sidebar .row[data-id="${target}"]`).click();
  await expect(page.locator(`.sidebar .row[data-id="${target}"]`)).toHaveClass(/selected/);
  await expect(page.locator(".right input.mono")).toHaveValue(target);
  const inspector = page.locator(".inspector");
  await expect(inspector).toContainText("Rests on");
  await expect(inspector.locator(".inspector-ids .hash")).toHaveCount(2);
  const tree = inspector.locator("section", { has: page.locator("h4", { hasText: /^Rests on/ }) }).locator(".tree");
  await expect(tree.locator("button.link", { hasText: /^walk-for-health$/ })).toBeVisible();
  await expect(tree.locator("button.link", { hasText: /^raincoat$/ })).toBeVisible();
  const cycleNode = tree.locator(".tree-node-label", { has: page.locator("button.link", { hasText: new RegExp(`^${cycleMember}$`) }) });
  await expect(cycleNode).toBeVisible();
  await expect(cycleNode.locator(".badge.cycle")).toBeVisible();
  await expect(inspector).toContainText(`Foundations reached (${report.must_grant.length})`);
  for (const f of report.must_grant) await expect(inspector.locator("section", { hasText: "Foundations reached" }).locator("button.link", { hasText: new RegExp(`^${f.id}$`) })).toBeVisible();
  // the graph tints upstream and downstream of the selection
  await expect(page.locator(`svg g.node[data-key="s:${target}"]`)).toHaveAttribute("data-state", "selected");
  await expect(page.locator('svg g.node[data-key="s:exercise-good"]')).toHaveAttribute("data-state", "up");
  await expect(page.locator('svg g.node[data-key="a:raincoat"]')).toHaveAttribute("data-state", "up");
  // links in the tree select
  await tree.locator("button.link", { hasText: /^walk-commute$/ }).click();
  await expect(page.locator(".right input.mono")).toHaveValue("walk-commute");
  await expect(inspector).toContainText("Supports");
});

test("adds a statement and an argument through the UI and stays valid", async ({ page }) => {
  await loadExample(page, walking);
  await sidebarButton(page, "+ Statement").click();
  const text = page.locator(".right textarea").first();
  await expect(text).toBeFocused();
  await expect(status(page)).toHaveText("1 problem"); // empty text until typed
  await text.fill("Owning a raincoat is cheap.");
  await expect(status(page)).toHaveText("Valid");
  await expect(rows(page)).toHaveCount(walking.statements + 1);
  await expect(rows(page).last()).toContainText("Owning a raincoat is cheap.");
  await expect(rows(page).last()).toHaveClass(/selected/);
  const newId = (await rows(page).last().getAttribute("data-id"))!;

  await page.getByRole("tab", { name: "Arguments" }).click();
  await sidebarButton(page, "+ Argument").click();
  const picker = page.locator(".right .picker-input").first();
  await expect(picker).toBeFocused();
  await expect(page.locator(".right .chip")).toHaveCount(1); // the new statement is the conclusion
  await expect(status(page)).toHaveText("Valid");
  await picker.fill("rain-often");
  await page.locator(".picker-item", { hasText: "rain-often" }).click();
  await expect(page.locator(".right .chip")).toHaveCount(2);
  await page.locator(".right textarea").first().fill("Cheap and useful things are worth owning.");
  await expect(status(page)).toHaveText("Valid");
  await expect(page.locator(".statusbar")).toContainText(`${plural(walking.statements + 1, "statement")} · ${plural(walking.arguments + 1, "argument")}`);
  await expect(rows(page)).toHaveCount(walking.arguments + 1);
  await expect(rows(page).last()).toContainText(`rain-often ⇒ ${newId}`);
  await expect(page.locator("svg.graph-svg g.node.argument")).toHaveCount(walking.arguments + 1);
  await expect(page.locator(".right .arg-summary")).toContainText("1 premise jointly entail 1 conclusion");
});

test("renaming an id updates every reference; Ctrl+Z undoes it", async ({ page }) => {
  await loadExample(page, walking);
  const from = "walk-commute";
  const to = "walk";
  const users = walking.doc.arguments.filter((a) => a.premises.includes(from) || a.conclusions.includes(from));
  expect(users.length).toBeGreaterThan(1);
  const rowText = (a: (typeof users)[number], rename: boolean): string => {
    const r = (id: string): string => (rename && id === from ? to : id);
    return `${a.premises.map(r).join(", ")} ⇒ ${a.conclusions.map(r).join(", ")}`;
  };

  await page.locator(`.sidebar .row[data-id="${from}"]`).click();
  const id = page.locator(".right input.mono");
  await id.fill("walk commute");
  await expect(page.locator(".right .field-error:visible")).toContainText("whitespace");
  await id.fill(walking.doc.statements[0].id);
  await expect(page.locator(".right .field-error:visible")).toContainText("already used");
  await id.fill(to);
  await id.press("Enter");
  await expect(page.locator(".right input.mono")).toHaveValue(to);
  await expect(page.locator(`.sidebar .row[data-id="${to}"]`)).toHaveClass(/selected/);
  await page.getByRole("tab", { name: "Arguments" }).click();
  for (const a of users) await expect(page.locator(`.sidebar .row[data-id="${a.id}"] .row-text`)).toHaveText(rowText(a, true));
  await expect(page.locator(`svg g.node[data-key="s:${to}"]`)).toHaveCount(1);
  await expect(page.locator(`svg g.node[data-key="s:${from}"]`)).toHaveCount(0);
  await expect(status(page)).toHaveText("Valid");
  await page.keyboard.press("Control+z");
  for (const a of users) await expect(page.locator(`.sidebar .row[data-id="${a.id}"] .row-text`)).toHaveText(rowText(a, false));
  await expect(page.locator(`svg g.node[data-key="s:${from}"]`)).toHaveCount(1);
  await expect(status(page)).toHaveText("Valid");
});

test("Save downloads a file that validates with the SDK", async ({ page }) => {
  await loadExample(page, walking);
  await page.locator('.sidebar .row[data-id="walk-commute"]').click();
  const meta = page.locator(".right textarea.mono").first();
  await meta.fill('{"role": "decision"}');
  await meta.blur();
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Save", exact: true }).click()]);
  expect(download.suggestedFilename()).toBe(walking.file);
  const filePath = await download.path();
  const text = readFileSync(filePath!, "utf8");
  const data = JSON.parse(text) as WorldviewDocument;
  expect(validateDict(data)).toEqual([]);
  expect(data.statements).toHaveLength(walking.statements);
  expect(data.statements.find((s) => s.id === "walk-commute")?.meta).toEqual({ role: "decision" });
  // the SDK's canonical key order, and otherwise the example unchanged
  expect(Object.keys(data)).toEqual(Object.keys(worldviewToDict(walking.wv)));
  expect(text).toBe(JSON.stringify(worldviewToDict(parseWorldview(data)), null, 2) + "\n");
  const expected = worldviewToDict(walking.wv);
  expected.statements.find((s) => s.id === "walk-commute")!.meta = { role: "decision" };
  expect(data).toEqual(expected);
  await expect(page.locator(".toasts")).toContainText(`Saved ${walking.file}`);
  await expect(page.locator(".statusbar .dirty")).toHaveCount(0);
});

test("the diff tab compares with the fork example in both directions", async ({ page }) => {
  await loadExample(page, walking);
  const asB = diff(fork.wv, walking.wv).summary; // default: A = the fork, B = the working document
  const asA = diff(walking.wv, fork.wv).summary; // swapped: A = the working document, B = the fork
  const line = (s: typeof asB): string =>
    `Statements: ${s.statements.identical} identical, ${s.statements.rejustified} rejustified, ${s.statements.added} added, ${s.statements.removed} removed. ` +
    `Arguments: ${s.arguments.identical} identical, ${s.arguments.added} added, ${s.arguments.removed} removed.`;

  await page.getByRole("tab", { name: "Diff" }).click();
  await page.locator(".sidebar select").nth(1).selectOption(fork.file);
  const summary = page.locator(".diff-summary");
  const stmts = page.locator(".diff-result section", { has: page.locator("h3", { hasText: /^Statements$/ }) });
  const count = (title: string): Locator => stmts.locator(".bucket", { has: page.locator("strong", { hasText: new RegExp(`^${title}$`) }) }).locator("summary .badge.count");

  await expect(page.locator(".diff-sides")).toContainText(`A example: ${fork.file}`);
  await expect(summary).toHaveText(line(asB));
  await expect(count("Rejustified")).toHaveText(String(asB.statements.rejustified));
  await expect(count("Added")).toHaveText(String(asB.statements.added));
  await expect(count("Removed")).toHaveText(String(asB.statements.removed));

  await page.getByRole("button", { name: /swap A\/B/ }).click();
  await expect(page.locator(".diff-sides")).toContainText(`A working document (${walking.file})`);
  await expect(summary).toHaveText(line(asA));
  // the fork's documented edits: 2 added, 1 removed, 2 rejustified
  await expect(count("Added")).toHaveText("2");
  await expect(count("Removed")).toHaveText("1");
  await expect(count("Rejustified")).toHaveText("2");
  const rejustified = stmts.locator(".bucket", { has: page.locator("strong", { hasText: /^Rejustified$/ }) });
  await expect(rejustified.locator("li")).toHaveCount(2);
  for (const e of diff(walking.wv, fork.wv).statements.rejustified) await expect(rejustified.locator("button.link", { hasText: new RegExp(`^${e.a}$`) })).toBeVisible();
  // entries only in the fork are not clickable; a rejustified entry selects it in the working document
  const added = stmts.locator(".bucket", { has: page.locator("strong", { hasText: /^Added$/ }) });
  await expect(added.locator("button.link")).toHaveCount(0);
  await rejustified.locator("button.link", { hasText: /^need-raincoat$/ }).click();
  await expect(page.locator(".right input.mono")).toHaveValue("need-raincoat");
});

test("the theme toggle flips data-theme on <html> and survives a reload", async ({ page }) => {
  const html = page.locator("html");
  await expect(html).not.toHaveAttribute("data-theme");
  const theme = page.getByRole("button", { name: /^Theme/ });
  await theme.click();
  await expect(html).toHaveAttribute("data-theme", "light");
  await theme.click();
  await expect(html).toHaveAttribute("data-theme", "dark");
  await page.reload();
  await expect(html).toHaveAttribute("data-theme", "dark");
  await page.getByRole("button", { name: /^Theme/ }).click();
  await expect(html).not.toHaveAttribute("data-theme");
});

test("reload restores the autosaved document", async ({ page }) => {
  await loadExample(page, walking);
  await sidebarButton(page, "+ Statement").click();
  await page.locator(".right textarea").first().fill("Persisted across reloads.");
  await expect(page.locator(".statusbar")).toContainText(plural(walking.statements + 1, "statement"));
  await page.waitForTimeout(600); // the autosave debounce
  await page.reload();
  await expect(rows(page)).toHaveCount(walking.statements + 1);
  await expect(rows(page).last()).toContainText("Persisted across reloads.");
  await expect(page.locator(".statusbar .dirty")).toBeVisible();
  await expect(page.locator(".statusbar")).toContainText(walking.file);
  await expect(status(page)).toHaveText("Valid");
});

test("invalid meta JSON is reported and never committed; ext namespaces must be objects", async ({ page }) => {
  await loadExample(page, walking);
  await page.locator('.sidebar .row[data-id="walk-commute"]').click();
  const undo = page.locator(".toolbar").getByRole("button", { name: /Undo/ });
  const meta = page.locator(".right textarea.mono").first();
  await meta.fill("{ not json");
  await meta.blur();
  await expect(page.locator(".right .field-error:visible")).toContainText("Not valid JSON");
  await expect(status(page)).toHaveText("Valid");
  await expect(undo).toBeDisabled(); // nothing was committed
  const ext = page.locator(".right textarea.mono").nth(1);
  await ext.fill('{"bayes": 0.5}');
  await ext.blur();
  await expect(page.locator(".right .field-error:visible")).toHaveCount(2);
  await expect(page.locator(".right .field-error:visible").nth(1)).toContainText("must be an object");
  await expect(undo).toBeDisabled();
  await meta.fill('{"role": "decision"}');
  await meta.blur();
  await ext.fill('{"bayes": {"prior": 0.5}}');
  await ext.blur();
  await expect(page.locator(".right .field-error:visible")).toHaveCount(0);
  await expect(undo).toBeEnabled();
  await expect(status(page)).toHaveText("Valid");
});

test("single-key shortcuts do not fire while typing", async ({ page }) => {
  await loadExample(page, walking);
  await page.locator('.sidebar .row[data-id="walk-commute"]').click();
  const original = walking.doc.statements.find((s) => s.id === "walk-commute")!.text;
  const text = page.locator(".right textarea").first();
  await text.click();
  await text.press("End");
  await text.pressSequentially(" f?");
  await expect(page.locator(".modal")).toHaveCount(0);
  await expect(text).toHaveValue(`${original} f?`);
  await text.press("Delete");
  await expect(page.locator(".modal")).toHaveCount(0);
  await expect(rows(page)).toHaveCount(walking.statements);
  await text.press("Escape"); // leaves the field and commits
  await expect(text).not.toBeFocused();
  await expect(page.locator('.sidebar .row[data-id="walk-commute"]')).toContainText(`${original} f?`);
  await page.keyboard.press("?");
  await expect(page.locator(".modal")).toContainText("Keyboard");
  await page.keyboard.press("Escape");
  await expect(page.locator(".modal")).toHaveCount(0);
  await page.keyboard.press("Delete");
  await expect(page.locator(".modal")).toContainText('Delete statement "walk-commute"');
  await page.keyboard.press("Escape");
  await expect(page.locator(".modal")).toHaveCount(0);
  await expect(rows(page)).toHaveCount(walking.statements);
});

test("the Descartes example lays out within 10 seconds and the inspector follows the selection", async ({ page }) => {
  expect(descartes.statements + descartes.arguments).toBeGreaterThan(600); // starts in focus mode
  await loadExample(page, descartes);
  await expect(page.locator(".toasts")).toContainText("Large document");
  await expect(page.locator(".statusbar")).toContainText(descartes.counts);
  await expect(page.locator(".graph-controls")).toContainText("statements hidden");
  await expect(page.locator("svg.graph-svg g.node").first()).toBeVisible({ timeout: 10_000 });
  await page.locator(".graph-controls select").first().selectOption("off");
  await expect(page.locator("svg.graph-svg g.node.statement")).toHaveCount(descartes.statements, { timeout: 10_000 });
  await expect(page.locator("svg.graph-svg g.node.argument")).toHaveCount(descartes.arguments);
  await expect(page.locator(".graph-controls")).not.toContainText("statements hidden");

  const row = rows(page).nth(40);
  const id = (await row.getAttribute("data-id"))!;
  await row.click();
  await expect(page.locator(".right input.mono")).toHaveValue(id);
  await expect(page.locator(".inspector")).toContainText("Rests on");
  await expect(page.locator(".inspector")).toContainText("Foundations reached");
  await expect(page.locator("svg g.node[data-state=selected]")).toHaveAttribute("data-key", `s:${id}`);

  const other = rows(page).nth(200);
  const otherId = (await other.getAttribute("data-id"))!;
  await other.click();
  await expect(page.locator(".right input.mono")).toHaveValue(otherId);
  await expect(page.locator("svg g.node[data-state=selected]")).toHaveAttribute("data-key", `s:${otherId}`);
  await expect(page.locator("svg g.node[data-state=selected]")).toHaveCount(1);
});
