import assert from "node:assert/strict";
import { basename, resolve } from "node:path";
import { test, type TestContext } from "node:test";
import type { Theme } from "@earendil-works/pi-coding-agent";
import { stripTerminalSequences, visibleWidth } from "@earendil-works/pi-tui";
import { mergeKeymap } from "../src/config/config.ts";
import { DEFAULT_KEYMAP } from "../src/config/keymap.ts";
import { filterSessions, sortSessions } from "../src/data/sessions.ts";
import { initI18n, t as translate } from "../src/i18n/index.ts";
import type { Keymap, SessionFileChange, SessionFileState, SessionRow } from "../src/types.ts";
import { LazyPanel } from "../src/ui/app.ts";
import type { ActionSource, DataSource } from "../src/ui/ports.ts";
import { buildHelpLines } from "../src/ui/widgets/help-overlay.ts";

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

function row(name: string, cwd = "project"): SessionRow {
	return { file: resolve("fixtures", `${name}.jsonl`), id: name, name, cwd, preview: name, createdAt: 0, updatedAt: 0, messageCount: 1 };
}

/** Independent in-memory store; production persistence has its own filesystem tests. */
function changeFiles(prev: SessionFileState, change: SessionFileChange): SessionFileState {
	const files = [...change.files];
	const drop = (values: string[]) => values.filter((file) => !files.includes(file));
	switch (change.type) {
		case "archive": return { pinned: drop(prev.pinned), archived: [...new Set([...prev.archived, ...files])] };
		case "unarchive": return { pinned: prev.pinned, archived: drop(prev.archived) };
		case "pin": return { pinned: [...files.filter((file) => !prev.pinned.includes(file)), ...prev.pinned], archived: prev.archived };
		case "unpin": return { pinned: drop(prev.pinned), archived: prev.archived };
		case "delete": return { pinned: drop(prev.pinned), archived: drop(prev.archived) };
	}
}

interface Options {
	rows?: SessionRow[];
	store?: { value: SessionFileState };
	current?: string;
	keymap?: Keymap;
	actions?: Partial<ActionSource>;
	data?: Partial<DataSource>;
}

function harness(t: TestContext, opts: Options = {}) {
	const rows = opts.rows ?? [row("alpha"), row("beta"), row("gamma")];
	const store = opts.store ?? { value: { pinned: [], archived: [] } };
	const changes: SessionFileChange[] = [];
	const entered: string[] = [];
	const copied: string[] = [];
	const deletes: string[] = [];
	let shown: SessionRow[] = [];
	let closed = false;
	const data: DataSource = {
		loadSessionState: async () => structuredClone(store.value),
		listSessions: async (scope, sort, pinned, filter) => {
			const scoped = scope === "all" ? rows : rows.filter((r) => r.cwd === "project");
			shown = sortSessions(filterSessions(scoped, filter), sort, pinned);
			return shown;
		},
		loadTree: async (file) => [{ entryId: file, kind: "message", role: "user", text: `body ${basename(file)}`, timestamp: 0, onActiveBranch: true, isLeaf: true }],
		loadContent: async (file) => [{ entryId: file, role: "user", timestamp: 0, markdown: `body ${basename(file)}` }],
		...opts.data,
	};
	const actions: ActionSource = {
		copyNodeText: async (file) => {
			copied.push(file);
			return true;
		},
		setNodeLabel: async () => {},
		resumeSession: async (file) => {
			entered.push(file);
			return "switched";
		},
		restoreNode: async (file) => {
			entered.push(file);
			return "restored";
		},
		updateSessionState: async (change) => {
			changes.push(change);
			store.value = changeFiles(store.value, change);
			return structuredClone(store.value);
		},
		deleteSession: async (file) => {
			deletes.push(file);
			const index = rows.findIndex((r) => r.file === file);
			if (index >= 0) rows.splice(index, 1);
			return "trash";
		},
		...opts.actions,
	};
	const panel = new LazyPanel({
		theme, data, actions,
		getHeight: () => 30,
		requestRender: () => {},
		onClose: () => { closed = true; },
		...(opts.current ? { currentSessionFile: opts.current } : {}),
		...(opts.keymap ? { keymap: opts.keymap } : {}),
	});
	t.after(() => panel.dispose());
	return {
		panel, rows, store, changes, entered, copied, deletes,
		closed: () => closed,
		shown: () => shown,
		cursorFile: () => shown[panel.state.cursor.sessions]?.file,
		text: (width = 180) => panel.render(width).map(stripTerminalSequences).join("\n"),
		footer: () => stripTerminalSequences(panel.render(180).at(-1)!),
		press: async (key: string) => {
			panel.handleInput(key);
			await flush();
		},
	};
}

