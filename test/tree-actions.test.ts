/**
 * Tree actions against a real session file in a temp directory:
 * `loadNodeText` (what `y` copies) and `labelNode` (what `T` persists).
 * Run with `npm test` (node --test via tsx).
 */

import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { labelNode } from "../src/actions/tree-actions.ts";
import { applyTreeFilter, effectiveLeafIds, loadNodeText, loadTree } from "../src/data/tree.ts";
import { treePrefixes } from "../src/ui/tree-lines.ts";

type AnyMessage = Parameters<SessionManager["appendMessage"]>[0];

/** Create a persisted session with one user and one assistant message; returns file + entry ids. */
function makeSession(dir: string) {
	const manager = SessionManager.create(dir, dir);
	const userId = manager.appendMessage({
		role: "user",
		content: [{ type: "text", text: "hello " }, { type: "image", data: "", mimeType: "image/png" }, { type: "text", text: "world" }],
		timestamp: 1,
	} as unknown as AnyMessage);
	const assistantId = manager.appendMessage({
		role: "assistant",
		content: [{ type: "thinking", thinking: "hmm" }, { type: "text", text: "Hi there\n\nsecond paragraph" }],
		api: "x",
		provider: "x",
		model: "x",
		usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
		stopReason: "stop",
		timestamp: 2,
	} as unknown as AnyMessage);
	const errorId = manager.appendMessage({
		role: "assistant",
		content: [],
		api: "x",
		provider: "x",
		model: "x",
		usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
		stopReason: "error",
		errorMessage: "rate limited",
		timestamp: 3,
	} as unknown as AnyMessage);
	const file = manager.getSessionFile();
	assert.ok(file);
	return { file, userId, assistantId, errorId };
}

test("loadNodeText copies the full text like /tree ctrl+x", (t) => {
	const dir = mkdtempSync(join(tmpdir(), "lazy-panel-"));
	t.after(() => rmSync(dir, { recursive: true, force: true }));
	const s = makeSession(dir);
	// text parts are concatenated verbatim, images are skipped
	assert.equal(loadNodeText(s.file, s.userId), "hello world");
	// thinking is not copied; newlines inside the text are preserved
	assert.equal(loadNodeText(s.file, s.assistantId), "Hi there\n\nsecond paragraph");
	// an assistant message without text falls back to its error message
	assert.equal(loadNodeText(s.file, s.errorId), "rate limited");
	assert.equal(loadNodeText(s.file, "nope"), undefined);
});

test("labelNode persists to the file for other sessions and goes through pi.setLabel for the current one", async (t) => {
	const dir = mkdtempSync(join(tmpdir(), "lazy-panel-"));
	t.after(() => rmSync(dir, { recursive: true, force: true }));
	const s = makeSession(dir);
	const piCalls: Array<[string, string | undefined]> = [];
	const pi = { setLabel: (id: string, label: string | undefined) => void piCalls.push([id, label]) };

	// another session file → append a label entry to that file
	const other = { sessionManager: { getSessionFile: () => "/elsewhere.jsonl" } as never };
	await labelNode(pi, other, s.file, s.userId, "  checkpoint ");
	assert.deepEqual(piCalls, []);
	assert.equal(SessionManager.open(s.file).getLabel(s.userId), "checkpoint");
	const rows = await loadTree(s.file);
	assert.equal(rows.find((r) => r.entryId === s.userId)?.label, "checkpoint");
	// empty / whitespace clears it
	await labelNode(pi, other, s.file, s.userId, "   ");
	assert.equal(SessionManager.open(s.file).getLabel(s.userId), undefined);

	// the session pi currently has open → pi.setLabel so pi's in-memory state stays in sync
	const current = { sessionManager: { getSessionFile: () => s.file } as never };
	await labelNode(pi, current, s.file, s.assistantId, "x");
	await labelNode(pi, current, s.file, s.assistantId, "");
	assert.deepEqual(piCalls, [
		[s.assistantId, "x"],
		[s.assistantId, undefined],
	]);
});

