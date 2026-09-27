/**
 * The pinned-sessions store (`~/.pi/agent/lazy-panel-pins.json`): load / save
 * round-trips, tolerant parsing, and de-duplication. Uses a temp agent dir.
 * Run with `npm test` (node --test via tsx).
 */

import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { PINS_FILE_NAME } from "../src/constants.ts";
import { loadPins, savePins } from "../src/config/pins.ts";

function tempDir(t: { after: (fn: () => void) => void }): string {
	const dir = mkdtempSync(join(tmpdir(), "lazy-panel-pins-"));
	t.after(() => rmSync(dir, { recursive: true, force: true }));
	return dir;
}

test("loadPins returns [] when the file is missing or broken; savePins round-trips the display order", (t) => {
	const dir = tempDir(t);
	assert.deepEqual(loadPins(dir), [], "missing file → empty");

	savePins(dir, ["/a.jsonl", "/b.jsonl"]);
	assert.deepEqual(loadPins(dir), ["/a.jsonl", "/b.jsonl"], "order is preserved");

	writeFileSync(join(dir, PINS_FILE_NAME), "{ not json");
	assert.deepEqual(loadPins(dir), [], "broken JSON → empty");
});

test("loadPins accepts a bare array and drops non-string / duplicate entries", (t) => {
	const dir = tempDir(t);
	writeFileSync(join(dir, PINS_FILE_NAME), JSON.stringify(["/a.jsonl", "/a.jsonl", 42, "", "/b.jsonl"]));
	assert.deepEqual(loadPins(dir), ["/a.jsonl", "/b.jsonl"]);
});

test("savePins de-duplicates and writes the { pinned } shape", (t) => {
	const dir = tempDir(t);
	savePins(dir, ["/a.jsonl", "/a.jsonl", "/b.jsonl"]);
	const parsed = JSON.parse(readFileSync(join(dir, PINS_FILE_NAME), "utf8")) as { pinned: string[] };
	assert.deepEqual(parsed.pinned, ["/a.jsonl", "/b.jsonl"]);
});
