/**
 * Enter actions against real session files in a temp directory:
 * `isEffectiveLeaf` (when Enter is a no-op), `resumeSession` (SESSIONS Enter)
 * and `restoreNode` (TREE Enter) with a recording stand-in for pi's command
 * context. Run with `npm test` (node --test via tsx).
 */

import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { basename, join } from "node:path";
import { test } from "node:test";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import {
	cloneSession,
	type CommandSpec,
	type CompactContext,
	compactSession,
	CURRENT_SESSION_DELETE_ERROR,
	defaultExportName,
	deleteSession,
	exportSession,
	exportTarget,
	type ForkContext,
	forkSession,
	GH_NOT_INSTALLED,
	GH_NOT_LOGGED_IN,
	type ImportContext,
	importSession,
	type NewSessionContext,
	newSession,
	renameSession,
	resumeSession,
	shareSession,
	shareViewerUrl,
} from "../src/actions/session-actions.ts";
import { type RestoreContext, restoreNode } from "../src/actions/tree-actions.ts";
import { EXTENSION_ID, SPINNER_FRAMES } from "../src/constants.ts";
import { loadForkPoints, loadLastReply } from "../src/data/content.ts";
import { isEffectiveLeaf } from "../src/data/tree.ts";
import { initI18n } from "../src/i18n/index.ts";
import { expandHome, resolveUserPath, stripQuotes } from "../src/utils/paths.ts";

// 恢复 / 摘要进度这类会话操作会经 t() 输出文案，测试统一按英文界面断言。
initI18n("en");

type AnyMessage = Parameters<SessionManager["appendMessage"]>[0];

function userMessage(text: string, timestamp: number): AnyMessage {
	return { role: "user", content: [{ type: "text", text }], timestamp } as unknown as AnyMessage;
}

function assistantMessage(text: string, timestamp: number): AnyMessage {
	return {
		role: "assistant",
		content: [{ type: "text", text }],
		api: "x",
		provider: "x",
		model: "x",
		usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
		stopReason: "stop",
		timestamp,
	} as unknown as AnyMessage;
}

/** A persisted session: user u1 → assistant a1 → label on a1 (so the raw leaf is a bookkeeping entry). */
function makeSession(dir: string) {
	const manager = SessionManager.create(dir, dir);
	const u1 = manager.appendMessage(userMessage("hello", 1));
	const a1 = manager.appendMessage(assistantMessage("hi", 2));
	const labelId = manager.appendLabelChange(a1, "ckpt");
	const file = manager.getSessionFile();
	assert.ok(file);
	return { manager, file, u1, a1, labelId };
}

function tempDir(t: { after: (fn: () => void) => void }): string {
	const dir = mkdtempSync(join(tmpdir(), "lazy-panel-"));
	t.after(() => rmSync(dir, { recursive: true, force: true }));
	return dir;
}

interface FakeCtxOptions {
	/** Whether pi is idle; `abort()` flips it back to idle. */
	idle?: boolean;
	cancelSwitch?: boolean;
	cancelNavigate?: boolean;
	cancelFork?: boolean;
	cancelNew?: boolean;
	/** Make `navigateTree` of the replacement context throw with this message. */
	nextNavigateError?: string;
	/** Make `compact` of the old ctx fail (calls onError with this message). */
	compactError?: string;
	/** Make `compact` of the replacement ctx fail (calls onError with this message). */
	nextCompactError?: string;
}

