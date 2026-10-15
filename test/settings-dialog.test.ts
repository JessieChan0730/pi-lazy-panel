import assert from "node:assert/strict";
import { test } from "node:test";
import type { Theme } from "@earendil-works/pi-coding-agent";
import { stripTerminalSequences, visibleWidth } from "@earendil-works/pi-tui";
import { DEFAULT_CONFIG, resolveConfig } from "../src/config/config.ts";
import { initI18n, t } from "../src/i18n/index.ts";
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

/** 画到屏幕上（overlay 会记下这次的位置，鼠标命中照着它算），返回去掉颜色后的整屏。 */
function screen(dialog: SettingsDialog, termW = 108, termH = 28): string[] {
	return dialog.overlay(Array.from({ length: termH }, () => "x".repeat(termW)), termW).map(stripTerminalSequences);
}

/** 某一行上 `needle` 的屏幕坐标（分类 / 设置名 / 按钮都直接点自己那一列）。 */
function cellAt(lines: string[], needle: string): { x: number; y: number } {
	const y = lines.findIndex((line) => line.includes(needle));
	assert.ok(y >= 0, `"${needle}" is on screen`);
	return { x: lines[y]!.indexOf(needle), y };
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
	// 可编辑（不再只读），回车是弹菜单选主题。主题页平时没有任何说明，
	// 所以底部说明框整个不画（连主题文件路径也不再出现）。
	assert.doesNotMatch(h.text(60), /Read-only/);
	assert.match(h.text(60), /4\/4 Theme/);
	assert.match(h.text(), /Theme {2,}nord/);
	h.state.region = "list";
	assert.doesNotMatch(h.text(), /nord\.json/);
	// 切换失败留下的主题：行上换成 pi 没切过去的那一个并带 * 标记，这时才补一句说明。
	h.state.themeDraft = "light";
	assert.match(h.text(), /\* Theme {2,}light/);
	assert.match(h.text(), /Switching to light failed/);
	assert.deepEqual(config, before);
	assert.match(makeDialog().text(), /Follow system/);
});
test("every row's value starts at the same column so values read as one left-aligned column", () => {
	// 逐行按自己的值取宽时，英文的值都比 12 列下限长，起点各不相同（看起来像在右边飘）；
	// 整页共用一列宽度后，中英两种语言的值都左对齐在同一列上。
	try {
		for (const language of ["en", "zh"] as const) {
			initI18n(language);
			const lines = makeDialog().text().split("\n");
			const start = (label: string): number => {
				const line = lines.find((l) => l.includes(label))!;
				const at = line.indexOf(label) + label.length;
				const after = line.slice(at);
				const value = after.trim();
				return visibleWidth(line.slice(0, at)) + visibleWidth(after.slice(0, after.indexOf(value)));
			};
			const columns = ["locale", "defaultScope", "defaultSort"].map((id) => start(t(`settings.${id}`)));
			assert.equal(new Set(columns).size, 1, `${language} value columns: ${columns.join(" / ")}`);
		}
	} finally {
		initI18n("en");
	}
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
test("the detail box only appears for items that carry a description", () => {
	// 布局和快捷键本来就容易看错，底部说明框（第二个 ┌ 开头的方框）留着；
	// 常规 / 主题行自己说得清，没有说明就不画框，把高度还给列表。
	const boxes = (text: string): number => text.split("\n").filter((line) => line.includes("┌")).length;
	const h = makeDialog();
	assert.equal(boxes(h.text()), 1, "general rows have no detail box");
	h.state.category = "layout";
	assert.equal(boxes(h.text()), 2, "the layout row keeps its explanation");
	h.state.category = "keybindings";
	assert.equal(boxes(h.text()), 2, "keybinding rows keep theirs");
	h.state.category = "theme";
	assert.equal(boxes(h.text()), 1, "the theme row has none either");
	// 说明框在就在、不在就完全不给 PgUp/PgDn 提示（footer 用的是同一个 hints）。
	assert.ok(!h.dialog.hints.some(([, label]) => /scroll/i.test(label)), "no scroll hint without a box");
	h.state.category = "layout";
	assert.ok(h.dialog.hints.some(([, label]) => /scroll/i.test(label)), "the scroll hint comes back with the box");
});
test("status messages use a bottom frame outside the main settings box in both languages", () => {
	try {
		for (const language of ["en", "zh"] as const) {
			initI18n(language);
			for (const width of [60, 76, 108]) {
				for (const status of ["notice", "error", "loading", "saving"] as const) {
					const h = makeDialog();
					if (status === "notice") h.state.notice = t("settings.saved");
					else if (status === "error") h.state.error = t("settings.saveFailed", { error: "conflict ".repeat(12) });
					else h.state[status] = true;
					const lines = h.dialog.render(width, 28).map(stripTerminalSequences);
					assert.equal(lines.length, 28);
					assert.ok(lines.every((line) => visibleWidth(line) === width));
					const boxes = lines.flatMap((line, i) => line.startsWith("┌") ? [i] : []);
					assert.equal(boxes.length, 2, "one main box and one auxiliary box");
					assert.ok(lines[boxes[1]! - 1]!.startsWith("└"), "main box closes before feedback");
					const expected = status === "notice" ? t("settings.saved") : status === "error" ? "conflict" : t(`settings.${status}`);
					assert.ok(lines.slice(boxes[1]).some((line) => line.includes(expected)));
					if (status === "notice") assert.ok(lines.some((line) => line.includes(t("settings.saved"))));
					if (width < 76) continue;
					const divider = lines.findIndex((line) => line.startsWith("├"));
					const sidebarColumn = lines[1]!.indexOf("│", 1);
					assert.ok(divider > 1);
					assert.ok(sidebarColumn > 1);
					for (const line of lines.slice(1, divider)) {
						// 用可见列而不是字符串下标检查，兼容中文的双宽字符。
						const column = visibleWidth(line.slice(0, line.indexOf("│", 1)));
						assert.equal(column, sidebarColumn, `${language}/${width}/${status}: ${line}`);
					}
				}
			}
		}
	} finally {
		initI18n("en");
	}
});
test("feedback and existing descriptions share one bottom frame with a divider", () => {
	for (const category of ["layout", "keybindings"] as const) {
		const h = makeDialog();
		h.state.category = category;
		h.state.notice = t("settings.saved");
		const lines = h.text().split("\n");
		const boxes = lines.flatMap((line, i) => line.startsWith("┌") ? [i] : []);
		assert.equal(boxes.length, 2, "do not stack a third box for feedback");
		const bottom = lines.slice(boxes[1]);
		assert.ok(bottom[1]!.includes(t("settings.saved")));
		assert.ok(bottom[2]!.startsWith("├"), "result and explanation are separated");
		assert.ok(bottom.some((line) => line.includes(category === "layout" ? "leftColumnRatio" : "keyScope")));
		h.state.notice = undefined;
		const descriptionOnly = h.text().split("\n");
		assert.equal(descriptionOnly.filter((line) => line.startsWith("┌")).length, 2);
		assert.equal(descriptionOnly.filter((line) => line.startsWith("├")).length, 1, "no empty feedback section");
	}
});
test("long feedback scrolls from any region and new results start at the top", () => {
	const h = makeDialog();
	h.dialog.open();
	h.state.error = `Long error ${"conflict ".repeat(100)}END_OF_ERROR`;
	assert.match(h.text(60, 18), /↓ PgDn/);
	assert.ok(h.dialog.hints.some(([key]) => key === "PgUp/PgDn"));
	let text = "";
	for (let i = 0; i < 10; i++) {
		h.dialog.handleInput("\x1b[6~");
		text += h.text(60, 18);
	}
	assert.match(text, /END_OF_ERROR/);
	assert.equal(h.state.positions.general?.cursor, 0);
	h.state.error = undefined;
	h.state.notice = t("settings.saved");
	assert.match(h.text(60, 18), /Settings applied/);
	assert.equal(h.state.positions.general?.detailScroll, 0);
	const lines = screen(h.dialog);
	const result = cellAt(lines, t("settings.saved"));
	assert.equal(h.dialog.hitAt(result.x, result.y), undefined, "feedback does not intercept list clicks");
	const close = cellAt(lines, `[ q ${t("hint.close")} ]`);
	assert.deepEqual(h.dialog.hitAt(close.x, close.y), { region: "buttons", index: 0 });
});
test("short viewports retain feedback without sacrificing the main controls", () => {
	for (const height of [7, 8, 9, 10, 11]) {
		const h = makeDialog();
		h.state.category = "layout";
		h.state.notice = t("settings.saved");
		const lines = h.dialog.render(60, height).map(stripTerminalSequences);
		assert.equal(lines.length, height);
		assert.ok(lines.every((line) => visibleWidth(line) === 60));
		assert.ok(lines.some((line) => line.includes(t("settings.saved"))));
		assert.ok(lines.some((line) => line.includes(`[ q ${t("hint.close")} ]`)));
		assert.equal(lines.filter((line) => line.startsWith("┌")).length, height < 9 ? 1 : 2);
	}
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

test("mouse: a click focuses the sidebar category, the setting row or the button it lands on", () => {
	const h = makeDialog();
	h.dialog.open();
	const lines = screen(h.dialog);

	// 侧栏：点 Layout → 切到 Layout，区域跟着变成分类栏
	const layout = cellAt(lines, "Layout");
	h.dialog.focusHit(h.dialog.hitAt(layout.x, layout.y)!);
	assert.equal(h.state.category, "layout");
	assert.equal(h.state.region, "categories");

	// 设置行：点某一条 → 区域变成列表、光标落在它上面
	h.state.category = "general";
	const rows = screen(h.dialog);
	const row = cellAt(rows, t("settings.defaultSort"));
	const hit = h.dialog.hitAt(row.x, row.y);
	assert.ok(hit);
	assert.equal(hit.region, "list");
	h.dialog.focusHit(hit);
	assert.equal(h.state.region, "list");
	assert.equal(h.state.positions.general?.cursor, 2, "第 3 条设置");

	// 按钮栏：点 [ q Close ] → 区域变成按钮栏，光标停在那个按钮上
	const buttons = screen(h.dialog);
	const close = cellAt(buttons, `[ q ${t("hint.close")} ]`);
	const closeHit = h.dialog.hitAt(close.x, close.y);
	assert.deepEqual(closeHit, { region: "buttons", index: 0 });

	// 边框 / 说明框 / 消息行上什么都不做
	assert.equal(h.dialog.hitAt(0, close.y), undefined, "框外");
	assert.equal(h.dialog.hitAt(close.x, 0), undefined, "标题边框");
	h.dialog.close();
});

test("mouse: a double-click is Enter — edit the setting, run the button, and a disabled button matches the keyboard", () => {
	const h = makeDialog();
	h.dialog.open();
	const lines = screen(h.dialog);
	const row = cellAt(lines, t("settings.locale"));
	const hit = h.dialog.hitAt(row.x, row.y)!;
	h.dialog.focusHit(hit);
	h.dialog.activate(); // 双击 = Enter：编辑这一条
	assert.deepEqual(h.edits, ["locale"]);

	// 按钮：`q` 关闭；`d` 在没有基线时是禁用（变暗）的，但键盘 Enter 一样会调 onDefaults
	// （真正的拒绝在流程里），鼠标和键盘保持同一条路径。
	const buttons = screen(h.dialog);
	const close = cellAt(buttons, `[ q ${t("hint.close")} ]`);
	h.dialog.focusHit(h.dialog.hitAt(close.x, close.y)!);
	h.dialog.activate();
	assert.equal(h.closes(), 1);
	assert.deepEqual(h.buttons, []);

	h.dialog.open();
	const again = screen(h.dialog);
	const restore = cellAt(again, `[ d ${t("settings.restore")} ]`);
	const restoreHit = h.dialog.hitAt(restore.x, restore.y);
	assert.deepEqual(restoreHit, { region: "buttons", index: 1 }, "禁用不等于点不到");
	h.dialog.focusHit(restoreHit!);
	h.dialog.activate();
	assert.deepEqual(h.buttons, ["defaults"], "和键盘 Enter 一样调 onDefaults");

	// 正在落盘时鼠标整个不响应（和键盘一致）
	const cursor = h.state.positions.general?.cursor;
	h.state.saving = true;
	assert.equal(h.dialog.hitAt(row.x, row.y), undefined);
	h.dialog.wheel(30, row.y, 1);
	assert.equal(h.state.positions.general?.cursor, cursor, "saving 时滚轮不动");
});

test("mouse: the wheel moves the cursor of the region under the pointer", () => {
	const h = makeDialog();
	h.dialog.open();
	const lines = screen(h.dialog);
	const layout = cellAt(lines, "Layout");
	h.dialog.wheel(layout.x, layout.y, 1); // 侧栏：下滑一个分类
	assert.equal(h.state.region, "categories");
	assert.equal(h.state.category, "layout");
	h.dialog.wheel(layout.x, layout.y, -1);
	assert.equal(h.state.category, "general");

	const rows = screen(h.dialog);
	const sort = cellAt(rows, t("settings.defaultSort"));
	h.dialog.wheel(sort.x, sort.y, 1); // 设置行：切到列表区域并移动光标
	assert.equal(h.state.region, "list");
	assert.ok((h.state.positions.general?.cursor ?? 0) > 0);
	h.dialog.close();
});

test("mouse: narrow layouts stay clickable — the title row, two-line items and the single button", () => {
	const h = makeDialog();
	h.dialog.open();
	// 46 列：contentWidth = 42 < 50，一条设置占两行；窄屏没有侧栏，标题行就是分类
	const lines = screen(h.dialog, 46, 28);
	const title = cellAt(lines, `1/4 ${t("settings.category.general")}`);
	const titleHit = h.dialog.hitAt(title.x, title.y);
	assert.deepEqual(titleHit, { region: "categories", index: 0 });

	// 一条设置的两行都算命中同一条
	const label = cellAt(lines, t("settings.defaultSort"));
	const value = { x: label.x, y: label.y + 1 };
	assert.equal(h.dialog.hitAt(value.x, value.y)?.index, h.dialog.hitAt(label.x, label.y)?.index, "值那一行也算这一条");
	assert.equal(h.dialog.hitAt(label.x, label.y)?.region, "list");

	// 窄屏按钮行只有一个按钮，整行都可点
	const button = cellAt(lines, `[ q ${t("hint.close")} ]`);
	assert.equal(h.dialog.hitAt(button.x, button.y)?.region, "buttons");
	h.dialog.close();
});
