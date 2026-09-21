/**
 * Panel behaviour tests: focus cycling, scope toggle, help overlay and the
 * search bar, driven through `LazyPanel.handleInput` with a stub theme and
 * an in-memory DataSource. Run with `npm test` (node --test via tsx).
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import type { Theme } from "@earendil-works/pi-coding-agent";
import { stripTerminalSequences, visibleWidth } from "@earendil-works/pi-tui";
import { DEFAULT_KEYMAP } from "../src/config/keymap.ts";
import { mergeKeymap } from "../src/config/config.ts";
import type { SessionRow } from "../src/types.ts";
import { type DataSource, LazyPanel } from "../src/ui/app.ts";
import { SEARCH_LABEL } from "../src/ui/widgets/search-bar.ts";

/** Styling is irrelevant here; return text unchanged so assertions stay simple. */
const fakeTheme = {
	fg: (_c: string, s: string) => s,
	bg: (_c: string, s: string) => s,
	bold: (s: string) => s,
	italic: (s: string) => s,
	underline: (s: string) => s,
	inverse: (s: string) => s,
	strikethrough: (s: string) => s,
} as unknown as Theme;

function row(i: number, cwd: string): SessionRow {
	return {
		file: `/tmp/s${i}.jsonl`,
		id: `id-${i}`,
		cwd,
		preview: `session ${i}`,
		createdAt: 0,
		updatedAt: 0,
		messageCount: 1,
	};
}

interface Harness {
	panel: LazyPanel;
	closed: () => boolean;
	calls: () => Array<{ scope: string; sort: string }>;
	text: (width?: number) => string[];
}

function makePanel(opts: { keymap?: typeof DEFAULT_KEYMAP; height?: number } = {}): Harness {
	const calls: Array<{ scope: string; sort: string }> = [];
	let closed = false;
	const data: DataSource = {
		listSessions: async (scope, sort) => {
			calls.push({ scope, sort });
			return scope === "all" ? [row(1, "/a"), row(2, "/b")] : [row(1, "/a")];
		},
		loadTree: async () => [],
		loadContent: async () => [],
	};
	const panel = new LazyPanel({
		theme: fakeTheme,
		data,
		getHeight: () => opts.height ?? 20,
		requestRender: () => {},
		onClose: () => {
			closed = true;
		},
		...(opts.keymap ? { keymap: opts.keymap } : {}),
	});
	return {
		panel,
		closed: () => closed,
		calls: () => calls,
		text: (width = 80) => panel.render(width).map((l) => stripTerminalSequences(l)),
	};
}

test("Tab / Shift+Tab cycle focus through sessions → tree → content", () => {
	const { panel } = makePanel();
	assert.equal(panel.state.focus, "sessions");
	panel.handleInput("\t");
	assert.equal(panel.state.focus, "tree");
	panel.handleInput("\t");
	assert.equal(panel.state.focus, "content");
	panel.handleInput("\t");
	assert.equal(panel.state.focus, "sessions");
	panel.handleInput("\x1b[Z");
	assert.equal(panel.state.focus, "content");
});

test("C / A toggle the list scope and reload sessions", async () => {
	const h = makePanel();
	await h.panel.load();
	assert.equal(h.panel.state.scope, "current-folder");
	h.panel.handleInput("C");
	await flush();
	assert.equal(h.panel.state.scope, "all");
	h.panel.handleInput("A");
	await flush();
	assert.equal(h.panel.state.scope, "current-folder");
	assert.deepEqual(
		h.calls().map((c) => c.scope),
		["current-folder", "all", "current-folder"],
	);
	// with a wide terminal the pane header shows the scope label
	h.panel.handleInput("C");
	await flush();
	assert.ok(h.text(160)[0]!.includes("All"), `header should mention All: ${h.text(160)[0]}`);
});

