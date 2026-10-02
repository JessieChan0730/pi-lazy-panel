/**
 * Dialog flows (src/ui/flows/) driven through a fake FlowHost: the host
 * records the prompt / menu a flow opens and the test answers it by calling
 * the dialog's callbacks, so the multi-step chains (and their Esc steps back)
 * are checked without rendering or key handling. The same flows are covered
 * end to end, through the keys, in panel.test.ts.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { initI18n, t } from "../src/i18n/index.ts";
import type { ContextUsageInfo, RestoreOptions, SessionRow } from "../src/types.ts";
import type { FlowHost } from "../src/ui/flows/host.ts";
import { confirmDeleteSession, copyLastReply, openContextUsage, startExport, startFork } from "../src/ui/flows/session-flows.ts";
import { openTreeFilterMenu, restoreTreeNode, type TreeTarget } from "../src/ui/flows/tree-flows.ts";
import type { ActionSource, DataSource } from "../src/ui/ports.ts";
import { createInitialState } from "../src/ui/state.ts";
import { CONFIRM_NO_INDEX, CONFIRM_YES_INDEX, deleteSessionsTitle, overwriteFileTitle } from "../src/ui/widgets/confirm-dialog.ts";
import type { InputDialogSpec } from "../src/ui/widgets/input-dialog.ts";
import { CUSTOM_PROMPT_INDEX } from "../src/ui/widgets/restore-dialog.ts";
import type { SelectDialogSpec } from "../src/ui/widgets/select-dialog.ts";

initI18n("en");

function row(i: number): SessionRow {
	return { file: `/tmp/s${i}.jsonl`, id: `id-${i}`, cwd: "/a", preview: `session ${i}`, createdAt: 0, updatedAt: 0, messageCount: 1 };
}

function flush(): Promise<void> {
	return new Promise((r) => setTimeout(r, 0));
}

interface FakeHostOptions {
	actions?: Partial<ActionSource>;
	data?: Partial<DataSource>;
	rows?: SessionRow[];
	currentSessionFile?: string;
	disposed?: () => boolean;
}

/** A FlowHost that keeps the open prompt / menu and every footer status for the assertions. */
function fakeHost(opts: FakeHostOptions = {}) {
	const state = createInitialState();
	const rows = opts.rows ?? [row(1), row(2), row(3)];
	const dialogs: { prompt: InputDialogSpec | undefined; menu: SelectDialogSpec | undefined } = { prompt: undefined, menu: undefined };
	const statuses: string[] = [];
	const entered: string[] = [];
	let usageOpened: { info: ContextUsageInfo; onCopy: (text: string) => void } | undefined;
	const host: FlowHost = {
		state,
		data: { listSessions: async () => rows, loadTree: async () => [], loadContent: async () => [], ...opts.data },
		actions: {
			copyNodeText: async () => true,
			setNodeLabel: async () => {},
			resumeSession: async () => "switched",
			restoreNode: async () => "restored",
			...opts.actions,
		},
		currentSessionFile: opts.currentSessionFile,
		skipSummaryPrompt: false,
		isDisposed: opts.disposed ?? (() => false),
		setStatus: (text) => {
			if (text !== undefined) statuses.push(text);
		},
		sessionRows: () => rows,
		currentSessionRow: () => rows[state.cursor.sessions],
		openPrompt: (mode, spec) => {
			state.mode = mode;
			dialogs.prompt = spec;
			dialogs.menu = undefined;
		},
		openMenu: (mode, spec) => {
			state.mode = mode;
			dialogs.menu = spec;
			dialogs.prompt = undefined;
		},
		closeDialogs: () => {
			state.mode = "normal";
			dialogs.prompt = undefined;
			dialogs.menu = undefined;
		},
		openInfo: () => {},
		openUsage: (info, onCopy) => {
			usageOpened = { info, onCopy };
		},
		dialogMaxRows: () => 10,
		enter: async (what, run) => {
			entered.push(what);
			await run();
		},
		relist: async () => true,
		followSessionsCursor: async () => {},
		reloadTree: async () => {},
		setTreeFilter: async (filter) => { state.treeFilter = filter; },
		refreshSession: async () => {},
	};
	return {
		host,
		state,
		statuses,
		entered,
		menu: (): SelectDialogSpec => {
			assert.ok(dialogs.menu, "a menu is open");
			return dialogs.menu;
		},
		prompt: (): InputDialogSpec => {
			assert.ok(dialogs.prompt, "a prompt is open");
			return dialogs.prompt;
		},
		anyOpen: () => dialogs.menu !== undefined || dialogs.prompt !== undefined,
		usageOpened: () => usageOpened,
	};
}

