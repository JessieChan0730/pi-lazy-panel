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
import {
	applyTreeFold,
	defaultFolded,
	filterTreeRows,
	foldableIds,
	foldedAncestors,
	foldTarget,
	nearestListedIndex,
} from "../src/data/tree-fold.ts";
import type { TreeRow } from "../src/types.ts";
import { fit, FRAME_DIVIDER, frame, metaBudget, overlayCentered, sideBySide } from "../src/ui/frame.ts";
import { hitTest, listVisibleRows, panelGeometry } from "../src/ui/mouse.ts";
import { scrollOffset, sessionsMeta } from "../src/ui/panes/sessions-pane.ts";
import { renderTreePane, treeMeta } from "../src/ui/panes/tree-pane.ts";
import { layoutContent } from "../src/ui/panes/content-pane.ts";
import { highlightLine, searchMeta } from "../src/ui/search-highlight.ts";
import { treePrefixes } from "../src/ui/tree-lines.ts";
import { ELLIPSIS, MARK_FOLDED, MARK_LEAF, MARK_OPEN, MAX_DEPTH, treeOutline } from "../src/ui/tree-outline.ts";
import { treeSearchHints, TreeDialog } from "../src/ui/widgets/tree-dialog.ts";
import { formatCost, formatTokens, normalizeNewlines, shortenPath, singleLine } from "../src/utils/format.ts";
import { initI18n } from "../src/i18n/index.ts";

// 测试统一按英文界面断言。
initI18n("en");

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

test("tree-fold: nearestListedIndex walks up to a listed ancestor, foldedAncestors names what hides a row", () => {
	const rows = forest();
	const listed = applyTreeFold(rows, new Set(["a", "b1"]));
	assert.deepEqual(listed.map((r) => r.entryId), ["root", "a", "b", "b1", "b2"]);
	assert.equal(nearestListedIndex(listed, rows, "b2"), 4);
	assert.equal(nearestListedIndex(listed, rows, "b1x"), 3, "hidden row → its listed parent");
	assert.equal(nearestListedIndex(listed, rows, "a1"), 1);
	assert.equal(nearestListedIndex(listed, rows, "nope"), 4, "unknown → last row, like pi");
	assert.equal(nearestListedIndex(listed, rows, undefined), 4);
	assert.equal(nearestListedIndex([], rows, "a"), 0);
	// a search-narrowed list with re-parented rows still finds the ancestor through the full tree
	const narrowed = filterTreeRows(rows, (r) => r.entryId === "root" || r.entryId === "b2");
	assert.equal(nearestListedIndex(narrowed, rows, "b1x"), 0, "b1 and b are gone, root is listed");
	assert.deepEqual(foldedAncestors(rows, "b1x", new Set(["a", "b1", "b"])), ["b1", "b"]);
	assert.deepEqual(foldedAncestors(rows, "b1x", new Set(["a"])), []);
	assert.deepEqual(foldedAncestors(rows, "root", new Set(["root"])), []);
});

test("filterTreeRows re-parents survivors to the nearest kept ancestor and returns untouched rows as-is", () => {
	const rows = forest();
	const out = filterTreeRows(rows, (r) => r.entryId !== "b" && r.entryId !== "b1");
	assert.deepEqual(
		out.map((r) => [r.entryId, r.parentId]),
		[
			["root", undefined],
			["a", "root"],
			["a1", "a"],
			["b1x", "root"],
			["b2", "root"],
		],
	);
	assert.equal(out[1], rows[1], "rows whose parent survived are the same objects");
	assert.deepEqual(filterTreeRows(rows, () => true), rows);
	assert.deepEqual(filterTreeRows(rows, () => false), []);
});

