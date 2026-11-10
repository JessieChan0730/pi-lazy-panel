import assert from "node:assert/strict";
import { test } from "node:test";
import type { ConfigSaveResult, ConfigSnapshot, OpenShortcutPatch, SettingsPatch } from "../../../src/config/config-store.ts";
import { applyKeymapPatch } from "../../../src/config/config-store.ts";
import { initI18n } from "../../../src/i18n/index.ts";
import type { Theme } from "@earendil-works/pi-coding-agent";
import type { SettingsFlowHost } from "../../../src/ui/flows/host.ts";
import { editSetting, exitSettings, openBindingEditor, readSettings, reloadSettings, restoreSettingsDefaults, retrySettings, saveSettings } from "../../../src/ui/flows/settings-flows.ts";
import type { SettingsSource } from "../../../src/ui/ports.ts";
import { keymapActionDirty, keymapDraftChords, setKeymapDraft, setSettingsDraft, settingsDirtyCount, settingsDraft, settingsRetryKind } from "../../../src/ui/settings-state.ts";
import { createInitialState } from "../../../src/ui/state.ts";
import type { InputDialogSpec } from "../../../src/ui/widgets/input-dialog.ts";
import type { SelectDialogSpec } from "../../../src/ui/widgets/select-dialog.ts";
initI18n("en");
/**
 * A fake pi theme port: `list` is the list `readSettings` scans, `active` is the
 * theme pi has active (and saved), and `set` records the real switches (or fails,
 * to cover the error path). There is no preview: the page switches on the spot.
 */
function themeFixture(list = [{ name: "dark", path: "/pi/theme/dark.json" }, { name: "nord", path: "/home/u/.pi/agent/themes/nord.json" }], fail = false) {
	let active = "dark";
	const sets: string[] = [];
	return {
		source: {
			list: () => list,
			theme: { name: active } as unknown as Theme,
			savedName: () => active,
			set: (name: string) => {
				if (fail) return { success: false, error: "invalid theme" };
				sets.push(name);
				active = name;
				return { success: true };
			},
		},
		list,
		sets: () => sets,
		active: () => active,
	};
}
/** 改动现在是选中即落盘（fire-and-forget），多让几轮微任务跑完再断言。 */
async function settle(): Promise<void> {
	for (let i = 0; i < 8; i++) await Promise.resolve();
}
function deferred<T>() {
	let resolve!: (value: T) => void;
	let reject!: (reason: Error) => void;
	const promise = new Promise<T>((yes, no) => {
		resolve = yes;
		reject = no;
	});
	return { promise, resolve, reject };
}
function fixture(raw: Record<string, unknown> = {}, overrides: Partial<SettingsSource> = {}) {
	const state = createInitialState();
	state.settings.phase = "open";
	let snapshot: ConfigSnapshot = { raw, fingerprint: "baseline" };
	let menu: SelectDialogSpec | undefined;
	let prompt: InputDialogSpec | undefined;
	let disposed = false;
	let writes = 0;
	let applies = 0;
	let refreshes = 0;
	let localeRefreshes = 0;
	// pi's themes: a live snapshot the fake can mutate to simulate a switch.
	const themes = themeFixture();
	const source: SettingsSource = {
		read: async () => snapshot,
		save: async (_baseline, patch) => {
			writes++;
			const next = { ...snapshot.raw };
			for (const [key, value] of Object.entries(patch)) {
				if (key === "keymap") {
					const applied = applyKeymapPatch(next.keymap, value as NonNullable<SettingsPatch["keymap"]>);
					if (Object.keys(applied).length) next.keymap = applied;
					else delete next.keymap;
				} else if (key === "openShortcut") {
					// null 是真实取值（关闭注册），只有 reset 才删掉用户值。
					const edit = value as OpenShortcutPatch;
					if ("reset" in edit) delete next.openShortcut;
					else next.openShortcut = "set" in edit ? edit.set : null;
				} else if (value === null)
					delete next[key];
				else
					next[key] = value;
			}
			snapshot = { raw: next, fingerprint: `saved-${writes}` };
			return { snapshot, warnings: [] };
		},
		apply: () => { applies++; },
		...overrides,
	};
	// Only the settings extension and inherited menu/lifecycle capabilities are used.
	const host = {
		state, settingsSource: source, themeSource: themes.source,
		isDisposed: () => disposed,
		openMenu: (_mode: string, spec: SelectDialogSpec) => {
			menu = spec;
			prompt = undefined;
		},
		openPrompt: (_mode: string, spec: InputDialogSpec) => {
			prompt = spec;
			menu = undefined;
		},
		closeDialogs: () => {
			menu = undefined;
			prompt = undefined;
		},
		closeSettings: () => {
			state.settings.phase = "closed";
			state.settings.generation++;
		},
		refreshSettings: () => { refreshes++; },
		refreshConfig: () => { localeRefreshes++; },
	} as unknown as SettingsFlowHost;
	return { host, state: state.settings, source, themes, menu: () => menu, prompt: () => prompt, dispose: () => {
		disposed = true;
	}, writes: () => writes, applies: () => applies, refreshes: () => refreshes, localeRefreshes: () => localeRefreshes };
}
test("General pickers write immediately; cancel closes the child and undo never writes", async () => {
	const h = fixture({ locale: "en", defaultScope: "all" });
	await readSettings(h.host);
	editSetting(h.host, "locale");
	assert.equal(h.menu()?.initialIndex, 2);
	h.menu()!.onCancel();
	assert.equal(h.menu(), undefined);
	assert.equal(settingsDirtyCount(h.state), 0);
	assert.equal(h.writes(), 0);
	// 选中即落盘并生效：不再需要按 s。
	editSetting(h.host, "locale");
	h.menu()!.onSelect(1);
	assert.equal(h.menu(), undefined);
	await settle();
	assert.equal(h.writes(), 1);
	assert.equal(h.applies(), 1);
	assert.deepEqual(h.state.baseline?.raw, { locale: "zh", defaultScope: "all" });
	assert.equal(settingsDraft(h.state)?.locale, "zh");
	assert.equal(settingsDirtyCount(h.state), 0);
	assert.equal(h.state.notice, "Interface language set to: Simplified Chinese");
	// 再选一次当前值：没有改动，也就没有写入。
	editSetting(h.host, "locale");
	h.menu()!.onSelect(1);
	await settle();
	assert.equal(h.writes(), 1);
	assert.equal(h.applies(), 1);
	assert.equal(settingsDirtyCount(h.state), 0);
	editSetting(h.host, "defaultScope");
	h.menu()!.onSelect(0);
	// 保存进行中 handleInput / setSettingsDraft 都会让路，等这次落盘结束再改下一项。
	await settle();
	editSetting(h.host, "defaultSort");
	h.menu()!.onSelect(3);
	await settle();
	assert.deepEqual(h.state.baseline?.raw, { locale: "zh", defaultScope: "current-folder", defaultSort: "threaded" });
	assert.equal(h.writes(), 3);
});
test("returning to implicit defaults clears edits without writing explicit overrides", async () => {
	const h = fixture();
	await readSettings(h.host);
	setSettingsDraft(h.state, "defaultScope", "all");
	setSettingsDraft(h.state, "defaultSort", "created");
	assert.equal(settingsDirtyCount(h.state), 2);
	setSettingsDraft(h.state, "defaultScope", "current-folder");
	setSettingsDraft(h.state, "defaultSort", "recent");
	assert.equal(settingsDirtyCount(h.state), 0);
	await saveSettings(h.host);
	assert.equal(h.writes(), 0);
});

