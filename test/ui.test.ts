/**
 * Static-UI tests: pure formatters, tree filtering and frame geometry.
 * Run with `npm test` (node --test via tsx).
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { visibleWidth } from "@earendil-works/pi-tui";
import { applyTreeFilter } from "../src/data/tree.ts";
import type { TreeRow } from "../src/types.ts";
import { fit, frame, sideBySide } from "../src/ui/frame.ts";
import { scrollOffset } from "../src/ui/panes/sessions-pane.ts";
import { formatCost, formatTokens, shortenPath, singleLine } from "../src/utils/format.ts";

test("formatTokens / formatCost", () => {
	assert.equal(formatTokens(84213), "84.2k");
	assert.equal(formatTokens(999), "999");
	assert.equal(formatTokens(1_500_000), "1.5M");
	assert.equal(formatCost(1.4211), "$1.42");
});

test("shortenPath replaces the home prefix and singleLine collapses whitespace", () => {
	const home = process.env.HOME ?? "";
	if (home) assert.equal(shortenPath(`${home}/x/y`), "~/x/y");
	assert.equal(shortenPath("/tmp/z"), "/tmp/z");
	assert.equal(singleLine("  a\n\n b\tc "), "a b c");
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
