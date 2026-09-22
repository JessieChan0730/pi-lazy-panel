/**
 * Static-UI tests: pure formatters, tree filtering and frame geometry.
 * Run with `npm test` (node --test via tsx).
 */

import assert from "node:assert/strict";
import { homedir } from "node:os";
import { join, sep } from "node:path";
import { test } from "node:test";
import { stripTerminalSequences, visibleWidth } from "@earendil-works/pi-tui";
import { applyTreeFilter } from "../src/data/tree.ts";
import { applyTreeFold, defaultFolded, foldableIds, foldTarget } from "../src/data/tree-fold.ts";
import type { TreeRow } from "../src/types.ts";
import { fit, FRAME_DIVIDER, frame, metaBudget, overlayCentered, sideBySide } from "../src/ui/frame.ts";
import { scrollOffset, sessionsMeta } from "../src/ui/panes/sessions-pane.ts";
import { renderTreePane } from "../src/ui/panes/tree-pane.ts";
import { treePrefixes } from "../src/ui/tree-lines.ts";
import { ELLIPSIS, MARK_FOLDED, MARK_LEAF, MARK_OPEN, MAX_DEPTH, treeOutline } from "../src/ui/tree-outline.ts";
import { TreeDialog } from "../src/ui/widgets/tree-dialog.ts";
import { formatCost, formatTokens, normalizeNewlines, shortenPath, singleLine } from "../src/utils/format.ts";

/** Styling is irrelevant here: a theme that returns text unchanged. */
const plainTheme = {
	fg: (_c: string, s: string) => s,
	bg: (_c: string, s: string) => s,
	bold: (s: string) => s,
	italic: (s: string) => s,
	underline: (s: string) => s,
	inverse: (s: string) => s,
	strikethrough: (s: string) => s,
};

test("formatTokens / formatCost", () => {
	assert.equal(formatTokens(84213), "84.2k");
	assert.equal(formatTokens(999), "999");
	assert.equal(formatTokens(1_500_000), "1.5M");
	assert.equal(formatCost(1.4211), "$1.42");
});

test("shortenPath replaces the home prefix and singleLine collapses whitespace", () => {
	// 用 os.homedir() + path.join，Windows 上没有 HOME 环境变量，路径分隔符也是 `\`。
	const home = homedir();
	assert.equal(shortenPath(home), "~");
	assert.equal(shortenPath(join(home, "x", "y")), `~${sep}x${sep}y`);
	// 同一台机器上也可能出现另一种分隔符（git bash / 手写路径），两种都要认。
	assert.equal(shortenPath(`${home}/x/y`), "~/x/y");
	// 只是前缀相同但不是子目录，不能缩写。
	assert.equal(shortenPath(`${home}xyz`), `${home}xyz`);
	// 不在 home 下的路径原样返回（Windows 的 tmpdir 在 home 里，所以不能拿它当反例）。
	const outside = process.platform === "win32" ? "D:\\work\\z" : "/opt/z";
	assert.equal(shortenPath(outside), outside);
	assert.equal(singleLine("  a\n\n b\tc "), "a b c");
	assert.equal(normalizeNewlines("a\r\nb\rc\n"), "a\nb\nc\n");
});

test("fit pads and truncates to the exact width, including wide chars", () => {
	assert.equal(visibleWidth(fit("abc", 6)), 6);
	assert.equal(visibleWidth(fit("abcdefghij", 6)), 6);
	assert.equal(visibleWidth(fit("中文字符测试", 7)), 7);
	assert.equal(visibleWidth(fit("\x1b[31mred\x1b[39m", 5)), 5);
});

test("frame produces height lines of exact width", () => {
	const id = (s: string) => s;
	for (const [w, h] of [
		[10, 3],
		[30, 8],
		[6, 2],
	] as const) {
		const lines = frame(["body line that is longer than the box", "x"], {
			width: w,
			height: h,
			title: "SESSIONS",
			meta: "1/2",
			border: id,
			titleStyle: id,
		});
		assert.equal(lines.length, h);
		for (const l of lines) assert.equal(visibleWidth(l), w, JSON.stringify(l));
	}
});

test("metaBudget matches frame: meta at the budget is kept, one column over is dropped", () => {
	const id = (s: string) => s;
	const title = "[1] SESSIONS";
	const width = 40;
	const budget = metaBudget(width, title);
	assert.ok(budget > 0);
	const top = (meta: string) => frame([], { width, height: 3, title, meta, border: id, titleStyle: id })[0]!;
	assert.ok(top("x".repeat(budget)).includes("x".repeat(budget)));
	assert.equal(top("x".repeat(budget + 1)).includes("x"), false);
});

