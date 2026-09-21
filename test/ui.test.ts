/**
 * Static-UI tests: pure formatters, tree filtering and frame geometry.
 * Run with `npm test` (node --test via tsx).
 */

import assert from "node:assert/strict";
import { homedir } from "node:os";
import { join, sep } from "node:path";
import { test } from "node:test";
import { visibleWidth } from "@earendil-works/pi-tui";
import { applyTreeFilter } from "../src/data/tree.ts";
import type { TreeRow } from "../src/types.ts";
import { fit, frame, metaBudget, sideBySide } from "../src/ui/frame.ts";
import { scrollOffset, sessionsMeta } from "../src/ui/panes/sessions-pane.ts";
import { formatCost, formatTokens, normalizeNewlines, shortenPath, singleLine } from "../src/utils/format.ts";

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

test("scrollOffset keeps the cursor visible", () => {
	assert.equal(scrollOffset(0, 5, 10), 0);
	assert.equal(scrollOffset(9, 10, 4), 6);
	assert.equal(scrollOffset(5, 10, 4), 3);
});

test("applyTreeFilter mirrors /tree filters", () => {
	const row = (over: Partial<TreeRow>): TreeRow => ({
		entryId: "e",
		depth: 0,
		role: "user",
		kind: "message",
		text: "",
		timestamp: 0,
		onActiveBranch: true,
		...over,
	});
	const rows = [
		row({ entryId: "u", role: "user" }),
		row({ entryId: "a", role: "assistant", label: "L" }),
		row({ entryId: "t", role: "tool", kind: "tool" }),
		row({ entryId: "m", role: "system", kind: "meta" }),
	];
	const ids = (r: TreeRow[]) => r.map((x) => x.entryId);
	assert.deepEqual(ids(applyTreeFilter(rows, "default")), ["u", "a"]);
	assert.deepEqual(ids(applyTreeFilter(rows, "tools")), ["u", "a", "t"]);
	assert.deepEqual(ids(applyTreeFilter(rows, "user-only")), ["u"]);
	assert.deepEqual(ids(applyTreeFilter(rows, "labeled")), ["a"]);
	assert.deepEqual(ids(applyTreeFilter(rows, "all")), ["u", "a", "t", "m"]);
});