/** Recording stand-in for pi's command context (and the replacement context handed to `withSession`). */
function fakeCtx(sessionManager: SessionManager, opts: FakeCtxOptions = {}) {
	let idle = opts.idle ?? true;
	const log: string[] = [];
	const switches: Array<{ file: string; withSession: boolean }> = [];
	const navigations: Array<{ entryId: string; options: unknown }> = [];
	const nextNavigations: Array<{ entryId: string; options: unknown }> = [];
	const notifies: Array<[string, string | undefined]> = [];
	/** fork calls on the old ctx / on the replacement ctx handed to withSession. */
	const forks: Array<{ entryId: string; position: string | undefined }> = [];
	const nextForks: Array<{ entryId: string; position: string | undefined }> = [];
	/** newSession calls: the names the setup callback would write ([] when no setup). */
	const newSessions: Array<{ hadSetup: boolean; appended: string[] }> = [];
	/** `compact` calls: the customInstructions on the old ctx / on the replacement ctx. */
	const compacts: Array<string | undefined> = [];
	const nextCompacts: Array<string | undefined> = [];
	/** `ui.setStatus` calls: `[key, text]` on the old ctx, `["next:" + key, text]` on the replacement ctx. */
	const statuses: Array<[string, string | undefined]> = [];
	// 切换后 pi 给 withSession 的是绑定到新会话的另一个 ctx；这里用单独的记录器区分它和旧 ctx。
	const next = {
		isIdle: () => true,
		abort: () => log.push("next.abort"),
		waitForIdle: async () => void log.push("next.wait"),
		navigateTree: async (entryId: string, options: unknown) => {
			nextNavigations.push({ entryId, options });
			if (opts.nextNavigateError) throw new Error(opts.nextNavigateError);
			return { cancelled: false };
		},
		fork: async (entryId: string, options?: { position?: string }) => {
			nextForks.push({ entryId, position: options?.position });
			return { cancelled: opts.cancelFork ?? false };
		},
		compact: (options?: { customInstructions?: string; onComplete?: (r: unknown) => void; onError?: (e: Error) => void }) => {
			nextCompacts.push(options?.customInstructions);
			if (opts.nextCompactError) options?.onError?.(new Error(opts.nextCompactError));
			else options?.onComplete?.({});
		},
		ui: {
			notify: (msg: string, level?: string) => void notifies.push([msg, level]),
			setStatus: (key: string, text: string | undefined) => void statuses.push([`next:${key}`, text]),
		},
	};
	const ctx = {
		sessionManager,
		isIdle: () => idle,
		abort: () => {
			log.push("abort");
			idle = true;
		},
		waitForIdle: async () => void log.push("wait"),
		navigateTree: async (entryId: string, options: unknown) => {
			log.push("navigate");
			navigations.push({ entryId, options });
			return { cancelled: opts.cancelNavigate ?? false };
		},
		fork: async (entryId: string, options?: { position?: string }) => {
			log.push("fork");
			forks.push({ entryId, position: options?.position });
			return { cancelled: opts.cancelFork ?? false };
		},
		newSession: async (options?: { setup?: (sm: unknown) => Promise<void> }) => {
			log.push("new");
			const appended: string[] = [];
			await options?.setup?.({ appendSessionInfo: (n: string) => void appended.push(n) } as never);
			newSessions.push({ hadSetup: options?.setup !== undefined, appended });
			return { cancelled: opts.cancelNew ?? false };
		},
		switchSession: async (file: string, options?: { withSession?: (c: unknown) => Promise<void> }) => {
			log.push("switch");
			switches.push({ file, withSession: options?.withSession !== undefined });
			if (opts.cancelSwitch) return { cancelled: true };
			await options?.withSession?.(next as never);
			return { cancelled: false };
		},
		compact: (options?: { customInstructions?: string; onComplete?: (r: unknown) => void; onError?: (e: Error) => void }) => {
			log.push("compact");
			compacts.push(options?.customInstructions);
			if (opts.compactError) options?.onError?.(new Error(opts.compactError));
			else options?.onComplete?.({});
		},
		ui: {
			notify: (msg: string, level?: string) => void notifies.push([`old:${msg}`, level]),
			setStatus: (key: string, text: string | undefined) => void statuses.push([key, text]),
		},
	} as unknown as RestoreContext & NewSessionContext & ForkContext & CompactContext;
	return { ctx, log, switches, navigations, nextNavigations, notifies, statuses, forks, nextForks, newSessions, compacts, nextCompacts };
}

test("isEffectiveLeaf: the leaf itself, or a non-user entry followed only by bookkeeping entries", (t) => {
	const dir = tempDir(t);
	const s = makeSession(dir);
	const m = SessionManager.open(s.file);
	assert.equal(m.getLeafId(), s.labelId);
	assert.equal(isEffectiveLeaf(m, s.labelId), true, "the raw leaf");
	assert.equal(isEffectiveLeaf(m, s.a1), true, "last message with only a label after it");
	assert.equal(isEffectiveLeaf(m, s.u1), false, "user messages restore into the editor, never a no-op");
	assert.equal(isEffectiveLeaf(m, "nope"), false);

	// model / thinking changes and session_info are bookkeeping too
	m.appendModelChange("p", "m2");
	m.appendThinkingLevelChange("high");
	m.appendSessionInfo("named");
	assert.equal(isEffectiveLeaf(m, s.a1), true);

	// a later message makes a1 an interior node
	const u2 = m.appendMessage(userMessage("more", 3));
	const a2 = m.appendMessage(assistantMessage("sure", 4));
	assert.equal(isEffectiveLeaf(m, s.a1), false);
	assert.equal(isEffectiveLeaf(m, a2), true);
	assert.equal(isEffectiveLeaf(m, u2), false);

	// a compaction after a2 changes what the model sees, so restoring to a2 is not a no-op
	m.appendCompaction("summary", u2, 10);
	assert.equal(isEffectiveLeaf(m, a2), false);

	// entries on another branch never count
	m.branch(s.u1);
	const a3 = m.appendMessage(assistantMessage("alt", 5));
	assert.equal(isEffectiveLeaf(m, a3), true);
	assert.equal(isEffectiveLeaf(m, a2), false);
});

test("resumeSession: no-op for the current session, switchSession for others, errors before pi tears anything down", async (t) => {
	const dir = tempDir(t);
	const s = makeSession(dir);
	const other = makeSession(mkdtempSync(join(dir, "other-")));

	const current = fakeCtx(SessionManager.open(s.file));
	assert.equal(await resumeSession(current.ctx, s.file), "unchanged");
	assert.deepEqual(current.switches, []);

	assert.equal(await resumeSession(current.ctx, other.file), "switched");
	assert.deepEqual(current.switches, [{ file: other.file, withSession: false }]);

	await assert.rejects(resumeSession(current.ctx, join(dir, "missing.jsonl")), /session file not found/);
	assert.equal(current.switches.length, 1, "a missing file never reaches switchSession");

	const cancelling = fakeCtx(SessionManager.open(s.file), { cancelSwitch: true });
	await assert.rejects(resumeSession(cancelling.ctx, other.file), /cancelled/);
});

