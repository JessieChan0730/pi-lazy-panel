/**
 * Enter actions against real session files in a temp directory:
 * `isEffectiveLeaf` (when Enter is a no-op), `resumeSession` (SESSIONS Enter)
 * and `restoreNode` (TREE Enter) with a recording stand-in for pi's command
 * context. Run with `npm test` (node --test via tsx).
 */

import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { resumeSession } from "../src/actions/session-actions.ts";
import { type RestoreContext, restoreNode } from "../src/actions/tree-actions.ts";
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
		ui: {
			notify: (msg: string, level?: string) => void notifies.push([msg, level]),
			setStatus: (key: string, text: string | undefined) => void statuses.push([`next:${key}`, text]),
		},
	};
	const ctx: RestoreContext = {
		sessionManager,
		isIdle: () => idle,
		abort: () => {
			log.push("abort");
			idle = true;
		},
		waitForIdle: async () => void log.push("wait"),
		navigateTree: async (entryId, options) => {
			log.push("navigate");
			navigations.push({ entryId, options });
			return { cancelled: opts.cancelNavigate ?? false };
		},
		switchSession: async (file, options) => {
			log.push("switch");
			switches.push({ file, withSession: options?.withSession !== undefined });
			if (opts.cancelSwitch) return { cancelled: true };
			await options?.withSession?.(next as never);
			return { cancelled: false };
		},
		ui: {
			notify: (msg: string, level?: string) => void notifies.push([`old:${msg}`, level]),
			setStatus: (key: string, text: string | undefined) => void statuses.push([key, text]),
		} as never,
	};
	return { ctx, log, switches, navigations, nextNavigations, notifies, statuses };
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