function flush(): Promise<void> {
	return new Promise((done) => setTimeout(done, 0));
}

function search(panel: LazyPanel, text: string): void {
	panel.handleInput("/");
	panel.handleInput(text);
	panel.handleInput("\r");
}

test("x archives atomically with unpin, follows the next row, and X/x brings it back without its pin", async (t) => {
	const alpha = row("alpha").file;
	const h = harness(t, { store: { value: { pinned: [alpha], archived: [] } } });
	await h.panel.load();
	assert.match(h.text(), /PINNED/);
	await h.press("x");
	assert.equal(h.rows.length, 3, "no session file is removed");
	assert.deepEqual(h.store.value, { pinned: [], archived: [alpha] });
	assert.deepEqual(h.changes, [{ type: "archive", files: [alpha] }]);
	assert.equal(h.panel.state.mode, "normal", "no confirmation dialog");
	assert.equal(h.cursorFile(), row("beta").file);
	assert.match(h.text(), /body beta/);
	assert.doesNotMatch(h.text(), /body alpha/);
	assert.match(h.footer(), /session archived.*X view archive/);
	await h.press("X");
	assert.equal(h.panel.state.sessionView, "archived");
	assert.deepEqual(h.shown().map((r) => r.file), [alpha]);
	assert.match(h.text(), /\[1\] ARCHIVED/);
	assert.doesNotMatch(h.text(), /PINNED/);
	assert.match(h.footer(), /X Back to sessions.*x Unarchive/);
	await h.press("x");
	assert.deepEqual(h.store.value, { pinned: [], archived: [] });
	assert.equal(h.panel.state.contentHighlight, undefined);
	assert.match(h.text(), /No sessions/);
	assert.doesNotMatch(h.text(), /body alpha/);
	await h.press("X");
	assert.equal(h.shown().length, 3);
	assert.equal(h.cursorFile(), row("beta").file, "return to the ordinary view's remembered session");
});

test("archive visibility and C/A scope are independent; switching either clears selection", async (t) => {
	const rows = [row("a"), row("b"), row("c", "other"), row("d", "other")];
	const h = harness(t, { rows, store: { value: { pinned: [], archived: [rows[1]!.file, rows[3]!.file] } } });
	await h.panel.load();
	assert.deepEqual(h.shown().map((r) => r.id), ["a"]);
	await h.press(" ");
	await h.press("X");
	assert.equal(h.panel.state.selectedSessionFiles.size, 0);
	assert.deepEqual(h.shown().map((r) => r.id), ["b"]);
	await h.press(" ");
	await h.press("A");
	assert.equal(h.panel.state.selectedSessionFiles.size, 0);
	assert.equal(h.panel.state.sessionView, "archived");
	assert.deepEqual(h.shown().map((r) => r.id), ["b", "d"]);
	await h.press("X");
	assert.deepEqual(h.shown().map((r) => r.id), ["a", "c"]);
	await h.press("C");
	assert.deepEqual(h.shown().map((r) => r.id), ["a"]);
});