test("restoreNode in the current session: navigateTree without a summary, aborting a running response first", async (t) => {
	const dir = tempDir(t);
	const s = makeSession(dir);

	// cursor on the effective leaf (a1, label after it): nothing to do
	const idle = fakeCtx(SessionManager.open(s.file));
	assert.equal(await restoreNode(idle.ctx, s.file, s.a1), "unchanged");
	assert.deepEqual(idle.log, []);

	// earlier node: navigate in place, no switch, no abort while idle
	assert.equal(await restoreNode(idle.ctx, s.file, s.u1), "restored");
	assert.deepEqual(idle.log, ["navigate"]);
	assert.deepEqual(idle.navigations, [{ entryId: s.u1, options: { summarize: false } }]);
	assert.deepEqual(idle.switches, []);

	// pi still streaming: abort → wait for idle → navigate (like the built-in /tree)
	const busy = fakeCtx(SessionManager.open(s.file), { idle: false });
	assert.equal(await restoreNode(busy.ctx, s.file, s.u1), "restored");
	assert.deepEqual(busy.log, ["abort", "wait", "navigate"]);

	// unknown entry / cancelled navigation are reported, nothing else happens
	await assert.rejects(restoreNode(idle.ctx, s.file, "nope"), /not found/);
	const cancelled = fakeCtx(SessionManager.open(s.file), { cancelNavigate: true });
	await assert.rejects(restoreNode(cancelled.ctx, s.file, s.u1), /cancelled/);
});

test("restoreNode in another session: switch first, then navigate with the replacement context", async (t) => {
	const dir = tempDir(t);
	const s = makeSession(dir);
	const other = makeSession(mkdtempSync(join(dir, "other-")));
	const ctx = fakeCtx(SessionManager.open(s.file));

	// the other session's effective leaf: plain switch, no restore
	assert.equal(await restoreNode(ctx.ctx, other.file, other.a1), "switched");
	assert.deepEqual(ctx.switches, [{ file: other.file, withSession: false }]);
	assert.deepEqual(ctx.nextNavigations, []);

	// an earlier node: navigate inside withSession, on the new ctx only
	assert.equal(await restoreNode(ctx.ctx, other.file, other.u1), "restored");
	assert.deepEqual(ctx.switches.at(-1), { file: other.file, withSession: true });
	assert.deepEqual(ctx.nextNavigations, [{ entryId: other.u1, options: { summarize: false } }]);
	assert.deepEqual(ctx.navigations, [], "the stale pre-switch ctx must not be used");
	assert.deepEqual(ctx.notifies, []);

	// pre-flight failures never switch
	await assert.rejects(restoreNode(ctx.ctx, other.file, "nope"), /not found/);
	await assert.rejects(restoreNode(ctx.ctx, join(dir, "missing.jsonl"), other.u1), /not found/);
	assert.equal(ctx.switches.length, 2);

	// navigation failing after the switch: reported in the new session, outcome is the switch that did happen
	const failing = fakeCtx(SessionManager.open(s.file), { nextNavigateError: "boom" });
	assert.equal(await restoreNode(failing.ctx, other.file, other.u1), "switched");
	assert.deepEqual(failing.notifies, [["restore failed: boom", "error"]]);
});

test("restoreNode passes the summary choice through to navigateTree and shows progress in pi's footer meanwhile", async (t) => {
	const dir = tempDir(t);
	const s = makeSession(dir);
	const other = makeSession(mkdtempSync(join(dir, "other-")));
	const ctx = fakeCtx(SessionManager.open(s.file));

	// current session: Summarize / Summarize with custom prompt; customInstructions only when given
	assert.equal(await restoreNode(ctx.ctx, s.file, s.u1, { summarize: true }), "restored");
	assert.equal(await restoreNode(ctx.ctx, s.file, s.u1, { summarize: true, customInstructions: "focus on x" }), "restored");
	assert.equal(await restoreNode(ctx.ctx, s.file, s.u1, { summarize: false }), "restored");
	assert.deepEqual(
		ctx.navigations.map((n) => n.options),
		[{ summarize: true }, { summarize: true, customInstructions: "focus on x" }, { summarize: false }],
	);
	// the panel is hidden while pi writes the summary, so the progress goes to pi's own footer and is cleared afterwards
	assert.deepEqual(ctx.statuses, [
		["lazy-panel", "summarizing branch…"],
		["lazy-panel", undefined],
		["lazy-panel", "summarizing branch…"],
		["lazy-panel", undefined],
	]);

	// other session: the choice travels into withSession and the status goes to the replacement ctx
	assert.equal(await restoreNode(ctx.ctx, other.file, other.u1, { summarize: true, customInstructions: "short" }), "restored");
	assert.deepEqual(ctx.nextNavigations, [{ entryId: other.u1, options: { summarize: true, customInstructions: "short" } }]);
	assert.deepEqual(ctx.statuses.slice(4), [
		["next:lazy-panel", "summarizing branch…"],
		["next:lazy-panel", undefined],
	]);

	// the effective leaf never navigates, whatever the choice
	assert.equal(await restoreNode(ctx.ctx, s.file, s.a1, { summarize: true }), "unchanged");
	assert.equal(ctx.navigations.length, 3);

	// a cancelled summary (aborted, or vetoed by an extension) is reported and the status is still cleared
	const cancelled = fakeCtx(SessionManager.open(s.file), { cancelNavigate: true });
	await assert.rejects(restoreNode(cancelled.ctx, s.file, s.u1, { summarize: true }), /branch summary cancelled/);
	assert.deepEqual(cancelled.statuses.at(-1), ["lazy-panel", undefined]);
});

/** The first footer status a spinner writes: a rotating frame followed by the text. */
function isSpinnerStart(status: [string, string | undefined] | undefined, key: string, text: string): boolean {
	if (!status || status[0] !== key || status[1] === undefined) return false;
	return status[1].includes(text) && SPINNER_FRAMES.some((frame) => status[1]?.startsWith(frame));
}

