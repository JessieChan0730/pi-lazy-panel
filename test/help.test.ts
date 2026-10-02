import assert from "node:assert/strict";
import { test } from "node:test";
import type { Theme } from "@earendil-works/pi-coding-agent";
import { stripTerminalSequences, visibleWidth } from "@earendil-works/pi-tui";
import { mergeKeymap } from "../src/config/config.ts";
import { DEFAULT_KEYMAP } from "../src/config/keymap.ts";
import { initI18n } from "../src/i18n/index.ts";
import type { Keymap } from "../src/types.ts";
import { buildHelpLines, helpBoxSize, helpLineCount, helpViewport, renderHelpBox } from "../src/ui/widgets/help-overlay.ts";

initI18n("en");

const SELECTED = "\x1b[44m";
const theme = {
	fg: (_color: string, text: string) => text,
	bg: (_color: string, text: string) => `${SELECTED}${text}\x1b[49m`,
	bold: (text: string) => text,
} as unknown as Theme;

const empty: Keymap = { global: {}, sessions: {}, tree: {}, content: {}, "tree-dialog": {} };

test("help has a fixed height, shrinks in small terminals and pads short lists", () => {
	assert.equal(helpBoxSize(100, 200).height, 28);
	assert.equal(helpBoxSize(100, 15).height, 13);
	for (const termH of [1, 2, 3, 4, 8]) assert.ok(helpBoxSize(40, termH).height <= termH);
	for (const focus of ["sessions", "tree", "content"] as const) {
		const { width, height } = helpBoxSize(100, 200);
		const lines = renderHelpBox({ keymap: DEFAULT_KEYMAP, focus, cursor: 0, scroll: 0, theme }, width, height);
		assert.equal(lines.length, 28);
		const logical = buildHelpLines(DEFAULT_KEYMAP, focus);
		const global = logical.findIndex((line) => line.kind === "header" && line.text === "Global");
		for (const action of ["move-down", "move-up"]) {
			assert.ok(logical.findIndex((line) => line.kind === "binding" && line.action === action) > global);
			assert.equal(logical.filter((line) => line.kind === "binding" && line.action === action).length, 1);
		}
	}
	const { width, height } = helpBoxSize(100, 200);
	assert.equal(renderHelpBox({ keymap: empty, focus: "content", cursor: 0, scroll: 0, theme }, width, height).length, 28);
});

test("help bottom border hints track hidden content without taking body rows", () => {
	try {
		for (const locale of ["en", "zh"] as const) {
			initI18n(locale);
			const above = locale === "en" ? "↑ More above" : "↑ 上方还有更多";
			const below = locale === "en" ? "↓ More below" : "↓ 下方还有更多";
			for (const [scroll, hasAbove, hasBelow] of [[0, false, true], [5, true, true], [999, true, false]] as const) {
				const lines = renderHelpBox({ keymap: DEFAULT_KEYMAP, focus: "sessions", cursor: 0, scroll, theme }, 64, 12);
				const bottom = stripTerminalSequences(lines.at(-1)!);
				assert.equal(bottom.includes(above), hasAbove);
				assert.equal(bottom.includes(below), hasBelow);
				assert.equal(lines.length, 12);
				assert.ok(lines.every((line) => visibleWidth(line) === 64));
			}
			const short = renderHelpBox({ keymap: empty, focus: "sessions", cursor: 0, scroll: 0, theme }, 64, 28);
			assert.ok(!stripTerminalSequences(short.at(-1)!).includes("↑"));
			assert.ok(!stripTerminalSequences(short.at(-1)!).includes("↓"));
		}
	} finally {
		initI18n("en");
	}
});

test("help entries retain individual action IDs, aliases and configured bindings", () => {
	const keymap = mergeKeymap(DEFAULT_KEYMAP, { sessions: { "go-top": "ctrl+w h", "session-delete": null } });
	const entries = buildHelpLines(keymap, "sessions").filter((line) => line.kind === "binding");
	assert.equal(entries[0]?.action, "session-resume");
	assert.equal(entries.find((entry) => entry.action === "move-down")?.keys, "j/↓");
	assert.ok(entries.some((entry) => entry.action === "go-top" && entry.keys.includes("Ctrl+w")));
	assert.ok(entries.some((entry) => entry.action === "go-bottom" && entry.keys === "G"));
	assert.ok(!entries.some((entry) => entry.action === "session-delete"));
	const dialog = buildHelpLines(keymap, "tree-dialog").filter((line) => line.kind === "binding");
	assert.ok(!dialog.some((entry) => entry.action === "help" || entry.action === "focus-next"));
});

test("help itself is a visible hint, excluded from selection and highlight in every pane", () => {
	for (const focus of ["sessions", "tree", "content"] as const) {
		const logical = buildHelpLines(DEFAULT_KEYMAP, focus);
		assert.ok(logical.some((line) => line.kind === "hint" && line.keys === "?"));
		assert.ok(!logical.some((line) => line.kind === "binding" && line.action === "help"));
	}
	const keymap: Keymap = { ...empty, global: { search: "/", help: "!", quit: "q" } };
	const entries = buildHelpLines(keymap, "sessions").filter((line) => line.kind === "binding");
	assert.deepEqual(entries.map((entry) => entry.action), ["search", "quit"]);
	for (const cursor of [0, 1]) {
		const view = helpViewport(keymap, "sessions", 80, 30, cursor, 0);
		const lines = renderHelpBox({ keymap, focus: "sessions", ...view, theme }, 64, 28);
		const hint = lines.find((line) => line.includes("Toggle this help"));
		assert.ok(hint);
		assert.ok(hint.includes("!"), "the custom help key stays visible");
		assert.ok(!hint.includes(SELECTED) && !hint.includes("›"));
		assert.ok(lines.some((line) => line.includes(`› ${entries[cursor]!.keys}`)));
	}
});

