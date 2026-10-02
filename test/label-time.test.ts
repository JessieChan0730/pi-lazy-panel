import assert from "node:assert/strict";
import { test } from "node:test";
import type { Theme } from "@earendil-works/pi-coding-agent";
import { stripTerminalSequences, visibleWidth } from "@earendil-works/pi-tui";
import { mergeKeymap } from "../src/config/config.ts";
import { DEFAULT_KEYMAP } from "../src/config/keymap.ts";
import { initI18n } from "../src/i18n/index.ts";
import type { Keymap, TreeRow } from "../src/types.ts";
import { LazyPanel } from "../src/ui/app.ts";
import { renderTreeRow } from "../src/ui/panes/tree-pane.ts";
import { formatShortDate } from "../src/utils/format.ts";

initI18n("en");

const theme = {
	fg: (_color: string, text: string) => text,
	bg: (_color: string, text: string) => text,
	bold: (text: string) => text,
	italic: (text: string) => text,
	underline: (text: string) => text,
	inverse: (text: string) => text,
	strikethrough: (text: string) => text,
} as unknown as Theme;
const labelTimestamp = new Date(2026, 9, 2, 14, 35).getTime();

function treeRow(): TreeRow {
	return {
		entryId: "entry", role: "user", kind: "message", text: "message body",
		timestamp: new Date(2026, 9, 2, 13, 20).getTime(), onActiveBranch: true,
		label: "checkpoint", labelTimestamp,
	};
}

function makePanel(keymap: Keymap = DEFAULT_KEYMAP) {
	const row = treeRow();
	let reads = 0;
	const panel = new LazyPanel({
		theme, keymap, getHeight: () => 24, requestRender: () => {}, onClose: () => {},
		data: {
			listSessions: async () => ["one", "two"].map((file) => ({
				file, id: file, cwd: ".", preview: file, createdAt: 0, updatedAt: 0, messageCount: 1,
			})),
			loadTree: async () => {
				reads++;
				return [{ ...row }];
			},
			loadContent: async () => [],
		},
		actions: {
			copyNodeText: async () => true,
			resumeSession: async () => "unchanged",
			restoreNode: async () => "unchanged",
			setNodeLabel: async (_file, _entryId, label) => {
				if (label) {
					row.label = label;
					row.labelTimestamp = labelTimestamp + 60_000;
				} else {
					delete row.label;
					delete row.labelTimestamp;
				}
			},
		},
	});
	return { panel, reads: () => reads, text: () => panel.render(240).map(stripTerminalSequences).join("\n") };
}

async function flush(): Promise<void> {
	await new Promise<void>((resolve) => setImmediate(resolve));
}

test("label time is optional, distinct from message time, and width-safe", () => {
	const row = treeRow();
	const render = (r: TreeRow, show = false, width = 100) => renderTreeRow(r, "", width, false, theme, undefined, show);
	assert.match(render(row), /\[checkpoint\] 13:20 user: message body/);
	assert.match(render(row, true), /\[checkpoint · 10-02 14:35\] 13:20 user: message body/);
	for (const timestamp of [NaN, Infinity]) {
		assert.equal(render({ ...row, labelTimestamp: timestamp }, true), render(row));
	}
	const missing = { ...row };
	delete missing.labelTimestamp;
	assert.equal(render(missing, true), render(row));
	delete missing.label;
	assert.doesNotMatch(render(missing, true), /10-02|checkpoint| · /);
	for (const width of [1, 8, 24, 40, 100]) {
		assert.equal(visibleWidth(render(row, true, width)), width);
	}
});

test("label time preserves selected background and search highlighting", () => {
	const styled = {
		...theme,
		fg: (_color: string, text: string) => `\x1b[90m${text}\x1b[0m`,
		bg: (_color: string, text: string) => `\x1b[44m${text}\x1b[0m`,
		inverse: (text: string) => `\x1b[7m${text}\x1b[27m`,
	} as Theme;
	const line = renderTreeRow(treeRow(), "", 100, true, styled, { terms: ["message"], current: true }, true);
	assert.ok(line.includes("\x1b[44m"));
	assert.ok(line.includes("\x1b[7m"));
	assert.match(stripTerminalSequences(line), /\[checkpoint · 10-02 14:35\] 13:20 user: message body/);
	assert.equal(visibleWidth(line), 100);
});

