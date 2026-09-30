import assert from "node:assert/strict";
import { test } from "node:test";
import type { Theme } from "@earendil-works/pi-coding-agent";
import { stripTerminalSequences, visibleWidth } from "@earendil-works/pi-tui";
import { mergeKeymap } from "../src/config/config.ts";
import { DEFAULT_KEYMAP } from "../src/config/keymap.ts";
import { applyTreeFilter } from "../src/data/tree.ts";
import { initI18n, t } from "../src/i18n/index.ts";
import type { Keymap, SessionRow, TreeFilter, TreeRow } from "../src/types.ts";
import { LazyPanel } from "../src/ui/app.ts";
import type { DataSource } from "../src/ui/ports.ts";
import { SelectDialog } from "../src/ui/widgets/select-dialog.ts";
import { treeFilterDialogSpec } from "../src/ui/widgets/tree-filter-dialog.ts";

initI18n("en");

const theme = {
	fg: (_color: string, text: string) => text,
	bg: (_color: string, text: string) => text,
	bold: (text: string) => text,
	italic: (text: string) => text,
	underline: (text: string) => text,
	inverse: (text: string) => text,
	strikethrough: (text: string) => text,
} as unknown as Theme;

const rows: TreeRow[] = [
	{ entryId: "e0", kind: "message", role: "user", text: "first question", timestamp: 0, onActiveBranch: true },
	{ entryId: "e1", parentId: "e0", kind: "message", role: "assistant", text: "first answer", label: "milestone", timestamp: 0, onActiveBranch: true },
	{ entryId: "e2", parentId: "e1", kind: "tool", role: "tool", text: "tool output", timestamp: 0, onActiveBranch: true },
	{ entryId: "e3", parentId: "e2", kind: "meta", role: "system", text: "model change", timestamp: 0, onActiveBranch: true },
	{ entryId: "e4", parentId: "e3", kind: "message", role: "user", text: "last question", timestamp: 0, onActiveBranch: true },
	{ entryId: "e5", parentId: "e4", kind: "message", role: "assistant", text: "last answer", timestamp: 0, onActiveBranch: true },
];

function session(id: string): SessionRow {
	return { file: id, id, cwd: ".", preview: id, createdAt: 0, updatedAt: 0, messageCount: 6 };
}

function harness(opts: { loadTree?: DataSource["loadTree"]; initialFilter?: TreeFilter; keymap?: Keymap; sessions?: SessionRow[] } = {}) {
	const filters: TreeFilter[] = [];
	const panel = new LazyPanel({
		theme,
		data: {
			listSessions: async () => opts.sessions ?? [session("one"), session("two")],
			loadTree: async (file, filter) => {
				filters.push(filter);
				return opts.loadTree ? opts.loadTree(file, filter) : applyTreeFilter(rows, filter);
			},
			loadContent: async () => rows.flatMap((row) => row.role === "user" || row.role === "assistant"
				? [{ entryId: row.entryId, role: row.role, timestamp: 0, markdown: row.text }]
				: []),
		},
		getHeight: () => 40,
		requestRender: () => {},
		onClose: () => {},
		initialState: { treeFilter: opts.initialFilter ?? "default" },
		...(opts.keymap ? { keymap: opts.keymap } : {}),
	});
	return { panel, filters, text: () => panel.render(140).map(stripTerminalSequences).join("\n") };
}

function flush(): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, 0));
}

function choose(panel: LazyPanel, key: string): void {
	panel.handleInput("f");
	assert.equal(panel.state.mode, "tree-filter");
	panel.handleInput(key);
}

test("filter picker has exactly five rows, selects the current mode and supports all direct shortcuts", () => {
	const filters: TreeFilter[] = ["default", "no-tools", "user-only", "labeled", "all"];
	for (const locale of ["en", "zh"] as const) {
		initI18n(locale);
		for (const [i, filter] of filters.entries()) {
			let selected: TreeFilter | undefined;
			const spec = treeFilterDialogSpec(filter, (value) => {
				selected = value;
			}, () => {});
			assert.equal(spec.items.length, 5);
			assert.equal(spec.initialIndex, i);
			assert.equal(spec.title, t("dialog.treeFilterTitle"));
			const menu = new SelectDialog({ theme, onChange: () => {} });
			menu.open(spec);
			const lines = menu.render(64);
			assert.equal(lines.length, 7, "five choices plus two borders");
			assert.ok(lines.every((line) => visibleWidth(line) === 64));
			assert.ok(lines[i + 1]?.includes("›"));
			menu.handleInput("dtula"[i]!);
			assert.equal(selected, filter);
		}
	}
	initI18n("en");
});