test("compactSession: compacts the current session in place, showing a spinner in pi's footer", async (t) => {
	const dir = tempDir(t);
	const s = makeSession(dir);
	const ctx = fakeCtx(SessionManager.open(s.file));

	// no instructions: compact with pi's default, no switch, outcome "compacted"
	assert.equal(await compactSession(ctx.ctx, s.file), "compacted");
	assert.deepEqual(ctx.compacts, [undefined]);
	assert.deepEqual(ctx.switches, [], "the current session is compacted in place, never switched");
	// the panel is hidden meanwhile, so progress goes to pi's own footer and is cleared afterwards
	assert.ok(isSpinnerStart(ctx.statuses[0], EXTENSION_ID, "compacting conversation…"), "spinner starts on pi's footer");
	assert.deepEqual(ctx.statuses.at(-1), [EXTENSION_ID, undefined], "status is cleared when done");

	// custom instructions travel through to ctx.compact
	assert.equal(await compactSession(ctx.ctx, s.file, "focus on the API changes"), "compacted");
	assert.deepEqual(ctx.compacts, [undefined, "focus on the API changes"]);
});

test("compactSession: a failed compaction rejects and still clears the footer", async (t) => {
	const dir = tempDir(t);
	const s = makeSession(dir);
	const failing = fakeCtx(SessionManager.open(s.file), { compactError: "No model available for summarization" });

	await assert.rejects(compactSession(failing.ctx, s.file), /No model available/);
	assert.deepEqual(failing.statuses.at(-1), [EXTENSION_ID, undefined], "the spinner is cleared even on failure");
});

test("compactSession in another session: switch first, then compact with the replacement context", async (t) => {
	const dir = tempDir(t);
	const s = makeSession(dir);
	const other = makeSession(mkdtempSync(join(dir, "other-")));
	const ctx = fakeCtx(SessionManager.open(s.file));

	// switch into the other session (that is what "enter the conversation" means), then compact it there
	assert.equal(await compactSession(ctx.ctx, other.file, "keep it short"), "switched");
	assert.deepEqual(ctx.switches, [{ file: other.file, withSession: true }]);
	assert.deepEqual(ctx.nextCompacts, ["keep it short"], "compaction runs on the replacement ctx");
	assert.deepEqual(ctx.compacts, [], "the stale pre-switch ctx must not be used");
	// the panel is gone after the switch, so the spinner goes to the replacement ctx's footer
	assert.ok(isSpinnerStart(ctx.statuses[0], `next:${EXTENSION_ID}`, "compacting conversation…"));
	assert.deepEqual(ctx.statuses.at(-1), [`next:${EXTENSION_ID}`, undefined]);

	// a missing file is rejected before pi tears anything down
	await assert.rejects(compactSession(ctx.ctx, join(dir, "missing.jsonl")), /session file not found/);
	assert.equal(ctx.switches.length, 1);

	// compaction failing after the switch is reported in the new session, and the outcome is the switch that did happen
	const failing = fakeCtx(SessionManager.open(s.file), { nextCompactError: "boom" });
	assert.equal(await compactSession(failing.ctx, other.file), "switched");
	assert.deepEqual(failing.notifies, [["compact failed: boom", "error"]]);
	assert.deepEqual(failing.statuses.at(-1), [`next:${EXTENSION_ID}`, undefined]);
});

/** A `trash` command that certainly does not exist, so the tests never touch the real system trash. */
const NO_TRASH = { trashCommand: "lazy-panel-no-such-trash-command" };

test("deleteSession: refuses the current session, falls back to unlink when trash is unavailable, reports missing files", async (t) => {
	const dir = tempDir(t);
	const s = makeSession(dir);
	const other = makeSession(mkdtempSync(join(dir, "other-")));
	const ctx = { sessionManager: SessionManager.open(s.file) };

	// the session pi has open is never deleted (pi's /resume wording)
	await assert.rejects(deleteSession(ctx, s.file, NO_TRASH), new RegExp(CURRENT_SESSION_DELETE_ERROR));
	assert.ok(existsSync(s.file));

	// trash cannot be spawned → unlink, and the caller learns which one did it
	assert.equal(await deleteSession(ctx, other.file, NO_TRASH), "unlink");
	assert.equal(existsSync(other.file), false);

	// gone already: reported, nothing thrown from unlink
	await assert.rejects(deleteSession(ctx, other.file, NO_TRASH), /session file not found/);
	await assert.rejects(deleteSession(ctx, join(dir, "missing.jsonl"), NO_TRASH), /session file not found/);
});

test("deleteSession: a trash command that removes the file counts as trash", async (t) => {
	const dir = tempDir(t);
	const s = makeSession(dir);
	const other = makeSession(mkdtempSync(join(dir, "other-")));
	const ctx = { sessionManager: SessionManager.open(s.file) };
	// `node -e` stands in for the trash CLI: it deletes its argument like a real one would move it away
	const fake = join(dir, "fake-trash.js");
	const { writeFileSync } = await import("node:fs");
	writeFileSync(fake, "require('node:fs').unlinkSync(process.argv[2]);\n");
	// spawnSync 直接找命令名：用一个包装脚本把 node 和脚本路径拼起来（Windows 上是 .cmd）
	const wrapper = process.platform === "win32" ? join(dir, "trash.cmd") : join(dir, "trash");
	writeFileSync(
		wrapper,
		process.platform === "win32" ? `@"${process.execPath}" "${fake}" %*\r\n` : `#!/bin/sh\nexec "${process.execPath}" "${fake}" "$@"\n`,
		{ mode: 0o755 },
	);
	assert.equal(await deleteSession(ctx, other.file, { trashCommand: wrapper }), "trash");
	assert.equal(existsSync(other.file), false);
});

