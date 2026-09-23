/**
 * Enter actions against real session files in a temp directory:
 * `isEffectiveLeaf` (when Enter is a no-op), `resumeSession` (SESSIONS Enter)
 * and `restoreNode` (TREE Enter) with a recording stand-in for pi's command
 * context. Run with `npm test` (node --test via tsx).
 */

import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import {
	cloneSession,
	CURRENT_SESSION_DELETE_ERROR,
	deleteSession,
	type ForkContext,
	forkSession,
	type NewSessionContext,
	newSession,
	renameSession,
	resumeSession,
} from "../src/actions/session-actions.ts";
import { type RestoreContext, restoreNode } from "../src/actions/tree-actions.ts";
import { loadForkPoints, loadLastReply } from "../src/data/content.ts";
import { isEffectiveLeaf } from "../src/data/tree.ts";

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
		ui: {
			notify: (msg: string, level?: string) => void notifies.push([`old:${msg}`, level]),
			setStatus: (key: string, text: string | undefined) => void statuses.push([key, text]),
		},
	} as unknown as RestoreContext & NewSessionContext & ForkContext;
	return { ctx, log, switches, navigations, nextNavigations, notifies, statuses, forks, nextForks, newSessions };
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
