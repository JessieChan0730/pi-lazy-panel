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
import { SUMMARIZING_STATUS } from "../src/constants.ts";
import type { ContentBlock, RestoreOptions, SessionRow, TreeFilter, TreeRow } from "../src/types.ts";
import { type ActionSource, type DataSource, LazyPanel } from "../src/ui/app.ts";
import { InputDialog } from "../src/ui/widgets/input-dialog.ts";
import { LABEL_DIALOG_TITLE } from "../src/ui/widgets/label-dialog.ts";
import { CUSTOM_PROMPT_TITLE, SUMMARY_MENU, SUMMARY_MENU_TITLE } from "../src/ui/widgets/restore-dialog.ts";
import { SEARCH_LABEL } from "../src/ui/widgets/search-bar.ts";
import { SelectDialog } from "../src/ui/widgets/select-dialog.ts";

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

/**
 * 假会话行。`file` 只是传给 DataSource 桩的不透明 id，面板本身不会对它做任何
 * 路径处理，所以这里固定用 `/tmp/...` 字符串即可，不必按平台拼路径。
 */
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
	// 同类动作合并成一行：h/l/Tab、1..3
	assert.ok(lines.some((l) => l.includes("h/l/Tab") && l.includes("Focus previous / next pane")));
	assert.ok(lines.some((l) => l.includes("1..3") && l.includes("Focus pane by number")));
	assert.equal(lines.some((l) => l.includes("Focus next pane")), false, "merged actions must not also appear alone");
	// keys other than close/scroll are swallowed while help is open
	h.panel.handleInput("l");
	assert.equal(h.panel.state.focus, "sessions");
	h.panel.handleInput("?");
	assert.equal(h.panel.state.helpOpen, false);

	// tree pane help lists tree actions; filters moved to the tree dialog (a), / search stays
	h.panel.handleInput("l");
	h.panel.handleInput("?");
	lines = h.text(100);
	assert.ok(lines.some((l) => l.includes("HELP · Tree pane")));
	assert.ok(lines.some((l) => l.includes("Restore conversation")));
	assert.ok(lines.some((l) => l.includes("Open the full tree dialog")));
	assert.equal(lines.some((l) => /Filter:/.test(l)), false, "tree filters are no longer pane bindings");
	assert.ok(lines.some((l) => l.includes("Search in the focused pane")), "search is available in the tree pane");
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