test("sessionsMeta degrades in order but always keeps position and scope", () => {
	const wide = sessionsMeta(15, 0, "current-folder", "recent", 80);
	assert.equal(wide, "1/15 · Current · recent");
	assert.equal(sessionsMeta(15, 0, "all", "recent", 80), "1/15 · All · recent");
	// drop sort, then shorten the scope, then position only
	assert.equal(sessionsMeta(15, 0, "current-folder", "recent", visibleWidth(wide) - 1), "1/15 · Current");
	assert.equal(sessionsMeta(15, 0, "current-folder", "recent", 10), "1/15 · Cur");
	assert.equal(sessionsMeta(15, 0, "current-folder", "recent", 4), "1/15");
	// no rows: just the scope label
	assert.equal(sessionsMeta(0, 0, "current-folder", "recent", 80), "Current");
	assert.equal(sessionsMeta(0, 0, "all", "recent", 2), "All");
});

test("sideBySide joins columns to leftWidth + rightWidth", () => {
	const out = sideBySide(["a", "b", "c"], ["x"], 3, 4);
	assert.equal(out.length, 3);
	for (const l of out) assert.equal(visibleWidth(l), 7);
});

test("overlayCentered draws the box in the middle of the base lines and keeps every width", () => {
	const base = Array.from({ length: 10 }, () => "x".repeat(20));
	const box = ["┌──┐", "│ab│", "└──┘"];
	const out = overlayCentered(base, box, 4, 20);
	assert.equal(out.length, 10);
	for (const l of out) assert.equal(visibleWidth(l), 20);
	// rows 3..5, columns 8..11
	assert.equal(stripTerminalSequences(out[3]!), "xxxxxxxx┌──┐xxxxxxxx");
	assert.equal(stripTerminalSequences(out[4]!), "xxxxxxxx│ab│xxxxxxxx");
	assert.equal(stripTerminalSequences(out[5]!), "xxxxxxxx└──┘xxxxxxxx");
	assert.equal(out[2], base[2]);
	assert.equal(out[6], base[6]);
	// a box taller than the base is clipped, never extends the output
	assert.equal(overlayCentered(["yy"], box, 4, 2).length, 1);
});

test("scrollOffset keeps the cursor visible", () => {
	assert.equal(scrollOffset(0, 5, 10), 0);
	assert.equal(scrollOffset(9, 10, 4), 6);
	assert.equal(scrollOffset(5, 10, 4), 3);
});

test("applyTreeFilter mirrors /tree filters: default hides bookkeeping only, no-tools also drops tool results", () => {
	const row = (over: Partial<TreeRow>): TreeRow => ({
		entryId: "e",
		role: "user",
		kind: "message",
		text: "",
		timestamp: 0,
		onActiveBranch: true,
		...over,
	});
	const rows = [
		row({ entryId: "s", role: "system", kind: "system" }),
		row({ entryId: "u", role: "user" }),
		row({ entryId: "a", role: "assistant", label: "L" }),
		row({ entryId: "t", role: "tool", kind: "tool" }),
		row({ entryId: "m", role: "system", kind: "meta" }),
	];
	const ids = (r: TreeRow[]) => r.map((x) => x.entryId);
	assert.deepEqual(ids(applyTreeFilter(rows, "default")), ["s", "u", "a", "t"]);
	assert.deepEqual(ids(applyTreeFilter(rows, "no-tools")), ["s", "u", "a"]);
	assert.deepEqual(ids(applyTreeFilter(rows, "user-only")), ["u"]);
	assert.deepEqual(ids(applyTreeFilter(rows, "labeled")), ["a"]);
	assert.deepEqual(ids(applyTreeFilter(rows, "all")), ["s", "u", "a", "t", "m"]);
});

test("applyTreeFilter re-parents rows whose parent was filtered out to the nearest kept ancestor", () => {
	const row = (entryId: string, over: Partial<TreeRow>): TreeRow => ({
		entryId,
		role: "user",
		kind: "message",
		text: "",
		timestamp: 0,
		onActiveBranch: true,
		...over,
	});
	// u1 → t1(tool) → a1 → t2(tool) → u2 ; the tools vanish under "no-tools"
	const rows = [
		row("u1", {}),
		row("t1", { parentId: "u1", role: "tool", kind: "tool" }),
		row("a1", { parentId: "t1", role: "assistant" }),
		row("t2", { parentId: "a1", role: "tool", kind: "tool" }),
		row("u2", { parentId: "t2" }),
	];
	const parents = (r: TreeRow[]) => r.map((x) => [x.entryId, x.parentId]);
	assert.deepEqual(parents(applyTreeFilter(rows, "no-tools")), [
		["u1", undefined],
		["a1", "u1"],
		["u2", "a1"],
	]);
	// a filtered-out root leaves its child as a new root (no parentId key at all)
	assert.deepEqual(parents(applyTreeFilter(rows, "user-only")), [
		["u1", undefined],
		["u2", "u1"],
	]);
	const [newRoot] = applyTreeFilter([row("t0", { role: "tool", kind: "tool" }), row("u3", { parentId: "t0" })], "no-tools");
	assert.equal(newRoot!.entryId, "u3");
	assert.equal("parentId" in newRoot!, false);
	// untouched rows are returned as-is
	assert.equal(applyTreeFilter(rows, "all"), rows);
	assert.equal(applyTreeFilter(rows, "default")[1], rows[1]);
});