test("help-only keymaps have no selectable entry", () => {
	const keymap: Keymap = { ...empty, global: { help: "!" } };
	assert.deepEqual(helpViewport(keymap, "sessions", 80, 30, 99, 99), { cursor: 0, scroll: 0 });
	const lines = renderHelpBox({ keymap, focus: "sessions", cursor: 0, scroll: 0, theme }, 64, 28);
	assert.ok(lines.some((line) => line.includes("Toggle this help")));
	assert.ok(!lines.some((line) => line.includes(SELECTED) || line.includes("›")));
});

test("help selection follows wrapped entries across sections and terminal resizes in both languages", () => {
	try {
		for (const locale of ["en", "zh"] as const) {
			initI18n(locale);
			const entries = buildHelpLines(DEFAULT_KEYMAP, "tree").filter((line) => line.kind === "binding");
			let scroll = 0;
			for (const cursor of [...entries.keys(), ...[...entries.keys()].reverse()]) {
				for (const [termW, termH] of [[100, 18], [34, 9], [50, 13], [100, 200]] as const) {
					const view = helpViewport(DEFAULT_KEYMAP, "tree", termW, termH, cursor, scroll);
					const { width, height } = helpBoxSize(termW, termH);
					const lines = renderHelpBox({ keymap: DEFAULT_KEYMAP, focus: "tree", ...view, theme }, width, height);
					const plain = lines.map(stripTerminalSequences);
					assert.equal(view.cursor, cursor, "wrapping does not change the selected action");
					assert.equal(plain.filter((line) => line.includes("› ")).length, 1);
					assert.ok(plain.some((line) => line.includes(`› ${entries[cursor]!.keys}`)), `${locale} ${termW}x${termH}: ${plain.join("\n")}`);
					assert.ok(lines.some((line) => line.includes(SELECTED)));
					assert.ok(lines.every((line) => visibleWidth(line) === width));
					assert.ok(view.scroll >= 0 && view.scroll <= Math.max(0, helpLineCount(DEFAULT_KEYMAP, "tree", termW) - (height - 2)));
					scroll = view.scroll;
				}
			}
		}
	} finally {
		initI18n("en");
	}
});

test("wrapped continuation rows share the selected background, not independent cursor markers", () => {
	const keymap: Keymap = { ...empty, tree: { "tree-fold": "z" } };
	const { width, height } = helpBoxSize(40, 100);
	const lines = renderHelpBox({ keymap, focus: "tree", cursor: 0, scroll: 0, theme }, width, height);
	const selected = lines.filter((line) => line.includes(SELECTED));
	assert.ok(selected.length > 1, "the description wraps");
	assert.equal(selected.filter((line) => line.includes("› ")).length, 1);
	assert.ok(!lines.find((line) => line.includes("Global"))?.includes(SELECTED));
});

test("Chinese help headings keep a blank above and commands directly below", () => {
	try {
		initI18n("zh");
		const lines = renderHelpBox({ keymap: DEFAULT_KEYMAP, focus: "content", cursor: 0, scroll: 0, theme }, 64, 100).map(stripTerminalSequences);
		for (const heading of ["-- 当前面板 --", "-- 全局 --"]) {
			const index = lines.findIndex((line) => line.includes(heading));
			assert.ok(index > 0);
			assert.equal(lines[index - 1]?.slice(1, -1).trim(), "");
			assert.ok(lines[index + 1]?.slice(1, -1).trim(), "command directly below heading");
		}
	} finally {
		initI18n("en");
	}
});

test("help viewport clamps selection and scroll, including an empty keymap", () => {
	assert.deepEqual(helpViewport(empty, "sessions", 80, 20, 99, 99), { cursor: 0, scroll: 0 });
	assert.deepEqual(helpViewport(DEFAULT_KEYMAP, "sessions", 80, 20, -10, 999), { cursor: 0, scroll: 0 });
	const count = buildHelpLines(DEFAULT_KEYMAP, "sessions").filter((line) => line.kind === "binding").length;
	const last = helpViewport(DEFAULT_KEYMAP, "sessions", 80, 10, 999, 999);
	assert.equal(last.cursor, count - 1);
	assert.ok(last.scroll > 0);
});

test("an oversized entry keeps its first row visible even when its description is taller than the viewport", () => {
	const keymap: Keymap = { ...empty, tree: { "move-up": "k", "tree-fold": "z" } };
	const view = helpViewport(keymap, "tree", 34, 8, 1, 999);
	const { width, height } = helpBoxSize(34, 8);
	const lines = renderHelpBox({ keymap, focus: "tree", ...view, theme }, width, height).map(stripTerminalSequences);
	assert.ok(lines[1]?.includes("› z"));
	assert.ok(helpLineCount(keymap, "tree", 34) > height);
});

test("wide characters do not stall wrapping when the description column is one cell wide", () => {
	try {
		initI18n("zh");
		const lines = renderHelpBox({ keymap: empty, focus: "content", cursor: 0, scroll: 0, theme }, 14, 8);
		assert.ok(lines.every((line) => visibleWidth(line) === 14));
		const bound = { ...empty, content: { "move-down": "j" } } as Keymap;
		const narrow = renderHelpBox({ keymap: bound, focus: "content", cursor: 0, scroll: 0, theme }, 14, 8);
		assert.ok(narrow.every((line) => visibleWidth(line) === 14));
	} finally {
		initI18n("en");
	}
});