test("success feedback names each changed setting and value in the applied language", async () => {
	try {
		for (const language of ["en", "zh"] as const) {
			const h = fixture({}, { apply: (config) => {
				initI18n(config.locale);
			} });
			await readSettings(h.host);
			setSettingsDraft(h.state, "locale", language);
			await saveSettings(h.host);
			assert.equal(h.state.notice, language === "zh" ? "设置界面语言为：简体中文" : "Interface language set to: English");
			for (const [key, value, expected] of [
				["defaultScope", "all", language === "zh" ? "设置默认会话范围为：全部目录" : "Default session scope set to: All folders"],
				["defaultSort", "title", language === "zh" ? "设置默认排序为：标题" : "Default sort order set to: Title"],
				["leftColumnRatio", 0.3, language === "zh" ? "设置左栏宽度为：30%" : "Left column width set to: 30%"],
			] as const) {
				setSettingsDraft(h.state, key, value);
				await saveSettings(h.host);
				assert.equal(h.state.notice, expected);
			}
			editSetting(h.host, "theme");
			h.menu()!.onSelect(1);
			assert.equal(h.state.notice, language === "zh" ? "主题设置为：nord" : "Theme set to: nord");
		}
	} finally {
		initI18n("en");
	}
});

test("scope picker lists all five scopes and preserves independent positions", async () => {
	const h = fixture();
	await readSettings(h.host);
	h.state.positions.global = { cursor: 4, scroll: 2, detailScroll: 0 };
	editSetting(h.host, "keyScope");
	assert.equal(h.menu()?.items.length, 5);
	h.menu()!.onSelect(4);
	assert.equal(h.state.keyScope, "tree-dialog");
	assert.equal(h.menu(), undefined);
	assert.equal(h.state.positions.global.cursor, 4);
	assert.equal(h.writes(), 0);
	h.state.notice = "Previous binding saved";
	editSetting(h.host, "keyScope");
	h.menu()!.onSelect(0);
	assert.equal(h.state.notice, undefined);
});
test("restore defaults confirms, marks only existing overrides for deletion, preserves unknowns", async () => {
	const h = fixture({ locale: "zh", defaultScope: "all", unknown: { future: true } });
	await readSettings(h.host);
	restoreSettingsDefaults(h.host);
	assert.equal(h.menu()?.initialIndex, 1);
	h.menu()!.onSelect(1);
	assert.equal(settingsDirtyCount(h.state), 0);
	assert.equal(h.writes(), 0);
	restoreSettingsDefaults(h.host);
	h.menu()!.onSelect(0);
	// 确认即落盘：两个覆盖都被删掉，没写过的未知字段原样保留。
	await settle();
	assert.equal(h.writes(), 1);
	assert.deepEqual(h.state.baseline?.raw, { unknown: { future: true } });
	assert.equal(h.state.phase, "open");
	assert.equal(h.applies(), 1);
	assert.equal(h.localeRefreshes(), 1);
	assert.deepEqual(h.state.patch, {});
	assert.equal(settingsDraft(h.state)?.locale, undefined);
	assert.equal(h.state.notice, "Interface language set to: Follow system · Default session scope set to: Current folder");
});
test("dirty exit defaults continue, discard requires second confirmation, clean exit immediate", async () => {
	const h = fixture();
	await readSettings(h.host);
	// 正常路径上改动都已经落盘，只有上一次提交失败才会留下草稿（这里直接构造）。
	setSettingsDraft(h.state, "locale", "zh");
	exitSettings(h.host);
	assert.equal(h.menu()?.initialIndex, 0);
	h.menu()!.onSelect(0);
	assert.equal(h.menu(), undefined);
	assert.equal(h.state.phase, "open");
	exitSettings(h.host);
	h.menu()!.onSelect(2);
	assert.equal(h.menu()?.initialIndex, 1);
	h.menu()!.onSelect(1);
	assert.equal(h.state.phase, "open");
	exitSettings(h.host);
	h.menu()!.onSelect(2);
	h.menu()!.onSelect(0);
	assert.equal(h.state.phase, "closed");
	assert.equal(h.writes(), 0);
	const clean = fixture();
	await readSettings(clean.host);
	exitSettings(clean.host);
	assert.equal(clean.state.phase, "closed");
});
test("save and exit waits for successful write and retains state on failure", async () => {
	const pending = deferred<ConfigSaveResult>();
	const h = fixture({}, { save: () => pending.promise });
	await readSettings(h.host);
	setSettingsDraft(h.state, "locale", "zh");
	const saving = saveSettings(h.host, true);
	assert.equal(h.state.phase, "open");
	assert.equal(h.state.saving, true);
	pending.reject(new Error("locale conflict"));
	await saving;
	assert.equal(h.state.phase, "open");
	assert.deepEqual(h.state.patch, { locale: "zh" });
	assert.match(h.state.error!, /locale conflict/);
	assert.equal(h.applies(), 0);
	h.source.save = async () => ({ snapshot: { raw: { locale: "zh", external: 12 }, fingerprint: "merged" }, warnings: [] });
	await saveSettings(h.host, true);
	assert.equal(h.state.phase, "closed");
	assert.deepEqual(h.state.baseline?.raw, { locale: "zh", external: 12 });
});
test("a failed write keeps the change, and s retries it", async () => {
	const h = fixture({ locale: "en" });
	const realSave = h.source.save;
	let fail = true;
	h.source.save = async (baseline, patch) => {
		if (fail) throw new Error("locale conflict");
		return realSave(baseline, patch);
	};
	await readSettings(h.host);
	editSetting(h.host, "locale");
	h.menu()!.onSelect(1);
	await settle();
	// 落盘失败：改动留着（重试还有东西可写），错误显示出来，语言还没切。
	assert.match(h.state.error!, /locale conflict/);
	assert.deepEqual(h.state.patch, { locale: "zh" });
	assert.equal(settingsDirtyCount(h.state), 1);
	assert.equal(settingsRetryKind(h.state), "commit");
	assert.equal(h.applies(), 0);
	assert.equal(h.state.baseline?.raw.locale, "en");
	assert.equal(h.writes(), 0, "失败的这次没有写成功");
	// 重试：这一次写成功，草稿清空、语言应用、错误和重试按钮都消失。
	fail = false;
	retrySettings(h.host);
	await settle();
	assert.equal(h.writes(), 1);
	assert.equal(h.applies(), 1);
	assert.deepEqual(h.state.patch, {});
	assert.equal(h.state.error, undefined);
	assert.equal(h.state.baseline?.raw.locale, "zh");
	assert.equal(settingsRetryKind(h.state), undefined);
	assert.equal(h.state.notice, "Interface language set to: Simplified Chinese");
	// 改回磁盘上已有的值 = 放弃这次改动：还没有落盘的改动和错误一起清掉，也不去写文件。
	fail = true;
	editSetting(h.host, "locale");
	h.menu()!.onSelect(1); // zh，也就是文件里的值
	await settle();
	assert.deepEqual(h.state.patch, {});
	assert.equal(h.state.error, undefined);
	assert.equal(settingsRetryKind(h.state), undefined);
	assert.equal(h.writes(), 1);
});
test("a failed read is retryable: s reads the file again", async () => {
	const h = fixture({}, { read: async () => {
		throw new Error("bad JSON");
	} });
	await readSettings(h.host);
	assert.equal(settingsRetryKind(h.state), "read");
	h.source.read = async () => ({ raw: { locale: "zh" }, fingerprint: "fixed" });
	retrySettings(h.host);
	await settle();
	assert.equal(h.state.baseline?.fingerprint, "fixed");
	assert.equal(h.state.error, undefined);
	assert.equal(settingsDirtyCount(h.state), 0);
	assert.equal(settingsRetryKind(h.state), undefined);
});
test("save is single-flight, frozen during persistence and language applies only after write", async () => {
	const pending = deferred<ConfigSaveResult>();
	let writes = 0;
	const h = fixture({}, { save: () => {
		writes++;
		return pending.promise;
	} });
	await readSettings(h.host);
	setSettingsDraft(h.state, "locale", "zh");
	const saving = saveSettings(h.host);
	await saveSettings(h.host);
	editSetting(h.host, "locale");
	restoreSettingsDefaults(h.host);
	reloadSettings(h.host);
	exitSettings(h.host);
	assert.equal(h.menu(), undefined);
	assert.equal(writes, 1);
	assert.equal(h.applies(), 0);
	setSettingsDraft(h.state, "locale", "en");
	assert.deepEqual(h.state.patch, { locale: "zh" });
	pending.resolve({ snapshot: { raw: { locale: "zh" }, fingerprint: "new" }, warnings: [] });
	await saving;
	assert.equal(h.applies(), 1);
	assert.equal(h.state.saving, false);
});
test("bad read is readonly with error, reload recovers, dirty reload requires confirmation", async () => {
	const h = fixture({}, { read: async () => {
		throw new Error("bad JSON");
	} });
	await readSettings(h.host);
	assert.equal(h.state.baseline, undefined);
	assert.match(h.state.error!, /bad JSON/);
	editSetting(h.host, "locale");
	assert.equal(h.menu(), undefined);
	await saveSettings(h.host);
	assert.equal(h.writes(), 0);
	h.source.read = async () => ({ raw: { locale: "en" }, fingerprint: "fixed" });
	await readSettings(h.host);
	setSettingsDraft(h.state, "locale", "zh");
	reloadSettings(h.host);
	h.menu()!.onCancel();
	assert.deepEqual(h.state.patch, { locale: "zh" });
	reloadSettings(h.host);
	h.menu()!.onSelect(0);
	await Promise.resolve();
	assert.deepEqual(h.state.patch, {});
	assert.equal((h.state.baseline as ConfigSnapshot | undefined)?.fingerprint, "fixed");
});
test("late reads cannot affect closed, reopened or disposed settings", async () => {
	for (const disposed of [false, true]) {
		const pending = deferred<ConfigSnapshot>();
		const h = fixture({}, { read: () => pending.promise });
		const reading = readSettings(h.host);
		if (disposed)
			h.dispose();
		else {
			h.host.closeSettings();
			h.state.phase = "open";
			h.source.read = async () => ({ raw: { locale: "en" }, fingerprint: "second" });
			await readSettings(h.host);
		}
		const before = h.refreshes();
		pending.resolve({ raw: { locale: "zh" }, fingerprint: "stale" });
		await reading;
		assert.notEqual(h.state.baseline?.fingerprint, "stale");
		assert.equal(h.refreshes(), before);
	}
});
test("late saves do not apply language or reset draft after close/reopen/dispose", async () => {
	for (const dispose of [false, true]) {
		const pending = deferred<ConfigSaveResult>();
		const h = fixture({}, { save: () => pending.promise });
		await readSettings(h.host);
		setSettingsDraft(h.state, "locale", "zh");
		const saving = saveSettings(h.host);
		if (dispose)
			h.dispose();
		else {
			h.host.closeSettings();
			h.state.phase = "open";
			h.state.saving = false;
			h.state.patch = { defaultScope: "all" };
		}
		const before = { ...h.state.patch };
		pending.resolve({ snapshot: { raw: { locale: "zh" }, fingerprint: "saved" }, warnings: [] });
		await saving;
		assert.equal(h.applies(), 0);
		assert.deepEqual(h.state.patch, before);
	}
});
test("persisted warnings and runtime apply failure are distinct and retained on save-exit", async () => {
	const h = fixture({}, {
		save: async () => ({ snapshot: { raw: { locale: "zh" }, fingerprint: "saved" }, warnings: ["lock cleanup failed"] }),
		apply: () => { throw new Error("language failed"); },
	});
	await readSettings(h.host);
	setSettingsDraft(h.state, "locale", "zh");
	await saveSettings(h.host, true);
	assert.deepEqual(h.state.patch, {});
	assert.equal(h.state.baseline?.fingerprint, "saved");
	assert.match(h.state.notice!, /lock cleanup failed/);
	assert.match(h.state.error!, /language failed/);
	assert.match(h.state.error!, /saved|Saved/);
	assert.equal(h.state.phase, "open");
	assert.equal(h.state.saving, false);
	// 文件已经写好了，重试也没用：不显示重试按钮（提示让人重新打开面板）。
	assert.equal(settingsRetryKind(h.state), undefined);
});
test("keybinding editor adds, removes, unbinds and resets a binding, writing each edit", async () => {
	const h = fixture();
	await readSettings(h.host);
	h.state.category = "keybindings";
	h.state.keyScope = "sessions";
	// The built-in default is shown even without a user override.
	assert.deepEqual(keymapDraftChords(h.state, "sessions", "session-delete"), ["d"]);
	editSetting(h.host, "session-delete");
	assert.equal(h.menu()?.items.length, 4); // add + remove d + unbind + reset
	h.menu()!.onSelect(0); // Add key…
	assert.ok(h.prompt());
	// The prompt records key presses instead of collecting text.
	assert.equal(h.prompt()!.capture, true);
	assert.equal(h.prompt()!.validate, undefined);
	h.prompt()!.onSubmit("ctrl+d");
	// 加完就落盘，落完菜单再打开（可以接着编下一条）。
	await settle();
	assert.deepEqual(h.state.baseline?.raw.keymap, { sessions: { "session-delete": ["d", "ctrl+d"] } });
	assert.equal(settingsDirtyCount(h.state), 0);
	assert.ok(h.menu());
	assert.equal(h.state.notice, "Key binding for Delete session(s) (Sessions pane) set to: d / Ctrl+d");
	// Menu reopened after the add; remove the original "d".
	h.menu()!.onSelect(1);
	await settle();
	assert.deepEqual(keymapDraftChords(h.state, "sessions", "session-delete"), ["ctrl+d"]);
	assert.deepEqual(h.state.baseline?.raw.keymap, { sessions: { "session-delete": "ctrl+d" } });
	// Reset back to the default deletes the override again.
	h.menu()!.onSelect(3);
	await settle();
	assert.deepEqual(keymapDraftChords(h.state, "sessions", "session-delete"), ["d"]);
	assert.ok(!keymapActionDirty(h.state, "sessions", "session-delete"));
	assert.equal(h.state.baseline?.raw.keymap, undefined);
	assert.match(h.state.notice!, /set to: d$/);
	assert.equal(h.writes(), 3);
});
test("pi-level open shortcut: capture one key, disable it, then reset to the built-in default", async () => {
	const h = fixture();
	await readSettings(h.host);
	h.state.category = "keybindings";
	// 没有用户值时只有「修改 / 关闭」：「恢复默认」要真的写过这一项才出现。
	editSetting(h.host, "openShortcut");
	assert.deepEqual(h.menu()?.items, ["Press a new key…", "Turn off"]);
	h.menu()!.onSelect(0);
	const prompt = h.prompt()!;
	// 单键录入：按下一个键就提交，裸字母 / Enter 被挡下并给出原因。
	assert.equal(prompt.capture, "single");
	assert.ok(prompt.validate!("l"));
	assert.ok(prompt.validate!("enter"));
	assert.equal(prompt.validate!("ctrl+l"), undefined);
	prompt.onSubmit("ctrl+l");
	await settle();
	// 立即落盘，通知里提醒要 /reload 才重新注册。
	assert.equal(h.state.baseline?.raw.openShortcut, "ctrl+l");
	assert.equal(settingsDirtyCount(h.state), 0);
	assert.equal(h.state.notice, "Open shortcut saved: Ctrl+l. Run /reload in pi to apply it");
	assert.equal(h.writes(), 1);
	// 关闭把 null 写进文件（不是删掉用户值）。
	editSetting(h.host, "openShortcut");
	assert.deepEqual(h.menu()?.items, ["Press a new key…", "Turn off", "Use default (Alt+l)"]);
	h.menu()!.onSelect(1);
	await settle();
	assert.equal(h.state.baseline?.raw.openShortcut, null);
	assert.equal(h.state.notice, "Open shortcut saved: Off. Run /reload in pi to apply it");
	// 已关闭时没有「关闭」这一项，但「恢复默认」还在。
	editSetting(h.host, "openShortcut");
	assert.deepEqual(h.menu()?.items, ["Press a new key…", "Use default (Alt+l)"]);
	h.menu()!.onSelect(1);
	await settle();
	// reset 删掉用户值，回到内置默认键。
	assert.ok(!Object.hasOwn(h.state.baseline!.raw, "openShortcut"));
	assert.equal(h.state.notice, "Open shortcut saved: Alt+l. Run /reload in pi to apply it");
	assert.equal(h.writes(), 3);
});
test("unbinding a default binding persists null and reset deletes the override on save", async () => {
	const h = fixture();
	await readSettings(h.host);
	h.state.category = "keybindings";
	h.state.keyScope = "tree";
	setKeymapDraft(h.state, "tree", "tree-copy", "unbind");
	assert.deepEqual(keymapDraftChords(h.state, "tree", "tree-copy"), []);
	await saveSettings(h.host);
	assert.deepEqual(h.state.baseline?.raw.keymap, { tree: { "tree-copy": null } });
	assert.equal(h.applies(), 1);
	setKeymapDraft(h.state, "tree", "tree-copy", "reset");
	await saveSettings(h.host);
	assert.equal(h.state.baseline?.raw.keymap, undefined);
});
test("restore defaults in a keybinding scope resets every overridden action", async () => {
	const h = fixture({ keymap: { tree: { "tree-copy": "c", "tree-fold": null } } });
	await readSettings(h.host);
	h.state.category = "keybindings";
	h.state.keyScope = "tree";
	restoreSettingsDefaults(h.host);
	h.menu()!.onSelect(0); // confirm
	await settle();
	assert.deepEqual(keymapDraftChords(h.state, "tree", "tree-copy"), ["y"]);
	assert.deepEqual(keymapDraftChords(h.state, "tree", "tree-fold"), ["z"]);
	assert.equal(h.state.baseline?.raw.keymap, undefined);
	assert.equal(settingsDirtyCount(h.state), 0);
});
test("openBindingEditor Esc on the add prompt returns to the action menu", async () => {
	const h = fixture();
	await readSettings(h.host);
	h.state.category = "keybindings";
	h.state.keyScope = "content";
	openBindingEditor(h.host, "content-copy");
	h.menu()!.onSelect(0); // Add key…
	assert.ok(h.prompt());
	h.prompt()!.onCancel();
	assert.equal(h.prompt(), undefined);
	assert.ok(h.menu()); // back on the action menu
	assert.equal(settingsDirtyCount(h.state), 0);
});
test("a key that cannot fire is refused until the user takes it from its owner", async () => {
	const h = fixture();
	await readSettings(h.host);
	h.state.category = "keybindings";
	h.state.keyScope = "sessions";
	// session-rename 排在 session-delete 后面：d 永远轮不到它。
	openBindingEditor(h.host, "session-rename");
	h.menu()!.onSelect(0); // Add key…
	h.prompt()!.onSubmit("d");
	// 拦下来了：一个字节都没写，处理菜单顶上来。
	assert.equal(h.writes(), 0);
	assert.match(h.menu()!.title, /"d" cannot fire/);
	assert.match(h.menu()!.title, /Delete session/);
	assert.match(h.menu()!.subject!, /Rename session/);
	assert.match(h.menu()!.items[0]!, /Take it from Delete session/);
	// 抢过来：delete 解绑，我们的 d 落盘，并说明这串键现在归谁。
	h.menu()!.onSelect(0);
	await settle();
	assert.deepEqual(h.state.baseline?.raw.keymap, { sessions: { "session-delete": null, "session-rename": ["r", "d"] } });
	assert.deepEqual(keymapDraftChords(h.state, "sessions", "session-rename"), ["r", "d"]);
	assert.deepEqual(keymapDraftChords(h.state, "sessions", "session-delete"), []);
	assert.equal(settingsDirtyCount(h.state), 0);
	assert.equal(h.writes(), 1);
	assert.match(h.state.notice!, /"d" now goes to Rename session/);
	assert.match(h.state.notice!, /Delete session\(s\) no longer fires/);
	assert.ok(h.menu()); // 落完盘回到绑定菜单
});