test("the current session can be archived; reopening warns, and Enter or TREE resume does not unarchive", async (t) => {
	const alpha = row("alpha").file;
	const h = harness(t, { current: alpha });
	await h.panel.load();
	await h.press("x");
	assert.equal(h.closed(), false);
	const reopened = harness(t, { store: h.store, current: alpha });
	await reopened.panel.load();
	assert.equal(reopened.panel.state.sessionView, "normal");
	assert.equal(reopened.cursorFile(), row("beta").file);
	assert.match(reopened.footer(), /current session is archived.*X view archive/);
	await reopened.press("X");
	await reopened.press("\r");
	assert.deepEqual(reopened.entered, [alpha]);
	assert.deepEqual(h.store.value.archived, [alpha]);
	assert.equal(reopened.closed(), true);

	const tree = harness(t, { store: h.store, current: alpha });
	await tree.panel.load();
	await tree.press("X");
	await tree.press("2");
	await tree.press("y");
	assert.deepEqual(tree.copied, [alpha]);
	await tree.press("\r");
	assert.deepEqual(tree.entered, [alpha]);
	assert.deepEqual(h.store.value.archived, [alpha]);
});

test("p refuses archived rows and d still confirms; successful deletion clears archive metadata", async (t) => {
	const alpha = row("alpha").file;
	const h = harness(t, { store: { value: { pinned: [], archived: [alpha] } } });
	await h.panel.load();
	await h.press("X");
	await h.press("p");
	assert.match(h.footer(), /unarchive.*before pinning/);
	assert.deepEqual(h.changes, []);
	await h.press("d");
	assert.equal(h.panel.state.mode, "confirm");
	await h.press("\r");
	assert.deepEqual(h.deletes, [], "default No leaves archived file alone");
	await h.press("d");
	await h.press("y");
	assert.deepEqual(h.deletes, [alpha]);
	assert.deepEqual(h.store.value.archived, []);
	assert.equal(h.shown().length, 0);
});

test("batch archive follows the nearest surviving neighbour, clears selection and empties TREE/CONTENT when done", async (t) => {
	const h = harness(t, { rows: [row("a"), row("b"), row("c"), row("d"), row("e")] });
	await h.panel.load();
	for (const name of ["a", "c"]) h.panel.state.selectedSessionFiles.add(row(name).file);
	h.panel.state.cursor.sessions = 2;
	await h.press("x");
	assert.deepEqual(h.changes[0]?.files, [row("a").file, row("c").file]);
	assert.equal(h.cursorFile(), row("d").file, "not e after the row before the cursor disappeared");
	assert.equal(h.panel.state.selectedSessionFiles.size, 0);
	for (const r of h.shown()) h.panel.state.selectedSessionFiles.add(r.file);
	await h.press("x");
	assert.equal(h.shown().length, 0);
	assert.equal(h.panel.state.contentHighlight, undefined);
	assert.match(h.text(), /No sessions/);
	assert.doesNotMatch(h.text().split("\n").slice(0, -1).join("\n"), /X view archive/);
	assert.doesNotMatch(h.text(), /body /);
	await h.press("X");
	for (const r of h.shown()) h.panel.state.selectedSessionFiles.add(r.file);
	await h.press("x");
	assert.deepEqual(h.store.value.archived, []);
	assert.equal(h.shown().length, 0);
});

test("each view remembers its query, file identity and wheel offset; matches are recalculated", async (t) => {
	const rows = Array.from({ length: 20 }, (_, i) => row(`s${String(i).padStart(2, "0")}`));
	const h = harness(t, { rows, store: { value: { pinned: [], archived: rows.slice(10).map((r) => r.file) } } });
	await h.panel.load();
	search(h.panel, "s07");
	h.panel.state.listScroll.sessions = 3;
	const normalFile = h.cursorFile();
	await h.press("X");
	assert.equal(Boolean(h.panel.state.search.sessions), false);
	search(h.panel, "s15");
	h.panel.state.listScroll.sessions = 7;
	const archivedFile = h.cursorFile();
	h.rows.shift(); // External deletion changes numeric row positions.
	await h.press("X");
	assert.equal(h.cursorFile(), normalFile);
	assert.equal(h.panel.state.search.sessions?.query, "s07");
	assert.deepEqual(h.panel.state.search.sessions?.matches, [6]);
	assert.equal(h.panel.state.listScroll.sessions, 3);
	await h.press("X");
	assert.equal(h.cursorFile(), archivedFile);
	assert.equal(h.panel.state.search.sessions?.query, "s15");
	assert.deepEqual(h.panel.state.search.sessions?.matches, [5]);
	assert.equal(h.panel.state.listScroll.sessions, 7);
});

