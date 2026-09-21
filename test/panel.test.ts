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
import type { ContentBlock, SessionRow, TreeRow } from "../src/types.ts";
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

test("h / l cycle focus, 1 / 2 / 3 jump, and pane titles carry the jump key", () => {
	const h = makePanel();
	const { panel } = h;
	assert.equal(panel.state.focus, "sessions");
	panel.handleInput("l");
	assert.equal(panel.state.focus, "tree");
	panel.handleInput("\t"); // tab still works as a secondary "next"
	assert.equal(panel.state.focus, "content");
	panel.handleInput("l");
	assert.equal(panel.state.focus, "sessions");
	panel.handleInput("h");
	assert.equal(panel.state.focus, "content");
	// shift+tab is no longer bound
	panel.handleInput("\x1b[Z");
	assert.equal(panel.state.focus, "content");
	// number keys jump straight to a pane
	panel.handleInput("1");
	assert.equal(panel.state.focus, "sessions");
	panel.handleInput("3");
	assert.equal(panel.state.focus, "content");
	panel.handleInput("2");
	assert.equal(panel.state.focus, "tree");
	// "l" is not shadowed in the tree pane any more (label is "T")
	panel.handleInput("l");
	assert.equal(panel.state.focus, "content");
	panel.handleInput("2");
	const text = h.text(100).join("\n");
	assert.ok(text.includes("[1] SESSIONS"), text);
	assert.ok(text.includes("[2] TREE"), text);
	assert.ok(text.includes("[3] CONTENT"), text);
});

test("C switches to Current folder only and A to All only (no toggling)", async () => {
	const h = makePanel();
	await h.panel.load();
	assert.equal(h.panel.state.scope, "current-folder");
	h.panel.handleInput("C"); // already current: no reload
	await flush();
	assert.equal(h.panel.state.scope, "current-folder");
	h.panel.handleInput("A");
	await flush();
	assert.equal(h.panel.state.scope, "all");
	h.panel.handleInput("A"); // pressing A again stays on All
	await flush();
	assert.equal(h.panel.state.scope, "all");
	h.panel.handleInput("C");
	await flush();
	assert.equal(h.panel.state.scope, "current-folder");
	assert.deepEqual(
		h.calls().map((c) => c.scope),
		["current-folder", "all", "current-folder"],
	);
	// with a wide terminal the pane header shows the scope label
	h.panel.handleInput("A");
	await flush();
	assert.ok(h.text(160)[0]!.includes("All"), `header should mention All: ${h.text(160)[0]}`);
});

test("sessions header shows position · scope · sort in BOTH scopes, and the footer hints the other scope", async () => {
	const h = makePanel();
	await h.panel.load();
	const header = (w: number) => h.text(w)[0]!;
	const footer = (w: number) => h.text(w).at(-1)!;

	// Current: 回归点——"[1] " 前缀让 "Current" 在 160 列（左栏 40 列）下放不下，之前整段 meta 消失
	assert.equal(h.panel.state.scope, "current-folder");
	assert.ok(header(200).includes("1/1 · Current · recent"), `Current header: ${header(200)}`);
	assert.ok(header(160).includes("1/1 · Current"), `Current header @160: ${header(160)}`);
	assert.ok(footer(160).includes("A All"), `footer should offer All: ${footer(160)}`);
	assert.equal(footer(160).includes("C Current"), false, `footer must not hint the active scope: ${footer(160)}`);

	// All
	h.panel.handleInput("A");
	await flush();
	assert.ok(header(200).includes("1/2 · All · recent"), `All header: ${header(200)}`);
	assert.ok(header(160).includes("1/2 · All · recent"), `All header @160: ${header(160)}`);
	assert.ok(footer(160).includes("C Current"), `footer should offer Current: ${footer(160)}`);
	assert.equal(footer(160).includes("A All"), false, `footer must not hint the active scope: ${footer(160)}`);

	// narrow terminals degrade the meta step by step but never drop position + scope entirely
	h.panel.handleInput("C");
	await flush();
	assert.ok(header(120).includes("1/1 · Cur"), `120 cols: ${header(120)}`);
	assert.ok(header(100).includes("1/1"), `100 cols: ${header(100)}`);
	for (const w of [100, 120, 160, 200]) assert.equal(visibleWidth(h.panel.render(w)[0]!), w);
});