test("treeMeta names a non-default filter next to the position and degrades to the position alone", () => {
	assert.equal(treeMeta(12, 1, "default", 40), "2/12");
	assert.equal(treeMeta(12, 1, "user-only", 40), "2/12 · user-only");
	assert.equal(treeMeta(12, 1, "user-only", 6), "2/12");
	assert.equal(treeMeta(0, 0, "labeled", 40), "labeled");
	assert.equal(treeMeta(0, 0, "default", 40), "");
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
	dlg.open({ rows: deep, initialIndex: deep.length - 1, filter: "default" });
	let box = dlg.render(80, deep.length + 6).map((l) => stripTerminalSequences(l));
	assert.ok(!box.some((l) => l.includes(ELLIPSIS)), "dialog never caps the depth");
	assert.ok(box.some((l) => l.includes(`${" ".repeat(15)}└─ `) && l.includes("user: n5")), box.join("\n"));
	for (const l of box) assert.equal(visibleWidth(l), 80);
	// the dialog shares the pane's fold state: a folded row shows ⊞ and its descendants are gone
	const folded = new Set(["n2"]);
	dlg.open({ rows: applyTreeFold(deep, folded), folded, filter: "default" });
	box = dlg.render(80, deep.length + 6).map((l) => stripTerminalSequences(l));
	assert.ok(box.some((l) => l.includes("└⊞ ") && l.includes("user: n2")), box.join("\n"));
	assert.ok(!box.some((l) => l.includes("user: n3")));
});

test("layoutContent keeps the message box square for CJK headers (你 / AI助手 are wide)", () => {
	// 头部标签在中文界面是全角字符（占 2 列）：盒子上边框的填充必须按可见宽度算，
	// 否则 ┐ 会被推到右边、和下边框 ┘ 对不齐（宽度算漏时甚至溢出被截成 …）。
	const inner = 40;
	initI18n("zh");
	try {
		const blocks = [
			{ entryId: "u", role: "user" as const, timestamp: 0, markdown: "hi" },
			{ entryId: "a", role: "assistant" as const, timestamp: 0, markdown: "hello" },
		];
		const { lines } = layoutContent(blocks, inner, plainTheme as never);
		// 每个盒子的行（去掉块间空行）都应是同一个可见宽度 inner - 1，上下边框才对齐。
		for (const l of lines) {
			if (l === "") continue;
			assert.equal(visibleWidth(stripTerminalSequences(l)), inner - 1, JSON.stringify(stripTerminalSequences(l)));
		}
	} finally {
		initI18n("en");
	}
});

test("TreeDialog search row: idle hint, live query reports, Esc keeps the query and hands the keys back, Enter means nothing", () => {
	const queries: string[] = [];
	const dlg = new TreeDialog({ theme: plainTheme as never, onChange: () => {} });
	const rows = forest();
	dlg.open({ rows, filter: "default", hints: [["q", "close"]], searchKey: "/", onQueryChange: (q) => queries.push(q) });
	const box = () => dlg.render(60, 12).map((l) => stripTerminalSequences(l));
	assert.ok(box()[1]!.includes("Search: / to search"), box()[1]);
	assert.deepEqual(dlg.hints, [["q", "close"]]);
	assert.equal(dlg.searchFocused, false);

	dlg.focusSearch();
	assert.equal(dlg.searchFocused, true);
	assert.deepEqual(dlg.hints, treeSearchHints());
	dlg.handleSearchInput("b");
	dlg.handleSearchInput("1");
	assert.deepEqual(queries, ["b", "b1"]);
	assert.equal(dlg.searchQuery, "b1");
	// the panel answers with the narrowed rows; the title counts them and the cursor lands where it says
	dlg.setRows(rows.filter((r) => r.entryId.startsWith("b1")), new Set(), 1);
	assert.ok(box()[0]!.includes("2/2 · default"), box()[0]);
	assert.equal(dlg.selectedRow?.entryId, "b1x");
	// Enter is not a search key: nothing changes
	dlg.handleSearchInput("\r");
	assert.equal(dlg.searchFocused, true);
	assert.equal(dlg.searchQuery, "b1");
	assert.deepEqual(queries, ["b", "b1"]);

	// Esc: keys back to the list, query kept and shown as plain text, nothing reported
	dlg.handleSearchInput("\x1b");
	assert.equal(dlg.searchFocused, false);
	assert.equal(dlg.searchQuery, "b1");
	assert.deepEqual(queries, ["b", "b1"]);
	assert.ok(box()[1]!.includes("Search: b1") && !box()[1]!.includes("to search"), box()[1]);

	// / again continues the same query (cursor at its end); deleting everything reports the empty query
	dlg.focusSearch();
	dlg.handleSearchInput("x");
	assert.equal(dlg.searchQuery, "b1x");
	for (let i = 0; i < 3; i++) dlg.handleSearchInput("\x7f");
	assert.equal(dlg.searchQuery, "");
	assert.equal(queries.at(-1), "");
	dlg.handleSearchInput("\x1b");
	assert.equal(dlg.searchFocused, false);
	assert.ok(box()[1]!.includes("Search: / to search"), box()[1]);

	// no rows while a query is active reads "No matches."
	dlg.focusSearch();
	dlg.handleSearchInput("z");
	dlg.setRows([], new Set(), 0);
	assert.ok(box().some((l) => l.includes("No matches.")), box().join("\n"));
	assert.ok(box()[0]!.includes("0/0"), box()[0]);
	for (const l of dlg.render(60, 12)) assert.equal(visibleWidth(l), 60);
	dlg.close();
	assert.equal(dlg.isOpen, false);
	assert.deepEqual(dlg.hints, []);
});

