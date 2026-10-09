import assert from "node:assert/strict";
import { test } from "node:test";
import type { Theme } from "@earendil-works/pi-coding-agent";
import { stripTerminalSequences, visibleWidth } from "@earendil-works/pi-tui";
import { DEFAULT_CONFIG, resolveConfig } from "../src/config/config.ts";
import { initI18n } from "../src/i18n/index.ts";
import { createSettingsState, SETTINGS_CATEGORIES, setSettingsDraft } from "../src/ui/settings-state.ts";
import { SettingsDialog } from "../src/ui/widgets/settings-dialog.ts";
initI18n("en");
const theme = { fg: (_c: string, s: string) => s, bg: (_c: string, s: string) => s, bold: (s: string) => s } as unknown as Theme;
function makeDialog(config = DEFAULT_CONFIG) {
	const state = createSettingsState();
	let changes = 0;
	let closes = 0;
	const edits: string[] = [];
	const buttons: string[] = [];
	const dialog = new SettingsDialog({
		state, config, theme,
		onChange: () => { changes++; },
		onClose: () => {
			assert.equal(state.phase, "closed");
			closes++;
		},
		onEdit: (id) => edits.push(id),
		onSave: () => buttons.push("save"),
		onDefaults: () => buttons.push("defaults"),
		onReload: () => buttons.push("reload"),
	});
	return { dialog, state, edits, buttons, changes: () => changes, closes: () => closes, text: (width = 108, height = 28) => dialog.render(width, height).map(stripTerminalSequences).join("\n") };
}
test("settings values and local readonly notes replace global preview notice", () => {
	const config = resolveConfig({ locale: "zh", defaultScope: "all", defaultSort: "threaded", leftColumnRatio: 0.4 });
	const before = structuredClone(config);
	const h = makeDialog(config);
	const general = h.text();
	assert.doesNotMatch(general, /Settings · Read-only|read-only preview/i);
	assert.match(general, /Simplified Chinese/);
	assert.match(general, /All folders/);
	assert.match(general, /Fork relationships/);
	h.state.category = "layout";
	assert.match(h.text(), /40%/);
	// 布局分类现在可编辑（不再是只读），narrow 标题只显示分类名。
	assert.doesNotMatch(h.text(), /Read-only/);
	assert.match(h.text(60), /2\/4 Layout/);
	assert.doesNotMatch(h.text(60), /Layout · Read-only/);
	h.state.category = "theme";
	assert.match(h.text(60), /Theme · Read-only/);
	assert.match(h.text(), /Follow pi/);
	assert.deepEqual(config, before);
	assert.match(makeDialog().text(), /Follow system/);
});
test("layout category draws a three-pane preview that tracks the draft ratio", () => {
	const narrow = makeDialog(resolveConfig({ leftColumnRatio: 0.2 }));
	narrow.state.category = "layout";
	const wide = makeDialog(resolveConfig({ leftColumnRatio: 0.5 }));
	wide.state.category = "layout";
	const a = narrow.text();
	assert.match(a, /SESSIONS/);
	assert.match(a, /TREE/);
	assert.match(a, /CONTENT/);
	// 不同比例下小样分隔线位置不同，整幅渲染必然不一样。
	assert.notEqual(a, wide.text());
});
test("action shortcuts work from categories and list without focusing buttons", () => {
	for (const region of ["categories", "list"] as const) {
		const h = makeDialog();
		h.dialog.open();
		h.state.region = region;
		for (const key of ["s", "d", "r"]) h.dialog.handleInput(key);
		assert.deepEqual(h.buttons, ["save", "defaults", "reload"]);
		assert.equal(h.state.region, region);
		const buttons = h.text().split("\n").at(-2)!;
		assert.match(buttons, /s Save/);
		assert.match(buttons, /q cancel/);
		assert.match(buttons, /d Restore defaults/);
		assert.match(buttons, /r Reload/);
		assert.doesNotMatch(buttons, /—/);
		h.dialog.handleInput("q");
		assert.equal(h.dialog.isOpen, false);
	}
});