test("renameSession: pi.setSessionName for the current session, a session_info entry in the file for others, empty clears", async (t) => {
	const dir = tempDir(t);
	const s = makeSession(dir);
	const other = makeSession(mkdtempSync(join(dir, "other-")));
	const names: string[] = [];
	const pi = { setSessionName: (name: string) => void names.push(name) };
	const ctx = { sessionManager: SessionManager.open(s.file) };

	// current session: pi keeps its in-memory manager in sync itself
	await renameSession(pi, ctx, s.file, "  Refactor auth  ");
	assert.deepEqual(names, ["Refactor auth"]);
	assert.equal(SessionManager.open(s.file).getSessionName(), undefined, "the file is pi's job for the current session");

	// other session: appended to its file, visible to the next open
	await renameSession(pi, ctx, other.file, "Notes");
	assert.equal(SessionManager.open(other.file).getSessionName(), "Notes");
	assert.deepEqual(names, ["Refactor auth"]);
	// empty clears the name (pi's getSessionName treats an empty session_info as none)
	await renameSession(pi, ctx, other.file, "   ");
	assert.equal(SessionManager.open(other.file).getSessionName(), undefined);
	await renameSession(pi, ctx, s.file, "");
	assert.deepEqual(names, ["Refactor auth", ""]);

	await assert.rejects(renameSession(pi, ctx, join(dir, "missing.jsonl"), "x"), /session file not found/);
});

test("loadForkPoints: every user message in the file, in order, collapsed to one line (what /fork's selector lists)", async (t) => {
	const dir = tempDir(t);
	const manager = SessionManager.create(dir, dir);
	const u1 = manager.appendMessage(userMessage("first  question\nsecond line", 1));
	manager.appendMessage(assistantMessage("an answer", 2));
	const u2 = manager.appendMessage(userMessage("follow up", 3));
	manager.appendMessage(assistantMessage("another answer", 4));
	const file = manager.getSessionFile();
	assert.ok(file);

	assert.deepEqual(await loadForkPoints(file), [
		{ entryId: u1, text: "first question second line" },
		{ entryId: u2, text: "follow up" },
	]);

	// a session with no user messages has nothing to fork from
	const empty = SessionManager.create(mkdtempSync(join(dir, "empty-")), dir);
	empty.appendMessage(assistantMessage("system talking to itself", 1));
	const emptyFile = empty.getSessionFile();
	assert.ok(emptyFile);
	assert.deepEqual(await loadForkPoints(emptyFile), []);
});

test("loadLastReply: text of the last assistant message on the active branch (undefined when there is none)", async (t) => {
	const dir = tempDir(t);
	const s = makeSession(dir);
	assert.equal(await loadLastReply(s.file), "hi");

	// no assistant message yet
	const bare = SessionManager.create(mkdtempSync(join(dir, "bare-")), dir);
	bare.appendMessage(userMessage("hello?", 1));
	const bareFile = bare.getSessionFile();
	assert.ok(bareFile);
	assert.equal(await loadLastReply(bareFile), undefined);

	// follows the active branch: after branching from u1, the alt reply is the last one
	const m = SessionManager.open(s.file);
	m.branch(s.u1);
	m.appendMessage(assistantMessage("alternative reply", 5));
	assert.equal(await loadLastReply(s.file), "alternative reply");
});

test("loadLastReply copies what pi's /copy copies: only the text parts, aborted empty replies skipped", async (t) => {
	const dir = tempDir(t);
	const manager = SessionManager.create(dir, dir);
	manager.appendMessage(userMessage("q", 1));
	manager.appendMessage(assistantMessage("earlier answer", 2));
	// an aborted reply with no content is skipped (pi's getLastAssistantText)
	manager.appendMessage({ ...(assistantMessage("", 3) as object), content: [], stopReason: "aborted" } as unknown as AnyMessage);
	const file = manager.getSessionFile();
	assert.ok(file);
	assert.equal(await loadLastReply(file), "earlier answer");

	// text parts are joined as-is (tool calls and thinking are not copied), then trimmed
	manager.appendMessage({
		...(assistantMessage("", 4) as object),
		content: [
			{ type: "thinking", thinking: "hmm" },
			{ type: "text", text: " Part one." },
			{ type: "toolCall", id: "t1", name: "bash", arguments: { command: "ls" } },
			{ type: "text", text: " Part two. " },
		],
	} as unknown as AnyMessage);
	assert.equal(await loadLastReply(file), "Part one. Part two.");

	// the last reply holding only a tool call has no text: nothing to copy (pi does not fall back further)
	manager.appendMessage({
		...(assistantMessage("", 5) as object),
		content: [{ type: "toolCall", id: "t2", name: "bash", arguments: { command: "pwd" } }],
		stopReason: "toolUse",
	} as unknown as AnyMessage);
	assert.equal(await loadLastReply(file), undefined);
});

test("loadForkPoints lists only user messages that have text (pi's selector skips image-only ones)", async (t) => {
	const dir = tempDir(t);
	const manager = SessionManager.create(dir, dir);
	manager.appendMessage({ role: "user", content: [{ type: "image", data: "", mimeType: "image/png" }], timestamp: 1 } as unknown as AnyMessage);
	const u2 = manager.appendMessage({
		role: "user",
		content: [{ type: "image", data: "", mimeType: "image/png" }, { type: "text", text: "what is this?" }],
		timestamp: 2,
	} as unknown as AnyMessage);
	manager.appendMessage(assistantMessage("a cat", 3));
	const file = manager.getSessionFile();
	assert.ok(file);
	assert.deepEqual(await loadForkPoints(file), [{ entryId: u2, text: "what is this?" }]);
});

