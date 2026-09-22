/**
 * Search query parsing and tree-row matching (the tree dialog's live search).
 * Run with `npm test` (node --test via tsx).
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { matchTreeRow, parseSearchQuery, searchTokens } from "../src/data/search.ts";
import type { TreeRow } from "../src/types.ts";

test("parseSearchQuery splits GitHub-style qualifiers from the free text", () => {
	const q = parseSearchQuery("  hello name:FilmRecall model:opus tag:scan path:src after:2026-09-01 before:2026-09-20 world ");
	assert.equal(q.text, "hello world");
	assert.equal(q.name, "FilmRecall");
	assert.equal(q.model, "opus");
	assert.equal(q.tag, "scan");
	assert.equal(q.path, "src");
	assert.deepEqual([q.after?.getFullYear(), q.after?.getMonth(), q.after?.getDate()], [2026, 8, 1]);
	assert.deepEqual([q.before?.getFullYear(), q.before?.getMonth(), q.before?.getDate()], [2026, 8, 20]);
	// unknown keys, empty values and unparsable dates stay free text; the last qualifier wins
	assert.equal(parseSearchQuery("foo:bar tag: after:nope").text, "foo:bar tag: after:nope");
	assert.equal(parseSearchQuery("tag:a tag:b").tag, "b");
	assert.equal(parseSearchQuery("").text, "");
	assert.deepEqual(searchTokens(parseSearchQuery("A  b")), ["a", "b"]);
	assert.deepEqual(searchTokens(parseSearchQuery("tag:x")), []);
});

test("matchTreeRow: every token must appear in label / role / text (case-insensitive); tag / after / before narrow", () => {
	const row: TreeRow = {
		entryId: "e",
		role: "assistant",
		kind: "message",
		text: "Hello World",
		timestamp: new Date(2026, 8, 10, 12).getTime(),
		onActiveBranch: true,
		label: "Ckpt",
	};
	const m = (raw: string, r: TreeRow = row) => matchTreeRow(r, parseSearchQuery(raw));
	assert.ok(m("hello"));
	assert.ok(m("WORLD hel"));
	assert.ok(m("assistant"));
	assert.ok(m("ckpt world"), "labels are searchable like in /tree");
	assert.ok(m(""));
	assert.equal(m("hello bye"), false, "all tokens are required");
	// tag: only looks at the label
	assert.ok(m("tag:ck"));
	assert.equal(m("tag:zz"), false);
	const { label: _label, ...unlabeled } = row;
	assert.equal(m("tag:ck", unlabeled), false);
	assert.ok(m("hello", unlabeled));
	// after / before bound the entry time; session-only qualifiers are ignored
	assert.ok(m("after:2026-09-01 before:2026-09-20"));
	assert.equal(m("after:2026-09-15"), false);
	assert.equal(m("before:2026-09-05"), false);
	assert.ok(m("model:opus path:nowhere hello"));
	// system rows match on their bracket text
	assert.ok(m("branch summary", { ...unlabeled, role: "system", kind: "system", text: "[branch summary]: tried X" }));
});
