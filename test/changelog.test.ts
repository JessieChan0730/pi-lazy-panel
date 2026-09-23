import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { changelogMarkdown, loadChangelog, NO_CHANGELOG, parseChangelog } from "../src/data/changelog.ts";

const SAMPLE = ["# Changelog", "", "## [Unreleased]", "", "- wip", "", "## [0.2.0] - 2026-09-05", "", "- new", "", "## 0.1.0", "", "- first"].join("\r\n");

test("parseChangelog keeps one entry per versioned ## heading, skipping unversioned sections", () => {
	const entries = parseChangelog(SAMPLE);
	assert.deepEqual(entries, ["## [0.2.0] - 2026-09-05\n\n- new", "## 0.1.0\n\n- first"]);
	assert.ok(!changelogMarkdown(SAMPLE).includes("wip"));
	assert.ok(changelogMarkdown(SAMPLE).startsWith("## [0.2.0]"), "newest first, like the file");
	assert.equal(changelogMarkdown("# nothing"), NO_CHANGELOG);
});

test("loadChangelog reads the file, a missing one reads as no entries", async () => {
	const dir = mkdtempSync(path.join(tmpdir(), "lazy-changelog-"));
	const file = path.join(dir, "CHANGELOG.md");
	writeFileSync(file, SAMPLE);
	assert.ok((await loadChangelog(file)).includes("- first"));
	assert.equal(await loadChangelog(path.join(dir, "missing.md")), NO_CHANGELOG);
});
