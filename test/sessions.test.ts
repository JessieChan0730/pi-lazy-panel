/**
 * `findSessionIndex`: locating pi's current session in the listed rows. Paths
 * are compared after `path.resolve`, so a relative / differently-spelled path
 * still matches the row's absolute file.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import path from "node:path";
import { findSessionIndex } from "../src/data/sessions.ts";
import type { SessionRow } from "../src/types.ts";

function row(file: string): SessionRow {
	return { file, id: file, cwd: "/w", preview: "", createdAt: 0, updatedAt: 0, messageCount: 1 };
}

test("findSessionIndex compares resolved paths and returns -1 when absent", () => {
	const a = path.resolve("sessions", "a.jsonl");
	const b = path.resolve("sessions", "b.jsonl");
	const rows = [row(a), row(b)];
	assert.equal(findSessionIndex(rows, b), 1);
	assert.equal(findSessionIndex(rows, path.join("sessions", "..", "sessions", "a.jsonl")), 0);
	assert.equal(findSessionIndex(rows, path.resolve("sessions", "c.jsonl")), -1);
	assert.equal(findSessionIndex(rows, undefined), -1);
	assert.equal(findSessionIndex([], a), -1);
});

test("sortSessions: recent / created by time, title sorts by shown title (name or preview) A–Z, threaded nests forks", async () => {
	const { sortSessions } = await import("../src/data/sessions.ts");
	const r = (file: string, over: Partial<SessionRow>): SessionRow => ({ ...row(file), ...over });
	const rows = [
		r("a", { createdAt: 1, updatedAt: 40, name: "zeta" }),
		r("b", { createdAt: 4, updatedAt: 10, preview: "Hi" }),
		r("c", { createdAt: 2, updatedAt: 30, name: "Alpha" }),
		r("d", { createdAt: 3, updatedAt: 20, parentFile: "a", name: "beta" }),
		r("e", { createdAt: 5, updatedAt: 5 }),
		r("f", { createdAt: 6, updatedAt: 6, name: "会话" }),
	];
	const files = (out: SessionRow[]) => out.map((s) => s.file);
	assert.deepEqual(files(sortSessions(rows, "recent")), ["a", "c", "d", "b", "f", "e"]);
	assert.deepEqual(files(sortSessions(rows, "created")), ["f", "e", "b", "d", "c", "a"]);
	// sorted by the title the pane shows: the unnamed "Hi" row sorts by its preview,
	// not dumped after the named ones; English (ASCII) titles come before the Chinese
	// one ("会话"); only the truly empty session ("e") is last
	assert.deepEqual(files(sortSessions(rows, "title")), ["c", "d", "b", "a", "f", "e"]);
	// forks sit under their parent (indented), roots by recency
	const threaded = sortSessions(rows, "threaded");
	assert.deepEqual(files(threaded), ["a", "d", "c", "b", "f", "e"]);
	assert.deepEqual(threaded.map((s) => s.threadDepth), [0, 1, 0, 0, 0, 0]);
	// the input is never mutated
	assert.deepEqual(files(rows), ["a", "b", "c", "d", "e", "f"]);
});