test("unavailable buttons are dimmed without an appended dash", () => {
	const state = createSettingsState();
	const dialog = new SettingsDialog({
		state, config: DEFAULT_CONFIG,
		theme: { ...theme, fg: (color: string, text: string) => color === "dim" ? `\x1b[2m${text}\x1b[22m` : text } as Theme,
		onChange: () => {}, onClose: () => {},
	});
	state.baseline = { raw: {}, fingerprint: null };
	const disabled = dialog.render(108, 28).at(-2)!;
	assert.match(disabled, /\x1b\[2m +\[ s Save \]/);
	assert.doesNotMatch(disabled, /—/);
	setSettingsDraft(state, "locale", "zh");
	assert.doesNotMatch(dialog.render(108, 28).at(-2)!, /\x1b\[2m +\[ s Save \]/);
});

test("instant open/close marks closed before callback, is idempotent and has no timers", (ctx) => {
	ctx.mock.timers.enable({ apis: ["setInterval"] });
	const h = makeDialog();
	h.dialog.open();
	h.dialog.open();
	assert.equal(h.state.phase, "open");
	h.dialog.handleInput("j");
	assert.equal(h.state.category, "layout");
	h.dialog.close();
	h.dialog.close();
	assert.equal(h.state.phase, "closed");
	assert.equal(h.closes(), 1);
	const changes = h.changes();
	ctx.mock.timers.tick(10000);
	assert.equal(h.changes(), changes);
	h.dialog.open();
	h.dialog.dispose();
	h.dialog.open();
	assert.equal(h.dialog.isOpen, false);
	assert.equal(h.closes(), 1);
});
test("h/l direct focus, Tab cycles and Enter activates scope row instead of cycling scopes", () => {
	const h = makeDialog();
	h.dialog.open();
	h.dialog.handleInput("j");
	h.dialog.handleInput("j");
	assert.equal(h.state.category, "keybindings");
	h.dialog.handleInput("l");
	h.dialog.handleInput("l");
	assert.equal(h.state.region, "list");
	assert.equal(h.state.keyScope, "global");
	h.dialog.handleInput("\r");
	assert.deepEqual(h.edits, ["keyScope"]);
	h.dialog.handleInput("j");
	h.dialog.handleInput("h");
	h.dialog.handleInput("\x1b[D");
	assert.equal(h.state.region, "categories");
	h.dialog.handleInput("\x1b[C");
	assert.equal(h.state.positions.global?.cursor, 1);
	h.dialog.handleInput("\t");
	assert.equal(h.state.region, "buttons");
	h.dialog.handleInput("\r");
	h.dialog.handleInput("j");
	h.dialog.handleInput("j");
	h.dialog.handleInput("\r");
	h.dialog.handleInput("j");
	h.dialog.handleInput("\r");
	assert.deepEqual(h.buttons, ["save", "defaults", "reload"]);
	h.dialog.handleInput("\t");
	assert.equal(h.state.region, "categories");
	h.dialog.handleInput("\x1b[Z");
	assert.equal(h.state.region, "buttons");
	h.dialog.handleInput("k");
	h.dialog.handleInput("k");
	h.dialog.handleInput("\r");
	assert.equal(h.dialog.isOpen, false);
});
test("dirty field markers, count, errors and saving state render inside settings", () => {
	const h = makeDialog();
	h.dialog.open();
	h.state.baseline = { raw: {}, fingerprint: null };
	setSettingsDraft(h.state, "locale", "zh");
	assert.match(h.text(), /\* Interface language/);
	assert.match(h.text(), /1 unsaved/);
	assert.match(h.text(), /Simplified Chinese/);
	h.state.error = "Unable to save: conflict in locale. Reload to retry.";
	assert.match(h.text(), /conflict in locale/);
	h.state.saving = true;
	h.dialog.handleInput("q");
	h.dialog.handleInput("s");
	assert.equal(h.dialog.isOpen, true);
	assert.deepEqual(h.buttons, []);
});
test("keybinding preview shows local overrides and unbinding, scroll preserves category positions", () => {
	const h = makeDialog(resolveConfig({ keymap: { global: { "settings-open": null, "go-top": ["ctrl+w h", "gg"] }, tree: { "move-down": null, "tree-copy": ["ctrl+x", "yy"] } } }));
	h.dialog.open();
	h.state.category = "keybindings";
	h.state.keyScope = "tree";
	assert.match(h.text(108, 40), /Ctrl\+x \/ yy/);
	assert.doesNotMatch(h.text(), /Move cursor down/);
	h.state.keyScope = "global";
	h.state.positions.global = { cursor: 18, scroll: 18, detailScroll: 0 };
	assert.match(h.text(108, 40), /No local binding/);
	assert.match(h.text(108, 40), /Ctrl\+w h \/ gg/);
	h.state.region = "list";
	for (let i = 0; i < 100; i++)
		h.dialog.handleInput("j");
	assert.match(h.text(60, 15), /Quit the panel/);
	const pos = { ...h.state.positions.global };
	h.dialog.handleInput("h");
	h.dialog.handleInput("k");
	h.dialog.handleInput("j");
	h.text(60, 15);
	assert.deepEqual(h.state.positions.global, pos);
});
test("long values have scrollable detail without changing selected action", () => {
	const h = makeDialog(resolveConfig({ keymap: { global: { "move-down": ["ctrl+w h", "ctrl+alt+shift+super+pageDown", "alt+pageUp", "ctrl+shift+f12"] } } }));
	h.dialog.open();
	h.state.category = "keybindings";
	h.state.region = "list";
	h.dialog.handleInput("j");
	let all = h.text(42, 18);
	assert.match(all, /↓ PgDn/);
	for (let i = 0; i < 10; i++) {
		h.dialog.handleInput("\x1b[6~");
		all += h.text(42, 18);
	}
	assert.match(all, /Ctrl\+Shift\+F12/);
	assert.equal(h.state.positions.global?.cursor, 1);
	h.dialog.handleInput("j");
	assert.equal(h.state.positions.global?.detailScroll, 0);
});
test("complete instant overlay and all locales stay within wide/narrow viewport", () => {
	const h = makeDialog();
	h.dialog.open();
	try {
		for (const language of ["en", "zh"] as const) {
			initI18n(language);
			for (const category of SETTINGS_CATEGORIES) {
				h.state.category = category;
				for (const width of [0, 1, 3, 12, 20, 40, 75, 76, 100, 140]) {
					for (const height of [0, 1, 3, 6, 8, 15, 28, 45]) {
						const out = h.dialog.overlay(Array.from({ length: height }, () => "x".repeat(width)), width);
						assert.equal(out.length, height);
						assert.ok(out.every((line) => visibleWidth(line) === width), `${language}/${category} ${width}x${height}`);
					}
				}
			}
		}
	} finally {
		initI18n("en");
	}
});
