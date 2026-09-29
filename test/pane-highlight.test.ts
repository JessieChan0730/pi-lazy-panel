import assert from "node:assert/strict";
import { resolve } from "node:path";
import { test } from "node:test";
import { stripTerminalSequences, visibleWidth } from "@earendil-works/pi-tui";
import { initI18n } from "../src/i18n/index.ts";
import type { SessionRow, TreeRow } from "../src/types.ts";
import { renderSessionsPane } from "../src/ui/panes/sessions-pane.ts";
import { renderTreePane } from "../src/ui/panes/tree-pane.ts";
import { TreeDialog } from "../src/ui/widgets/tree-dialog.ts";

initI18n("en");

const theme = {
	fg: (_c: string, s: string) => `\x1b[37m${s}\x1b[39m`,
	bg: (_c: string, s: string) => `\x1b[44m${s}\x1b[49m`,
	bold: (s: string) => `\x1b[1m${s}\x1b[22m`,
	underline: (s: string) => `\x1b[4m${s}\x1b[24m`,
	inverse: (s: string) => `\x1b[7m${s}\x1b[27m`,
};

/** 按终端的 SGR 状态逐列检查，不能只检查字符串最外层有没有背景色。 */
function backgroundColumns(line: string): boolean[] {
	let highlighted = false;
	const columns: boolean[] = [];
	for (const part of line.split(/(\x1b\[[\d;]*m)/)) {
		if (part.startsWith("\x1b[")) {
			for (const code of part.slice(2, -1).split(";").map(Number)) {
				if (code === 0 || code === 49) highlighted = false;
				else if (code === 44) highlighted = true;
			}
		} else {
			columns.push(...Array<boolean>(visibleWidth(part)).fill(highlighted));
		}
	}
	return columns;
}

const cases: Array<{ label: string; row: Partial<SessionRow>; width?: number; current?: boolean; selected?: boolean; truncated?: boolean }> = [
	{ label: "short title", row: { name: "Short title" } },
	{ label: "long title", row: { name: "Long title ".repeat(12) }, truncated: true },
	{ label: "wide title", row: { name: "很长的会话标题".repeat(12) }, truncated: true },
	{ label: "preview as title", row: { preview: "Long preview ".repeat(12) }, truncated: true },
	{ label: "long details", row: { model: "long-model-name".repeat(12) }, truncated: true },
	{ label: "current session", row: { name: "Long title ".repeat(12) }, current: true, truncated: true },
	{ label: "multi-selected session", row: { name: "Long title ".repeat(12) }, selected: true, truncated: true },
	{ label: "narrow threaded row", row: { name: "Long title", threadDepth: 2 }, width: 16, current: true, truncated: true },
];

for (const scenario of cases) {
	test(`session cursor highlights the entire item: ${scenario.label}`, () => {
		const width = scenario.width ?? 40;
		const row: SessionRow = {
			file: resolve("session.jsonl"),
			id: "session",
			preview: "preview",
			cwd: "project",
			model: "model",
			createdAt: 0,
			updatedAt: 0,
			messageCount: 1,
			...scenario.row,
		};
		const lines = renderSessionsPane({
			rows: [row, { ...row, id: "other", file: resolve("other.jsonl") }],
			cursor: 0,
			focused: true,
			scope: "current-folder",
			sort: "recent",
			selected: new Set(scenario.selected ? [row.file] : []),
			...(scenario.current ? { currentFile: row.file } : {}),
			theme: theme as never,
		}, width, 6);
		if (scenario.truncated) assert.ok(lines.slice(1, 3).some((line) => stripTerminalSequences(line).includes("…")));
		for (const line of lines.slice(1, 3)) {
			assert.equal(visibleWidth(line), width);
			assert.deepEqual(backgroundColumns(line), [false, ...Array<boolean>(width - 2).fill(true), false],
				`every item column, including ellipsis, padding and date, should be highlighted: ${JSON.stringify(line)}`);
		}
		for (const line of lines.slice(3)) {
			assert.ok(backgroundColumns(line).every((highlighted) => !highlighted), "highlight must not leak into other rows or borders");
		}
	});
}

const treeCases: Array<{ label: string; row: Partial<TreeRow>; width?: number; truncated?: boolean }> = [
	{ label: "short text", row: { text: "Short text" } },
	{ label: "long text", row: { text: "Long node text ".repeat(12) }, truncated: true },
	{ label: "wide text", row: { text: "很长的节点内容".repeat(12) }, truncated: true },
	{ label: "long label", row: { label: "Long label ".repeat(12) }, truncated: true },
	{ label: "inactive branch", row: { text: "Long node text ".repeat(12), onActiveBranch: false }, truncated: true },
	{ label: "narrow pane", row: { text: "Long node text" }, width: 16, truncated: true },
];

for (const target of ["pane", "dialog", "search"] as const) {
	for (const scenario of treeCases) {
		test(`tree ${target} cursor highlights the entire item: ${scenario.label}`, () => {
			const width = scenario.width ?? 40;
			const root: TreeRow = {
				entryId: "root",
				role: "user",
				kind: "message",
				text: "Root",
				timestamp: 0,
				onActiveBranch: true,
			};
			const rows = [root, { ...root, entryId: "node", parentId: "root", ...scenario.row }, { ...root, entryId: "other", parentId: "root" }];
			let lines: string[];
			if (target === "dialog") {
				const dialog = new TreeDialog({ theme: theme as never, onChange: () => {} });
				dialog.open({ rows, initialIndex: 1, filter: "default" });
				lines = dialog.render(width, 10);
			} else {
				lines = renderTreePane({
					rows,
					cursor: 1,
					focused: true,
					theme: theme as never,
					...(target === "search" ? { search: { terms: ["Long", "Short", "节点", "user"], matches: new Set([1]), current: 1, position: 1, total: 1 } } : {}),
				}, width, 10);
			}
			const cursor = lines.findIndex((line) => stripTerminalSequences(line).startsWith("│› "));
			assert.notEqual(cursor, -1, "the selected tree row should be visible");
			if (scenario.truncated) assert.ok(stripTerminalSequences(lines[cursor]!).includes("…"));
			if (target === "search" && width >= 40) assert.ok(lines[cursor]!.includes("\x1b[7m"), "search matches should still be styled");
			lines.forEach((line, index) => {
				assert.equal(visibleWidth(line), width);
				const expected = index === cursor ? [false, ...Array<boolean>(width - 2).fill(true), false] : Array<boolean>(width).fill(false);
				assert.deepEqual(backgroundColumns(line), expected,
					`highlight must fill only the selected row, including ellipsis and padding: ${JSON.stringify(line)}`);
			});
		});
	}
}