test("f menu supports navigation, cancellation, same-filter no-op, and keeps a and h/l outside the menu", async () => {
	const h = harness({ initialFilter: "user-only" });
	await h.panel.load();
	h.panel.handleInput("f");
	assert.equal(h.panel.state.mode, "normal", "f is not a sessions shortcut");
	h.panel.handleInput("2");
	const cursor = h.panel.state.cursor.tree;
	h.panel.handleInput("f");
	assert.ok(h.text().includes("› u  User messages only"));
	assert.ok(h.text().includes("Esc cancel"));
	h.panel.handleInput("1");
	assert.equal(h.panel.state.focus, "tree", "menu input cannot switch underlying panes");
	h.panel.handleInput("j");
	h.panel.handleInput("\x1b[A");
	h.panel.handleInput("\x1b");
	assert.equal(h.panel.state.mode, "normal");
	assert.equal(h.panel.state.treeFilter, "user-only");
	assert.equal(h.panel.state.cursor.tree, cursor);
	assert.equal(h.filters.length, 1, "Esc never reloads");
	choose(h.panel, "\r");
	await flush();
	assert.equal(h.filters.length, 1, "confirming the current mode never toggles it");
	h.panel.handleInput("f");
	h.panel.handleInput("\x1b[B");
	h.panel.handleInput("\r");
	await flush();
	assert.equal(h.panel.state.treeFilter, "labeled");
	h.panel.handleInput("l");
	assert.equal(h.panel.state.focus, "content");
	h.panel.handleInput("h");
	h.panel.handleInput("a");
	assert.equal(h.panel.state.mode, "tree");
	h.panel.handleInput("f");
	assert.equal(h.panel.state.mode, "tree", "the large dialog keeps its direct filter keys");
	h.panel.dispose();
});

test("pane and full tree dialog share filters in both directions and preserve cursor/content", async () => {
	const h = harness();
	await h.panel.load();
	h.panel.handleInput("2");
	// Leave a stale dialog cursor behind, then move the pane cursor elsewhere.
	h.panel.handleInput("a");
	h.panel.handleInput("g");
	h.panel.handleInput("g");
	h.panel.handleInput("q");
	h.panel.handleInput("G");
	choose(h.panel, "t");
	await flush();
	assert.equal(h.panel.state.contentHighlight, "e5", "use the pane cursor, not the closed dialog's cursor");
	h.panel.state.listScroll.tree = 2;
	choose(h.panel, "u");
	await flush();
	assert.equal(h.panel.state.cursor.tree, 1);
	assert.equal(h.panel.state.contentHighlight, "e4", "hidden assistant falls back to the nearest visible ancestor");
	assert.equal(h.panel.state.listScroll.tree, null);
	assert.ok(h.text().split("\n").some((line) => line.includes("[2] TREE") && line.includes("user-only")));
	h.panel.handleInput("a");
	assert.equal(h.panel.state.treeFilter, "user-only");
	assert.ok(h.text().includes("2/2 · user-only"));
	h.panel.handleInput("l");
	await flush();
	assert.equal(h.panel.state.treeFilter, "labeled");
	h.panel.handleInput("q");
	await flush();
	assert.equal(h.panel.state.contentHighlight, "e1");
	assert.ok(h.text().split("\n").some((line) => line.includes("[2] TREE") && line.includes("labeled")));
	h.panel.handleInput("f");
	assert.ok(h.text().includes("› l  Labeled entries only"));
	h.panel.handleInput("a");
	await flush();
	assert.equal(h.panel.state.mode, "normal", "a selects all inside the menu rather than opening the tree dialog");
	assert.equal(h.panel.state.treeFilter, "all");
	choose(h.panel, "d");
	await flush();
	assert.equal(h.panel.state.treeFilter, "default");
	h.panel.dispose();
});

