import assert from "node:assert/strict";
import { resolve } from "node:path";
import { test } from "node:test";
import { stripTerminalSequences, visibleWidth } from "@earendil-works/pi-tui";
import { initI18n } from "../../src/i18n/index.ts";
import type { SessionRow, TreeRow } from "../../src/types.ts";
import { renderSessionsPane } from "../../src/ui/panes/sessions-pane.ts";
import { renderTreePane } from "../../src/ui/panes/tree-pane.ts";
import { TreeDialog } from "../../src/ui/widgets/tree-dialog.ts";

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

const cases: Array<{ label: string; row: Partial<SessionRow>; width?: number; current?: boolean; running?: boolean; selected?: boolean; truncated?: boolean }> = [
	{ label: "short title", row: { name: "Short title" } },
	{ label: "long title", row: { name: "Long title ".repeat(12) }, truncated: true },
	{ label: "wide title", row: { name: "很长的会话标题".repeat(12) }, truncated: true },
	{ label: "preview as title", row: { preview: "Long preview ".repeat(12) }, truncated: true },
	{ label: "long details", row: { model: "long-model-name".repeat(12) }, truncated: true },
	{ label: "current session", row: { name: "Long title ".repeat(12) }, current: true, truncated: true },
	{ label: "running session", row: { name: "Long title ".repeat(12) }, current: true, running: true, truncated: true },
	{ label: "running short title", row: { name: "Short" }, current: true, running: true },
	{ label: "running multi-selected session", row: { name: "很长的会话标题".repeat(12) }, current: true, running: true, selected: true, truncated: true },
	{ label: "narrow running row", row: { name: "Long title", threadDepth: 2 }, width: 16, current: true, running: true, truncated: true },
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
			...(scenario.running ? { runningFrame: 1 } : {}),
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

test("the running marker is an accent spinner + a plain muted word in the current tag's place; the title keeps its color", () => {
	const row: SessionRow = { file: resolve("session.jsonl"), id: "session", name: "alpha", preview: "preview", cwd: "project", createdAt: 0, updatedAt: 0, messageCount: 1 };
	for (const cursor of [0, 1]) {
		for (const selected of [false, true]) {
			const colored: Array<[string, string]> = [];
			const bolded: string[] = [];
			const recording = {
				...theme,
				fg: (color: string, text: string) => (colored.push([color, text]), theme.fg(color, text)),
				bold: (text: string) => (bolded.push(stripTerminalSequences(text)), theme.bold(text)),
			};
			const props = {
				rows: [row, { ...row, id: "other", file: resolve("other.jsonl"), name: "beta" }],
				cursor,
				focused: true,
				scope: "current-folder" as const,
				sort: "recent" as const,
				selected: new Set(selected ? [row.file] : []),
				currentFile: row.file,
			};
			const lines = renderSessionsPane({ ...props, runningFrame: 12, theme: recording as never }, 40, 6);
			// 第 12 帧 = 10 帧里的第 3 个。转圈是 accent；文字是 muted，光标行的底色上提亮成 text
			assert.deepEqual(colored.filter(([, text]) => text === "⠹"), [["accent", "⠹"]]);
			assert.deepEqual(colored.filter(([, text]) => text === " running"), [[cursor === 0 ? "text" : "muted", " running"]]);
			assert.ok(bolded.every((text) => !text.includes("running") && !text.includes("⠹")), "the marker is never bold, even on the bold cursor title");
			assert.equal(colored.filter(([color]) => color === "warning").length, 0);
			// 标题照旧：多选才是 accent，普通行是 text，光标行不另外着色
			const titleColors = colored.filter(([, text]) => text.startsWith("alpha")).map(([color]) => color);
			assert.deepEqual(titleColors, selected ? ["accent"] : cursor === 0 ? [] : ["text"]);
			const plain = lines.map((line) => stripTerminalSequences(line));
			assert.ok(plain[1]!.includes("alpha ⠹ running"), plain[1]);
			assert.equal(plain.filter((line) => line.includes("(current)")).length, 0);
			// 和空闲时的 (current) 行同宽，日期仍然右对齐在同一列
			const idle = renderSessionsPane({ ...props, theme: theme as never }, 40, 6).map((line) => stripTerminalSequences(line));
			assert.ok(idle[1]!.includes("alpha(current)"), idle[1]);
			assert.equal(visibleWidth(lines[1]!), 40);
			assert.equal(plain[1]!.slice(-13), idle[1]!.slice(-13));
		}
	}
});

test("a narrow pane keeps the title and shrinks the running marker to its spinner", () => {
	const row: SessionRow = { file: resolve("session.jsonl"), id: "session", name: "A fairly long session title", preview: "preview", cwd: "project", createdAt: 0, updatedAt: 0, messageCount: 1 };
	const render = (width: number, name = row.name!) => stripTerminalSequences(renderSessionsPane({
		rows: [{ ...row, name }],
		cursor: 0,
		focused: true,
		scope: "current-folder",
		sort: "recent",
		selected: new Set(),
		currentFile: row.file,
		runningFrame: 0,
		theme: theme as never,
	}, width, 4)[1]!);
	// 宽：标题留得下 12 列，带文字
	assert.match(render(50), /A fairly long session t… ⠋ running /);
	// 窄：带文字的话标题只剩 4 列，退成只有方块，标题多留 8 列
	assert.match(render(30), /A fairly lo… ⠋ /);
	assert.doesNotMatch(render(30), /running/);
	// 短标题本来就放得下，窄面板也带文字
	assert.match(render(30, "Abc"), /Abc ⠋ running /);
	for (const width of [16, 30, 50]) assert.equal(visibleWidth(render(width)), width);
});

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
