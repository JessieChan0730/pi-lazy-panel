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