test("Esc clears pending keys, then search, selection, archive view, and finally closes; q closes directly", async (t) => {
	const h = harness(t, { store: { value: { pinned: [], archived: [row("alpha").file] } } });
	await h.panel.load();
	await h.press("X");
	search(h.panel, "alpha");
	await h.press(" ");
	await h.press("g");
	await h.press("\x1b");
	assert.ok(h.panel.state.search.sessions);
	await h.press("\x1b");
	assert.equal(Boolean(h.panel.state.search.sessions), false);
	assert.equal(h.panel.state.selectedSessionFiles.size, 1);
	await h.press("\x1b");
	assert.equal(h.panel.state.selectedSessionFiles.size, 0);
	assert.equal(h.panel.state.sessionView, "archived");
	await h.press("\x1b");
	assert.equal(h.panel.state.sessionView, "normal");
	assert.equal(h.closed(), false);
	await h.press("\x1b");
	assert.equal(h.closed(), true);
	const other = harness(t);
	await other.panel.load();
	await other.press("X");
	await other.press("q");
	assert.equal(other.closed(), true);
});

test("failed or pending saves preserve rows and pins, block repeated x and mouse input, and do not leak rejections", async (t) => {
	let reject!: (error: Error) => void;
	let calls = 0;
	const waiting = new Promise<SessionFileState>((_resolve, no) => {
		reject = no;
	});
	const alpha = row("alpha").file;
	const h = harness(t, {
		store: { value: { pinned: [alpha], archived: [] } },
		actions: { updateSessionState: async () => {
			calls++;
			return waiting;
		} },
	});
	await h.panel.load();
	h.panel.render(180);
	h.panel.handleInput("x");
	h.panel.handleInput("x");
	h.panel.handleInput("X");
	h.panel.handleInput("j");
	h.panel.handleMouse({ type: "wheel", x: 2, y: 2, screenX: 2, screenY: 2, width: 180, height: 30, wheelDelta: 3, button: "none", shift: false, alt: false, ctrl: false });
	assert.equal(calls, 1);
	assert.equal(h.panel.state.sessionView, "normal");
	assert.equal(h.cursorFile(), alpha);
	assert.deepEqual(h.panel.state.pinnedFiles, [alpha]);
	assert.equal(h.panel.state.listScroll.sessions, null);
	reject(new Error("disk full"));
	await flush();
	assert.match(h.footer(), /archive failed: disk full/);
	assert.equal(h.panel.state.sessionStateBusy, false);
	assert.equal(h.shown().length, 3);
	assert.equal(h.panel.state.archivedFiles.size, 0);
});

test("view-load failure leaves the previous view, query, rows and selection intact", async (t) => {
	let fail = false;
	const h = harness(t, { data: { loadSessionState: async () => {
		if (fail) throw new Error("corrupt metadata");
		return { pinned: [], archived: [] };
	} } });
	await h.panel.load();
	search(h.panel, "beta");
	await h.press(" ");
	fail = true;
	await h.press("X");
	assert.equal(h.panel.state.sessionView, "normal");
	assert.equal(h.cursorFile(), row("beta").file);
	assert.equal(h.panel.state.search.sessions?.query, "beta");
	assert.equal(h.panel.state.selectedSessionFiles.size, 1);
	assert.match(h.footer(), /corrupt metadata/);
	assert.equal(h.panel.state.sessionStateBusy, false);
});

test("other windows' organization changes are seen on relist without losing unrelated pins", async (t) => {
	const h = harness(t);
	await h.panel.load();
	h.store.value = { archived: [row("beta").file], pinned: [row("gamma").file] };
	await h.press("x");
	assert.deepEqual(h.store.value.archived, [row("beta").file, row("alpha").file]);
	assert.deepEqual(h.panel.state.pinnedFiles, [row("gamma").file]);
	assert.deepEqual(h.shown().map((r) => r.id), ["gamma"]);
	await h.press("X");
	assert.deepEqual(h.shown().map((r) => r.id), ["alpha", "beta"]);
});