test("frame draws FRAME_DIVIDER body lines as ├──┤", () => {
	const idFn = (s: string) => s;
	const out = frame(["a", FRAME_DIVIDER, "b"], { width: 6, height: 5, title: "T", border: idFn, titleStyle: idFn });
	assert.equal(out[2], "├────┤");
	assert.equal(out[1], "│a   │");
	for (const l of out) assert.equal(visibleWidth(l), 6);
});

test("highlightLine paints the terms by column, keeps the width and the styles around the hit (trailing resets included)", () => {
	const style = (s: string) => `\x1b[43m${s}\x1b[49m`;
	// plain text
	assert.equal(highlightLine("say hello world", ["hello"], style), "say \x1b[43mhello\x1b[49m world");
	// inside a coloured, background-filled cursor row the colours continue after the hit and the closing resets survive
	const row = "\x1b[44m\x1b[31mhello world\x1b[39m\x1b[49m";
	const out = highlightLine(row, ["wor"], style);
	assert.equal(stripTerminalSequences(out), "hello world");
	assert.ok(out.startsWith("\x1b[44m\x1b[31mhello "), out);
	assert.ok(out.includes("\x1b[43mwor\x1b[49m"), out);
	assert.ok(out.endsWith("\x1b[39m\x1b[49m"), out);
	assert.ok(out.slice(out.indexOf("wor\x1b[49m") + 8).startsWith("\x1b[44m\x1b[31mld"), `the part after the hit re-establishes the row's codes: ${out}`);
	// wide characters: columns are counted, not code units
	const cjk = highlightLine("中文 测试 end", ["测试"], style);
	assert.equal(cjk, "中文 \x1b[43m测试\x1b[49m end");
	assert.equal(visibleWidth(cjk), visibleWidth("中文 测试 end"));
	// a hit spanning existing escape codes keeps them and styles only the text runs
	const mixed = highlightLine("ab\x1b[1mcd\x1b[22mef", ["bcde"], style);
	assert.equal(stripTerminalSequences(mixed), "abcdef");
	assert.ok(mixed.includes("\x1b[43mb\x1b[49m\x1b[1m\x1b[43mcd\x1b[49m\x1b[22m\x1b[43me\x1b[49m"), mixed);
	// several terms, case-insensitive; nothing to paint returns the line as-is
	assert.equal(highlightLine("Foo bar", ["foo", "AR"], style), "\x1b[43mFoo\x1b[49m b\x1b[43mar\x1b[49m");
	assert.equal(highlightLine("abc", ["zzz"], style), "abc");
	assert.equal(highlightLine("abc", [], style), "abc");
});