test("newSession: appends the trimmed name only when non-empty, otherwise no setup", async (t) => {
	const dir = tempDir(t);
	const s = makeSession(dir);
	const ctx = fakeCtx(SessionManager.open(s.file));

	assert.equal(await newSession(ctx.ctx, "  My chat  "), "switched");
	assert.equal(await newSession(ctx.ctx, "   "), "switched");
	assert.deepEqual(ctx.newSessions, [
		{ hadSetup: true, appended: ["My chat"] },
		{ hadSetup: false, appended: [] },
	]);

	const cancelling = fakeCtx(SessionManager.open(s.file), { cancelNew: true });
	await assert.rejects(newSession(cancelling.ctx, "x"), /cancelled/);
});

test("forkSession: current session forks before the entry in place; other sessions switch first and fork on the new ctx", async (t) => {
	const dir = tempDir(t);
	const s = makeSession(dir);
	const other = makeSession(mkdtempSync(join(dir, "other-")));

	// current session: fork in place (pi's own fork wrapper puts the prompt back into the editor)
	const current = fakeCtx(SessionManager.open(s.file));
	assert.equal(await forkSession(current.ctx, s.file, s.u1), "switched");
	assert.deepEqual(current.forks, [{ entryId: s.u1, position: "before" }]);
	assert.deepEqual(current.switches, []);

	// other session: switch first, then fork on the replacement ctx
	const cross = fakeCtx(SessionManager.open(s.file));
	assert.equal(await forkSession(cross.ctx, other.file, other.u1), "switched");
	assert.deepEqual(cross.switches, [{ file: other.file, withSession: true }]);
	assert.deepEqual(cross.nextForks, [{ entryId: other.u1, position: "before" }]);
	assert.deepEqual(cross.forks, [], "the stale pre-switch ctx must not fork");

	// pi / an extension cancelling the fork surfaces as an error (current session, panel still up)
	const cancelling = fakeCtx(SessionManager.open(s.file), { cancelFork: true });
	await assert.rejects(forkSession(cancelling.ctx, s.file, s.u1), /cancelled/);
});

test("forkSession / cloneSession refuse up front what pi's fork would throw on (pi exits the process on those)", async (t) => {
	const dir = tempDir(t);
	const s = makeSession(dir);
	const other = makeSession(mkdtempSync(join(dir, "other-")));
	const ctx = fakeCtx(SessionManager.open(s.file));

	// unknown entry, in the current session and in another one
	await assert.rejects(forkSession(ctx.ctx, s.file, "nope"), /not found/);
	await assert.rejects(forkSession(ctx.ctx, other.file, "nope"), /not found/);
	// "before" only works on a user message (pi: "Invalid entry ID for forking")
	await assert.rejects(forkSession(ctx.ctx, s.file, s.a1), /user message/);
	await assert.rejects(forkSession(ctx.ctx, other.file, other.a1), /user message/);
	// a file that is gone
	await assert.rejects(forkSession(ctx.ctx, join(dir, "missing.jsonl"), s.u1), /session file not found/);
	await assert.rejects(cloneSession(ctx.ctx, join(dir, "missing.jsonl")), /session file not found/);

	// a session whose working directory no longer exists (the fork would be re-created there)
	const gone = SessionManager.create(join(dir, "deleted-project"), mkdtempSync(join(dir, "gone-")));
	const gu1 = gone.appendMessage(userMessage("hello", 1));
	gone.appendMessage(assistantMessage("hi", 2));
	const goneFile = gone.getSessionFile();
	assert.ok(goneFile);
	await assert.rejects(forkSession(ctx.ctx, goneFile, gu1), /folder no longer exists/);
	await assert.rejects(cloneSession(ctx.ctx, goneFile), /folder no longer exists/);

	// none of the refusals reached pi
	assert.deepEqual(ctx.forks, []);
	assert.deepEqual(ctx.switches, []);
});

test("cloneSession: forks the active leaf with position 'at', switching first for other sessions", async (t) => {
	const dir = tempDir(t);
	const s = makeSession(dir);
	const other = makeSession(mkdtempSync(join(dir, "other-")));

	// current session: clone the active branch (leaf = the label entry)
	const current = fakeCtx(SessionManager.open(s.file));
	assert.equal(await cloneSession(current.ctx, s.file), "switched");
	assert.deepEqual(current.forks, [{ entryId: s.labelId, position: "at" }]);

	// other session: switch first, then clone on the replacement ctx
	const cross = fakeCtx(SessionManager.open(s.file));
	assert.equal(await cloneSession(cross.ctx, other.file), "switched");
	assert.deepEqual(cross.switches, [{ file: other.file, withSession: true }]);
	assert.deepEqual(cross.nextForks, [{ entryId: other.labelId, position: "at" }]);

	// a session with no entries yet has no leaf to clone
	const empty = SessionManager.create(mkdtempSync(join(dir, "empty-")), dir);
	const emptyFile = empty.getSessionFile();
	assert.ok(emptyFile);
	const bare = fakeCtx(empty); // its own manager, so isCurrentSession is true and we read its (null) leaf
	await assert.rejects(cloneSession(bare.ctx, emptyFile), /nothing to clone/);
});

/** Lines of a JSONL file, parsed. */
function readJsonl(file: string): Array<Record<string, unknown>> {
	return readFileSync(file, "utf-8")
		.split("\n")
		.filter((line) => line.trim())
		.map((line) => JSON.parse(line) as Record<string, unknown>);
}

/**
 * A stand-in program run as `node <script> <mode>`: the tests hand it to the
 * actions as a CommandSpec, so no shell / .cmd wrapper is needed on Windows.
 */