test("filter changes retain pane search, clear folds, handle empty results and allow recovery", async () => {
	const h = harness({ loadTree: async (_file, filter) => filter === "labeled" ? [] : applyTreeFilter(rows, filter) });
	await h.panel.load();
	h.panel.handleInput("2");
	h.panel.handleInput("/");
	h.panel.handleInput("question");
	h.panel.handleInput("\r");
	h.panel.state.treeFolded.add("e4");
	choose(h.panel, "u");
	await flush();
	assert.equal(h.panel.state.treeFolded.size, 0);
	assert.ok(h.text().includes("1/2 matches"), h.text());
	choose(h.panel, "l");
	await flush();
	assert.equal(h.panel.state.contentHighlight, undefined);
	assert.equal(h.panel.state.cursor.tree, 0);
	assert.ok(h.text().includes(t("pane.nothingToShow")), h.text());
	assert.ok(h.text().includes("no matches"));
	choose(h.panel, "a");
	await flush();
	assert.equal(h.panel.state.treeFilter, "all");
	assert.ok(h.text().includes("matches"), "the pane query is retained and recomputed");
	h.panel.dispose();
});

test("f is configurable, appears in help/footer, and reports a missing session without opening a menu", async () => {
	const h = harness({ keymap: mergeKeymap(DEFAULT_KEYMAP, { tree: { "tree-filter-menu": "F2" } }) });
	await h.panel.load();
	h.panel.handleInput("2");
	assert.ok(h.text().includes("F2 Filter"));
	h.panel.handleInput("?");
	assert.ok(h.text().includes("Choose a tree filter"));
	h.panel.handleInput("\x1b");
	h.panel.handleInput("f");
	assert.equal(h.panel.state.mode, "normal");
	h.panel.handleInput("\x1bOQ");
	assert.equal(h.panel.state.mode, "tree-filter");
	h.panel.dispose();
	const empty = harness({ sessions: [] });
	await empty.panel.load();
	empty.panel.handleInput("2");
	empty.panel.handleInput("f");
	assert.equal(empty.panel.state.mode, "normal");
	assert.ok(empty.text().includes(t("status.noSessionLoaded")));
	empty.panel.dispose();
});

test("failed filtering leaves the displayed mode, rows, cursor and folds intact and can be retried", async () => {
	let fail = true;
	const h = harness({ loadTree: async (_file, filter) => {
		if (filter === "user-only" && fail) throw new Error("filter read failed");
		return applyTreeFilter(rows, filter);
	} });
	await h.panel.load();
	h.panel.handleInput("2");
	const cursor = h.panel.state.cursor.tree;
	h.panel.state.treeFolded.add("e4");
	choose(h.panel, "u");
	await flush();
	assert.equal(h.panel.state.treeFilter, "default");
	assert.equal(h.panel.state.cursor.tree, cursor);
	assert.equal(h.panel.state.contentHighlight, "e5");
	assert.ok(h.panel.state.treeFolded.has("e4"));
	assert.ok(h.text().includes("filter read failed"));
	fail = false;
	choose(h.panel, "u");
	await flush();
	assert.equal(h.panel.state.treeFilter, "user-only");
	h.panel.dispose();
});

test("slow filter results cannot replace a newer choice, a different session, or a disposed panel", async () => {
	let finish: (rows: TreeRow[]) => void = () => {};
	const h = harness({ loadTree: async (_file, filter) => filter === "user-only"
		? new Promise<TreeRow[]>((resolve) => { finish = resolve; })
		: applyTreeFilter(rows, filter) });
	await h.panel.load();
	h.panel.handleInput("2");
	choose(h.panel, "u");
	choose(h.panel, "a");
	await flush();
	finish(applyTreeFilter(rows, "user-only"));
	await flush();
	assert.equal(h.panel.state.treeFilter, "all");
	assert.equal(h.panel.state.contentHighlight, "e5");
	choose(h.panel, "u");
	choose(h.panel, "a"); // Choosing the already-applied mode cancels a pending change.
	finish(applyTreeFilter(rows, "user-only"));
	await flush();
	assert.equal(h.panel.state.treeFilter, "all");
	choose(h.panel, "u");
	h.panel.state.cursor.sessions = 1;
	await h.panel.loadSelectedSession();
	finish(applyTreeFilter(rows, "user-only"));
	await flush();
	assert.equal(h.panel.state.treeFilter, "all");
	choose(h.panel, "u");
	h.panel.dispose();
	finish(applyTreeFilter(rows, "user-only"));
	await flush();
	assert.equal(h.panel.state.treeFilter, "all");
});