/** A tree row for the geometry tests: text = id, on the active branch unless said otherwise. */
function node(entryId: string, parentId?: string, onActiveBranch = true): TreeRow {
	return { entryId, ...(parentId ? { parentId } : {}), role: "user", kind: "message", text: entryId, timestamp: 0, onActiveBranch };
}

/** Rows of a small forest: prefixes follow pi's /tree (branch → +1 level, first generation after → +1, chains flat). */
function forest(): TreeRow[] {
	//  root
	//  ├⊟ a        (root has 2 children)
	//  │     a1    (single child of a: +1 level for the first generation, no connector)
	//  └⊟ b
	//     ├⊟ b1
	//     │     b1x   (single child of b1: indented one more, gutter under b1 because b2 follows)
	//     └─ b2
	return [node("root"), node("a", "root"), node("a1", "a"), node("b", "root"), node("b1", "b"), node("b1x", "b1"), node("b2", "b")];
}

/** A chain of branch points: each level has a dead-end sibling, so the indent keeps growing (n5 sits 6 levels deep). */
function deepChain(): TreeRow[] {
	const rows = [node("r")];
	let parent = "r";
	for (let i = 0; i < 6; i++) {
		rows.push(node(`x${i}`, parent), node(`n${i}`, parent));
		parent = `n${i}`;
	}
	return rows;
}

test("treePrefixes draws pi-style guide lines; folded rows get ⊞", () => {
	const rows = forest();
	assert.deepEqual(treePrefixes(rows), [
		"", // root
		"├⊟ ", // a: connector, has a child
		"│     ", // a1: gutter from a's connector (b still to come) + blank level
		"└⊟ ", // b: last child of root
		"   ├⊟ ", // b1: no gutter (b was last), connector
		"   │     ", // b1x: gutter under b1 (b2 still to come), single child so no connector
		"   └─ ", // b2
	]);
	// rows whose parent is unknown are treated as roots; two roots hang off a virtual root without connectors
	const twoRoots = [rows[0]!, { ...rows[1]!, parentId: "missing" }];
	assert.deepEqual(treePrefixes(twoRoots), ["", ""]);
	// a folded row (its descendants already dropped by applyTreeFold) shows ⊞ on its connector
	const folded = new Set(["a"]);
	assert.deepEqual(treePrefixes(applyTreeFold(rows, folded), folded), ["", "├⊞ ", "└⊟ ", "   ├⊟ ", "   │     ", "   └─ "]);
	// a folded root among several has no connector, so the marker follows the (empty) prefix like in pi
	const roots = [rows[0]!, { ...rows[3]!, parentId: "missing" }, rows[4]!, rows[5]!, rows[6]!];
	assert.deepEqual(treePrefixes(roots), ["", "", "├⊟ ", "│     ", "└─ "]);
	const foldedRoot = new Set(["b"]);
	assert.deepEqual(treePrefixes(applyTreeFold(roots, foldedRoot), foldedRoot), ["", "⊞ "]);
});

test("tree-fold: segment starts with children fold, side branches start folded, z targets the enclosing head", () => {
	const active = new Set(["root", "b", "b2"]);
	const rows = forest().map((r) => ({ ...r, onActiveBranch: active.has(r.entryId) }));
	// a lone root never folds; a / b / b1 are children of a branch point and have children; b2 has none
	assert.deepEqual([...foldableIds(rows)].sort(), ["a", "b", "b1"]);
	assert.deepEqual([...defaultFolded(rows)].sort(), ["a", "b1"]);
	// folding hides every descendant; ids that are not foldable are ignored
	assert.deepEqual(applyTreeFold(rows, new Set(["a", "b1"])).map((r) => r.entryId), ["root", "a", "b", "b1", "b2"]);
	assert.deepEqual(applyTreeFold(rows, new Set(["root", "b2", "nope"])).map((r) => r.entryId), rows.map((r) => r.entryId));
	assert.equal(applyTreeFold(rows, new Set()), rows);
	// z: the row itself when foldable, else the head of its segment, nothing on the trunk
	assert.equal(foldTarget(rows, "a"), "a");
	assert.equal(foldTarget(rows, "a1"), "a");
	assert.equal(foldTarget(rows, "b1x"), "b1");
	assert.equal(foldTarget(rows, "b2"), "b");
	assert.equal(foldTarget(rows, "root"), undefined);
	// several roots are segment starts of a virtual root: each root with children folds
	const roots = [rows[0]!, rows[1]!, { ...rows[3]!, parentId: "missing" }, rows[4]!];
	assert.deepEqual([...foldableIds(roots)].sort(), ["b", "root"]);
	assert.equal(foldTarget(roots, "a"), "root");
});