function fakeProgram(dir: string, name: string, source: string, mode = ""): CommandSpec {
	const script = join(dir, `${name}.cjs`);
	writeFileSync(script, source);
	return { command: process.execPath, args: mode ? [script, mode] : [script, "ok"] };
}

/** Fake `pi --export <file> <out>`: writes the arguments into <out>; mode "fail" exits like pi does on an error. */
const FAKE_PI = `const [mode, flag, file, out] = process.argv.slice(2);
if (mode === "fail") { console.error("Error: File not found: " + file); process.exit(1); }
require("node:fs").writeFileSync(out, "<html>" + JSON.stringify([flag, file]) + "</html>");
console.log("Exported to: " + out);
`;

/** Fake gh: mode "logged-out" fails auth, "gist-fail" fails creating the gist; otherwise prints a gist URL. */
const FAKE_GH = `const [mode, ...args] = process.argv.slice(2);
const fs = require("node:fs");
if (args[0] === "auth") process.exit(mode === "logged-out" ? 1 : 0);
if (args[0] === "gist") {
	if (mode === "gist-fail") { console.error("HTTP 401: Bad credentials"); process.exit(1); }
	const file = args[args.length - 1];
	fs.writeFileSync(process.env.LAZY_PANEL_GH_LOG, JSON.stringify({ args, html: fs.readFileSync(file, "utf-8") }));
	console.error("- Creating gist session.html");
	console.log("https://gist.github.com/someone/abc123def");
	process.exit(0);
}
process.exit(2);
`;

test("paths: quotes stripped, ~ expanded on every platform, relative paths resolved against the cwd", () => {
	assert.equal(stripQuotes('"C:\\My Files\\a.jsonl"'), "C:\\My Files\\a.jsonl");
	assert.equal(stripQuotes("'a b'"), "a b");
	assert.equal(stripQuotes('"unbalanced'), '"unbalanced');
	assert.equal(expandHome("~"), homedir());
	assert.equal(expandHome("~/x/y.html"), join(homedir(), "x/y.html"));
	assert.equal(expandHome("~\\x"), join(homedir(), "x"));
	assert.equal(expandHome("a~/b"), "a~/b");
	const cwd = join(tmpdir(), "work");
	assert.equal(resolveUserPath(cwd, "  out/a.html "), join(cwd, "out", "a.html"));
	assert.equal(resolveUserPath(cwd, "~/a.jsonl"), join(homedir(), "a.jsonl"));
	assert.equal(resolveUserPath(cwd, "   "), "");
});

test("exportTarget: blank = pi's default name in the cwd, folders get the default name inside, existing files are flagged", (t) => {
	const dir = tempDir(t);
	const file = join(dir, "2026-09-23T10-00-00-000Z_abc.jsonl");
	const html = `pi-session-${basename(file, ".jsonl")}.html`;
	assert.equal(defaultExportName(file, "html"), html);
	assert.equal(defaultExportName(file, "jsonl", new Date("2026-09-23T10:20:30.456Z")), "session-2026-09-23T10-20-30-456Z.jsonl");

	assert.deepEqual(exportTarget(dir, file, "html", ""), { path: join(dir, html), exists: false });
	// an existing folder, and a not-yet-existing one typed with a trailing separator
	mkdirSync(join(dir, "out"));
	assert.equal(exportTarget(dir, file, "html", "out").path, join(dir, "out", html));
	assert.equal(exportTarget(dir, file, "html", "new-folder/").path, join(dir, "new-folder", html));
	// a plain file path is taken as is; an existing one is flagged so the panel asks before overwriting
	assert.deepEqual(exportTarget(dir, file, "jsonl", "copy.jsonl"), { path: join(dir, "copy.jsonl"), exists: false });
	writeFileSync(join(dir, "copy.jsonl"), "x");
	assert.equal(exportTarget(dir, file, "jsonl", '"copy.jsonl"').exists, true);
});

test("exportSession jsonl: a fresh header plus the active branch re-chained; the open session uses pi's in-memory leaf", async (t) => {
	const dir = tempDir(t);
	const s = makeSession(dir);
	const other = makeSession(mkdtempSync(join(dir, "other-")));
	const ctx = { sessionManager: SessionManager.open(s.file) };

	// another session: read from its file (u1 → a1 → label)
	const out = join(dir, "exports", "other.jsonl");
	assert.equal(await exportSession(ctx, other.file, "jsonl", out), out);
	const lines = readJsonl(out);
	assert.equal(lines[0]?.type, "session");
	assert.equal(lines[0]?.id, SessionManager.open(other.file).getSessionId());
	assert.deepEqual(
		lines.slice(1).map((l) => [l.id, l.parentId]),
		[
			[other.u1, null],
			[other.a1, other.u1],
			[other.labelId, other.a1],
		],
	);

	// the open session: pi moved its leaf back to u1 in memory only; the export follows memory, not the file
	const live = SessionManager.open(s.file);
	live.branch(s.u1);
	const liveOut = join(dir, "live.jsonl");
	await exportSession({ sessionManager: live }, s.file, "jsonl", liveOut);
	assert.deepEqual(
		readJsonl(liveOut)
			.slice(1)
			.map((l) => l.id),
		[s.u1],
	);

	await assert.rejects(exportSession(ctx, other.file, "jsonl", other.file), /session file itself/);
	await assert.rejects(exportSession(ctx, join(dir, "missing.jsonl"), "jsonl", join(dir, "x.jsonl")), /session file not found/);
});