test("new copies do not inherit archive membership, and archived parents do not hide separately forked files", async (t) => {
	const parent = row("parent");
	const child = { ...row("child"), parentFile: parent.file };
	const h = harness(t, { rows: [parent, child], store: { value: { pinned: [], archived: [parent.file] } } });
	h.panel.state.sort = "threaded";
	await h.panel.load();
	assert.deepEqual(h.shown().map((r) => [r.id, r.threadDepth]), [["child", 0]]);
	h.rows.push({ ...parent, file: row("clone").file });
	await h.panel.load();
	assert.equal(h.shown().length, 2, "identity is the file, not a reused imported session UUID");
	await h.press("X");
	assert.deepEqual(h.shown().map((r) => [r.id, r.threadDepth]), [["parent", 0]]);
});

test("archive actions use custom multi-key bindings and help execution, and cannot execute in other panes", async (t) => {
	const warnings: string[] = [];
	const keymap = mergeKeymap(DEFAULT_KEYMAP, { sessions: { "session-archive": "zx", "session-archive-view": "zX" } }, warnings);
	const h = harness(t, { keymap });
	await h.panel.load();
	await h.press("x");
	await h.press("X");
	assert.equal(h.changes.length, 0);
	await h.press("z");
	await h.press("x");
	assert.equal(h.changes.length, 1);
	assert.match(h.footer(), /zX view archive/);
	await h.press("?");
	const lines = buildHelpLines(keymap, "sessions").filter((line) => line.kind === "binding");
	const target = lines.findIndex((line) => line.action === "session-archive-view");
	assert.ok(target >= 0);
	for (let i = 0; i < target; i++) h.panel.handleInput("j");
	await h.press("\r");
	assert.equal(h.panel.state.sessionView, "archived");
	assert.equal(h.panel.state.helpOpen, false);
	await h.press("2");
	h.panel.dispatch("session-archive");
	h.panel.dispatch("session-archive-view");
	assert.equal(h.panel.state.sessionView, "archived");
	assert.equal(h.changes.length, 1);
});

test("empty session views are concise and localized, with distinguishable titles at narrow widths", async (t) => {
	const h = harness(t, { rows: [] });
	await h.panel.load();
	await h.press("X");
	for (const locale of ["en", "zh"] as const) {
		initI18n(locale);
		for (const width of [60, 80, 160]) {
			const lines = h.panel.render(width);
			assert.ok(lines.every((line) => visibleWidth(line) === width));
			assert.ok(stripTerminalSequences(lines[0]!).includes(translate("pane.archivedSessionsTitle")));
		}
		assert.ok(h.text().includes(translate("pane.sessionsEmpty")));
		await h.press("X");
		const normal = h.text().split("\n").slice(0, -1).join("\n");
		assert.ok(normal.includes(translate("pane.sessionsEmpty")));
		assert.doesNotMatch(normal, /view archive|查看归档|未归档/);
		await h.press("X");
	}
	initI18n("en");
});

test("successful save with an unlock warning publishes the committed state instead of pretending to roll back", async (t) => {
	const store = { value: { pinned: [row("alpha").file], archived: [] } as SessionFileState };
	const h = harness(t, { store, actions: { updateSessionState: async (change) => {
		store.value = changeFiles(store.value, change);
		return { ...store.value, warning: "unlock failed" };
	} } });
	await h.panel.load();
	await h.press("x");
	assert.equal(h.shown().length, 2);
	assert.deepEqual(h.panel.state.pinnedFiles, []);
	assert.deepEqual([...h.panel.state.archivedFiles], [row("alpha").file]);
	assert.match(h.footer(), /state saved.*unlock failed/);
	assert.doesNotMatch(h.footer(), /archive failed/);
});