test("cancelling a refused key edit restores the draft the edit replaced", async () => {
	const h = fixture();
	await readSettings(h.host);
	h.state.category = "keybindings";
	h.state.keyScope = "sessions";
	// 编辑前已经有一份没落盘的改动（比如上一次保存失败留下的）。
	setKeymapDraft(h.state, "sessions", "session-rename", ["r", "z"]);
	openBindingEditor(h.host, "session-rename");
	h.menu()!.onSelect(0); // Add key…
	h.prompt()!.onSubmit("d");
	// Esc 取消这次改动：回到编辑前那份草稿，而不是清空。
	h.menu()!.onCancel();
	await settle();
	assert.deepEqual(keymapDraftChords(h.state, "sessions", "session-rename"), ["r", "z"]);
	assert.deepEqual(h.state.patch.keymap?.sessions?.["session-rename"], { set: ["r", "z"] });
	assert.deepEqual(keymapDraftChords(h.state, "sessions", "session-delete"), ["d"]);
	assert.equal(h.writes(), 0);
	assert.ok(h.menu()); // 回到绑定菜单
	// 菜单里选"取消这次改动"和 Esc 一样。
	h.menu()!.onSelect(0);
	h.prompt()!.onSubmit("d");
	h.menu()!.onSelect(1);
	await settle();
	assert.deepEqual(keymapDraftChords(h.state, "sessions", "session-rename"), ["r", "z"]);
	assert.equal(h.writes(), 0);
});

