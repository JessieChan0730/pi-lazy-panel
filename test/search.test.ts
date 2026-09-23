/**
 * Search query parsing and matching: tree rows (the tree pane and the tree
 * dialog's live search), session rows, content lines and the highlight ranges.
 * Run with `npm test` (node --test via tsx).
 */

import assert from "node:assert/strict";
import { homedir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { findMatchRanges, highlightTerms, matchesTokens, matchSessionRow, matchTreeRow, parseSearchQuery, searchTokens } from "../src/data/search.ts";
import type { SessionRow, TreeRow } from "../src/types.ts";

test("parseSearchQuery splits GitHub-style qualifiers from the free text", () => {
	const q = parseSearchQuery("  hello name:FilmRecall model:opus tag:scan path:src role:user after:2026-09-01 before:2026-09-20 world ");
	assert.equal(q.text, "hello world");
	assert.equal(q.name, "FilmRecall");
	assert.equal(q.model, "opus");
	assert.equal(q.tag, "scan");
	assert.equal(q.path, "src");
	assert.equal(q.role, "user");
	assert.deepEqual([q.after?.getFullYear(), q.after?.getMonth(), q.after?.getDate()], [2026, 8, 1]);
	assert.deepEqual([q.before?.getFullYear(), q.before?.getMonth(), q.before?.getDate()], [2026, 8, 20]);
	// unknown keys, empty values and unparsable dates stay free text; the last qualifier wins
	assert.equal(parseSearchQuery("foo:bar tag: after:nope").text, "foo:bar tag: after:nope");
	assert.equal(parseSearchQuery("tag:a tag:b").tag, "b");
	assert.equal(parseSearchQuery("").text, "");
	assert.deepEqual(searchTokens(parseSearchQuery("A  b")), ["a", "b"]);
	assert.deepEqual(searchTokens(parseSearchQuery("tag:x")), []);
});

test("matchTreeRow: every token must appear in label / text (case-insensitive); tag / role / after / before narrow", () => {
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
	assert.equal(m("assistant"), false, "the role is not searched by a bare word");
	assert.ok(m("ckpt world"), "labels are searchable like in /tree");
	assert.ok(m(""));
	assert.equal(m("hello bye"), false, "all tokens are required");
	// tag: only looks at the label
	assert.ok(m("tag:ck"));
	assert.equal(m("tag:zz"), false);
	const { label: _label, ...unlabeled } = row;
	assert.equal(m("tag:ck", unlabeled), false);
	assert.ok(m("hello", unlabeled));
	// role: only looks at the role
	assert.ok(m("role:assist hello"));
	assert.equal(m("role:user"), false);
	assert.ok(m("role:USER", { ...row, role: "user" }));
	// after / before bound the entry time; session-only qualifiers are ignored
	assert.ok(m("after:2026-09-01 before:2026-09-20"));
	assert.equal(m("after:2026-09-15"), false);
	assert.equal(m("before:2026-09-05"), false);
	assert.ok(m("model:opus path:nowhere hello"));
	// system rows match on their bracket text
	assert.ok(m("branch summary", { ...unlabeled, role: "system", kind: "system", text: "[branch summary]: tried X" }));
});

test("matchSessionRow: tokens over name / preview only; model: path: reach the model / cwd; after / before bound the update; tag: is ignored", () => {
	const s: SessionRow = {
		file: "/tmp/s.jsonl",
		id: "id",
		name: "FilmRecall",
		cwd: "/home/u/code/FilmRecall",
		model: "claude-opus-4",
		preview: "scan the film",
		createdAt: 0,
		updatedAt: new Date(2026, 8, 10, 12).getTime(),
		messageCount: 3,
	};
	const m = (raw: string, r: SessionRow = s) => matchSessionRow(r, parseSearchQuery(raw));
	assert.ok(m("film"));
	assert.ok(m("FILM scan"), "tokens may come from the name and the preview");
	assert.equal(m("film bye"), false, "all tokens are required");
	assert.ok(m(""));
	// the model and the path never match a bare word (a fragment of the home dir or the model id would hit every session)
	assert.equal(m("opus"), false);
	assert.equal(m("code"), false);
	assert.ok(m("name:recall"));
	assert.equal(m("name:scan"), false, "name: does not look at the preview");
	assert.ok(m("model:OPUS"));
	assert.equal(m("model:sonnet"), false);
	assert.ok(m("path:u/code"));
	assert.equal(m("path:docs"), false);
	// path: also understands the ~ form the pane shows
	assert.ok(m("path:~", { ...s, cwd: join(homedir(), "proj") }));
	assert.equal(m("path:~", s), false);
	assert.ok(m("after:2026-09-01 before:2026-09-20"));
	assert.equal(m("after:2026-09-15"), false);
	assert.equal(m("before:2026-09-05"), false);
	assert.ok(m("tag:whatever film"));
	// a session without a name / model never satisfies name: / model:, but its preview still matches
	const { name: _name, model: _model, ...bare } = s;
	assert.equal(m("name:x", bare), false);
	assert.equal(m("model:x", bare), false);
	assert.ok(m("film", bare));
});

test("matchesTokens, highlightTerms and findMatchRanges (content lines and the highlight painter)", () => {
	assert.ok(matchesTokens("Hello World", ["hello", "wor"]));
	assert.equal(matchesTokens("Hello World", ["hello", "bye"]), false);
	assert.ok(matchesTokens("anything", []));
	// the free-text tokens plus the values of the text qualifiers; dates have nothing to paint
	assert.deepEqual(highlightTerms(parseSearchQuery("Foo name:Film model:opus path:src tag:ck role:user after:2026-09-01")), ["foo", "Film", "opus", "src", "ck", "user"]);
	assert.deepEqual(highlightTerms(parseSearchQuery("")), []);
	// every occurrence, case-insensitive, sorted; overlapping / touching ranges are merged
	assert.deepEqual(findMatchRanges("Foo foo FOO", ["foo"]), [
		{ start: 0, end: 3 },
		{ start: 4, end: 7 },
		{ start: 8, end: 11 },
	]);
	assert.deepEqual(findMatchRanges("abcabc", ["ab", "bc"]), [{ start: 0, end: 6 }]);
	assert.deepEqual(findMatchRanges("x a.b x", ["."]), [{ start: 3, end: 4 }], "terms are literal, not regular expressions");
	assert.deepEqual(findMatchRanges("Ünïcode ünïcode", ["ünï"]), [
		{ start: 0, end: 3 },
		{ start: 8, end: 11 },
	]);
	assert.deepEqual(findMatchRanges("abc", [""]), [], "empty terms are skipped");
	assert.deepEqual(findMatchRanges("abc", ["zzz"]), []);
});