test("loadTree marks the rows Enter treats as the leaf (isLeaf), following the label entries pi appends", async (t) => {
	const dir = mkdtempSync(join(tmpdir(), "lazy-panel-"));
	t.after(() => rmSync(dir, { recursive: true, force: true }));
	const s = makeSession(dir);
	const leafOf = async () => (await loadTree(s.file)).filter((r) => r.isLeaf).map((r) => r.entryId);

	// user → assistant → assistant(error): only the raw leaf
	assert.deepEqual(await leafOf(), [s.errorId]);

	// a label on the last message is appended as a new leaf entry; the message still counts as the leaf
	const m = SessionManager.open(s.file);
	const labelId = m.appendLabelChange(s.errorId, "here");
	assert.deepEqual([...effectiveLeafIds(m)], [labelId, s.errorId]);
	assert.deepEqual(await leafOf(), [s.errorId]);

	// a new user message after it moves the leaf on: the raw leaf always counts (pi: "Already at this point"),
	// but a user message that is not the raw leaf never does
	const nextId = m.appendMessage({ role: "user", content: [{ type: "text", text: "next" }], timestamp: 4 } as unknown as AnyMessage);
	assert.deepEqual(await leafOf(), [nextId]);
	m.appendLabelChange(nextId, "after");
	assert.deepEqual(await leafOf(), []);
	// earlier rows stay on the active branch without being the leaf
	const rows = await loadTree(s.file);
	assert.equal(rows.find((r) => r.entryId === s.errorId)?.isLeaf, undefined);
	assert.equal(rows.find((r) => r.entryId === s.errorId)?.onActiveBranch, true);
});

test("loadTree keeps the system prompts branches hang off, so the default filter still draws a tree (real /tree shape)", async (t) => {
	const dir = mkdtempSync(join(tmpdir(), "lazy-panel-"));
	t.after(() => rmSync(dir, { recursive: true, force: true }));
	// pi 的真实结构：model_change → system → user → assistant，restore 回 system 后再继续会追加第二条 system 消息，
	// 分支就挂在 system 节点上。之前 system 归 meta 被默认过滤掉，整棵树会被压平。
	const m = SessionManager.create(dir, dir);
	const modelId = m.appendModelChange("x", "m1");
	const sysId = m.appendMessage({ role: "system", content: "", timestamp: 1 } as unknown as AnyMessage);
	const u1 = m.appendMessage({ role: "user", content: [{ type: "text", text: "hi" }], timestamp: 2 } as unknown as AnyMessage);
	// pi 只在出现第一条 assistant 消息后才把文件写到磁盘，所以第一条分支上要有一条回复。
	const a1 = m.appendMessage({
		role: "assistant",
		content: [{ type: "text", text: "hello" }],
		api: "x",
		provider: "x",
		model: "x",
		usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
		stopReason: "stop",
		timestamp: 3,
	} as unknown as AnyMessage);
	m.branch(sysId);
	const sys2 = m.appendMessage({ role: "system", content: "", timestamp: 4 } as unknown as AnyMessage);
	const u2 = m.appendMessage({ role: "user", content: [{ type: "text", text: "again" }], timestamp: 5 } as unknown as AnyMessage);
	// jump back to a1 with a summary of the abandoned branch: pi hangs the branch_summary under a1
	const bs = m.branchWithSummary(a1, "summary");
	const file = m.getSessionFile()!;

	const all = await loadTree(file);
	const byId = (rows: typeof all, id: string) => rows.find((r) => r.entryId === id)!;
	assert.equal(byId(all, modelId).kind, "meta");
	assert.equal(byId(all, modelId).text, "[model: m1]");
	assert.equal(byId(all, sysId).kind, "system");
	assert.equal(byId(all, sysId).text, "[system]");
	assert.equal(byId(all, bs).text, "[branch summary]: summary");
	assert.equal(byId(all, sysId).parentId, modelId);

	const rows = applyTreeFilter(all, "default");
	assert.deepEqual(
		rows.map((r) => [r.entryId, r.parentId]),
		[
			[sysId, undefined], // model_change dropped → system becomes the root
			[u1, sysId],
			[a1, u1],
			[bs, a1],
			[sys2, sysId],
			[u2, sys2],
		],
	);
	// the branch point is visible: both children of the first system prompt get connectors
	assert.deepEqual(treePrefixes(rows), ["", "├⊟ ", "│     ", "│     ", "└⊟ ", "      "]);
	assert.equal(applyTreeFilter(all, "user-only").length, 2);
});
