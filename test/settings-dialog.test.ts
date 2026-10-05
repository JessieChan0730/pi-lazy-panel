import assert from "node:assert/strict";
import { test } from "node:test";
import type { Theme } from "@earendil-works/pi-coding-agent";
import { stripTerminalSequences, visibleWidth } from "@earendil-works/pi-tui";
import { DEFAULT_CONFIG, resolveConfig } from "../src/config/config.ts";
import { initI18n } from "../src/i18n/index.ts";
import { createSettingsState, SETTINGS_CATEGORIES } from "../src/ui/settings-state.ts";
import { SettingsDialog } from "../src/ui/widgets/settings-dialog.ts";

initI18n("en");

const theme = {
	fg: (_c: string, s: string) => s,
	bg: (_c: string, s: string) => s,
	bold: (s: string) => s,
} as unknown as Theme;

function makeDialog(config = DEFAULT_CONFIG) {
	const state = createSettingsState();
	let changes = 0;
	let closes = 0;
	const dialog = new SettingsDialog({
		state, config, theme,
		onChange: () => { changes++; },
		onClose: () => { closes++; },
	});
	return {
		dialog,
		state,
		changes: () => changes,
		closes: () => closes,
		text: (width = 108, height = 28) => dialog.render(width, height).map(stripTerminalSequences).join("\n"),
	};
}

test("settings shows startup values and distinguishes explicit and system language", () => {
	const config = resolveConfig({ locale: "zh", defaultScope: "all", defaultSort: "threaded", leftColumnRatio: 0.4 });
	const before = structuredClone(config);
	const h = makeDialog(config);
	const general = h.text();
	assert.match(general, /Settings · Read-only/);
	assert.match(general, /Simplified Chinese/);
	assert.match(general, /All folders/);
	assert.match(general, /Fork relationships/);
	h.state.category = "layout";
	assert.match(h.text(), /40%/);
	assert.match(h.text(), /SESSIONS and TREE share/);
	h.state.category = "theme";
	assert.match(h.text(), /Follow pi/);
	assert.match(h.text(), /Plugin theme selection/);
	assert.deepEqual(config, before);
	assert.match(makeDialog().text(), /System \(English\)/);
});

test("settings fixed navigation cycles regions, categories and all five scopes without editing", (ctx) => {
	ctx.mock.timers.enable({ apis: ["setInterval"] });
	const h = makeDialog();
	ctx.after(() => h.dialog.dispose());
	h.dialog.open();
	h.dialog.handleInput("j");
	assert.equal(h.state.category, "general", "opening consumes navigation");
	ctx.mock.timers.tick(120);
	assert.equal(h.state.phase, "open");
	h.dialog.handleInput("j");
	assert.equal(h.state.category, "layout");
	h.dialog.handleInput("\x1b[B");
	assert.equal(h.state.category, "keybindings");
	h.dialog.handleInput("\r");
	assert.equal(h.state.region, "list");
	for (const scope of ["sessions", "tree", "content", "tree-dialog", "global"]) {
		h.dialog.handleInput("l");
		assert.equal(h.state.keyScope, scope);
	}
	h.dialog.handleInput("\x1b[D");
	assert.equal(h.state.keyScope, "tree-dialog");
	h.dialog.handleInput("j");
	h.dialog.handleInput("j");
	assert.equal(h.state.positions["tree-dialog"]?.cursor, 2);
	h.dialog.handleInput("l");
	h.dialog.handleInput("h");
	assert.equal(h.state.positions["tree-dialog"]?.cursor, 2, "scope positions survive navigation");
	const configBefore = structuredClone(DEFAULT_CONFIG);
	for (const key of ["\r", "s", "d", "r", " ", ","]) h.dialog.handleInput(key);
	assert.deepEqual(DEFAULT_CONFIG, configBefore, "no edit/save/session actions");
	h.dialog.handleInput("\t");
	assert.equal(h.state.region, "buttons");
	h.dialog.handleInput("\t");
	assert.equal(h.state.region, "categories");
	h.dialog.handleInput("\x1b[Z");
	assert.equal(h.state.region, "buttons");
	h.dialog.handleInput("\r");
	assert.equal(h.state.phase, "closing");
	ctx.mock.timers.tick(120);
	assert.equal(h.closes(), 1);
});

test("keybinding preview shows local overrides and unbinding without inventing inherited bindings", () => {
	const config = resolveConfig({ keymap: { global: { "settings-open": null, "go-top": ["ctrl+w h", "gg"] }, tree: { "move-down": null, "tree-copy": ["ctrl+x", "yy"] } } });
	for (const scope of Object.values(config.keymap)) Object.freeze(scope);
	Object.freeze(config.keymap);
	Object.freeze(config);
	const h = makeDialog(config);
	h.state.category = "keybindings";
	h.state.keyScope = "tree";
	assert.match(h.text(108, 40), /Ctrl\+x \/ yy/);
	assert.doesNotMatch(h.text(), /Move cursor down/, "global inheritance is not expanded into this layer");
	assert.match(h.text(108, 40), /inheritance is not expanded/);
	h.state.keyScope = "global";
	h.state.positions.global = { cursor: 17, scroll: 17, detailScroll: 0 };
	const text = h.text(108, 40);
	assert.match(text, /No local binding/);
	assert.match(text, /Ctrl\+w h \/ gg/);
	assert.doesNotMatch(text, /,\s*│/, "unbound settings must not display its default comma");
});