test("exportSession html: runs `pi --export <file> <out>` (creating the folder) and reports pi's error", async (t) => {
	const dir = tempDir(t);
	const s = makeSession(dir);
	const ctx = { sessionManager: SessionManager.open(s.file) };
	const out = join(dir, "nested", "folder", "s.html");
	await exportSession(ctx, s.file, "html", out, { pi: fakeProgram(dir, "pi", FAKE_PI) });
	assert.equal(readFileSync(out, "utf-8"), `<html>${JSON.stringify(["--export", s.file])}</html>`);

	await assert.rejects(
		exportSession(ctx, s.file, "html", join(dir, "y.html"), { pi: fakeProgram(dir, "pi-fail", FAKE_PI, "fail") }),
		/^Error: File not found: /,
	);
	await assert.rejects(
		exportSession(ctx, s.file, "html", join(dir, "z.html"), { pi: { command: "lazy-panel-no-such-pi", args: [] } }),
		/cannot run pi --export/,
	);
});

test("importSession: copies into the session folder (renaming on clashes) and switches to the copy", async (t) => {
	const dir = tempDir(t);
	const s = makeSession(dir);
	const source = makeSession(mkdtempSync(join(dir, "elsewhere-")));
	const fake = fakeCtx(SessionManager.open(s.file));
	const ctx = { ...fake.ctx, cwd: dir } as unknown as ImportContext;

	const dest = join(dir, basename(source.file));
	assert.equal(await importSession(ctx, source.file), "switched");
	assert.deepEqual(fake.switches, [{ file: dest, withSession: false }]);
	assert.equal(readFileSync(dest, "utf-8"), readFileSync(source.file, "utf-8"));

	// importing the same file again: pi's "-1" suffix instead of overwriting the first copy
	await importSession(ctx, source.file);
	const renamed = join(dir, `${basename(source.file, ".jsonl")}-1.jsonl`);
	assert.equal(fake.switches[1]?.file, renamed);
	assert.ok(existsSync(renamed));

	// a file already in the session folder is switched to in place, not copied
	const before = readdirSync(dir).length;
	await importSession(ctx, dest);
	assert.equal(fake.switches[2]?.file, dest);
	assert.equal(readdirSync(dir).length, before);
});

test("importSession: bad input is refused before pi is touched, and a copy is removed when the switch does not happen", async (t) => {
	const dir = tempDir(t);
	const s = makeSession(dir);
	const outside = mkdtempSync(join(dir, "outside-"));
	const fake = fakeCtx(SessionManager.open(s.file));
	const ctx = { ...fake.ctx, cwd: outside } as unknown as ImportContext;
	const filesBefore = readdirSync(dir).sort();

	await assert.rejects(importSession(ctx, "  "), /no file given/);
	await assert.rejects(importSession(ctx, "missing.jsonl"), /file not found: .*missing\.jsonl/);
	await assert.rejects(importSession(ctx, outside), /not a file/);
	writeFileSync(join(outside, "empty.jsonl"), "");
	await assert.rejects(importSession(ctx, "empty.jsonl"), /empty/);
	// not a pi session: SessionManager.open refuses it, the copy is cleaned up, pi never switches
	writeFileSync(join(outside, "notes.jsonl"), "hello\nworld\n");
	await assert.rejects(importSession(ctx, "notes.jsonl"), /not a valid/);
	assert.deepEqual(fake.switches, []);
	assert.deepEqual(readdirSync(dir).sort(), filesBefore);

	// the switch is cancelled (an extension vetoed it): the copy goes away too
	const source = makeSession(mkdtempSync(join(outside, "src-")));
	const cancelling = fakeCtx(SessionManager.open(s.file), { cancelSwitch: true });
	await assert.rejects(importSession({ ...cancelling.ctx, cwd: outside } as unknown as ImportContext, source.file), /cancelled/);
	assert.equal(existsSync(join(dir, basename(source.file))), false);
});

test("shareSession: gh auth check, HTML via pi --export, a secret gist, and pi's viewer link", async (t) => {
	const dir = tempDir(t);
	const s = makeSession(dir);
	const log = join(dir, "gh-log.json");
	process.env.LAZY_PANEL_GH_LOG = log;
	t.after(() => delete process.env.LAZY_PANEL_GH_LOG);
	const pi = fakeProgram(dir, "pi", FAKE_PI);

	const result = await shareSession(s.file, { pi, gh: fakeProgram(dir, "gh", FAKE_GH) });
	assert.deepEqual(result, { url: shareViewerUrl("abc123def"), gistUrl: "https://gist.github.com/someone/abc123def" });
	assert.equal(result.url, `${process.env.PI_SHARE_VIEWER_URL || "https://pi.dev/session/"}#abc123def`);
	const call = JSON.parse(readFileSync(log, "utf-8")) as { args: string[]; html: string };
	assert.deepEqual(call.args.slice(0, 3), ["gist", "create", "--public=false"]);
	assert.equal(basename(call.args[3] ?? ""), "session.html");
	assert.match(call.html, /--export/);
	// the temporary HTML is gone afterwards
	assert.equal(existsSync(call.args[3] ?? ""), false);

	const message = (expected: string) => (err: Error) => err.message === expected;
	await assert.rejects(shareSession(s.file, { pi, gh: fakeProgram(dir, "gh-out", FAKE_GH, "logged-out") }), message(GH_NOT_LOGGED_IN));
	await assert.rejects(shareSession(s.file, { pi, gh: { command: "lazy-panel-no-such-gh", args: [] } }), message(GH_NOT_INSTALLED));
	await assert.rejects(
		shareSession(s.file, { pi, gh: fakeProgram(dir, "gh-fail", FAKE_GH, "gist-fail") }),
		/Failed to create gist: HTTP 401: Bad credentials/,
	);
	await assert.rejects(shareSession(join(dir, "missing.jsonl"), { pi }), /session file not found/);
});