test("searchMeta: position / count, count alone off the matches, no matches; shortened to the budget", () => {
	assert.equal(searchMeta(2, 7, 40), "2/7 matches");
	assert.equal(searchMeta(2, 7, 5), "2/7");
	assert.equal(searchMeta(0, 7, 40), "7 matches");
	assert.equal(searchMeta(0, 7, 3), "7");
	assert.equal(searchMeta(0, 0, 40), "no matches");
	assert.equal(searchMeta(0, 0, 4), "0/0");
});

// -------------------------------------------------------------------------
// Mouse hit-testing (src/ui/mouse.ts) — geometry must match render()
// -------------------------------------------------------------------------

test("panelGeometry splits the viewport the same way render() does", () => {
	// width 100 · height 20 · ratio 0.25: left column 25, sessions 9 / tree 10, footer 1.
	assert.deepEqual(panelGeometry(100, 20, 0.25), { leftW: 25, rightW: 75, bodyH: 19, sessionsH: 9, treeH: 10 });
	// leftW never drops below 24; a wide terminal grows it with the ratio.
	assert.equal(panelGeometry(60, 20, 0.25).leftW, 24);
	assert.equal(panelGeometry(200, 20, 0.25).leftW, 50);
});

test("listVisibleRows counts list rows per pane (sessions 2 lines each, tree 1)", () => {
	// height 20 → sessions pane 9 rows (7 body → 3 items), tree pane 10 rows (8 body → 8 items)
	assert.deepEqual(listVisibleRows(20), { sessions: 3, tree: 8 });
});

function hit(x: number, y: number, over: Partial<Parameters<typeof hitTest>[0]> = {}) {
	return hitTest({ width: 100, height: 20, ratio: 0.25, x, y, sessionsFirst: 0, sessionsTotal: 5, treeFirst: 0, treeTotal: 4, ...over });
}

test("hitTest maps sessions cells (2 lines/row) to row indices, borders / leftover blanks to none", () => {
	assert.deepEqual(hit(2, 1), { pane: "sessions", row: 0 });
	assert.deepEqual(hit(2, 3), { pane: "sessions", row: 1 });
	assert.deepEqual(hit(2, 5), { pane: "sessions", row: 2 });
	assert.deepEqual(hit(2, 7), { pane: "sessions", row: undefined }, "leftover half-row below the last visible item");
	assert.deepEqual(hit(2, 0), { pane: "sessions", row: undefined }, "top border");
	assert.deepEqual(hit(2, 8), { pane: "sessions", row: undefined }, "bottom border");
});

test("hitTest offsets rows by the pane's first visible row (scrolled window)", () => {
	// window starts at index 2 → the three visible rows are 2, 3, 4.
	assert.deepEqual(hit(2, 1, { sessionsFirst: 2 }), { pane: "sessions", row: 2 });
	assert.deepEqual(hit(2, 3, { sessionsFirst: 2 }), { pane: "sessions", row: 3 });
	assert.deepEqual(hit(2, 5, { sessionsFirst: 2 }), { pane: "sessions", row: 4 });
});

test("hitTest maps tree cells (1 line/row) and stops past the last row", () => {
	assert.deepEqual(hit(2, 10), { pane: "tree", row: 0 });
	assert.deepEqual(hit(2, 11), { pane: "tree", row: 1 });
	assert.deepEqual(hit(2, 13), { pane: "tree", row: 3 });
	assert.deepEqual(hit(2, 14), { pane: "tree", row: undefined }, "past the 4th (last) row");
	assert.deepEqual(hit(2, 9), { pane: "tree", row: undefined }, "top border");
	assert.deepEqual(hit(2, 18), { pane: "tree", row: undefined }, "bottom border");
});

test("hitTest maps the right column to content, and the footer / outside to nothing", () => {
	assert.deepEqual(hit(50, 5), { pane: "content", row: undefined });
	assert.deepEqual(hit(25, 10), { pane: "content", row: undefined }, "first column of the right pane");
	assert.equal(hit(50, 19), undefined, "footer row");
	assert.equal(hit(100, 5), undefined, "past the right edge");
	assert.equal(hit(-1, 5), undefined, "before the left edge");
});
