/**
 * Dialog flows (src/ui/flows/) driven through a fake FlowHost: the host
 * records the prompt / menu a flow opens and the test answers it by calling
 * the dialog's callbacks, so the multi-step chains (and their Esc steps back)
 * are checked without rendering or key handling. The same flows are covered
 * end to end, through the keys, in panel.test.ts.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { initI18n, t } from "../../../src/i18n/index.ts";
import type { ContextUsageInfo, RestoreOptions, SessionRow } from "../../../src/types.ts";
import type { FlowHost } from "../../../src/ui/flows/host.ts";
import { confirmDeleteSession, confirmShareSession, copyLastReply, openContextUsage, startExport, startFork } from "../../../src/ui/flows/session-flows.ts";
import { openTreeFilterMenu, restoreTreeNode, type TreeTarget } from "../../../src/ui/flows/tree-flows.ts";
import type { ActionSource, DataSource } from "../../../src/ui/ports.ts";
import { createInitialState } from "../../../src/ui/state.ts";
import { CONFIRM_NO_INDEX, CONFIRM_YES_INDEX, deleteSessionsTitle, overwriteFileTitle } from "../../../src/ui/widgets/confirm-dialog.ts";
import { nodeSubject } from "../../../src/ui/widgets/dialog-subject.ts";
import type { InputDialogSpec } from "../../../src/ui/widgets/input-dialog.ts";
import type { NoticeDialogSpec } from "../../../src/ui/widgets/notice-dialog.ts";
import { CUSTOM_PROMPT_INDEX } from "../../../src/ui/widgets/restore-dialog.ts";
import type { SelectDialogSpec } from "../../../src/ui/widgets/select-dialog.ts";

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
	const dialogs: { prompt: InputDialogSpec | undefined; menu: SelectDialogSpec | undefined; notice: NoticeDialogSpec | undefined } = {
		prompt: undefined,
		menu: undefined,
		notice: undefined,
	};
	const statuses: string[] = [];
	const entered: string[] = [];
	let pendingCancel: (() => void) | undefined;
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
		archiveOpenHint: () => "X open archive",
		removeArchivedRows: () => {},
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
			dialogs.notice = undefined;
		},
		openMenu: (mode, spec) => {
			state.mode = mode;
			dialogs.menu = spec;
			dialogs.prompt = undefined;
			dialogs.notice = undefined;
		},
		openNotice: (mode, spec) => {
			state.mode = mode;
			dialogs.notice = spec;
			dialogs.menu = undefined;
			dialogs.prompt = undefined;
		},
		closeDialogs: () => {
			state.mode = "normal";
			dialogs.prompt = undefined;
			dialogs.menu = undefined;
			dialogs.notice = undefined;
		},
		setPendingCancel: (cancel) => {
			pendingCancel = cancel;
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
		notice: (): NoticeDialogSpec => {
			assert.ok(dialogs.notice, "a notice is open");
			return dialogs.notice;
		},
		anyOpen: () => dialogs.menu !== undefined || dialogs.prompt !== undefined || dialogs.notice !== undefined,
		pendingCancel: () => pendingCancel,
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
	assert.equal(h.menu().subject, "#1/3", "the confirmation names the picked position, not the message text");
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
	const target: TreeTarget = { file: "/tmp/s1.jsonl", row: { entryId: "e1", role: "user", kind: "message", text: "hi", timestamp: 0, onActiveBranch: false, isLeaf: false } };
	restoreTreeNode(h.host, target);
	assert.equal(h.state.mode, "restore");
	const subject = h.menu().subject ?? "";
	assert.equal(subject, nodeSubject(target.row), "the menu identifies the node by role · time, not its text");
	assert.ok(!subject.includes("hi"));
	h.menu().onSelect(CUSTOM_PROMPT_INDEX);
	h.prompt().onCancel();
	assert.equal(h.menu().initialIndex, CUSTOM_PROMPT_INDEX, "Esc lands back on the custom entry");
	h.menu().onSelect(CUSTOM_PROMPT_INDEX);
	h.prompt().onSubmit("  keep the API notes  ");
	await flush();
	assert.deepEqual(restores, [{ summarize: true, customInstructions: "keep the API notes" }]);
	assert.deepEqual(h.entered, ["restore"]);
	// the active leaf restores right away, without a summary and without a menu
	const leaf: TreeTarget = { file: "/tmp/s1.jsonl", row: { entryId: "e1", role: "user", kind: "message", text: "hi", timestamp: 0, onActiveBranch: true, isLeaf: true } };
	restoreTreeNode(h.host, leaf);
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
	assert.equal(h.menu().subject, t("confirm.deleteSkipped"), "only the skip notice, no joined titles");
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

test("share Radius: a missing credential runs pi's sign-in (account → browser), copies the link, then shares", async () => {
	const shares: Array<{ file: string; destination: string }> = [];
	const copies: string[] = [];
	const opened: string[] = [];
	const steps: string[] = [];
	let finish: () => void = () => {};
	const h = fakeHost({
		actions: {
			radiusAuthenticated: async () => false,
			shareSession: async (file, destination) => {
				shares.push({ file, destination });
				return { url: "https://pi.dev/session/#radius", destination: "radius" };
			},
			copyText: async (text) => void copies.push(text),
			openUrl: (url) => void opened.push(url),
			loginRadius: async (method, interaction) => {
				steps.push(method);
				const choice = await interaction.prompt({
					type: "select",
					message: "Sign in to Radius:",
					options: [
						{ id: "browser", label: "Sign in with browser (recommended)" },
						{ id: "device-code", label: "Sign in with device code (when signing in from another device)" },
					],
				});
				steps.push(choice);
				interaction.notify({ type: "auth_url", url: "https://radius.test/authorize?state=x", instructions: "Continue in your browser." });
				await new Promise<void>((resolve) => {
					finish = resolve;
				});
			},
		},
	});

	confirmShareSession(h.host);
	h.menu().onSelect(2);
	await flush();
	assert.equal(h.menu().title, "Radius sign-in");
	assert.deepEqual(h.menu().items, ["Sign in with an account", "Sign in with an API key"]);
	assert.equal(h.menu().subject, "Esc/q close");
	h.menu().onSelect(0);
	await flush();

	// pi's OAuth question, translated by the panel: both choices, pi's parentheticals dropped.
	assert.equal(h.menu().title, t("dialog.radiusLoginMethodTitle"));
	assert.deepEqual(h.menu().items, [t("dialog.radiusLoginBrowser"), t("dialog.radiusLoginDeviceCode")]);
	assert.equal(h.menu().subject, "Esc/q close");
	h.menu().onSelect(0);
	await flush();

	// Browser sign-in does not cover the panel: the link goes to the clipboard, Esc stays available.
	assert.deepEqual(opened, ["https://radius.test/authorize?state=x"]);
	assert.equal(h.anyOpen(), false);
	assert.deepEqual(copies, ["https://radius.test/authorize?state=x"]);
	assert.equal(h.statuses.at(-1), t("status.radiusBrowserLinkCopied"));
	assert.ok(h.pendingCancel(), "Esc can still cancel the browser wait");

	finish();
	await flush();
	await flush();
	assert.deepEqual(steps, ["oauth", "browser"]);
	assert.deepEqual(shares, [{ file: "/tmp/s1.jsonl", destination: "radius" }]);
	assert.ok(h.statuses.includes("signed in to Radius"), h.statuses.join(","));
	assert.equal(copies.at(-1), "https://pi.dev/session/#radius");
	assert.equal(h.anyOpen(), false);
	assert.equal(h.pendingCancel(), undefined, "the cancel hook is cleared once the sign-in ends");
});

test("share Radius: the browser link stays in the footer when the clipboard fails; cancelling does not share", async () => {
	const shares: unknown[] = [];
	const h = fakeHost({
		actions: {
			radiusAuthenticated: async () => false,
			shareSession: async (file, destination) => {
				shares.push({ file, destination });
				return { url: "https://pi.dev/session/#radius", destination: "radius" };
			},
			copyText: async () => {
				throw new Error("no clipboard");
			},
			loginRadius: async (_method, interaction) => {
				interaction.notify({ type: "auth_url", url: "https://radius.test/authorize?state=x" });
				await new Promise((_resolve, reject) => {
					interaction.signal.addEventListener("abort", () => reject(new Error("Login cancelled")), { once: true });
				});
			},
		},
	});

	confirmShareSession(h.host);
	h.menu().onSelect(2);
	await flush();
	h.menu().onSelect(0);
	await flush();
	await flush();
	assert.equal(h.statuses.at(-1), t("status.radiusBrowserLink", { url: "https://radius.test/authorize?state=x" }));
	assert.equal(h.anyOpen(), false);

	// Esc (through the panel's cancel hook) aborts the wait; nothing is uploaded.
	h.pendingCancel()?.();
	await flush();
	await flush();
	assert.ok(h.statuses.includes(t("status.radiusLoginCancelled")), h.statuses.join(","));
	assert.deepEqual(shares, []);
});

test("share Radius: the API key uses the input dialog and an empty key stays open", async () => {
	const shares: Array<{ file: string; destination: string }> = [];
	let key: string | undefined;
	const h = fakeHost({
		actions: {
			radiusAuthenticated: async () => false,
			shareSession: async (file, destination) => {
				shares.push({ file, destination });
				return { url: "https://pi.dev/session/#radius", destination: "radius" };
			},
			copyText: async () => {},
			loginRadius: async (method, interaction) => {
				assert.equal(method, "api_key");
				key = await interaction.prompt({ type: "secret", message: "Enter your Radius API key:", placeholder: "rds_…" });
			},
		},
	});

	confirmShareSession(h.host);
	h.menu().onSelect(2);
	await flush();
	h.menu().onSelect(1);
	await flush();
	const prompt = h.prompt();
	assert.equal(prompt.title, t("dialog.radiusApiKeyTitle"));
	assert.equal(prompt.placeholder, "rds_…");
	assert.equal(prompt.validate?.("  "), "API key cannot be empty");
	assert.equal(prompt.validate?.("rds_key"), undefined);
	prompt.onSubmit("rds_key");
	await flush();
	await flush();
	assert.equal(key, "rds_key");
	assert.deepEqual(shares, [{ file: "/tmp/s1.jsonl", destination: "radius" }]);
	assert.equal(h.anyOpen(), false);
});

test("share Radius: a rejected API key is reported and the next S still asks for sign-in, not the account menu", async () => {
	const shares: unknown[] = [];
	const h = fakeHost({
		actions: {
			radiusAuthenticated: async () => false,
			shareSession: async (file, destination) => {
				shares.push({ file, destination });
				return { url: "https://pi.dev/session/#radius", destination: "radius" };
			},
			loginRadius: async (_method, interaction) => {
				await interaction.prompt({ type: "secret", message: "Enter Radius API key" });
				throw new Error("invalid API key");
			},
		},
	});

	confirmShareSession(h.host);
	h.menu().onSelect(2);
	await flush();
	h.menu().onSelect(1);
	await flush();
	h.prompt().onSubmit("rds_bad");
	await flush();
	await flush();
	assert.equal(h.anyOpen(), false);
	assert.equal(h.statuses.at(-1), t("status.radiusLoginFailed", { error: "invalid API key" }));
	assert.deepEqual(shares, []);

	// The key was never stored, so Radius starts the sign-in menus again.
	confirmShareSession(h.host);
	h.menu().onSelect(2);
	await flush();
	assert.equal(h.menu().title, t("dialog.radiusLoginTitle"));
	assert.ok(!h.menu().items.includes(t("dialog.radiusAccountShare")));
});

test("share Radius: Esc in the method menu or the API-key prompt cancels without sharing", async () => {
	const shares: unknown[] = [];
	let logins = 0;
	const h = fakeHost({
		actions: {
			radiusAuthenticated: async () => false,
			shareSession: async (file, destination) => {
				shares.push({ file, destination });
				return { url: "https://pi.dev/session/#radius", destination: "radius" };
			},
			loginRadius: async (_method, interaction) => {
				logins++;
				await interaction.prompt({ type: "secret", message: "Enter your Radius API key:" });
			},
		},
	});

	confirmShareSession(h.host);
	h.menu().onSelect(2);
	await flush();
	h.menu().onCancel();
	await flush();
	assert.equal(logins, 0);
	assert.deepEqual(shares, []);
	assert.equal(h.anyOpen(), false);

	confirmShareSession(h.host);
	h.menu().onSelect(2);
	await flush();
	h.menu().onSelect(1);
	await flush();
	assert.equal(logins, 1);
	h.prompt().onCancel();
	await flush();
	await flush();
	assert.equal(h.anyOpen(), false);
	assert.ok(h.statuses.includes("Radius sign-in cancelled"), h.statuses.join(","));
	assert.deepEqual(shares, []);
});

test("share Radius: an existing credential asks Share / Sign out before uploading; auto never checks Radius", async () => {
	const shares: Array<{ file: string; destination: string }> = [];
	let checks = 0;
	let logins = 0;
	const h = fakeHost({
		actions: {
			radiusAuthenticated: async () => {
				checks++;
				return true;
			},
			loginRadius: async () => {
				logins++;
			},
			shareSession: async (file, destination) => {
				shares.push({ file, destination });
				return { url: "https://pi.dev/session/#radius", destination: "radius" };
			},
			copyText: async () => {},
		},
	});

	confirmShareSession(h.host);
	h.menu().onSelect(2);
	await flush();
	assert.equal(checks, 1);
	assert.equal(logins, 0);
	assert.equal(h.menu().title, t("dialog.radiusAccountTitle"));
	assert.deepEqual(shares, [], "nothing is uploaded before the account menu is answered");

	h.menu().onSelect(0);
	await flush();
	await flush();
	assert.deepEqual(shares, [{ file: "/tmp/s1.jsonl", destination: "radius" }]);

	confirmShareSession(h.host);
	h.menu().onSelect(0);
	await flush();
	await flush();
	assert.equal(checks, 1);
	assert.deepEqual(shares.at(-1), { file: "/tmp/s1.jsonl", destination: "auto" });
});

test("share Radius: a device code opens in a notice, and closing it cancels the sign-in", async () => {
	const shares: unknown[] = [];
	const opened: string[] = [];
	const h = fakeHost({
		actions: {
			radiusAuthenticated: async () => false,
			shareSession: async (file, destination) => {
				shares.push({ file, destination });
				return { url: "https://pi.dev/session/#radius", destination: "radius" };
			},
			openUrl: (url) => void opened.push(url),
			loginRadius: async (_method, interaction) => {
				interaction.notify({ type: "progress", message: "Waiting for device authorization…" });
				interaction.notify({ type: "device_code", userCode: "ABCD-EFGH", verificationUri: "https://radius.test/device" });
				await new Promise((_resolve, reject) => {
					interaction.signal.addEventListener("abort", () => reject(new Error("Login cancelled")), { once: true });
				});
			},
		},
	});

	confirmShareSession(h.host);
	h.menu().onSelect(2);
	await flush();
	h.menu().onSelect(0);
	await flush();
	assert.ok(h.statuses.includes("Waiting for device authorization…"), h.statuses.join(","));
	const notice = h.notice();
	assert.equal(notice.title, "Sign in on another device");
	assert.deepEqual(notice.lines, ["Enter code ABCD-EFGH", "https://radius.test/device"]);
	assert.deepEqual(opened, ["https://radius.test/device"]);

	notice.onClose();
	await flush();
	await flush();
	assert.equal(h.anyOpen(), false);
	assert.ok(h.statuses.includes("Radius sign-in cancelled"), h.statuses.join(","));
	assert.deepEqual(shares, []);
});

test("share Radius: a signed-in account asks Share / Sign out; sign-out confirms first", async () => {
	let logouts = 0;
	const shares: Array<{ file: string; destination: string }> = [];
	const h = fakeHost({
		actions: {
			shareSession: async (file, destination) => {
				shares.push({ file, destination });
				return { url: "https://pi.dev/session/#radius", destination: "radius" };
			},
			radiusAuthenticated: async () => true,
			logoutRadius: async () => {
				logouts++;
			},
		},
	});

	// The outer menu still has three destinations; Radius opens the account menu.
	confirmShareSession(h.host);
	assert.equal(h.menu().items.length, 3);
	h.menu().onSelect(2);
	await flush();
	assert.equal(h.menu().title, t("dialog.radiusAccountTitle"));
	assert.deepEqual(h.menu().items, [t("dialog.radiusAccountShare"), t("dialog.radiusAccountSignOut")]);

	// Share keeps the old explicit-Radius path.
	h.menu().onSelect(0);
	await flush();
	assert.deepEqual(shares, [{ file: "/tmp/s1.jsonl", destination: "radius" }]);
	assert.equal(h.anyOpen(), false);

	// Sign out: No is the default and goes back to the account menu.
	h.statuses.length = 0;
	confirmShareSession(h.host);
	h.menu().onSelect(2);
	await flush();
	h.menu().onSelect(1);
	assert.equal(h.menu().title, t("confirm.radiusSignOut"));
	h.menu().onSelect(CONFIRM_NO_INDEX);
	assert.equal(h.menu().title, t("dialog.radiusAccountTitle"));
	assert.equal(logouts, 0);

	h.menu().onSelect(1);
	h.menu().onSelect(CONFIRM_YES_INDEX);
	await flush();
	assert.equal(logouts, 1);
	assert.equal(h.anyOpen(), false);
	assert.deepEqual(h.statuses.slice(-2), [t("status.radiusSigningOut"), t("status.radiusSignedOut")]);

	// A failing credential store is reported in the footer, not thrown at the panel.
	const failing = fakeHost({
		actions: {
			shareSession: async () => ({ url: "https://pi.dev/session/#radius", destination: "radius" }),
			radiusAuthenticated: async () => true,
			logoutRadius: async () => {
				throw new Error("credential store is read-only");
			},
		},
	});
	confirmShareSession(failing.host);
	failing.menu().onSelect(2);
	await flush();
	failing.menu().onSelect(1);
	failing.menu().onSelect(CONFIRM_YES_INDEX);
	await flush();
	assert.ok(failing.statuses.at(-1)?.includes("credential store is read-only"), failing.statuses.join(","));

	// No port wired: footer only, no confirmation menu.
	const bare = fakeHost({
		actions: {
			shareSession: async () => ({ url: "u", destination: "radius" }),
			radiusAuthenticated: async () => true,
		},
	});
	confirmShareSession(bare.host);
	bare.menu().onSelect(2);
	await flush();
	bare.menu().onSelect(1);
	assert.equal(bare.anyOpen(), false);
	assert.ok(bare.statuses.includes(t("status.radiusSignOutUnavailable")), bare.statuses.join(","));
});
