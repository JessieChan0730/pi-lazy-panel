import assert from "node:assert/strict";
import { test } from "node:test";
import type { ConfigSaveResult, ConfigSnapshot } from "../src/config/config-store.ts";
import { initI18n } from "../src/i18n/index.ts";
import type { SettingsFlowHost } from "../src/ui/flows/host.ts";
import { editSetting, exitSettings, readSettings, reloadSettings, restoreSettingsDefaults, saveSettings } from "../src/ui/flows/settings-flows.ts";
import type { SettingsSource } from "../src/ui/ports.ts";
import { setSettingsDraft, settingsDirtyCount, settingsDraft } from "../src/ui/settings-state.ts";
import { createInitialState } from "../src/ui/state.ts";
import type { SelectDialogSpec } from "../src/ui/widgets/select-dialog.ts";
initI18n("en");
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
	let disposed = false;
	let writes = 0;
	let applies = 0;
	let refreshes = 0;
	let localeRefreshes = 0;
	const source: SettingsSource = {
		read: async () => snapshot,
		save: async (_baseline, patch) => {
			writes++;
			const next = { ...snapshot.raw };
			for (const [key, value] of Object.entries(patch)) {
				if (value === null)
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
		state, settingsSource: source,
		isDisposed: () => disposed,
		openMenu: (_mode: string, spec: SelectDialogSpec) => { menu = spec; },
		closeDialogs: () => { menu = undefined; },
		closeSettings: () => {
			state.settings.phase = "closed";
			state.settings.generation++;
		},
		refreshSettings: () => { refreshes++; },
		refreshConfig: () => { localeRefreshes++; },
	} as unknown as SettingsFlowHost;
	return { host, state: state.settings, source, menu: () => menu, dispose: () => {
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
