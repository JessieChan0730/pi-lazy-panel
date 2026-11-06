import assert from "node:assert/strict";
import { resolve, sep } from "node:path";
import { test } from "node:test";
import type { Theme } from "@earendil-works/pi-coding-agent";
import { initI18n } from "../../../src/i18n/index.ts";
import type { SessionRow } from "../../../src/types.ts";
import { ArchiveDialog } from "../../../src/ui/widgets/archive-dialog.ts";

initI18n("en");

const theme = {
	fg: (_color: string, text: string) => text,
	bg: (_color: string, text: string) => text,
	bold: (text: string) => text,
} as unknown as Theme;

function row(id: string, cwd: string): SessionRow {
	return { file: resolve("fixtures", `${id}.jsonl`), id, cwd, preview: id, createdAt: 0, updatedAt: 0, messageCount: 1 };
}

function dialog(rows: SessionRow[], currentProject: string): ArchiveDialog {
	const box = new ArchiveDialog({ theme, onChange: () => {} });
	box.open({ rows, currentProject, onRestore: () => {}, onDelete: () => {}, onProjectMenu: () => {}, onClose: () => {} });
	return box;
}

test("archive project filters and menu choices use platform-aware path identity", () => {
	const project = resolve("fixtures", "CaseProject");
	const differentCase = project.toUpperCase();
	const other = resolve("fixtures", "OtherProject");
	const box = dialog([row("a", project), row("b", differentCase), row("c", other)], project);
	const windows = process.platform === "win32";
	assert.deepEqual(box.rows.map((item) => item.id), windows ? ["a", "b"] : ["a"]);
	assert.equal(box.projects.length, windows ? 2 : 3, "Windows case variants must not create duplicate projects");
	assert.equal(box.projectChoices.length, windows ? 3 : 4, "the menu must not repeat the current project");
	assert.equal(box.projectChoices[0]!.value, project, "keep the original path spelling for display");
	box.setProject(differentCase);
	assert.deepEqual(box.rows.map((item) => item.id), windows ? ["a", "b"] : ["b"]);
	box.setProject(undefined);
	assert.equal(box.rows.length, 3, "the all-projects choice still includes every row");
});

test("archive project identity resolves relative paths and dot segments on every platform", () => {
	const relative = "fixtures/CaseProject";
	const absolute = resolve(relative);
	const dotted = `${absolute}${sep}subdir${sep}..`;
	const box = dialog([row("a", relative), row("b", absolute), row("c", dotted)], absolute);
	assert.deepEqual(box.rows.map((item) => item.id), ["a", "b", "c"]);
	assert.deepEqual(box.projects, [relative]);
	assert.equal(box.projectChoices.length, 2, "only current project and all projects are needed");
});