test("? opens the help overlay for the focused pane and ? / Esc close it", () => {
	const h = makePanel({ height: 30 });
	h.panel.handleInput("?");
	assert.equal(h.panel.state.helpOpen, true);
	let lines = h.text(100);
	assert.ok(lines.some((l) => l.includes("HELP · Sessions pane")));
	assert.ok(lines.some((l) => l.includes("Resume session")));
	assert.ok(lines.some((l) => l.includes("Focus next pane")));
	// keys other than close/scroll are swallowed while help is open
	h.panel.handleInput("\t");
	assert.equal(h.panel.state.focus, "sessions");
	h.panel.handleInput("?");
	assert.equal(h.panel.state.helpOpen, false);

	// tree pane help lists tree actions
	h.panel.handleInput("\t");
	h.panel.handleInput("?");
	lines = h.text(100);
	assert.ok(lines.some((l) => l.includes("HELP · Tree pane")));
	assert.ok(lines.some((l) => l.includes("Restore conversation")));
	h.panel.handleInput("\x1b");
	assert.equal(h.panel.state.helpOpen, false);
	// every rendered line keeps the exact width while the overlay is drawn
	h.panel.handleInput("?");
	for (const l of h.panel.render(100)) assert.equal(visibleWidth(l), 100);
});

test("/ shows the 搜索 bar, typing edits it, Enter stores the query, Esc cancels", () => {
	const h = makePanel();
	h.panel.handleInput("/");
	assert.equal(h.panel.state.mode, "search");
	let bottom = h.text().at(-1)!;
	assert.ok(bottom.startsWith(SEARCH_LABEL.trimEnd()), `footer should start with 搜索, got: ${bottom}`);

	for (const ch of "foo") h.panel.handleInput(ch);
	bottom = h.text().at(-1)!;
	assert.ok(bottom.includes("foo"));
	// global keys are NOT dispatched while typing
	h.panel.handleInput("q");
	assert.equal(h.closed(), false);
	h.panel.handleInput("\x7f"); // backspace removes the q
	h.panel.handleInput("\r");
	assert.equal(h.panel.state.mode, "normal");
	assert.equal(h.panel.state.searchQuery, "foo");
	assert.equal(h.panel.state.searchPane, "sessions");
	bottom = h.text().at(-1)!;
	assert.ok(bottom.includes("foo") && bottom.includes("搜索"));

	// Esc in normal mode clears the active search first, only then quits
	h.panel.handleInput("\x1b");
	assert.equal(h.panel.state.searchQuery, "");
	assert.equal(h.closed(), false);

	// cancel path keeps the previous (now empty) query
	h.panel.handleInput("/");
	h.panel.handleInput("x");
	h.panel.handleInput("\x1b");
	assert.equal(h.panel.state.mode, "normal");
	assert.equal(h.panel.state.searchQuery, "");
	assert.equal(h.text().at(-1)!.includes("搜索"), false);
});

test("q quits, custom keymap overrides defaults and combos work", () => {
	const plain = makePanel();
	plain.panel.handleInput("q");
	assert.equal(plain.closed(), true);

	const custom = mergeKeymap(DEFAULT_KEYMAP, {
		global: { quit: "ctrl+q", "focus-next": "ctrl+n", help: "F1", "toggle-scope": null },
	});
	const h = makePanel({ keymap: custom });
	h.panel.handleInput("q"); // no longer bound
	assert.equal(h.closed(), false);
	h.panel.handleInput("\x0e"); // ctrl+n
	assert.equal(h.panel.state.focus, "tree");
	h.panel.handleInput("C"); // unbound
	assert.equal(h.panel.state.scope, "current-folder");
	h.panel.handleInput("\x1bOP"); // F1
	assert.equal(h.panel.state.helpOpen, true);
	assert.ok(h.text(100).some((l) => l.includes("F1")));
	h.panel.handleInput("\x1b");
	h.panel.handleInput("\x11"); // ctrl+q
	assert.equal(h.closed(), true);
});

test("multi-key sequence gg is buffered and Esc discards the pending prefix", () => {
	const h = makePanel();
	h.panel.handleInput("g");
	assert.ok(h.text().at(-1)!.includes("pending: g"));
	h.panel.handleInput("\x1b");
	assert.equal(h.text().at(-1)!.includes("pending"), false);
	assert.equal(h.closed(), false);
	h.panel.handleInput("g");
	h.panel.handleInput("g");
	// go-top is dispatched (stubbed for now) and the buffer is cleared
	assert.equal(h.text().at(-1)!.includes("pending"), false);
	assert.ok(h.text().at(-1)!.includes("go-top"));
	h.panel.dispose();
});

function flush(): Promise<void> {
	return new Promise((r) => setTimeout(r, 0));
}
