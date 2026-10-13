import assert from "node:assert/strict";
import { test } from "node:test";
import type { ConfigSaveResult, ConfigSnapshot, SettingsPatch } from "../src/config/config-store.ts";
import { applyKeymapPatch } from "../src/config/config-store.ts";
import { initI18n } from "../src/i18n/index.ts";
import type { Theme } from "@earendil-works/pi-coding-agent";
import type { SettingsFlowHost } from "../src/ui/flows/host.ts";
import { editSetting, exitSettings, openBindingEditor, readSettings, reloadSettings, restoreSettingsDefaults, saveSettings } from "../src/ui/flows/settings-flows.ts";
import type { SettingsSource } from "../src/ui/ports.ts";
import { keymapActionDirty, keymapDraftChords, setKeymapDraft, setSettingsDraft, settingsDirtyCount, settingsDraft } from "../src/ui/settings-state.ts";
import { createInitialState } from "../src/ui/state.ts";
import type { InputDialogSpec } from "../src/ui/widgets/input-dialog.ts";
import type { SelectDialogSpec } from "../src/ui/widgets/select-dialog.ts";
initI18n("en");
/**
 * A fake pi theme port: `themes()` is the list `readSettings` scans, `active`
 * is what the panel would be painted with, and `set` records switches (or
 * fails, to cover the notice path).
 */
function themeFixture(list = [{ name: "dark", path: "/pi/theme/dark.json" }, { name: "nord", path: "/home/u/.pi/agent/themes/nord.json" }], fail = false) {
	let active = "dark";
	const sets: string[] = [];
	return {
		source: {
			list: () => list,
			theme: { name: active } as unknown as Theme,
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
test("General pickers only draft, cancel closes child; undo and no-op never write", async () => {
	const h = fixture({ locale: "en", defaultScope: "all" });
	await readSettings(h.host);
	editSetting(h.host, "locale");
	assert.equal(h.menu()?.initialIndex, 2);
	h.menu()!.onCancel();
	assert.equal(h.menu(), undefined);
	assert.equal(settingsDirtyCount(h.state), 0);
	editSetting(h.host, "locale");
	h.menu()!.onSelect(1);
	assert.equal(h.menu(), undefined);
	assert.deepEqual(h.state.patch, { locale: "zh" });
	assert.equal(settingsDraft(h.state)?.locale, "zh");
	assert.equal(h.applies(), 0);
	editSetting(h.host, "locale");
	h.menu()!.onSelect(2);
	await saveSettings(h.host);
	assert.equal(h.writes(), 0);
	assert.equal(h.applies(), 0);
	assert.equal(settingsDirtyCount(h.state), 0);
	editSetting(h.host, "defaultScope");
	h.menu()!.onSelect(0);
	editSetting(h.host, "defaultSort");
	h.menu()!.onSelect(3);
	assert.deepEqual(h.state.patch, { defaultScope: "current-folder", defaultSort: "threaded" });
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
});
test("restore defaults confirms, marks only existing overrides for deletion, preserves unknowns", async () => {
	const h = fixture({ locale: "zh", defaultScope: "all", unknown: { future: true } });
	await readSettings(h.host);
	restoreSettingsDefaults(h.host);
	assert.equal(h.menu()?.initialIndex, 1);
	h.menu()!.onSelect(1);
	assert.equal(settingsDirtyCount(h.state), 0);
	restoreSettingsDefaults(h.host);
	h.menu()!.onSelect(0);
	assert.deepEqual(h.state.patch, { locale: null, defaultScope: null });
	assert.equal(h.writes(), 0);
	assert.equal(settingsDraft(h.state)?.locale, undefined);
	await saveSettings(h.host);
	assert.deepEqual(h.state.baseline?.raw, { unknown: { future: true } });
	assert.equal(h.state.phase, "open");
	assert.equal(h.applies(), 1);
	assert.equal(h.localeRefreshes(), 1);
	assert.deepEqual(h.state.patch, {});
	assert.match(h.state.notice!, /Saved/i);
});
test("dirty exit defaults continue, discard requires second confirmation, clean exit immediate", async () => {
	const h = fixture();
	await readSettings(h.host);
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
});
test("keybinding editor adds, removes, unbinds and resets a binding", async () => {
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
	assert.deepEqual(keymapDraftChords(h.state, "sessions", "session-delete"), ["d", "ctrl+d"]);
	assert.ok(keymapActionDirty(h.state, "sessions", "session-delete"));
	// Menu reopened after the add; remove the original "d".
	h.menu()!.onSelect(1);
	assert.deepEqual(keymapDraftChords(h.state, "sessions", "session-delete"), ["ctrl+d"]);
	// Reset back to default clears the draft.
	h.menu()!.onSelect(3);
	assert.deepEqual(keymapDraftChords(h.state, "sessions", "session-delete"), ["d"]);
	assert.ok(!keymapActionDirty(h.state, "sessions", "session-delete"));
	assert.equal(h.writes(), 0);
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
	assert.deepEqual(keymapDraftChords(h.state, "tree", "tree-copy"), ["y"]);
	assert.deepEqual(keymapDraftChords(h.state, "tree", "tree-fold"), ["z"]);
	assert.equal(settingsDirtyCount(h.state), 2);
	await saveSettings(h.host);
	assert.equal(h.state.baseline?.raw.keymap, undefined);
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
test("theme picker lists pi's themes, marks the active one and switches immediately", async () => {
	const h = fixture();
	await readSettings(h.host);
	h.state.category = "theme";
	editSetting(h.host, "theme");
	// 当前主题带标记、且光标一开始就落在它上面（Enter 再按一次是空操作）。
	assert.deepEqual(h.menu()?.items, ["dark (active)", "nord"]);
	assert.equal(h.menu()?.initialIndex, 0);
	// 选当前主题：什么都不做（不写、不报）。
	h.menu()!.onSelect(0);
	assert.deepEqual(h.themes.sets(), []);
	assert.equal(h.state.notice, undefined);
	// 换主题：立刻应用（pi 负责持久化），面板记下新的活动主题并提示。
	editSetting(h.host, "theme");
	h.menu()!.onSelect(1);
	assert.deepEqual(h.themes.sets(), ["nord"]);
	assert.equal(h.themes.active(), "nord");
	assert.equal(h.state.activeTheme, "nord");
	assert.equal(h.state.notice, "Theme: nord");
	assert.equal((h.state.patch as Record<string, unknown>).theme, undefined, "主题不写进面板草稿");
	assert.equal(h.writes(), 0);
	// 再打开：列表里的标记跟着走。
	editSetting(h.host, "theme");
	assert.deepEqual(h.menu()?.items, ["dark", "nord (active)"]);
	h.menu()!.onCancel();
	assert.equal(h.state.notice, "Theme: nord");
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
test("a failed theme switch keeps the previous active theme", async () => {
	const h = fixture();
	(h.host as unknown as { themeSource: unknown }).themeSource = themeFixture(undefined, true).source;
	await readSettings(h.host);
	h.state.category = "theme";
	editSetting(h.host, "theme");
	h.menu()!.onSelect(1);
	assert.equal(h.state.activeTheme, "dark");
	assert.equal(h.state.notice, undefined);
	assert.match(h.state.error ?? "", /invalid theme/);
});