test("? opens the help overlay for the focused pane and ? / Esc close it", () => {
	const h = makePanel({ height: 30 });
	h.panel.handleInput("?");
	assert.equal(h.panel.state.helpOpen, true);
	let lines = h.text(100);
	assert.ok(lines.some((l) => l.includes("HELP · Sessions pane")));
	assert.ok(lines.some((l) => l.includes("Resume session")));
	// 同类动作合并成一行：h/l/Tab、1..3、d/t/u/L/a
	assert.ok(lines.some((l) => l.includes("h/l/Tab") && l.includes("Focus previous / next pane")));
	assert.ok(lines.some((l) => l.includes("1..3") && l.includes("Focus pane by number")));
	assert.equal(lines.some((l) => l.includes("Focus next pane")), false, "merged actions must not also appear alone");
	// keys other than close/scroll are swallowed while help is open
	h.panel.handleInput("l");
	assert.equal(h.panel.state.focus, "sessions");
	h.panel.handleInput("?");
	assert.equal(h.panel.state.helpOpen, false);

	// tree pane help lists tree actions
	h.panel.handleInput("l");
	h.panel.handleInput("?");
	lines = h.text(100);
	assert.ok(lines.some((l) => l.includes("HELP · Tree pane")));
	assert.ok(lines.some((l) => l.includes("Restore conversation")));
	assert.ok(lines.some((l) => l.includes("d/t/u/L/a") && l.includes("Filter: default / tools / user / labeled / all")));
	assert.equal(lines.some((l) => l.includes("Filter: tools")), false);
	h.panel.handleInput("\x1b");
	assert.equal(h.panel.state.helpOpen, false);

	// content pane help only lists scrolling plus the global keys
	h.panel.handleInput("3");
	h.panel.handleInput("?");
	lines = h.text(100);
	assert.ok(lines.some((l) => l.includes("HELP · Content pane")));
	assert.ok(lines.some((l) => l.includes("Go to top")));
	assert.equal(lines.some((l) => /Yank|Preview|Word/.test(l)), false, "content help must not list vim editing keys");
	h.panel.handleInput("\x1b");
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
		global: { quit: "ctrl+q", "focus-next": "ctrl+n", help: "F1", "scope-all": null, "focus-sessions": "F5" },
	});
	const h = makePanel({ keymap: custom });
	h.panel.handleInput("q"); // no longer bound
	assert.equal(h.closed(), false);
	h.panel.handleInput("\x0e"); // ctrl+n
	assert.equal(h.panel.state.focus, "tree");
	h.panel.handleInput("A"); // unbound
	assert.equal(h.panel.state.scope, "current-folder");
	// the pane title follows the rebound jump key
	assert.ok(h.text(100).some((l) => l.includes("[F5] SESSIONS")));
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
	// go-top is dispatched and the buffer is cleared
	assert.equal(h.text().at(-1)!.includes("pending"), false);
	assert.equal(h.panel.state.cursor.sessions, 0);
	h.panel.dispose();
});

function flush(): Promise<void> {
	return new Promise((r) => setTimeout(r, 0));
}

/** Wait past the sessions-pane load debounce. */
function settle(): Promise<void> {
	return new Promise((r) => setTimeout(r, 80));
}

function treeRow(i: number, onActiveBranch = true): TreeRow {
	return { entryId: `e${i}`, depth: 0, role: i % 2 ? "assistant" : "user", kind: "message", text: `msg ${i}`, timestamp: 0, onActiveBranch };
}

function block(i: number): ContentBlock {
	return { entryId: `e${i}`, role: i % 2 ? "assistant" : "user", timestamp: 0, markdown: `message ${i}\n\nline\nline\nline` };
}

/** Panel with 5 sessions; each session has 4 tree nodes / 4 content blocks named after the session. */
function makeLoadedPanel(height = 20) {
	const treeCalls: string[] = [];
	const contentCalls: Array<{ file: string; leaf: string | undefined }> = [];
	const data: DataSource = {
		listSessions: async () => [1, 2, 3, 4, 5].map((i) => row(i, "/a")),
		loadTree: async (file) => {
			treeCalls.push(file);
			return [treeRow(0), treeRow(1), treeRow(2), treeRow(3, false)];
		},
		loadContent: async (file, leaf) => {
			contentCalls.push({ file, leaf });
			// e3 is a side branch: only reachable by asking for it explicitly.
			return leaf === "e3" ? [block(0), block(3)] : [block(0), block(1), block(2)];
		},
	};
	const panel = new LazyPanel({ theme: fakeTheme, data, getHeight: () => height, requestRender: () => {}, onClose: () => {} });
	return { panel, treeCalls, contentCalls, text: (width = 100) => panel.render(width).map((l) => stripTerminalSequences(l)) };
}