test("treeOutline: triangles on segment starts, 2 columns per level below a head, … past MAX_DEPTH", () => {
	const rows = forest();
	const text = (outline: Map<string, { indent: string; marker: string }>, id: string) => `${outline.get(id)!.indent}${outline.get(id)!.marker}`;
	const open = treeOutline(rows, new Set());
	assert.deepEqual(
		rows.map((r) => text(open, r.entryId)),
		[
			"", // root: a lone root is not a segment start, nothing in front of it
			"▾ ", // a: child of a branch point with children; the triangle sits where the trunk's text starts
			"  ", // a1: one level below a, right under a's text
			"▾ ", // b
			"  ▾ ", // b1: inside b, itself a segment start
			"    ", // b1x: inside b1
			"  ─ ", // b2: segment start without children
		],
	);
	const folded = treeOutline(rows, new Set(["a"]));
	assert.equal(text(folded, "a"), MARK_FOLDED);
	assert.equal(text(folded, "b"), MARK_OPEN);
	// a linear conversation is flat: no indent, no marker
	const chain = [node("r"), node("s", "r"), node("t", "s")];
	assert.deepEqual([...treeOutline(chain, new Set()).values()], [{ indent: "", marker: "" }, { indent: "", marker: "" }, { indent: "", marker: "" }]);
	// depth is capped: rows past MAX_DEPTH keep the width of a MAX_DEPTH row with `… ` standing in for the outer levels
	const deep = treeOutline(deepChain(), new Set());
	assert.equal(text(deep, "n3"), `${"  ".repeat(MAX_DEPTH)}${MARK_OPEN}`);
	assert.equal(text(deep, "n4"), `${ELLIPSIS}${"  ".repeat(MAX_DEPTH - 1)}${MARK_OPEN}`);
	assert.equal(text(deep, "n5"), `${ELLIPSIS}${"  ".repeat(MAX_DEPTH - 1)}${MARK_LEAF}`);
});

test("renderTreePane draws the outline with at most MAX_DEPTH levels; the dialog draws full guide lines and ⊞ for folded rows", () => {
	const deep = deepChain();
	const pane = renderTreePane({ rows: deep, cursor: deep.length - 1, focused: true, theme: plainTheme as never }, 60, deep.length + 2).map((l) =>
		stripTerminalSequences(l),
	);
	// n3 is the deepest level drawn as such; n5 (6 levels deep) is capped to the same width with a leading …
	assert.ok(pane.some((l) => l.includes(`${"  ".repeat(MAX_DEPTH)}${MARK_OPEN}• `) && l.includes("user: n3")), pane.join("\n"));
	const last = pane.at(-2)!;
	assert.ok(last.includes(`› ${ELLIPSIS}${"  ".repeat(MAX_DEPTH - 1)}${MARK_LEAF}• `) && last.includes("user: n5"), last);
	for (const l of pane) assert.equal(visibleWidth(l), 60);

	const dlg = new TreeDialog({ theme: plainTheme as never, onChange: () => {} });
	dlg.open({ rows: deep, initialIndex: deep.length - 1, filter: "default", onClose: () => {} });
	let box = dlg.render(80, deep.length + 6).map((l) => stripTerminalSequences(l));
	assert.ok(!box.some((l) => l.includes(ELLIPSIS)), "dialog never caps the depth");
	assert.ok(box.some((l) => l.includes(`${" ".repeat(15)}└─ `) && l.includes("user: n5")), box.join("\n"));
	for (const l of box) assert.equal(visibleWidth(l), 80);
	// the dialog shares the pane's fold state: a folded row shows ⊞ and its descendants are gone
	const folded = new Set(["n2"]);
	dlg.open({ rows: applyTreeFold(deep, folded), folded, filter: "default", onClose: () => {} });
	box = dlg.render(80, deep.length + 6).map((l) => stripTerminalSequences(l));
	assert.ok(box.some((l) => l.includes("└⊞ ") && l.includes("user: n2")), box.join("\n"));
	assert.ok(!box.some((l) => l.includes("user: n3")));
});

test("frame draws FRAME_DIVIDER body lines as ├──┤", () => {
	const idFn = (s: string) => s;
	const out = frame(["a", FRAME_DIVIDER, "b"], { width: 6, height: 5, title: "T", border: idFn, titleStyle: idFn });
	assert.equal(out[2], "├────┤");
	assert.equal(out[1], "│a   │");
	for (const l of out) assert.equal(visibleWidth(l), 6);
});
