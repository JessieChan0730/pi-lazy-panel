import assert from "node:assert/strict";
import { basename, resolve } from "node:path";
import { test, type TestContext } from "node:test";
import type { Theme } from "@earendil-works/pi-coding-agent";
import { stripTerminalSequences, visibleWidth } from "@earendil-works/pi-tui";
import { mergeKeymap } from "../../src/config/config.ts";
import { DEFAULT_KEYMAP } from "../../src/config/keymap.ts";
import { filterArchivedSessions, filterSessions, sortSessions } from "../../src/data/sessions.ts";
import { initI18n, t as translate } from "../../src/i18n/index.ts";
import type { Keymap, SessionFileChange, SessionFileState, SessionRow } from "../../src/types.ts";
import { LazyPanel } from "../../src/ui/app.ts";
import type { ActionSource, DataSource } from "../../src/ui/ports.ts";
import { buildHelpLines } from "../../src/ui/widgets/help-overlay.ts";

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
	currentProjectCwd?: string;
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
	let archivedRows: SessionRow[] = [];
	let closed = false;
	const data: DataSource = {
		loadSessionState: async () => structuredClone(store.value),
		listSessions: async (scope, sort, pinned, filter) => {
			const scoped = scope === "all" ? rows : rows.filter((r) => r.cwd === "project");
			shown = sortSessions(filterSessions(scoped, filter), sort, pinned);
			return shown;
		},
		// The real adapter lists every directory, independent of the C/A scope.
		listArchivedSessions: async (archived) => {
			archivedRows = sortSessions(filterArchivedSessions(rows, archived), "recent");
			return archivedRows;
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
		...(opts.currentProjectCwd ? { currentProjectCwd: opts.currentProjectCwd } : {}),
		...(opts.keymap ? { keymap: opts.keymap } : {}),
	});
	t.after(() => panel.dispose());
	return {
		panel, rows, store, changes, entered, copied, deletes,
		closed: () => closed,
		shown: () => shown,
		archivedShown: () => archivedRows,
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

/** Dialog row order, from the rendered lines (the normal list is empty in these tests). */
function rowOrder(text: string, names: readonly string[]): string[] {
	const lines = text.split("\n");
	return [...names].sort((a, b) => {
		const ai = lines.findIndex((line) => line.includes(a));
		const bi = lines.findIndex((line) => line.includes(b));
		return ai - bi;
	});
}

test("x archives atomically; X opens the archive, Enter restores it and keeps the box open", async (t) => {
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
	assert.doesNotMatch(h.text(), /body alpha/);
	assert.match(h.footer(), /session archived.*X open archive/);

	await h.press("X");
	assert.equal(h.panel.state.mode, "archive");
	assert.deepEqual(h.archivedShown().map((r) => r.id), ["alpha"]);
	assert.match(h.text(), /ARCHIVE/);
	assert.match(h.footer(), /Enter restore.*D delete all/);
	assert.doesNotMatch(h.footer(), /Esc\/q\/X/, "X is not offered as a close key");

	await h.press("\r");
	assert.equal(h.panel.state.mode, "archive", "restoring leaves the dialog open");
	assert.deepEqual(h.changes.at(-1), { type: "unarchive", files: [alpha] });
	assert.deepEqual(h.store.value.archived, []);
	assert.deepEqual(h.archivedShown(), []);
	assert.match(h.text(), /0\/0/);
	assert.ok(h.shown().some((r) => r.id === "alpha"), "restored row is back in SESSIONS");
	assert.match(h.footer(), /session unarchived/);
});

test("X works from any pane and opens on the current project; p reaches every directory", async (t) => {
	const alpha = row("alpha");
	const other = row("other", "/tmp/opencode/other");
	const rows = [alpha, row("beta"), row("gamma"), other];
	const h = harness(t, { rows, store: { value: { pinned: [], archived: [alpha.file, other.file] } }, currentProjectCwd: "/tmp/opencode/project" });
	await h.panel.load();
	assert.deepEqual(h.shown().map((r) => r.id), ["beta", "gamma"], "current-folder scope hides the other directory");
	await h.press("2");
	await h.press("X");
	assert.equal(h.panel.state.mode, "archive");
	assert.equal(h.panel.state.focus, "tree");
	assert.deepEqual(h.archivedShown().map((r) => r.id).sort(), ["alpha", "other"], "the adapter still loads every directory");
	assert.match(h.text(), /Current project/);
	assert.doesNotMatch(h.text(), /tmp\/opencode\/other/, "the box opens scoped to the current project");
	await h.press("p");
	await h.press("j");
	await h.press("\r");
	assert.match(h.text(), /All projects/);
	assert.match(h.text(), /tmp\/opencode\/other/);
	await h.press("X");
	assert.equal(h.panel.state.mode, "archive", "X no longer closes the box");
	await h.press("\x1b");
	assert.equal(h.panel.state.mode, "normal");
	assert.equal(h.panel.state.focus, "tree");
});

test("archive search filters live; Enter leaves the search row, the next Enter restores", async (t) => {
	const archived = [row("alpha").file, row("beta").file, row("gamma").file];
	const h = harness(t, { store: { value: { pinned: [], archived } } });
	await h.panel.load();
	await h.press("X");
	await h.press("/");
	h.panel.handleInput("bet");
	await flush();
	assert.match(h.text(), /beta/);
	assert.doesNotMatch(h.text(), /alpha/);
	await h.press("\r");
	assert.deepEqual(h.store.value.archived, archived, "Enter in the search row only leaves the input");
	assert.equal(h.panel.state.mode, "archive");
	await h.press("\r");
	assert.deepEqual(h.store.value.archived, [row("alpha").file, row("gamma").file]);
	assert.match(h.footer(), /session unarchived/);
});

test("s cycles updated / created / title and keeps the cursor on its row", async (t) => {
	const old = { ...row("z-old"), updatedAt: 100, createdAt: 100 };
	const recent = { ...row("a-recent"), updatedAt: 300, createdAt: 50 };
	const created = { ...row("m-created"), updatedAt: 200, createdAt: 400 };
	const h = harness(t, { rows: [old, recent, created], store: { value: { pinned: [], archived: [old.file, recent.file, created.file] } } });
	await h.panel.load();
	await h.press("X");
	assert.deepEqual(rowOrder(h.text(), ["a-recent", "z-old", "m-created"]), ["a-recent", "m-created", "z-old"]);
	await h.press("s");
	assert.match(h.text(), /Created/);
	assert.deepEqual(rowOrder(h.text(), ["a-recent", "z-old", "m-created"]), ["m-created", "z-old", "a-recent"]);
	await h.press("s");
	assert.match(h.text(), /Title/);
	assert.deepEqual(rowOrder(h.text(), ["a-recent", "z-old", "m-created"]), ["a-recent", "m-created", "z-old"]);
	await h.press("s");
	assert.match(h.text(), /Updated/);
});

test("the box opens on the current project; p switches to all / other projects", async (t) => {
	const project = "/tmp/opencode/project";
	const other = "/tmp/opencode/other";
	const h = harness(t, {
		rows: [row("a", project), row("b", other)],
		store: { value: { pinned: [], archived: [row("a", project).file, row("b", other).file] } },
		currentProjectCwd: project,
	});
	await h.panel.load();
	await h.press("X");
	assert.match(h.text(), /Current project/);
	assert.match(h.text(), /\/tmp\/opencode\/project/);
	assert.doesNotMatch(h.text(), /\/tmp\/opencode\/other/, "another project's archive stays hidden by default");
	assert.deepEqual(h.archivedShown().map((r) => r.id), ["a", "b"], "adapter rows are unfiltered; the dialog filters the view");
	await h.press("p");
	assert.equal(h.panel.state.mode, "archive");
	assert.match(h.text(), /Project/);
	assert.match(h.text(), /All projects/);
	assert.match(h.text(), /Current project \(~?\/tmp\/opencode\/project\)/);
	await h.press("j");
	await h.press("\r");
	assert.match(h.text(), /All projects/);
	assert.match(h.text(), /\/tmp\/opencode\/other/);
	await h.press("p");
	await h.press("k");
	await h.press("\r");
	assert.match(h.text(), /Current project/);
	assert.doesNotMatch(h.text(), /\/tmp\/opencode\/other/);
	await h.press("p");
	await h.press("j");
	await h.press("j");
	await h.press("\r");
	assert.match(h.text(), /\/tmp\/opencode\/other/);
	assert.doesNotMatch(h.text(), /\/tmp\/opencode\/project/);
});

test("d refuses the current session; a confirmed archive delete removes the file and its metadata", async (t) => {
	const alpha = row("alpha").file;
	const beta = row("beta").file;
	const h = harness(t, { store: { value: { pinned: [], archived: [alpha, beta] } }, current: alpha });
	await h.panel.load();
	await h.press("X");
	assert.equal(h.panel.state.mode, "archive");
	await h.press("d");
	assert.equal(h.panel.state.mode, "confirm");
	assert.match(h.text(), /Can't delete the active session/);
	assert.deepEqual(h.deletes, []);
	await h.press("\x1b");
	assert.equal(h.panel.state.mode, "archive");
	await h.press("j");
	await h.press("d");
	await h.press("\r");
	assert.deepEqual(h.deletes, [], "default No leaves the archived file alone");
	assert.equal(h.panel.state.mode, "archive");
	await h.press("d");
	await h.press("y");
	assert.deepEqual(h.deletes, [beta]);
	assert.deepEqual(h.store.value.archived, [alpha]);
	assert.deepEqual(h.archivedShown().map((r) => r.id), ["alpha"]);
	assert.match(h.footer(), /moved to trash/);
});

test("D deletes only the rows visible after search and project filtering", async (t) => {
	const archived = [row("alpha").file, row("beta").file, row("gamma").file];
	const h = harness(t, { store: { value: { pinned: [], archived } } });
	await h.panel.load();
	await h.press("X");
	await h.press("/");
	h.panel.handleInput("alpha");
	await h.press("\r");
	await h.press("D");
	assert.equal(h.panel.state.mode, "confirm");
	assert.match(h.text(), /Delete session\?/);
	await h.press("y");
	assert.deepEqual(h.deletes, [row("alpha").file]);
	assert.deepEqual(h.store.value.archived, [row("beta").file, row("gamma").file]);
	assert.match(h.footer(), /session moved to trash/);
});

test("a failed single archive delete reports the error and keeps the row", async (t) => {
	const alpha = row("alpha").file;
	const h = harness(t, {
		store: { value: { pinned: [], archived: [alpha] } },
		actions: {
			deleteSession: async () => {
				throw new Error("permission denied");
			},
		},
	});
	await h.panel.load();
	await h.press("X");
	await h.press("d");
	await h.press("y");
	assert.deepEqual(h.store.value.archived, [alpha]);
	assert.deepEqual(h.archivedShown().map((r) => r.id), ["alpha"]);
	assert.match(h.footer(), /delete failed: .*permission denied/);
});

test("metadata cleanup failure after an archive delete is reported without claiming the file survived", async (t) => {
	const alpha = row("alpha").file;
	const h = harness(t, {
		store: { value: { pinned: [], archived: [alpha] } },
		actions: {
			updateSessionState: async (change) => {
				if (change.type === "delete") throw new Error("disk full");
				return changeFiles(h.store.value, change);
			},
		},
	});
	await h.panel.load();
	await h.press("X");
	await h.press("d");
	await h.press("y");
	assert.deepEqual(h.deletes, [alpha]);
	assert.equal(h.archivedShown().length, 0);
	assert.match(h.footer(), /moved to trash.*metadata cleanup failed: disk full/);
});

test("current-session warning names the new X key and the current session can be restored", async (t) => {
	const alpha = row("alpha").file;
	const h = harness(t, { current: alpha });
	await h.panel.load();
	await h.press("x");
	const reopened = harness(t, { store: h.store, current: alpha, currentProjectCwd: "project" });
	await reopened.panel.load();
	assert.equal(reopened.cursorFile(), row("beta").file);
	assert.match(reopened.footer(), /current session is archived.*X open archive/);
	await reopened.press("X");
	assert.deepEqual(reopened.archivedShown().map((r) => r.id), ["alpha"]);
	await reopened.press("\r");
	assert.deepEqual(h.store.value.archived, []);
	assert.ok(reopened.shown().some((r) => r.id === "alpha"));
});

test("a failed archive load leaves the normal list, mode and selection intact", async (t) => {
	const h = harness(t, { data: { listArchivedSessions: async () => {
		throw new Error("unreadable archive");
	} } });
	await h.panel.load();
	search(h.panel, "beta");
	await h.press(" ");
	await h.press("X");
	assert.equal(h.panel.state.mode, "normal");
	assert.equal(h.panel.state.search.sessions?.query, "beta");
	assert.equal(h.panel.state.selectedSessionFiles.size, 1);
	assert.equal(h.shown().length, 3);
	assert.match(h.footer(), /unreadable archive/);
	assert.equal(h.panel.state.sessionStateBusy, false);
});

test("a pending archive save blocks repeated x / X and preserves rows after failure", async (t) => {
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
	assert.equal(calls, 1);
	assert.equal(h.panel.state.mode, "normal");
	assert.equal(h.cursorFile(), alpha);
	assert.equal(h.panel.state.sessionStateBusy, true);
	reject(new Error("disk full"));
	await flush();
	assert.match(h.footer(), /archive failed: disk full/);
	assert.equal(h.panel.state.sessionStateBusy, false);
	assert.equal(h.shown().length, 3);
	assert.equal(h.panel.state.archivedFiles.size, 0);
});

test("archive-open is a global action: custom bindings, help execution and dispatch all open the box", async (t) => {
	const warnings: string[] = [];
	const keymap = mergeKeymap(DEFAULT_KEYMAP, { global: { "archive-open": "zx" }, sessions: { "session-archive": "ax" } }, warnings);
	assert.deepEqual(warnings, []);
	const h = harness(t, { keymap });
	await h.panel.load();
	await h.press("x");
	assert.equal(h.changes.length, 0);
	await h.press("z");
	await h.press("x");
	assert.equal(h.panel.state.mode, "archive");
	await h.press("q");
	assert.equal(h.panel.state.mode, "normal");
	await h.press("?");
	const lines = buildHelpLines(keymap, "sessions").filter((line) => line.kind === "binding");
	const target = lines.findIndex((line) => line.action === "archive-open");
	assert.ok(target >= 0);
	for (let i = 0; i < target; i++) h.panel.handleInput("j");
	await h.press("\r");
	assert.equal(h.panel.state.mode, "archive");
	assert.equal(h.panel.state.helpOpen, false);
	await h.press("q");
	h.panel.dispatch("archive-open");
	await flush();
	assert.equal(h.panel.state.mode, "archive");
});

test("empty archive boxes render at every width and in both locales", async (t) => {
	const h = harness(t, { rows: [] });
	await h.panel.load();
	await h.press("X");
	for (const locale of ["en", "zh"] as const) {
		initI18n(locale);
		for (const width of [60, 80, 160]) {
			const lines = h.panel.render(width);
			assert.ok(lines.every((line) => visibleWidth(line) === width));
			assert.ok(lines.some((line) => stripTerminalSequences(line).includes(translate("archive.title"))));
		}
		assert.ok(h.text().includes(translate("archive.empty")));
	}
	initI18n("en");
});