test("j/k/gg/G move the sessions cursor and reload the tree for the new session", async () => {
	const h = makeLoadedPanel();
	await h.panel.load();
	assert.deepEqual(h.treeCalls, ["/tmp/s1.jsonl"]);
	h.panel.handleInput("j");
	h.panel.handleInput("j");
	assert.equal(h.panel.state.cursor.sessions, 2);
	await settle();
	// debounced: only the session the cursor rests on is loaded
	assert.deepEqual(h.treeCalls, ["/tmp/s1.jsonl", "/tmp/s3.jsonl"]);
	h.panel.handleInput("k");
	assert.equal(h.panel.state.cursor.sessions, 1);
	h.panel.handleInput("G");
	assert.equal(h.panel.state.cursor.sessions, 4);
	h.panel.handleInput("j");
	assert.equal(h.panel.state.cursor.sessions, 4, "clamped at the bottom");
	h.panel.handleInput("g");
	h.panel.handleInput("g");
	assert.equal(h.panel.state.cursor.sessions, 0);
	h.panel.handleInput("k");
	assert.equal(h.panel.state.cursor.sessions, 0, "clamped at the top");
	await settle();
	assert.equal(h.treeCalls.at(-1), "/tmp/s1.jsonl");
	h.panel.dispose();
});

test("tree cursor drives the content highlight and scrolls the block into view", async () => {
	const h = makeLoadedPanel();
	await h.panel.load();
	h.text();
	// initial: tree cursor on the active leaf (e2), content highlights it
	assert.equal(h.panel.state.cursor.tree, 2);
	assert.equal(h.panel.state.contentHighlight, "e2");
	assert.ok(h.text().some((l) => l.includes("›┌─ YOU")), "highlighted block header carries the › marker");

	h.panel.handleInput("2");
	h.panel.handleInput("g");
	h.panel.handleInput("g");
	assert.equal(h.panel.state.cursor.tree, 0);
	await flush();
	assert.equal(h.panel.state.contentHighlight, "e0");
	assert.equal(h.panel.state.cursor.content, 0);

	h.panel.handleInput("j");
	await flush();
	assert.equal(h.panel.state.contentHighlight, "e1");
	assert.ok(h.panel.state.cursor.content > 0, "scrolled so the block starts at the top");

	// moving onto a node from another branch reloads content for that leaf
	h.panel.handleInput("G");
	await flush();
	assert.equal(h.panel.state.cursor.tree, 3);
	assert.deepEqual(h.contentCalls.at(-1), { file: "/tmp/s1.jsonl", leaf: "e3" });
	assert.equal(h.panel.state.contentHighlight, "e3");
	h.panel.dispose();
});

test("active-branch nodes without a message block keep the full branch and highlight the previous message", async () => {
	const contentCalls: Array<string | undefined> = [];
	const data: DataSource = {
		listSessions: async () => [row(1, "/a")],
		// e1 is a tool result on the active branch: no content block for it
		loadTree: async () => [treeRow(0), { ...treeRow(1), role: "tool", kind: "tool" }, treeRow(2)],
		loadContent: async (_file, leaf) => {
			contentCalls.push(leaf);
			return [block(0), block(2)];
		},
	};
	const panel = new LazyPanel({ theme: fakeTheme, data, getHeight: () => 20, requestRender: () => {}, onClose: () => {} });
	await panel.load();
	panel.render(100);
	panel.handleInput("2");
	panel.handleInput("k");
	await flush();
	assert.equal(panel.state.cursor.tree, 1);
	assert.deepEqual(contentCalls, [undefined], "no reload for a node on the active branch");
	assert.equal(panel.state.contentHighlight, "e0", "highlights the nearest previous message");
	panel.dispose();
});

test("content pane scrolls by line with j/k, gg/G, and J/K from the sessions pane", async () => {
	const h = makeLoadedPanel(12);
	await h.panel.load();
	h.text();
	h.panel.handleInput("3");
	h.panel.handleInput("g");
	h.panel.handleInput("g");
	assert.equal(h.panel.state.cursor.content, 0);
	h.panel.handleInput("j");
	h.panel.handleInput("j");
	assert.equal(h.panel.state.cursor.content, 2);
	h.panel.handleInput("k");
	assert.equal(h.panel.state.cursor.content, 1);
	h.panel.handleInput("G");
	const bottom = h.panel.state.cursor.content;
	assert.ok(bottom > 2);
	h.panel.handleInput("j");
	assert.equal(h.panel.state.cursor.content, bottom, "clamped at the last page");
	const lastPage = h.text();
	assert.ok(lastPage.some((l) => l.includes("└")), "last page shows the end of the conversation");

	// J / K only scroll the content pane; the sessions cursor stays put
	h.panel.handleInput("1");
	h.panel.handleInput("g");
	h.panel.handleInput("g");
	h.panel.handleInput("3");
	h.panel.handleInput("g");
	h.panel.handleInput("g");
	h.panel.handleInput("1");
	h.panel.handleInput("J");
	assert.equal(h.panel.state.cursor.sessions, 0);
	assert.ok(h.panel.state.cursor.content > 0);
	h.panel.handleInput("K");
	assert.equal(h.panel.state.cursor.content, 0);
	h.panel.dispose();
});
