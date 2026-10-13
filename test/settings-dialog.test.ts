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
/** pi's themes and its saved one, as the panel's state holds them after a read (see docs/theme.md). */
const themes = [
	{ name: "dark", path: "/pi/theme/dark.json" },
	{ name: "light", path: "/pi/theme/light.json" },
	{ name: "nord", path: "/home/user/.pi/agent/themes/nord.json" },
];
function makeDialog(config = DEFAULT_CONFIG, withThemes = true) {
	const state = createSettingsState();
	if (withThemes) {
		state.themes = themes;
		state.activeTheme = "nord";
	}
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
		onRetry: () => buttons.push("retry"),
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
	// 主题页和其他设置一样只有一行：右边是 pi 已保存的主题（值来自 pi 的主题列表），
	// 说明框给出它的文件路径；可编辑（不再只读），回车是弹菜单选主题。
	assert.doesNotMatch(h.text(60), /Read-only/);
	assert.match(h.text(60), /4\/4 Theme/);
	assert.match(h.text(), /Theme {2,}nord/);
	h.state.region = "list";
	assert.match(h.text(), /\/home\/user\/\.pi\/agent\/themes\/nord\.json/);
	// 切换失败留下的主题：行上换成 pi 没切过去的那一个并带 * 标记，说明文字也跟着换。
	h.state.themeDraft = "light";
	assert.match(h.text(), /\* Theme {2,}light/);
	assert.match(h.text(), /Switching to light failed/);
	assert.deepEqual(config, before);
	assert.match(makeDialog().text(), /Follow system/);
});
test("layout category shows the ratio value and the width description in the detail box", () => {
	const narrow = makeDialog(resolveConfig({ leftColumnRatio: 0.2 }));
	narrow.state.category = "layout";
	const wide = makeDialog(resolveConfig({ leftColumnRatio: 0.5 }));
	wide.state.category = "layout";
	const a = narrow.text();
	assert.match(a, /20%/);
	assert.match(wide.text(), /50%/);
	// 不再画三栏小样，底部独立说明框承载宽度说明（提到三个面板）。
	assert.match(a, /SESSIONS and TREE share this width/);
	// 不同比例下显示的数值不同，整幅渲染必然不一样。
	assert.notEqual(a, wide.text());
});
test("action shortcuts work from categories and list without focusing buttons", () => {
	for (const region of ["categories", "list"] as const) {
		const h = makeDialog();
		h.dialog.open();
		h.state.baseline = { raw: {}, fingerprint: null };
		h.state.region = region;
		// 正常状态：改动都已经落盘，按钮栏里没有"保存"，也没有"重试"。
		const idle = h.text().split("\n").find((l) => l.includes("[ q close ]"))!;
		assert.match(idle, /q close/);
		assert.match(idle, /d Restore defaults/);
		assert.match(idle, /r Reload/);
		assert.doesNotMatch(idle, /Retry|Save/);
		assert.doesNotMatch(idle, /—/);
		// 上一次提交失败后才多出重试按钮，s 在任意区域都能直接重试。
		setSettingsDraft(h.state, "locale", "zh");
		h.state.error = "Not saved: conflict";
		assert.match(h.text().split("\n").find((l) => l.includes("[ s Retry ]"))!, /s Retry/);
		for (const key of ["s", "d", "r"]) h.dialog.handleInput(key);
		assert.deepEqual(h.buttons, ["retry", "defaults", "reload"]);
		assert.equal(h.state.region, region);
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
	const line = (needle: string): string => dialog.render(108, 28).find((l) => l.includes(needle))!;
	// 没有失败就没有重试按钮（每个正常改动都已经落盘）。
	assert.equal(dialog.render(108, 28).some((l) => l.includes("Retry")), false);
	// 主题页的 d 撤的是切换失败的那个主题：没有失败就是灰的，有了才能按。
	state.category = "theme";
	assert.match(line("[ d Restore defaults ]"), /\x1b\[2m +\[ d Restore defaults \]/);
	state.themeDraft = "nord";
	assert.doesNotMatch(line("[ d Restore defaults ]"), /\x1b\[2m +\[ d/);
	// 失败后出现重试按钮，保存进行中变灰。
	state.category = "general";
	setSettingsDraft(state, "locale", "zh");
	state.error = "Not saved: conflict";
	assert.doesNotMatch(line("[ s Retry ]"), /\x1b\[2m +\[ s Retry \]/);
	assert.doesNotMatch(line("[ s Retry ]"), /—/);
	state.saving = true;
	assert.match(line("[ s Retry ]"), /\x1b\[2m +\[ s Retry \]/);
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
	// 按钮栏是 close / restore / reload，Enter 激活光标所在的那一个（没有失败就没有重试）。
	h.dialog.handleInput("j");
	h.dialog.handleInput("\r");
	h.dialog.handleInput("j");
	h.dialog.handleInput("\r");
	assert.deepEqual(h.buttons, ["defaults", "reload"]);
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
	// 一次失败（主题切不过去）让按钮栏带上重试按钮，和没有主题（空行）两种情况都要画得下。
	const h = makeDialog();
	h.dialog.open();
	h.state.baseline = { raw: {}, fingerprint: null };
	h.state.themeDraft = "light";
	h.state.error = "Cannot switch theme: boom";
	const bare = makeDialog(DEFAULT_CONFIG, false);
	bare.dialog.open();
	bare.state.baseline = { raw: {}, fingerprint: null };
	setSettingsDraft(bare.state, "locale", "zh");
	bare.state.error = "Not saved: conflict";
	try {
		for (const language of ["en", "zh"] as const) {
			initI18n(language);
			for (const view of [h, bare]) {
				for (const category of SETTINGS_CATEGORIES) {
					view.state.category = category;
					for (const width of [0, 1, 3, 12, 20, 40, 75, 76, 100, 140]) {
						for (const height of [0, 1, 3, 6, 8, 15, 28, 45]) {
							const out = view.dialog.overlay(Array.from({ length: height }, () => "x".repeat(width)), width);
							assert.equal(out.length, height);
							assert.ok(out.every((line) => visibleWidth(line) === width), `${language}/${category} ${width}x${height}`);
						}
					}
				}
			}
		}
	} finally {
		initI18n("en");
	}
});
test("keybinding category is editable: no read-only note, dirty marker, Enter edits the action", () => {
	const h = makeDialog();
	h.dialog.open();
	h.state.baseline = { raw: { keymap: { sessions: { "session-delete": "ctrl+d" } } }, fingerprint: null };
	h.state.category = "keybindings";
	h.state.keyScope = "sessions";
	// Editable now, so no "Read-only" heading like Theme has.
	assert.doesNotMatch(h.text(60, 30), /Keybindings · Read-only/);
	// A per-action draft override shows the "*" marker and the new chord.
	h.state.patch = { keymap: { sessions: { "session-delete": { set: ["ctrl+x"] } } } };
	assert.match(h.text(108, 40), /\* Delete session/);
	assert.match(h.text(108, 40), /Ctrl\+x/);
	// Enter on an action row (not the scope row) edits that action.
	h.state.region = "list";
	h.state.positions.sessions = { cursor: 1, scroll: 0, detailScroll: 0 };
	h.dialog.handleInput("\r");
	assert.equal(h.edits.at(-1), "session-resume");
});