test("metadata cleanup failure after deletion is reported without claiming the file survived", async (t) => {
	const alpha = row("alpha").file;
	const h = harness(t, {
		store: { value: { pinned: [], archived: [alpha] } },
		actions: { updateSessionState: async () => { throw new Error("disk full"); } },
	});
	await h.panel.load();
	await h.press("X");
	await h.press("d");
	await h.press("y");
	assert.deepEqual(h.deletes, [alpha]);
	assert.equal(h.shown().length, 0);
	assert.match(h.footer(), /moved to trash.*metadata cleanup failed: disk full/);
});

test("an old list response cannot overwrite a newer archive view", async (t) => {
	let finish!: (rows: SessionRow[]) => void;
	let call = 0;
	const pending = new Promise<SessionRow[]>((done) => {
		finish = done;
	});
	const h = harness(t, { data: { listSessions: async () => {
		call++;
		return call === 1 ? pending : [];
	} } });
	const loading = h.panel.load();
	await flush();
	await h.press("X");
	assert.equal(h.panel.state.sessionView, "archived");
	finish([row("alpha")]);
	await loading;
	assert.match(h.text(), /No sessions/);
	assert.doesNotMatch(h.text(), /body alpha/);
});

test("completion after the panel is disposed does not change its UI snapshot", async (t) => {
	let finish!: (state: SessionFileState) => void;
	const pending = new Promise<SessionFileState>((done) => {
		finish = done;
	});
	const h = harness(t, { actions: { updateSessionState: async () => pending } });
	await h.panel.load();
	h.panel.handleInput("x");
	h.panel.dispose();
	finish({ pinned: [], archived: [row("alpha").file] });
	await flush();
	assert.equal(h.panel.state.archivedFiles.size, 0);
	assert.equal(h.shown().length, 3);
});

test("ordinary search cannot hit an archived row, and archived search does not include ordinary rows", async (t) => {
	const h = harness(t, { store: { value: { pinned: [], archived: [row("alpha").file] } } });
	await h.panel.load();
	search(h.panel, "alpha");
	assert.equal(h.panel.state.search.sessions?.matches.length, 0);
	await h.press("X");
	search(h.panel, "beta");
	assert.equal(h.panel.state.search.sessions?.matches.length, 0);
	await h.press("\x1b");
	search(h.panel, "alpha");
	assert.deepEqual(h.panel.state.search.sessions?.matches, [0]);
});

test("failed scope loading preserves the previous scope and cursor in the archive view", async (t) => {
	let fail = false;
	const h = harness(t, { data: { loadSessionState: async () => {
		if (fail) throw new Error("unreadable state");
		return { pinned: [], archived: [row("alpha").file, row("beta").file] };
	} } });
	await h.panel.load();
	await h.press("X");
	await h.press("j");
	await h.press(" ");
	fail = true;
	await h.press("A");
	assert.equal(h.panel.state.scope, "current-folder");
	assert.equal(h.panel.state.sessionView, "archived");
	assert.equal(h.cursorFile(), row("beta").file);
	assert.equal(h.panel.state.selectedSessionFiles.size, 1);
	assert.match(h.footer(), /unreadable state/);
});

test("a late failure opening the old session cannot erase the new archive view's content", async (t) => {
	let reject!: (error: Error) => void;
	const pending = new Promise<never>((_resolve, no) => {
		reject = no;
	});
	const beta = row("beta").file;
	const h = harness(t, {
		store: { value: { pinned: [], archived: [beta] } },
		data: { loadTree: async (file) => {
			if (file === row("alpha").file) return pending;
			return [{ entryId: file, kind: "message", role: "user", text: `body ${basename(file)}`, timestamp: 0, onActiveBranch: true, isLeaf: true }];
		} },
	});
	const loading = h.panel.load();
	await flush();
	await h.press("X");
	assert.match(h.text(), /body beta/);
	reject(new Error("old file vanished"));
	await loading;
	assert.match(h.text(), /body beta/);
	assert.equal(h.panel.state.contentHighlight, beta);
	assert.doesNotMatch(h.footer(), /old file vanished/);
});