test("settings list scroll follows the cursor and preserves each category position", (ctx) => {
	ctx.mock.timers.enable({ apis: ["setInterval"] });
	const h = makeDialog();
	ctx.after(() => h.dialog.dispose());
	h.dialog.open();
	ctx.mock.timers.tick(120);
	h.state.category = "keybindings";
	h.state.region = "list";
	for (let i = 0; i < 100; i++) h.dialog.handleInput("j");
	assert.match(h.text(60, 15), /Quit the panel/);
	const pos = { ...h.state.positions.global! };
	assert.ok(pos.scroll > 0);
	h.dialog.handleInput("\x1b[Z");
	h.dialog.handleInput("k");
	assert.equal(h.state.category, "layout");
	h.dialog.handleInput("j");
	h.text(60, 15);
	assert.deepEqual(h.state.positions.global, pos);
});

test("long keybinding values and descriptions can be inspected without changing the selected action", (ctx) => {
	ctx.mock.timers.enable({ apis: ["setInterval"] });
	const bindings = ["ctrl+w h", "ctrl+alt+shift+super+pageDown", "alt+pageUp", "ctrl+shift+f12"];
	const h = makeDialog(resolveConfig({ keymap: { global: { "move-down": bindings } } }));
	ctx.after(() => h.dialog.dispose());
	h.dialog.open();
	ctx.mock.timers.tick(120);
	h.state.category = "keybindings";
	h.state.region = "list";
	let all = h.text(42, 18);
	assert.match(all, /↓ PgDn/);
	for (let i = 0; i < 10; i++) {
		h.dialog.handleInput("\x1b[6~");
		all += h.text(42, 18);
	}
	assert.match(all, /Ctrl\+Shift\+F12/);
	assert.match(all, /affect execution/);
	assert.equal(h.state.positions.global?.cursor, 0);
	h.dialog.handleInput("j");
	assert.equal(h.state.positions.global?.detailScroll, 0);
});

test("settings open/close animations are finite, reversible and safe to dispose", (ctx) => {
	ctx.mock.timers.enable({ apis: ["setInterval"] });
	const h = makeDialog();
	h.dialog.open();
	assert.equal(h.dialog.isOpen, true);
	ctx.mock.timers.tick(60);
	assert.equal(h.state.progress, 0.5);
	h.dialog.handleInput("\x1b");
	h.dialog.handleInput("q");
	h.dialog.handleInput("j");
	assert.equal(h.state.category, "general");
	assert.equal(h.state.phase, "closing");
	ctx.mock.timers.tick(30);
	assert.equal(h.dialog.isOpen, true);
	ctx.mock.timers.tick(30);
	assert.equal(h.dialog.isOpen, false);
	assert.equal(h.closes(), 1);
	let changes = h.changes();
	ctx.mock.timers.tick(1000);
	assert.equal(h.changes(), changes);
	h.dialog.open();
	ctx.mock.timers.tick(120);
	assert.equal(h.state.phase, "open");
	changes = h.changes();
	ctx.mock.timers.tick(1000);
	assert.equal(h.changes(), changes, "no timer while settled");
	h.dialog.close();
	h.dialog.dispose();
	changes = h.changes();
	ctx.mock.timers.tick(1000);
	h.dialog.open();
	assert.equal(h.changes(), changes, "no redraw after dispose");
	assert.equal(h.closes(), 1, "dispose does not run the close callback");
});

test("closing immediately and repeated opens do not leave multiple timers", (ctx) => {
	ctx.mock.timers.enable({ apis: ["setInterval"] });
	const h = makeDialog();
	ctx.after(() => h.dialog.dispose());
	h.dialog.open();
	h.dialog.open();
	h.dialog.close();
	h.dialog.close();
	ctx.mock.timers.tick(30);
	assert.equal(h.closes(), 1);
	assert.equal(h.state.phase, "closed");
	const changes = h.changes();
	ctx.mock.timers.tick(1000);
	assert.equal(h.changes(), changes);
});

test("animation reveals a fixed final layout; resize and all locales stay within the viewport", (ctx) => {
	ctx.mock.timers.enable({ apis: ["setInterval"] });
	const h = makeDialog();
	ctx.after(() => {
		h.dialog.dispose();
		initI18n("en");
	});
	const base = Array.from({ length: 32 }, () => ".".repeat(120));
	h.dialog.open();
	ctx.mock.timers.tick(60);
	const half = h.dialog.overlay(base, 120);
	ctx.mock.timers.tick(60);
	const full = h.dialog.overlay(base, 120);
	const row = full.findIndex((line) => line.includes("Interface language"));
	assert.ok(row >= 0);
	assert.equal(half[row], full[row], "revealed text does not move or reflow");
	for (const language of ["en", "zh"] as const) {
		initI18n(language);
		for (const category of SETTINGS_CATEGORIES) {
			h.state.category = category;
			for (const width of [0, 1, 3, 12, 20, 40, 75, 76, 100, 140]) {
				for (const height of [0, 1, 3, 6, 8, 15, 28, 45]) {
					for (const progress of [0, 0.25, 0.5, 1]) {
						h.state.progress = progress;
						const background = Array.from({ length: height }, () => "x".repeat(width));
						const out = h.dialog.overlay(background, width);
						assert.equal(out.length, height);
						assert.ok(out.every((line) => visibleWidth(line) === width), `${language}/${category} ${width}x${height} @${progress}`);
					}
				}
			}
		}
	}
});