test("a key taken from another action is written and reported, and reset is guarded too", async () => {
	const h = fixture();
	await readSettings(h.host);
	h.state.category = "keybindings";
	h.state.keyScope = "sessions";
	// session-new 排在 session-delete 前面：d 按得出来，但 delete 的 d 不再触发。
	openBindingEditor(h.host, "session-new");
	h.menu()!.onSelect(0); // Add key…
	h.prompt()!.onSubmit("d");
	await settle();
	assert.deepEqual(h.state.baseline?.raw.keymap, { sessions: { "session-new": ["n", "d"] } });
	assert.equal(h.state.error, undefined);
	assert.equal(h.writes(), 1);
	assert.match(h.state.notice!, /"d" now goes to New session/);
	assert.match(h.state.notice!, /Delete session\(s\) no longer fires/);
	// 前缀重叠同理：g 归 New session 后，go-top 的 gg 再也触发不了。
	h.menu()!.onSelect(0);
	h.prompt()!.onSubmit("g");
	await settle();
	assert.match(h.state.notice!, /"g" now goes to New session/);
	assert.match(h.state.notice!, /Go to top no longer fires/);
});

test("reset to default is refused when the default key is taken, and a conflict already in the file never blocks", async () => {
	// 文件里 session-new 占了 r（它排在 session-rename 前面）。
	const h = fixture({ keymap: { sessions: { "session-new": "r", "session-rename": "z" } } });
	await readSettings(h.host);
	h.state.category = "keybindings";
	h.state.keyScope = "sessions";
	// 编辑前没有冲突（z 没人用）：Reset 把 rename 打回默认的 r，这一下才撞上 session-new。
	openBindingEditor(h.host, "session-rename");
	const resetIndex = h.menu()!.items.length - 1;
	assert.match(h.menu()!.items[resetIndex]!, /Reset to default/);
	h.menu()!.onSelect(resetIndex);
	assert.equal(h.writes(), 0);
	assert.match(h.menu()!.title, /"r" cannot fire/);
	assert.match(h.menu()!.title, /New session/);
	h.menu()!.onSelect(0); // 抢过来
	await settle();
	assert.deepEqual(h.state.baseline?.raw.keymap, { sessions: { "session-new": null } });
	// 文件里本来就有的冲突不该拦人：remove 掉自己另一条键照常落盘。
	const dirty = fixture({ keymap: { sessions: { "session-rename": ["r", "d"] } } });
	await readSettings(dirty.host);
	dirty.state.category = "keybindings";
	dirty.state.keyScope = "sessions";
	openBindingEditor(dirty.host, "session-rename");
	dirty.menu()!.onSelect(1); // Remove: r
	await settle();
	assert.equal(dirty.writes(), 1);
	assert.deepEqual(dirty.state.baseline?.raw.keymap, { sessions: { "session-rename": "d" } });
});