test("tree filter: five choices, current mode selected, cancel preserves it and selection closes the menu", async () => {
	const h = fakeHost();
	h.state.treeFilter = "user-only";
	openTreeFilterMenu(h.host, undefined);
	assert.equal(h.anyOpen(), false);
	assert.equal(h.statuses.at(-1), t("status.noSessionLoaded"));
	openTreeFilterMenu(h.host, "session");
	assert.equal(h.state.mode, "tree-filter");
	assert.equal(h.menu().items.length, 5);
	assert.equal(h.menu().initialIndex, 2);
	h.menu().onCancel();
	assert.equal(h.state.treeFilter, "user-only");
	assert.equal(h.anyOpen(), false);
	openTreeFilterMenu(h.host, "session");
	h.menu().onSelect(3);
	await flush();
	assert.equal(h.state.treeFilter, "labeled");
	assert.equal(h.state.mode, "normal");
	assert.equal(h.anyOpen(), false);
});

test("export: format menu → path prompt → overwrite confirmation, each Esc / No steps back one dialog", async () => {
	const written: string[] = [];
	const h = fakeHost({
		actions: {
			exportTarget: (_file, format, input) => {
				const path = input.trim() || `/work/default.${format}`;
				return { path, exists: path === "/work/taken.jsonl" };
			},
			exportSession: async (_file, format, path) => {
				written.push(`${format}:${path}`);
				return path;
			},
		},
	});
	startExport(h.host);
	assert.equal(h.state.mode, "export");
	assert.equal(h.menu().initialIndex, 0, "the format menu starts on HTML");
	// JSONL → the path prompt, pre-filled with pi's default for that format
	h.menu().onSelect(1);
	assert.equal(h.prompt().value, "/work/default.jsonl");
	// Esc → back to the menu, on the format just picked
	h.prompt().onCancel();
	assert.equal(h.menu().initialIndex, 1);
	h.menu().onSelect(1);
	// an existing file asks first; No → back to the prompt with the typed path kept
	h.prompt().onSubmit("/work/taken.jsonl");
	assert.equal(h.menu().title, overwriteFileTitle());
	h.menu().onSelect(CONFIRM_NO_INDEX);
	assert.equal(h.prompt().value, "/work/taken.jsonl", "the typed path is kept");
	assert.deepEqual(written, [], "nothing is written before Yes");
	// Enter again, Yes → written, every dialog closed, the footer says where
	h.prompt().onSubmit("/work/taken.jsonl");
	h.menu().onSelect(CONFIRM_YES_INDEX);
	await flush();
	assert.deepEqual(written, ["jsonl:/work/taken.jsonl"]);
	assert.equal(h.state.mode, "normal");
	assert.equal(h.anyOpen(), false);
	assert.equal(h.statuses.at(-1), t("status.exportedTo", { path: "/work/taken.jsonl" }));
});

test("fork: the selector starts on the last user message; No on the confirmation goes back onto the picked one", async () => {
	const forks: string[] = [];
	const h = fakeHost({
		actions: {
			forkSession: async (file, entryId) => {
				forks.push(`${file}#${entryId}`);
				return "switched";
			},
		},
		data: {
			loadForkPoints: async () => [
				{ entryId: "u1", text: "first" },
				{ entryId: "u2", text: "second" },
				{ entryId: "u3", text: "third" },
			],
		},
	});
	await startFork(h.host);
	assert.equal(h.state.mode, "fork");
	assert.equal(h.menu().initialIndex, 2, "like pi's /fork: the last user message");
	assert.equal(h.menu().maxRows, 10, "a long list scrolls within the host's limit");
	h.menu().onSelect(0);
	assert.equal(h.menu().subject, "first", "the confirmation names the message");
	h.menu().onSelect(CONFIRM_NO_INDEX);
	assert.equal(h.menu().initialIndex, 0, "back on the message just picked");
	h.menu().onSelect(0);
	h.menu().onSelect(CONFIRM_YES_INDEX);
	await flush();
	assert.deepEqual(forks, ["/tmp/s1.jsonl#u1"]);
	assert.deepEqual(h.entered, ["fork"]);
	assert.equal(h.state.mode, "normal");
});

