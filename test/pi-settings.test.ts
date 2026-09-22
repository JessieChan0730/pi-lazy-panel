/**
 * pi settings the panel reads (`branchSummary.skipPrompt`) through pi's own
 * SettingsManager, against temp agent / project directories.
 * Run with `npm test` (node --test via tsx).
 */

import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { DEFAULT_PI_SETTINGS, loadPiSettings } from "../src/config/pi-settings.ts";

function tempDir(t: { after: (fn: () => void) => void }): string {
	const dir = mkdtempSync(join(tmpdir(), "lazy-panel-settings-"));
	t.after(() => rmSync(dir, { recursive: true, force: true }));
	return dir;
}

test("loadPiSettings reads branchSummary.skipPrompt from the global and project files, defaulting to false", (t) => {
	const dir = tempDir(t);
	const agentDir = join(dir, "agent");
	const cwd = join(dir, "project");
	mkdirSync(agentDir, { recursive: true });
	mkdirSync(cwd, { recursive: true });

	// nothing on disk → pi's defaults
	assert.deepEqual(loadPiSettings(cwd, agentDir), DEFAULT_PI_SETTINGS);
	assert.equal(DEFAULT_PI_SETTINGS.skipBranchSummaryPrompt, false);

	// global file
	writeFileSync(join(agentDir, "settings.json"), JSON.stringify({ branchSummary: { skipPrompt: true } }));
	assert.equal(loadPiSettings(cwd, agentDir).skipBranchSummaryPrompt, true);

	// the project file wins, but only when the project is trusted
	mkdirSync(join(cwd, ".pi"), { recursive: true });
	writeFileSync(join(cwd, ".pi", "settings.json"), JSON.stringify({ branchSummary: { skipPrompt: false } }));
	assert.equal(loadPiSettings(cwd, agentDir, true).skipBranchSummaryPrompt, false);
	assert.equal(loadPiSettings(cwd, agentDir, false).skipBranchSummaryPrompt, true);

	// a broken file never throws: pi's loader keeps the other scope and reports the error elsewhere
	writeFileSync(join(agentDir, "settings.json"), "{ not json");
	assert.equal(loadPiSettings(cwd, agentDir, true).skipBranchSummaryPrompt, false);
});
