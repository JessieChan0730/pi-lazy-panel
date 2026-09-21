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
import { loadNodeText, loadTree } from "../src/data/tree.ts";

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