test("restore: Summarize branch? → custom prompt, Esc there comes back onto the custom entry; the active leaf skips the menu", async () => {
	const restores: RestoreOptions[] = [];
	const h = fakeHost({
		actions: {
			restoreNode: async (_file, _entryId, options) => {
				restores.push(options);
				return "restored";
			},
		},
	});
	function node(isLeaf: boolean): TreeTarget {
		return { file: "/tmp/s1.jsonl", row: { entryId: "e1", role: "user", kind: "message", text: "hi", timestamp: 0, onActiveBranch: isLeaf, isLeaf } };
	}
	restoreTreeNode(h.host, node(false));
	assert.equal(h.state.mode, "restore");
	assert.equal(h.menu().subject, "user: hi");
	h.menu().onSelect(CUSTOM_PROMPT_INDEX);
	h.prompt().onCancel();
	assert.equal(h.menu().initialIndex, CUSTOM_PROMPT_INDEX, "Esc lands back on the custom entry");
	h.menu().onSelect(CUSTOM_PROMPT_INDEX);
	h.prompt().onSubmit("  keep the API notes  ");
	await flush();
	assert.deepEqual(restores, [{ summarize: true, customInstructions: "keep the API notes" }]);
	assert.deepEqual(h.entered, ["restore"]);
	// the active leaf restores right away, without a summary and without a menu
	restoreTreeNode(h.host, node(true));
	await flush();
	assert.deepEqual(restores.at(-1), { summarize: false });
	assert.equal(h.anyOpen(), false);
});

test("batch delete: one confirmation, the open session is left out, a failure stays selected with the first error", async () => {
	const deleted: string[] = [];
	const rows = [row(1), row(2), row(3)];
	const h = fakeHost({
		rows,
		currentSessionFile: "/tmp/s1.jsonl",
		actions: {
			deleteSession: async (file) => {
				if (file === "/tmp/s3.jsonl") throw new Error("locked");
				deleted.push(file);
				return "trash";
			},
		},
	});
	for (const r of rows) h.state.selectedSessionFiles.add(r.file);
	confirmDeleteSession(h.host);
	assert.equal(h.state.mode, "confirm");
	assert.equal(h.menu().title, deleteSessionsTitle(2), "the open session is not counted");
	assert.deepEqual([...h.state.selectedSessionFiles].sort(), ["/tmp/s2.jsonl", "/tmp/s3.jsonl"], "…and no longer selected");
	h.menu().onSelect(CONFIRM_YES_INDEX);
	await flush();
	assert.deepEqual(deleted, ["/tmp/s2.jsonl"]);
	assert.deepEqual([...h.state.selectedSessionFiles], ["/tmp/s3.jsonl"], "the failed one stays selected");
	assert.equal(h.statuses.at(-1), t("status.batchDeletedFailed", { deleted: 1, failed: 1, error: "session 3: locked" }));
});

test("a flow that finishes after the panel is gone leaves it alone", async () => {
	let disposed = false;
	const h = fakeHost({
		disposed: () => disposed,
		actions: {
			copyLastReply: async () => {
				disposed = true; // the panel closes while the clipboard is busy
				return true;
			},
		},
	});
	await copyLastReply(h.host);
	assert.deepEqual(h.statuses, [], "no footer update after dispose");
});

test("context usage: loads the cursor session, opens the box, and y copies its text", async () => {
	const info: ContextUsageInfo = { messages: 3, used: 100, contextWindow: 200, percent: 0.5, categories: [{ key: "context", tokens: 40, color: "warning" }, { key: "freeSpace", tokens: 160, color: "dim" }] };
	const usageCalls: string[] = [];
	const copied: string[] = [];
	const h = fakeHost({
		data: {
			loadContextUsage: async (file) => {
				usageCalls.push(file);
				return info;
			},
		},
		actions: { copyText: async (text) => void copied.push(text) },
	});
	await openContextUsage(h.host);
	assert.deepEqual(usageCalls, ["/tmp/s1.jsonl"]);
	const opened = h.usageOpened();
	assert.ok(opened, "the usage box opened");
	assert.equal(opened.info, info);
	opened.onCopy("some text");
	await flush();
	assert.deepEqual(copied, ["some text"]);
	assert.ok(h.statuses.includes(t("status.copiedContextUsage")), h.statuses.join(","));

	// no loader injected: footer only, nothing opens
	const bare = fakeHost();
	await openContextUsage(bare.host);
	assert.equal(bare.usageOpened(), undefined);
	assert.ok(bare.statuses.includes(t("status.usageUnavailable")), bare.statuses.join(","));
});