function treeRow(i: number, onActiveBranch = true, over: Partial<TreeRow> = {}): TreeRow {
	return { entryId: `e${i}`, role: i % 2 ? "assistant" : "user", kind: "message", text: `msg ${i}`, timestamp: 0, onActiveBranch, ...over };
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

/**
 * Panel whose tree rows come from a mutable map of labels, plus a recording ActionSource.
 * e2 is the active leaf (Enter on it restores without asking); e0 / e1 go through the summary menu.
 */
function makeTreeActionPanel(actions?: Partial<ActionSource>, opts: { skipSummaryPrompt?: boolean } = {}) {
	const labels = new Map<string, string>();
	const copies: Array<{ file: string; entryId: string }> = [];
	const labelCalls: Array<{ file: string; entryId: string; label: string | undefined }> = [];
	const enters: Array<{ kind: "resume" | "restore"; file: string; entryId?: string; options?: RestoreOptions }> = [];
	const hidden: boolean[] = [];
	const treeFilters: TreeFilter[] = [];
	let closed = false;
	const data: DataSource = {
		listSessions: async () => [row(1, "/a")],
		loadTree: async (_file, filter) => {
			treeFilters.push(filter);
			const rows = [treeRow(0), treeRow(1), treeRow(2, true, { isLeaf: true })].map((r) =>
				labels.has(r.entryId) ? { ...r, label: labels.get(r.entryId)! } : r,
			);
			return filter === "labeled" ? rows.filter((r) => r.label !== undefined) : rows;
		},
		loadContent: async () => [block(0), block(1), block(2)],
	};
	const source: ActionSource = {
		copyNodeText: async (file, entryId) => {
			copies.push({ file, entryId });
			return entryId !== "e0"; // e0 pretends to have no text
		},
		setNodeLabel: async (file, entryId, label) => {
			labelCalls.push({ file, entryId, label });
			if (label) labels.set(entryId, label);
			else labels.delete(entryId);
		},
		resumeSession: async (file) => {
			enters.push({ kind: "resume", file });
			return "switched";
		},
		restoreNode: async (file, entryId, options) => {
			enters.push({ kind: "restore", file, entryId, options });
			return "restored";
		},
		...actions,
	};
	const panel = new LazyPanel({
		theme: fakeTheme,
		data,
		actions: source,
		getHeight: () => 20,
		requestRender: () => {},
		onClose: () => {
			closed = true;
		},
		setHidden: (h) => hidden.push(h),
		...(opts.skipSummaryPrompt !== undefined ? { skipSummaryPrompt: opts.skipSummaryPrompt } : {}),
	});
	return {
		panel,
		copies,
		labelCalls,
		labels,
		enters,
		hidden,
		treeFilters,
		closed: () => closed,
		text: (width = 100) => panel.render(width).map((l) => stripTerminalSequences(l)),
	};
}

test("y in the tree pane copies the node under the cursor and reports the result in the footer", async () => {
	const h = makeTreeActionPanel();
	await h.panel.load();
	h.panel.handleInput("2");
	assert.equal(h.panel.state.cursor.tree, 2);
	h.panel.handleInput("y");
	await flush();
	assert.deepEqual(h.copies, [{ file: "/tmp/s1.jsonl", entryId: "e2" }]);
	assert.ok(h.text().at(-1)!.includes("copied node text"), h.text().at(-1));

	// an entry without text is reported, like /tree does
	h.panel.handleInput("g");
	h.panel.handleInput("g");
	h.panel.handleInput("y");
	await flush();
	assert.equal(h.copies.at(-1)!.entryId, "e0");
	assert.ok(h.text().at(-1)!.includes("no text to copy"), h.text().at(-1));

	// y in the sessions pane is clone, not tree copy
	h.panel.handleInput("1");
	h.panel.handleInput("y");
	await flush();
	assert.equal(h.copies.length, 2);
	h.panel.dispose();
});

/** The centered Label dialog in rendered `lines`: its top row, title line and input line (row + 1), or undefined when closed. */
function labelDialog(lines: string[]): { top: number; title: string; input: string } | undefined {
	const top = lines.findIndex((l) => l.includes(`┌─ ${LABEL_DIALOG_TITLE} `));
	if (top < 0) return undefined;
	return { top, title: lines[top]!, input: lines[top + 1] ?? "" };
}

test("/ opens the search bar in the tree pane (footer lists it), and a opens the full tree dialog", async () => {
	const h = makeTreeActionPanel();
	await h.panel.load();
	h.panel.handleInput("2");
	h.panel.handleInput("k"); // the cursor starts on the leaf e2; move up to e1
	assert.equal(h.panel.state.cursor.tree, 1);
	// footer hints of the tree pane start with / Search and list a Tree
	const footer = h.text().at(-1)!;
	assert.ok(footer.includes("a Tree"), footer);
	assert.ok(footer.includes("/ Search"), footer);

	// / opens the search bar like in the other panes (matching is still TODO); Esc closes it
	h.panel.handleInput("/");
	assert.equal(h.panel.state.mode, "search");
	assert.ok(h.text().at(-1)!.includes("搜索:"), h.text().at(-1));
	h.panel.handleInput("\x1b");
	assert.equal(h.panel.state.mode, "normal");
	h.panel.handleInput("n");
	assert.equal(h.panel.state.mode, "normal");
	// the old filter keys are unbound: they neither change the filter nor dispatch anything
	h.panel.handleInput("u");
	assert.equal(h.panel.state.treeFilter, "default");
	assert.equal(h.text().at(-1)!.includes("not implemented"), false, h.text().at(-1));

	// a: big box with a search row, a divider, the rows (cursor on the pane's node) and a hint row
	h.panel.handleInput("a");
	assert.equal(h.panel.state.mode, "tree");
	const lines = h.text(100);
	const top = lines.findIndex((l) => l.includes("┌─ TREE "));
	assert.ok(top >= 0, lines.join("\n"));
	assert.ok(lines[top]!.includes("2/3 · default"), lines[top]);
	// the idle search row names the key that focuses it
	assert.ok(lines[top + 1]!.includes(`${SEARCH_LABEL}/ to search`), lines[top + 1]);
	assert.ok(lines[top + 2]!.includes("├──"), lines[top + 2]);
	assert.ok(lines[top + 3]!.includes("user: msg 0") && !lines[top + 3]!.includes("›"), lines[top + 3]);
	assert.ok(lines[top + 4]!.includes("› ") && lines[top + 4]!.includes("assistant: msg 1"), lines[top + 4]);
	// the box starts at column 2, so its bottom border is the first "└" found there (the pane borders sit at column 0)
	const bottom = lines.findIndex((l, i) => i > top && l.slice(2).startsWith("└"));
	assert.ok(lines[bottom - 1]!.includes("/ search") && lines[bottom - 1]!.includes("q close"), lines[bottom - 1]);
	assert.ok(lines[bottom - 2]!.includes("├──"), lines[bottom - 2]);
	// the box spans the terminal minus a 2-column margin and the footer shows its hints
	assert.equal(lines[top]!.indexOf("┌"), 2);
	assert.ok(lines.at(-1)!.includes("TREE") && lines.at(-1)!.includes("q close"), lines.at(-1));
	for (const l of h.panel.render(100)) assert.equal(visibleWidth(l), 100);

	// j moves the dialog's own cursor (the pane's stays put until the dialog closes); y copies the dialog's row
	h.panel.handleInput("j");
	assert.ok(h.text().some((l) => l.includes("┌─ TREE ") && l.includes("3/3 · default")), h.text().join("\n"));
	assert.equal(h.panel.state.cursor.tree, 1);
	h.panel.handleInput("y");
	await flush();
	assert.deepEqual(h.copies, [{ file: "/tmp/s1.jsonl", entryId: "e2" }]);
	assert.ok(h.text().at(-1)!.includes("copied node text"), `status shows under the dialog: ${h.text().at(-1)}`);
	// pane switching, scope and quit keys are switched off inside the dialog
	h.panel.handleInput("1");
	h.panel.handleInput("\t");
	h.panel.handleInput("A");
	h.panel.handleInput("\x03"); // ctrl+c
	assert.equal(h.panel.state.mode, "tree");
	assert.equal(h.panel.state.focus, "tree");
	assert.equal(h.panel.state.scope, "current-folder");
	assert.equal(h.closed(), false);

	// Esc closes it and the pane cursor follows the dialog's row (the content pane with it)
	h.panel.handleInput("\x1b");
	await flush();
	assert.equal(h.panel.state.mode, "normal");
	assert.equal(h.closed(), false);
	assert.equal(h.panel.state.cursor.tree, 2);
	assert.equal(h.panel.state.contentHighlight, "e2");
	h.panel.handleInput("a");
	h.panel.handleInput("q");
	assert.equal(h.panel.state.mode, "normal");
	assert.equal(h.closed(), false);
});

test("tree dialog: gg/G move its cursor, T labels its row over the dialog, Enter restores from it", async () => {
	const h = makeTreeActionPanel();
	await h.panel.load();
	h.panel.handleInput("2");
	h.panel.handleInput("k"); // pane cursor on e1
	await flush();
	h.panel.handleInput("a");
	const title = () => h.text().find((l) => l.includes("┌─ TREE "))!;
	assert.ok(title().includes("2/3"), title());
	h.panel.handleInput("G");
	assert.ok(title().includes("3/3"), title());
	h.panel.handleInput("g");
	h.panel.handleInput("g");
	assert.ok(title().includes("1/3"), title());
	// y on e0 (no text) reports it, still inside the dialog
	h.panel.handleInput("y");
	await flush();
	assert.equal(h.copies.at(-1)!.entryId, "e0");
	assert.ok(h.text().at(-1)!.includes("no text to copy"), h.text().at(-1));

	// T: the Label dialog is drawn over the tree dialog and names the dialog's row; saving returns to the dialog
	h.panel.handleInput("j");
	h.panel.handleInput("T");
	assert.equal(h.panel.state.mode, "label");
	let lines = h.text();
	const dlg = labelDialog(lines);
	assert.ok(dlg, "the Label dialog should be drawn");
	assert.ok(dlg.title.includes("assistant: msg 1"), dlg.title);
	assert.ok(lines.some((l) => l.includes("┌─ TREE ")), "the tree dialog stays underneath");
	assert.ok(lines.at(-1)!.includes("LABEL"), lines.at(-1));
	for (const ch of "ckpt") h.panel.handleInput(ch);
	h.panel.handleInput("\r");
	await flush();
	assert.equal(h.panel.state.mode, "tree");
	assert.deepEqual(h.labelCalls, [{ file: "/tmp/s1.jsonl", entryId: "e1", label: "ckpt" }]);
	lines = h.text();
	assert.ok(lines.some((l) => l.includes("› ") && l.includes("[ckpt]") && l.includes("assistant: msg 1")), lines.join("\n"));
	assert.ok(title().includes("2/3"), title());
	// Esc in the label prompt also lands back in the dialog
	h.panel.handleInput("T");
	h.panel.handleInput("\x1b");
	assert.equal(h.panel.state.mode, "tree");
	assert.equal(h.labelCalls.length, 1);

	// Enter on the leaf restores without asking and closes the panel (the pane cursor was on e1)
	h.panel.handleInput("j");
	h.panel.handleInput("\r");
	await flush();
	assert.deepEqual(h.enters, [{ kind: "restore", file: "/tmp/s1.jsonl", entryId: "e2", options: { summarize: false } }]);
	assert.equal(h.closed(), true);
});

test("tree dialog: Enter on another node asks Summarize branch? over the dialog; Esc returns to it, a failure keeps it open", async () => {
	const h = makeTreeActionPanel({
		restoreNode: async (_file, entryId, options) => {
			if (entryId === "e0") throw new Error("entry e0 not found in session");
			h.enters.push({ kind: "restore", file: _file, entryId, options });
			return "restored";
		},
	});
	await h.panel.load();
	h.panel.handleInput("2");
	h.panel.handleInput("a");
	h.panel.handleInput("g");
	h.panel.handleInput("g"); // dialog cursor on e0
	h.panel.handleInput("\r");
	assert.equal(h.panel.state.mode, "restore");
	const menu = summaryMenu(h.text());
	assert.ok(menu, "the menu should be drawn");
	assert.ok(menu.title.includes("user: msg 0"), menu.title);
	assert.ok(h.text().some((l) => l.includes("┌─ TREE ")), "the tree dialog stays underneath");
	h.panel.handleInput("\x1b");
	assert.equal(h.panel.state.mode, "tree");
	assert.deepEqual(h.enters, []);

	// No summary on e0 fails: the panel comes back with the dialog still open and the error in the footer
	h.panel.handleInput("\r");
	h.panel.handleInput("\r");
	await flush();
	assert.equal(h.closed(), false);
	assert.deepEqual(h.hidden, [true, false]);
	assert.equal(h.panel.state.mode, "tree");
	assert.ok(h.text().at(-1)!.includes("restore failed: entry e0 not found"), h.text().at(-1));
	// then e1 succeeds
	h.panel.handleInput("j");
	h.panel.handleInput("\r");
	h.panel.handleInput("\r");
	await flush();
	assert.deepEqual(h.enters, [{ kind: "restore", file: "/tmp/s1.jsonl", entryId: "e1", options: { summarize: false } }]);
	assert.equal(h.closed(), true);
});

test("tree dialog search filters live; Esc leaves the search row keeping the query, Esc on the list closes; folds open meanwhile and come back", async () => {
	const h = makeForkedPanel();
	await h.panel.load();
	const title = () => h.text().find((l) => l.includes("┌─ TREE "))!;
	const searchRow = () => {
		const lines = h.text();
		return lines[lines.findIndex((l) => l.includes("┌─ TREE ")) + 1]!;
	};
	const folded = () => [...h.panel.state.treeFolded].sort();
	h.panel.handleInput("2");
	h.panel.handleInput("a");
	assert.ok(title().includes("4/4 · default"), title());
	assert.deepEqual(folded(), ["e1"]);

	// / focuses the search row: the footer switches to its hints and typing filters at once
	h.panel.handleInput("/");
	assert.ok(h.text().at(-1)!.includes("Esc back to the list"), h.text().at(-1));
	h.panel.handleInput("2");
	const lines = h.text();
	assert.ok(title().includes("1/1 · default"), title());
	assert.ok(lines.some((l) => l.includes("› ") && l.includes("user: msg 2")), lines.join("\n"));
	assert.equal(lines.some((l) => l.includes("assistant: msg 1")), false, "non-matching rows are gone");
	// the match sat inside the folded side branch: folds are cleared while searching
	assert.deepEqual(folded(), []);
	// keys are text while the search row is focused; Enter means nothing there
	h.panel.handleInput("q");
	assert.equal(h.panel.state.mode, "tree");
	assert.ok(title().includes("0/0"), title());
	assert.ok(h.text().some((l) => l.includes("No matches.")), h.text().join("\n"));
	h.panel.handleInput("\x7f"); // backspace: back to "2"
	assert.ok(title().includes("1/1"), title());
	h.panel.handleInput("\r");
	assert.ok(h.text().at(-1)!.includes("Esc back to the list"), `Enter is not a search key: ${h.text().at(-1)}`);
	assert.ok(title().includes("1/1"), title());

	// Esc leaves the search row: the query and the narrowed rows stay, the keys go to the list
	h.panel.handleInput("\x1b");
	assert.ok(h.text().at(-1)!.includes("q close"), h.text().at(-1));
	assert.ok(title().includes("1/1"), title());
	assert.ok(searchRow().includes(`${SEARCH_LABEL}2`) && !searchRow().includes("to search"), searchRow());
	assert.deepEqual(folded(), [], "still searching: the folds stay open");
	// / again continues the same query; deleting it all restores the folds and the cursor lands on the nearest listed ancestor
	h.panel.handleInput("/");
	h.panel.handleInput("\x7f");
	assert.deepEqual(folded(), ["e1"]);
	assert.ok(title().includes("2/4"), title());
	h.panel.handleInput("\x1b");
	assert.ok(searchRow().includes("/ to search"), searchRow());
	assert.equal(h.panel.state.mode, "tree");

	// Esc on the list closes the dialog
	h.panel.handleInput("\x1b");
	assert.equal(h.panel.state.mode, "normal");

	// closing while a query is active: the search ends, the pre-search folds come back, and the chosen row is revealed and selected in the pane
	h.panel.handleInput("a");
	h.panel.handleInput("/");
	h.panel.handleInput("2");
	h.panel.handleInput("\x1b");
	assert.deepEqual(folded(), []);
	h.panel.handleInput("q");
	await flush();
	assert.equal(h.panel.state.mode, "normal");
	assert.deepEqual(folded(), [], "e1 came back folded, then was opened to reveal e2");
	assert.equal(h.panel.state.cursor.tree, 2);
	assert.equal(h.panel.state.contentHighlight, "e2");
	assert.ok(h.text().some((l) => l.includes("›") && l.includes("user: msg 2")), h.text().join("\n"));
	// reopening starts without a query
	h.panel.handleInput("a");
	assert.ok(title().includes("3/5"), title());
	assert.ok(searchRow().includes("/ to search"), searchRow());
	h.panel.handleInput("q");
	h.panel.dispose();
});

test("tree dialog search matches labels and qualifiers", async () => {
	const h = makeTreeActionPanel();
	await h.panel.load();
	h.panel.handleInput("2");
	h.panel.handleInput("k");
	await flush();
	h.panel.handleInput("T");
	for (const ch of "ckpt") h.panel.handleInput(ch);
	h.panel.handleInput("\r");
	await flush();
	h.panel.handleInput("a");
	const title = () => h.text().find((l) => l.includes("┌─ TREE "))!;
	h.panel.handleInput("/");
	for (const ch of "CKPT") h.panel.handleInput(ch);
	assert.ok(title().includes("1/1"), `the title counts the matches: ${title()}`);
	assert.ok(h.text().some((l) => l.includes("[ckpt]") && l.includes("assistant: msg 1")));
	for (const ch of " tag:ck") h.panel.handleInput(ch);
	assert.ok(title().includes("1/1"), title());
	for (const ch of "x") h.panel.handleInput(ch); // tag:ckx matches nothing
	assert.ok(title().includes("0/0"), title());
	h.panel.dispose();
});

test("tree dialog filters d/t/u/l/a reload the tree (toggling back to default), clear the folds and show in both titles", async () => {
	const h = makeTreeActionPanel();
	await h.panel.load();
	h.panel.handleInput("2");
	h.panel.handleInput("a");
	const title = () => h.text().find((l) => l.includes("┌─ TREE "))!;
	h.panel.handleInput("u");
	await flush();
	assert.equal(h.panel.state.treeFilter, "user-only");
	assert.equal(h.treeFilters.at(-1), "user-only");
	assert.ok(title().includes("3/3 · user-only"), title());
	h.panel.handleInput("u"); // toggle back
	await flush();
	assert.equal(h.panel.state.treeFilter, "default");
	h.panel.handleInput("l");
	await flush();
	assert.equal(h.panel.state.treeFilter, "labeled");
	assert.ok(title().includes("0/0 · labeled"), title());
	assert.ok(h.text().some((l) => l.includes("No entries.")), h.text().join("\n"));
	h.panel.handleInput("a");
	await flush();
	assert.equal(h.panel.state.treeFilter, "all");
	assert.ok(title().includes("3/3 · all"), title());
	h.panel.handleInput("t");
	await flush();
	assert.equal(h.panel.state.treeFilter, "no-tools");
	h.panel.handleInput("d");
	await flush();
	assert.equal(h.panel.state.treeFilter, "default");
	assert.ok(title().includes("3/3 · default"), title());
	// the pane names a non-default filter in its header once the dialog closes
	h.panel.handleInput("u");
	await flush();
	h.panel.handleInput("q");
	const paneHeader = h.text(160).find((l) => l.includes("[2] TREE"))!;
	assert.ok(paneHeader.includes("· user-only"), paneHeader);
	h.panel.dispose();

	// a filter change clears the folds like pi (a folded side branch would hide the rows the filter asks for)
	const forked = makeForkedPanel();
	await forked.panel.load();
	forked.panel.handleInput("2");
	forked.panel.handleInput("a");
	assert.deepEqual([...forked.panel.state.treeFolded], ["e1"]);
	forked.panel.handleInput("a"); // filter: all
	await flush();
	assert.deepEqual([...forked.panel.state.treeFolded], []);
	assert.ok(forked.text().some((l) => l.includes("┌─ TREE ") && l.includes("5/5 · all")), forked.text().join("\n"));
	forked.panel.dispose();
});

test("tree dialog z folds / unfolds on the shared fold state; h switches nothing and l is the labeled filter", async () => {
	const h = makeForkedPanel();
	await h.panel.load();
	const title = () => h.text().find((l) => l.includes("┌─ TREE "))!;
	const folded = () => [...h.panel.state.treeFolded].sort();
	const cursorRow = () => h.text().find((l) => /›\s/.test(l.slice(2)))!;
	h.panel.handleInput("2");
	h.panel.handleInput("a");
	// cursor starts on the active leaf e4: z folds its segment and jumps to the head e3 (⊞, e4 gone)
	assert.ok(title().includes("4/4"), title());
	h.panel.handleInput("z");
	assert.deepEqual(folded(), ["e1", "e3"]);
	assert.ok(title().includes("3/3"), title());
	assert.ok(cursorRow().includes("└⊞ ") && cursorRow().includes("assistant: msg 3"), cursorRow());
	// z on the folded head opens it again
	h.panel.handleInput("z");
	assert.deepEqual(folded(), ["e1"]);
	assert.ok(title().includes("3/4"), title());
	// k onto the folded side branch e1: z opens it, j into it, z folds it again and jumps back to the head
	h.panel.handleInput("k");
	assert.ok(cursorRow().includes("├⊞ ") && cursorRow().includes("assistant: msg 1"), cursorRow());
	h.panel.handleInput("z");
	assert.deepEqual(folded(), []);
	assert.ok(title().includes("2/5"), title());
	h.panel.handleInput("j");
	assert.ok(cursorRow().includes("user: msg 2"), cursorRow());
	h.panel.handleInput("z");
	assert.deepEqual(folded(), ["e1"]);
	assert.ok(title().includes("2/4"), title());
	// the trunk has nothing to fold
	h.panel.handleInput("g");
	h.panel.handleInput("g");
	h.panel.handleInput("z");
	assert.ok(h.text().at(-1)!.includes("nothing to fold"), h.text().at(-1));
	assert.deepEqual(folded(), ["e1"]);
	// the pane sees the same fold state after closing
	h.panel.handleInput("q");
	assert.deepEqual(folded(), ["e1"]);
	assert.equal(h.panel.state.cursor.tree, 0);
	assert.ok(h.text().some((l) => l.includes("▸ ") && l.includes("assistant: msg 1")), h.text().join("\n"));

	// h is pane switching outside and does nothing here; l is the labeled filter, not "next pane"
	h.panel.handleInput("a");
	h.panel.handleInput("h");
	assert.equal(h.panel.state.mode, "tree");
	assert.equal(h.panel.state.focus, "tree");
	h.panel.handleInput("l");
	await flush();
	assert.equal(h.panel.state.focus, "tree");
	assert.equal(h.panel.state.treeFilter, "labeled");
	h.panel.handleInput("l");
	await flush();
	assert.equal(h.panel.state.treeFilter, "default");
	h.panel.handleInput("q");
	h.panel.dispose();
});

test("? does nothing inside the tree dialog: every key it has is on its bottom row", async () => {
	const h = makeTreeActionPanel();
	await h.panel.load();
	h.panel.handleInput("2");
	h.panel.handleInput("a");
	h.panel.handleInput("?");
	assert.equal(h.panel.state.helpOpen, false);
	assert.equal(h.panel.state.mode, "tree");
	const lines = h.text(160);
	const bottom = lines.findIndex((l, i) => i > 0 && l.slice(2).startsWith("└"));
	const hintRow = lines[bottom - 1]!;
	for (const hint of ["/ search", "j/k move", "Enter restore", "q close", "z fold", "d/t/u/l/a filter", "y copy", "T label"]) {
		assert.ok(hintRow.includes(hint), `${hint} missing from: ${hintRow}`);
	}
	assert.equal(hintRow.includes("? help"), false, hintRow);
	assert.equal(hintRow.includes("h/l"), false, hintRow);
	assert.ok(lines.at(-1)!.includes("d/t/u/l/a filter"), `the footer repeats the hints: ${lines.at(-1)}`);
	h.panel.handleInput("q");
	assert.equal(h.panel.state.mode, "normal");
	h.panel.dispose();
});

/** Panel with one session whose tree forks: e0 ─┬─ e1 (side) → e2, └─ e3 (active) → e4 (active leaf). */
function makeForkedPanel() {
	const contentCalls: Array<string | undefined> = [];
	const data: DataSource = {
		listSessions: async () => [row(1, "/a")],
		loadTree: async () => [
			treeRow(0),
			treeRow(1, false, { parentId: "e0" }),
			treeRow(2, false, { parentId: "e1" }),
			treeRow(3, true, { parentId: "e0" }),
			treeRow(4, true, { parentId: "e3", isLeaf: true }),
		],
		loadContent: async (_file, leaf) => {
			contentCalls.push(leaf);
			return leaf === "e1" || leaf === "e2" ? [block(0), block(1), block(2)] : [block(0), block(3), block(4)];
		},
	};
	const panel = new LazyPanel({ theme: fakeTheme, data, getHeight: () => 20, requestRender: () => {}, onClose: () => {} });
	// 160 columns: the left column is 40 wide, so "assistant: msg N" survives the truncation of the narrow pane
	return { panel, contentCalls, text: (width = 160) => panel.render(width).map((l) => stripTerminalSequences(l)) };
}

test("side branches start folded; z folds / unfolds the segment under the cursor and the dialog shows ⊞", async () => {
	const h = makeForkedPanel();
	await h.panel.load();
	const folded = () => [...h.panel.state.treeFolded].sort();
	// tree rows carry "role: msg N"; content blocks say "message N", session rows "session N"
	const treeLine = (lines: string[], role: string, i: number) => lines.find((l) => l.includes(`${role}: msg ${i}`));

	// the side branch e1 starts folded (e2 hidden), the active one open; the cursor sits on the active leaf e4
	assert.deepEqual(folded(), ["e1"]);
	assert.equal(h.panel.state.cursor.tree, 3);
	let lines = h.text();
	assert.ok(lines.some((l) => l.includes("TREE") && l.includes("4/4")), lines.join("\n"));
	assert.ok(treeLine(lines, "assistant", 1)!.includes("▸ "), treeLine(lines, "assistant", 1));
	assert.ok(treeLine(lines, "assistant", 3)!.includes("▾ • "), treeLine(lines, "assistant", 3));
	assert.equal(treeLine(lines, "user", 2), undefined);
	// the root is not foldable: nothing in front of the trunk
	assert.ok(treeLine(lines, "user", 0)!.startsWith("│  • "), treeLine(lines, "user", 0));
	// rows inside the open branch are indented one level, right under the branch's text
	assert.ok(treeLine(lines, "user", 4)!.startsWith("│›   • "), treeLine(lines, "user", 4));

	// z on the folded head unfolds it; the cursor stays on the head
	h.panel.handleInput("2");
	h.panel.handleInput("k");
	h.panel.handleInput("k");
	assert.equal(h.panel.state.cursor.tree, 1);
	h.panel.handleInput("z");
	assert.deepEqual(folded(), []);
	assert.equal(h.panel.state.cursor.tree, 1);
	lines = h.text();
	assert.equal(lines.indexOf(treeLine(lines, "user", 2)!), lines.indexOf(treeLine(lines, "assistant", 1)!) + 1);
	assert.ok(treeLine(lines, "assistant", 1)!.includes("▸ ") === false && treeLine(lines, "assistant", 1)!.includes("▾ "));

	// z inside the segment folds it and jumps to its head; the content pane follows the cursor
	h.panel.handleInput("j");
	assert.equal(h.panel.state.cursor.tree, 2);
	await flush();
	assert.ok(h.contentCalls.includes("e2"), h.contentCalls.join(","));
	h.panel.handleInput("z");
	await flush();
	assert.deepEqual(folded(), ["e1"]);
	assert.equal(h.panel.state.cursor.tree, 1);
	assert.equal(treeLine(h.text(), "user", 2), undefined);
	assert.equal(h.panel.state.contentHighlight, "e1");

	// the trunk of a single-root tree has nothing to fold
	h.panel.handleInput("g");
	h.panel.handleInput("g");
	h.panel.handleInput("z");
	assert.deepEqual(folded(), ["e1"]);
	assert.ok(h.text().at(-1)!.includes("nothing to fold"), h.text().at(-1));

	// the active branch folds too (z on its leaf jumps to e3), and z on the folded head opens it again
	h.panel.handleInput("G");
	assert.equal(h.panel.state.cursor.tree, 3);
	h.panel.handleInput("z");
	await flush();
	assert.deepEqual(folded(), ["e1", "e3"]);
	assert.equal(h.panel.state.cursor.tree, 2);
	assert.equal(treeLine(h.text(), "user", 4), undefined);
	h.panel.handleInput("z");
	assert.deepEqual(folded(), ["e1"]);
	assert.equal(h.panel.state.cursor.tree, 2);
	assert.ok(treeLine(h.text(), "user", 4));

	// the dialog lists the same rows with ⊞ on the folded head
	h.panel.handleInput("a");
	lines = h.text();
	assert.ok(lines.some((l) => l.includes("├⊞ ") && l.includes("assistant: msg 1")), lines.join("\n"));
	assert.equal(treeLine(lines, "user", 2), undefined);
	assert.ok(lines.some((l) => l.includes("┌─ TREE ") && l.includes("3/4 · default")), lines.join("\n"));
	h.panel.handleInput("q");
	h.panel.dispose();
});

test("T opens a centered Label dialog; Enter saves and refreshes the row, empty removes, Esc cancels", async () => {
	const h = makeTreeActionPanel();
	await h.panel.load();
	h.panel.handleInput("2");
	h.panel.handleInput("k"); // cursor on e1
	await flush();
	h.panel.handleInput("T");
	assert.equal(h.panel.state.mode, "label");
	const lines = h.text();
	const dlg = labelDialog(lines);
	assert.ok(dlg, "the Label dialog should be drawn");
	// drawn over the middle of the panel (not in the footer row), naming the node; the footer carries the dialog's keys
	assert.ok(dlg.top > 2 && dlg.top < lines.length - 6, `dialog row ${dlg.top} of ${lines.length}`);
	assert.ok(dlg.title.includes("assistant: msg 1"), dlg.title);
	// 3 rows: border, input, border — the bottom border sits right under the input line
	assert.ok(lines[dlg.top + 2]!.includes("└"), lines[dlg.top + 2]);
	const footer = lines.at(-1)!;
	assert.ok(footer.includes("LABEL") && footer.includes("Enter save") && footer.includes("empty removes"), footer);
	for (const l of h.panel.render(100)) assert.equal(visibleWidth(l), 100);

	// keys go to the input, not to the keymap
	for (const ch of "ckpt") h.panel.handleInput(ch);
	assert.equal(h.panel.state.focus, "tree");
	assert.equal(h.panel.state.cursor.tree, 1);
	assert.ok(labelDialog(h.text())!.input.includes("ckpt"));
	h.panel.handleInput("\r");
	await flush();
	assert.equal(h.panel.state.mode, "normal");
	assert.equal(labelDialog(h.text()), undefined, "dialog closes on Enter");
	assert.deepEqual(h.labelCalls, [{ file: "/tmp/s1.jsonl", entryId: "e1", label: "ckpt" }]);
	// tree reloaded: the row now shows the label, cursor stays on the same node
	assert.equal(h.panel.state.cursor.tree, 1);
	assert.ok(h.text().some((l) => l.includes("[ckpt]")), "tree row should show the new label");
	assert.ok(h.text().at(-1)!.includes("label set: ckpt"));

	// reopening pre-fills the current label; Esc leaves it untouched
	h.panel.handleInput("T");
	assert.ok(labelDialog(h.text())!.input.includes("ckpt"));
	h.panel.handleInput("\x1b");
	assert.equal(h.panel.state.mode, "normal");
	assert.equal(labelDialog(h.text()), undefined, "dialog closes on Esc");
	assert.equal(h.labelCalls.length, 1);
	assert.equal(h.labels.get("e1"), "ckpt");

	// the cursor starts at the end of the pre-filled text, so backspace clears it; an empty value removes the label
	h.panel.handleInput("T");
	for (let i = 0; i < 4; i++) h.panel.handleInput("\x7f");
	assert.equal(labelDialog(h.text())!.input.includes("ckpt"), false);
	h.panel.handleInput("\r");
	await flush();
	assert.deepEqual(h.labelCalls.at(-1), { file: "/tmp/s1.jsonl", entryId: "e1", label: undefined });
	assert.equal(h.labels.has("e1"), false);
	assert.ok(h.text().at(-1)!.includes("label removed"));
	h.panel.dispose();
});

test("label errors land in the footer and a panel without actions says so", async () => {
	const failing = makeTreeActionPanel({
		setNodeLabel: async () => {
			throw new Error("disk full");
		},
	});
	await failing.panel.load();
	failing.panel.handleInput("2");
	failing.panel.handleInput("T");
	failing.panel.handleInput("x");
	failing.panel.handleInput("\r");
	await flush();
	assert.ok(failing.text().at(-1)!.includes("label failed: disk full"), failing.text().at(-1));
	failing.panel.dispose();

	const bare = makeLoadedPanel();
	await bare.panel.load();
	bare.panel.handleInput("2");
	bare.panel.handleInput("T");
	assert.equal(bare.panel.state.mode, "normal");
	assert.ok(bare.text().at(-1)!.includes("actions unavailable"));
	bare.panel.handleInput("y");
	await flush();
	assert.ok(bare.text().at(-1)!.includes("actions unavailable"));
	// Enter in either pane says so too and keeps the panel open
	bare.panel.handleInput("\r");
	await flush();
	assert.ok(bare.text().at(-1)!.includes("restore: actions unavailable"), bare.text().at(-1));
	bare.panel.handleInput("1");
	bare.panel.handleInput("\r");
	await flush();
	assert.ok(bare.text().at(-1)!.includes("resume: actions unavailable"), bare.text().at(-1));
	bare.panel.dispose();
});

test("Enter in the sessions pane resumes the session under the cursor and closes the panel", async () => {
	const h = makeTreeActionPanel();
	await h.panel.load();
	assert.equal(h.panel.state.focus, "sessions");
	h.panel.handleInput("\r");
	await flush();
	assert.deepEqual(h.enters, [{ kind: "resume", file: "/tmp/s1.jsonl" }]);
	assert.equal(h.closed(), true);
	// hidden while pi switched; a successful switch closes the panel instead of showing it again
	assert.deepEqual(h.hidden, [true]);
});

test("Enter in the tree pane on the active leaf restores without asking (switching session first is the action's job)", async () => {
	const h = makeTreeActionPanel();
	await h.panel.load();
	h.panel.handleInput("2");
	assert.equal(h.panel.state.cursor.tree, 2, "the cursor starts on the leaf");
	h.panel.handleInput("\r");
	await flush();
	assert.equal(summaryMenu(h.text()), undefined, "no menu for the leaf");
	assert.deepEqual(h.enters, [{ kind: "restore", file: "/tmp/s1.jsonl", entryId: "e2", options: { summarize: false } }]);
	assert.equal(h.closed(), true);
});

/** The centered "Summarize branch?" menu in rendered `lines`: its title line and the entry lines, or undefined when closed. */
function summaryMenu(lines: string[]): { top: number; title: string; items: string[]; selected: string | undefined } | undefined {
	const top = lines.findIndex((l) => l.includes(`┌─ ${SUMMARY_MENU_TITLE} `));
	if (top < 0) return undefined;
	const items = lines.slice(top + 1, top + 1 + SUMMARY_MENU.length);
	const selected = items.find((l) => l.includes("›"));
	return { top, title: lines[top]!, items, selected: selected?.replace(/.*›\s*/, "").trim() };
}

test("Enter on another node opens the Summarize branch? menu: j/k move, Esc goes back to the tree, No summary restores", async () => {
	const h = makeTreeActionPanel();
	await h.panel.load();
	h.panel.handleInput("2");
	h.panel.handleInput("k"); // cursor on e1
	await flush();
	h.panel.handleInput("\r");
	assert.equal(h.panel.state.mode, "restore");
	let lines = h.text();
	const menu = summaryMenu(lines);
	assert.ok(menu, "the menu should be drawn");
	// drawn over the middle of the panel, naming the node; three entries in pi's order, cursor on the first
	assert.ok(menu.top > 2 && menu.top < lines.length - 6, `menu row ${menu.top} of ${lines.length}`);
	assert.ok(menu.title.includes("assistant: msg 1"), menu.title);
	for (const [i, m] of SUMMARY_MENU.entries()) assert.ok(menu.items[i]!.includes(m.label), `${i}: ${menu.items[i]}`);
	assert.ok(menu.items[0]!.startsWith("No summary") || menu.selected?.startsWith("No summary"), menu.items[0]);
	assert.ok(lines[menu.top + SUMMARY_MENU.length + 1]!.includes("└"), "bottom border right under the last entry");
	const footer = lines.at(-1)!;
	assert.ok(footer.includes("RESTORE") && footer.includes("Enter select") && footer.includes("Esc cancel"), footer);
	for (const l of h.panel.render(100)) assert.equal(visibleWidth(l), 100);

	// j / k move the menu cursor, not the tree cursor; other keys are swallowed
	h.panel.handleInput("j");
	assert.ok(summaryMenu(h.text())!.selected?.startsWith("Summarize"), "j moves down");
	h.panel.handleInput("j");
	h.panel.handleInput("j");
	assert.ok(summaryMenu(h.text())!.selected?.startsWith("Summarize with custom prompt"), "clamped at the bottom");
	h.panel.handleInput("k");
	h.panel.handleInput("\x1b[A"); // up arrow
	assert.ok(summaryMenu(h.text())!.selected?.startsWith("No summary"), "k / ↑ move up");
	h.panel.handleInput("q");
	h.panel.handleInput("l");
	assert.equal(h.closed(), false);
	assert.equal(h.panel.state.focus, "tree");
	assert.equal(h.panel.state.cursor.tree, 1);

	// Esc: back to the tree, nothing restored
	h.panel.handleInput("\x1b");
	assert.equal(h.panel.state.mode, "normal");
	assert.equal(summaryMenu(h.text()), undefined, "menu closes on Esc");
	assert.deepEqual(h.enters, []);
	assert.deepEqual(h.hidden, []);
	assert.equal(h.closed(), false);

	// Enter again, pick "No summary"
	h.panel.handleInput("\r");
	h.panel.handleInput("\r");
	await flush();
	assert.deepEqual(h.enters, [{ kind: "restore", file: "/tmp/s1.jsonl", entryId: "e1", options: { summarize: false } }]);
	assert.equal(h.closed(), true);
	lines = h.text();
	assert.equal(summaryMenu(lines), undefined);
});

test("Summarize: the footer says summarizing branch… while pi writes the summary, then the panel closes", async () => {
	let finish: (() => void) | undefined;
	const h = makeTreeActionPanel({
		restoreNode: (file, entryId, options) =>
			new Promise((resolve) => {
				h.enters.push({ kind: "restore", file, entryId, options });
				finish = () => resolve("restored");
			}),
	});
	await h.panel.load();
	h.panel.handleInput("2");
	h.panel.handleInput("k");
	await flush();
	h.panel.handleInput("\r");
	h.panel.handleInput("j"); // Summarize
	h.panel.handleInput("\r");
	assert.deepEqual(h.enters, [{ kind: "restore", file: "/tmp/s1.jsonl", entryId: "e1", options: { summarize: true } }]);
	assert.equal(h.panel.state.mode, "normal");
	assert.ok(h.text().at(-1)!.includes(SUMMARIZING_STATUS), h.text().at(-1));
	assert.deepEqual(h.hidden, [true]);
	// keys are ignored meanwhile, like any other Enter
	h.panel.handleInput("q");
	h.panel.handleInput("\r");
	assert.equal(h.closed(), false);
	assert.equal(h.enters.length, 1);
	finish!();
	await flush();
	assert.equal(h.closed(), true);
});

test("Summarize with custom prompt opens a one-line input; Esc returns to the menu, Enter summarizes with the text", async () => {
	const h = makeTreeActionPanel();
	await h.panel.load();
	h.panel.handleInput("2");
	h.panel.handleInput("k");
	await flush();
	h.panel.handleInput("\r");
	h.panel.handleInput("G"); // swallowed by the menu (only j/k/arrows move)
	assert.ok(summaryMenu(h.text())!.selected?.startsWith("No summary"));
	h.panel.handleInput("j");
	h.panel.handleInput("j");
	h.panel.handleInput("\r");
	// the menu is replaced by the custom prompt, still in restore mode
	assert.equal(h.panel.state.mode, "restore");
	let lines = h.text();
	assert.equal(summaryMenu(lines), undefined);
	const promptTop = lines.findIndex((l) => l.includes(`┌─ ${CUSTOM_PROMPT_TITLE} `));
	assert.ok(promptTop > 0, "the custom prompt should be drawn");
	assert.ok(lines[promptTop]!.includes("assistant: msg 1"), lines[promptTop]);
	assert.ok(lines.at(-1)!.includes("Enter summarize") && lines.at(-1)!.includes("Esc back"), lines.at(-1));
	for (const l of h.panel.render(100)) assert.equal(visibleWidth(l), 100);

	// Esc: back to the menu with the cursor still on the custom entry (pi loops back to the selector too)
	h.panel.handleInput("\x1b");
	assert.equal(h.panel.state.mode, "restore");
	const menu = summaryMenu(h.text());
	assert.ok(menu, "menu reopens after Esc in the prompt");
	assert.ok(menu.selected?.startsWith("Summarize with custom prompt"), menu.selected);
	assert.deepEqual(h.enters, []);

	// Enter with instructions
	h.panel.handleInput("\r");
	for (const ch of "focus on x") h.panel.handleInput(ch);
	assert.equal(h.panel.state.cursor.tree, 1, "typing goes to the prompt, not the keymap");
	lines = h.text();
	assert.ok(lines[lines.findIndex((l) => l.includes(`┌─ ${CUSTOM_PROMPT_TITLE} `)) + 1]!.includes("focus on x"));
	h.panel.handleInput("\r");
	await flush();
	assert.equal(h.panel.state.mode, "normal");
	assert.deepEqual(h.enters, [
		{ kind: "restore", file: "/tmp/s1.jsonl", entryId: "e1", options: { summarize: true, customInstructions: "focus on x" } },
	]);
	assert.equal(h.closed(), true);

	// a blank prompt means pi's default instructions
	const blank = makeTreeActionPanel();
	await blank.panel.load();
	blank.panel.handleInput("2");
	blank.panel.handleInput("k");
	await flush();
	blank.panel.handleInput("\r");
	blank.panel.handleInput("j");
	blank.panel.handleInput("j");
	blank.panel.handleInput("\r");
	blank.panel.handleInput(" ");
	blank.panel.handleInput("\r");
	await flush();
	assert.deepEqual(blank.enters.at(-1)?.options, { summarize: true });
	assert.equal(blank.closed(), true);
});

test("pi's branchSummary.skipPrompt skips the menu and restores without a summary", async () => {
	const h = makeTreeActionPanel(undefined, { skipSummaryPrompt: true });
	await h.panel.load();
	h.panel.handleInput("2");
	h.panel.handleInput("g");
	h.panel.handleInput("g");
	await flush();
	h.panel.handleInput("\r");
	await flush();
	assert.equal(summaryMenu(h.text()), undefined);
	assert.deepEqual(h.enters, [{ kind: "restore", file: "/tmp/s1.jsonl", entryId: "e0", options: { summarize: false } }]);
	assert.equal(h.closed(), true);
});

test("a failed Enter stays in the footer, shows the panel again and keeps it usable", async () => {
	const h = makeTreeActionPanel({
		restoreNode: async (_file, _entryId, options) => {
			throw new Error(options.summarize ? "No model available for summarization" : "entry e1 not found in session");
		},
		resumeSession: async () => {
			throw new Error("session file not found: /tmp/s1.jsonl");
		},
	});
	await h.panel.load();
	h.panel.handleInput("2");
	h.panel.handleInput("k");
	await flush();
	h.panel.handleInput("\r");
	h.panel.handleInput("\r"); // No summary
	await flush();
	assert.equal(h.closed(), false);
	assert.deepEqual(h.hidden, [true, false]);
	assert.ok(h.text().at(-1)!.includes("restore failed: entry e1 not found"), h.text().at(-1));
	// keys work again afterwards
	h.panel.handleInput("k");
	assert.equal(h.panel.state.cursor.tree, 0);

	// a summary that pi refuses (no model) is reported the same way
	h.panel.handleInput("\r");
	h.panel.handleInput("j");
	h.panel.handleInput("\r");
	await flush();
	assert.equal(h.closed(), false);
	assert.ok(h.text().at(-1)!.includes("restore failed: No model available"), h.text().at(-1));

	h.panel.handleInput("1");
	h.panel.handleInput("\r");
	await flush();
	assert.equal(h.closed(), false);
	assert.ok(h.text().at(-1)!.includes("resume failed: session file not found"), h.text().at(-1));
	h.panel.dispose();
});

test("keys are ignored while an Enter action is waiting for pi", async () => {
	let finish: (() => void) | undefined;
	const h = makeTreeActionPanel({
		resumeSession: () =>
			new Promise((resolve) => {
				finish = () => resolve("switched");
			}),
	});
	await h.panel.load();
	h.panel.handleInput("\r");
	assert.ok(h.text().at(-1)!.includes("resume…"), h.text().at(-1));
	assert.deepEqual(h.hidden, [true]);
	// q would normally quit; a second Enter would start another resume
	h.panel.handleInput("q");
	h.panel.handleInput("\r");
	h.panel.handleInput("l");
	assert.equal(h.closed(), false);
	assert.equal(h.panel.state.focus, "sessions");
	assert.ok(finish, "the action should have been started once");
	finish!();
	await flush();
	assert.equal(h.closed(), true);
});

test("InputDialog is a reusable 3-row prompt: title / value / subject / hints come from open()", () => {
	const submitted: string[] = [];
	let cancelled = 0;
	const dlg = new InputDialog({ theme: fakeTheme, onChange: () => {} });
	assert.equal(dlg.isOpen, false);
	assert.deepEqual(dlg.hints, []);

	dlg.open({ title: "Rename", value: "old", subject: "session A", hints: [["Enter", "rename"]], onSubmit: (v) => submitted.push(v), onCancel: () => cancelled++ });
	assert.equal(dlg.isOpen, true);
	assert.deepEqual(dlg.hints, [["Enter", "rename"]]);
	const lines = dlg.render(40);
	assert.equal(lines.length, 3);
	for (const l of lines) assert.equal(visibleWidth(l), 40);
	assert.ok(lines[0]!.includes("┌─ Rename ") && lines[0]!.includes("session A"), lines[0]);
	assert.ok(lines[1]!.includes("old"), lines[1]);
	assert.ok(lines[2]!.startsWith("└"), lines[2]);

	// the cursor starts at the end, so typing appends
	dlg.handleInput("!");
	assert.equal(dlg.getValue(), "old!");
	dlg.handleInput("\r");
	assert.deepEqual(submitted, ["old!"]);

	// a second open swaps every part of the spec, including the callbacks
	dlg.open({ title: "Label", hints: [], onSubmit: (v) => submitted.push(`label:${v}`), onCancel: () => cancelled++ });
	assert.equal(dlg.getValue(), "");
	assert.ok(dlg.render(40)[0]!.includes("┌─ Label "));
	dlg.handleInput("\x1b");
	assert.equal(cancelled, 1);
	dlg.close();
	assert.equal(dlg.isOpen, false);
});

test("SelectDialog is a reusable centered menu: items / cursor / subject / hints come from open()", () => {
	const picked: number[] = [];
	let cancelled = 0;
	const dlg = new SelectDialog({ theme: fakeTheme, onChange: () => {} });
	assert.equal(dlg.isOpen, false);
	assert.deepEqual(dlg.hints, []);

	dlg.open({
		title: "Delete?",
		items: ["Yes", "No"],
		initialIndex: 1,
		subject: "session A",
		hints: [["Enter", "pick"]],
		onSelect: (i) => picked.push(i),
		onCancel: () => cancelled++,
	});
	assert.equal(dlg.isOpen, true);
	assert.equal(dlg.selectedIndex, 1);
	assert.deepEqual(dlg.hints, [["Enter", "pick"]]);
	const lines = dlg.render(40).map((l) => stripTerminalSequences(l));
	assert.equal(lines.length, 4, "border + one row per entry + border");
	for (const l of dlg.render(40)) assert.equal(visibleWidth(l), 40);
	assert.ok(lines[0]!.includes("┌─ Delete? ") && lines[0]!.includes("session A"), lines[0]);
	assert.ok(lines[1]!.includes("  Yes") && !lines[1]!.includes("›"), lines[1]);
	assert.ok(lines[2]!.includes("› No"), lines[2]);
	assert.ok(lines[3]!.startsWith("└"), lines[3]);

	// j / k / arrows move and clamp; Enter reports the index; Esc cancels; other keys do nothing
	dlg.handleInput("j");
	assert.equal(dlg.selectedIndex, 1);
	dlg.handleInput("k");
	assert.equal(dlg.selectedIndex, 0);
	dlg.handleInput("\x1b[B");
	assert.equal(dlg.selectedIndex, 1);
	dlg.handleInput("x");
	assert.equal(dlg.selectedIndex, 1);
	dlg.handleInput("\r");
	assert.deepEqual(picked, [1]);
	dlg.handleInput("\x1b");
	assert.equal(cancelled, 1);

	// a second open swaps the spec; an out-of-range initial index is clamped
	dlg.open({ title: "Sort", items: ["a", "b", "c"], initialIndex: 9, hints: [], onSelect: (i) => picked.push(i), onCancel: () => cancelled++ });
	assert.equal(dlg.selectedIndex, 2);
	assert.ok(stripTerminalSequences(dlg.render(30)[0]!).includes("┌─ Sort "));
	dlg.close();
	assert.equal(dlg.isOpen, false);
	dlg.handleInput("\r");
	assert.deepEqual(picked, [1], "a closed dialog ignores input");
});

test("the sessions cursor starts on pi's current session and stays put when it is not listed", async () => {
	const make = (currentSessionFile?: string) => {
		const data: DataSource = {
			listSessions: async (scope) => (scope === "all" ? [row(1, "/a"), row(2, "/b"), row(3, "/c")] : [row(1, "/a"), row(2, "/b")]),
			loadTree: async () => [],
			loadContent: async () => [],
		};
		return new LazyPanel({
			theme: fakeTheme,
			data,
			getHeight: () => 20,
			requestRender: () => {},
			onClose: () => {},
			...(currentSessionFile ? { currentSessionFile } : {}),
		});
	};

	// 当前会话是第二行：打开时光标就在第二行
	const panel = make("/tmp/s2.jsonl");
	await panel.load();
	assert.equal(panel.state.cursor.sessions, 1);
	// 之后 A 切范围重新加载时不再定位，光标照旧回到顶部
	panel.handleInput("A");
	await flush();
	await flush();
	assert.equal(panel.state.scope, "all");
	assert.equal(panel.state.cursor.sessions, 0);

	// 新会话（还没有文件，或者文件没列出来）：光标留在第一行
	assert.equal((await loaded(make())).state.cursor.sessions, 0);
	assert.equal((await loaded(make("/tmp/new.jsonl"))).state.cursor.sessions, 0);
});

async function loaded(panel: LazyPanel): Promise<LazyPanel> {
	await panel.load();
	return panel;
}