test("T shares display state across tree views without reloading or changing selection/search", async () => {
	const h = makePanel();
	try {
		await h.panel.load();
		h.panel.handleInput("2");
		assert.equal(h.panel.state.showLabelTimestamps, false);
		const reads = h.reads();
		const before = structuredClone(h.panel.state);
		h.panel.handleInput("T");
		assert.equal(h.panel.state.showLabelTimestamps, true);
		assert.deepEqual(h.panel.state, { ...before, showLabelTimestamps: true });
		assert.equal(h.reads(), reads);
		assert.ok(h.text().includes("[checkpoint · 10-02 14:35]"));
		h.panel.handleInput("a");
		assert.ok(h.text().includes("[checkpoint · 10-02 14:35]"));
		h.panel.handleInput("/");
		h.panel.handleInput("T");
		assert.equal(h.panel.state.showLabelTimestamps, true, "search input owns its keys");
		h.panel.handleInput("\x1b");
		h.panel.handleInput("T");
		assert.equal(h.panel.state.showLabelTimestamps, false);
		h.panel.handleInput("q");
		assert.ok(h.text().includes("[checkpoint]"));
		h.panel.handleInput("/");
		for (const ch of "checkpoint") h.panel.handleInput(ch);
		h.panel.handleInput("\r");
		const search = structuredClone(h.panel.state.search);
		h.panel.handleInput("T");
		assert.deepEqual(h.panel.state.search, search);
		h.panel.handleInput("1");
		h.panel.handleInput("j");
		await flush();
		assert.equal(h.panel.state.showLabelTimestamps, true, "switching sessions keeps display preference");
	} finally { h.panel.dispose(); }
	const fresh = makePanel();
	assert.equal(fresh.panel.state.showLabelTimestamps, false);
	fresh.panel.dispose();
});

test("L edits labels and reloads the real timestamp; clearing removes both", async () => {
	const h = makePanel();
	try {
		await h.panel.load();
		h.panel.handleInput("2");
		h.panel.handleInput("T");
		h.panel.handleInput("a");
		h.panel.handleInput("L");
		assert.equal(h.panel.state.mode, "label");
		h.panel.handleInput("T");
		assert.equal(h.panel.state.showLabelTimestamps, true);
		h.panel.handleInput("\r");
		await flush();
		assert.equal(h.panel.state.mode, "tree");
		assert.ok(h.text().includes(formatShortDate(labelTimestamp + 60_000)));
		h.panel.handleInput("L");
		h.panel.handleInput("\x01"); // Home, then delete to end.
		h.panel.handleInput("\x0b");
		h.panel.handleInput("\r");
		await flush();
		assert.doesNotMatch(h.text(), /\[checkpoint|10-02 14:36/);
	} finally { h.panel.dispose(); }
});

test("label time supports rebinding, unbinding and execution through help", async () => {
	for (const binding of ["V", null]) {
		const h = makePanel(mergeKeymap(DEFAULT_KEYMAP, { tree: { "tree-toggle-label-time": binding } }));
		try {
			await h.panel.load();
			h.panel.handleInput("2");
			h.panel.handleInput("T");
			assert.equal(h.panel.state.showLabelTimestamps, false);
			h.panel.handleInput("V");
			assert.equal(h.panel.state.showLabelTimestamps, binding !== null);
		} finally { h.panel.dispose(); }
	}
	const h = makePanel(mergeKeymap(DEFAULT_KEYMAP, { tree: { "tree-toggle-label-time": "V" } }));
	try {
		await h.panel.load();
		h.panel.handleInput("2");
		h.panel.handleInput("?");
		for (let i = 0; i < 40 && !h.panel.state.showLabelTimestamps; i++) {
			const text = h.text();
			if (text.split("\n").some((line) => line.includes("›") && line.includes("Show / hide label timestamps"))) {
				h.panel.handleInput("\r");
				break;
			}
			h.panel.handleInput("j");
		}
		assert.equal(h.panel.state.helpOpen, false);
		assert.equal(h.panel.state.showLabelTimestamps, true);
	} finally { h.panel.dispose(); }
});