test("theme picker switches pi on the spot, without a preview or a save step", async () => {
	const h = fixture();
	await readSettings(h.host);
	assert.equal(h.state.activeTheme, "dark");
	h.state.category = "theme";
	editSetting(h.host, "theme");
	// pi 已保存的那个带标记、光标一开始就落在它上面。
	assert.deepEqual(h.menu()?.items, ["dark (active)", "nord"]);
	assert.equal(h.menu()?.initialIndex, 0);
	// 选当前主题：什么都不做。
	h.menu()!.onSelect(0);
	assert.deepEqual(h.themes.sets(), []);
	assert.equal(h.state.themeDraft, undefined);
	assert.equal(h.state.notice, undefined);
	// 换主题：回车当场切 pi（由 pi 持久化），草稿清空，不用再按 s。
	editSetting(h.host, "theme");
	h.menu()!.onSelect(1);
	assert.deepEqual(h.themes.sets(), ["nord"]);
	assert.equal(h.themes.active(), "nord");
	assert.equal(h.state.activeTheme, "nord");
	assert.equal(h.state.themeDraft, undefined);
	assert.equal(settingsDirtyCount(h.state), 0);
	assert.equal(h.state.notice, "Theme set to: nord");
	assert.equal((h.state.patch as Record<string, unknown>).theme, undefined, "主题不写进面板配置草稿");
	assert.equal(h.writes(), 0, "主题走 pi，不碰面板的配置文件");
	// 再打开：光标落在当前主题上，pi 生效的就是它。
	editSetting(h.host, "theme");
	assert.deepEqual(h.menu()?.items, ["dark", "nord (active)"]);
	assert.equal(h.menu()?.initialIndex, 1);
	h.menu()!.onCancel();
	assert.equal(h.state.themeDraft, undefined);
});
test("d on the theme page gives up on a failed switch, and does nothing without one", async () => {
	const h = fixture();
	(h.host as unknown as { themeSource: unknown }).themeSource = themeFixture(undefined, true).source;
	await readSettings(h.host);
	h.state.category = "theme";
	// 没有失败时 d 什么都不做（按钮本身也是灰的）。
	restoreSettingsDefaults(h.host);
	assert.equal(h.menu(), undefined);
	editSetting(h.host, "theme");
	h.menu()!.onSelect(1);
	assert.equal(h.state.themeDraft, "nord");
	assert.match(h.state.error ?? "", /invalid theme/);
	restoreSettingsDefaults(h.host);
	h.menu()!.onCancel();
	assert.equal(h.state.themeDraft, "nord");
	restoreSettingsDefaults(h.host);
	h.menu()!.onSelect(0);
	assert.equal(h.state.themeDraft, undefined);
	assert.equal(h.state.error, undefined);
	assert.equal(h.state.activeTheme, "dark");
	assert.equal(settingsDirtyCount(h.state), 0);
});
test("theme picker reports a missing port and an empty theme list without opening a menu", async () => {
	// 入口没注入 themeSource（例如别处复用面板）时只提示，不崩。
	const noPort = fixture();
	(noPort.host as { themeSource?: unknown }).themeSource = undefined;
	await readSettings(noPort.host);
	assert.deepEqual(noPort.state.themes, []);
	noPort.state.category = "theme";
	editSetting(noPort.host, "theme");
	assert.match(noPort.state.error ?? "", /theme/i);
	assert.equal(noPort.menu(), undefined);
	// pi 一个主题都没有（--no-themes 之类）时同样只提示。
	const empty = fixture();
	(empty.host as unknown as { themeSource: unknown }).themeSource = themeFixture([]).source;
	await readSettings(empty.host);
	empty.state.category = "theme";
	editSetting(empty.host, "theme");
	assert.equal(empty.state.themes.length, 0);
	assert.match(empty.state.error ?? "", /theme/i);
	assert.equal(empty.menu(), undefined);
});
test("a failed theme switch keeps the theme as a retryable change", async () => {
	const h = fixture();
	(h.host as unknown as { themeSource: unknown }).themeSource = themeFixture(undefined, true).source;
	await readSettings(h.host);
	h.state.category = "theme";
	editSetting(h.host, "theme");
	h.menu()!.onSelect(1);
	// pi 没切过去：当前主题没动，失败的那个留着等重试。
	assert.equal(h.state.activeTheme, "dark");
	assert.equal(h.state.themeDraft, "nord", "失败保留待重试的主题");
	assert.match(h.state.error ?? "", /invalid theme/);
	assert.equal(settingsRetryKind(h.state), "commit");
	assert.deepEqual(h.themes.sets(), []);
	// 带着一处没生效的改动退出，仍然会被挽留。
	exitSettings(h.host);
	assert.ok(h.menu());
	assert.equal(h.state.phase, "open");
	h.menu()!.onCancel();
	// 重试：pi 这次接受了，草稿清空、错误消失（主题重试也走同一条提交例程）。
	const fixed = themeFixture();
	(h.host as unknown as { themeSource: unknown }).themeSource = fixed.source;
	retrySettings(h.host);
	await settle();
	assert.deepEqual(fixed.sets(), ["nord"]);
	assert.equal(h.state.themeDraft, undefined);
	assert.equal(h.state.activeTheme, "nord");
	assert.equal(h.state.error, undefined);
	assert.equal(settingsRetryKind(h.state), undefined);
	assert.equal(h.state.phase, "open");
	assert.equal(h.state.notice, "Theme set to: nord");
});
test("reloading settings drops a pending failed theme switch", async () => {
	const h = fixture();
	(h.host as unknown as { themeSource: unknown }).themeSource = themeFixture(undefined, true).source;
	await readSettings(h.host);
	h.state.category = "theme";
	editSetting(h.host, "theme");
	h.menu()!.onSelect(1);
	assert.equal(h.state.themeDraft, "nord");
	reloadSettings(h.host);
	h.menu()!.onSelect(0);
	await settle();
	assert.equal(h.state.themeDraft, undefined);
	assert.equal(h.state.error, undefined);
	assert.equal(h.state.activeTheme, "dark");
});
