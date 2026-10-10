/** Settings menus and persistence orchestration. Widgets never read or write files. */
import { resolveConfig } from "../../config/config.ts";
import { scopeTitle } from "../../config/keymap.ts";
import { KEY_SCOPES, LEFT_COLUMN_RATIO_MAX, LEFT_COLUMN_RATIO_MIN } from "../../constants.ts";
import { t } from "../../i18n/index.ts";
import type { KeyHint } from "../../types.ts";
import { setSettingsDraft, settingsDirtyCount, settingsDraft, type EditableSetting } from "../settings-state.ts";
import { confirmDialogSpec } from "../widgets/confirm-dialog.ts";
import { numericInputValue } from "../widgets/input-dialog.ts";
import type { SettingsFlowHost } from "./host.ts";
function current(h: SettingsFlowHost, generation: number): boolean {
	return !h.isDisposed() && h.state.settings.phase === "open" && h.state.settings.generation === generation;
}
function hints(): KeyHint[] {
	return [["j/k", t("hint.move")], ["Enter", t("hint.choose")], ["Esc", t("hint.cancel")]];
}
export async function readSettings(h: SettingsFlowHost): Promise<void> {
	const s = h.state.settings;
	if (s.saving || h.isDisposed() || s.phase !== "open")
		return;
	const generation = ++s.generation;
	s.loading = true;
	s.baseline = undefined;
	s.patch = {};
	s.error = undefined;
	s.notice = undefined;
	h.refreshSettings();
	try {
		if (!h.settingsSource)
			throw new Error(t("settings.unavailable"));
		const snapshot = await h.settingsSource.read();
		if (!current(h, generation))
			return;
		s.baseline = snapshot;
		s.config = resolveConfig(snapshot.raw);
	} catch (error) {
		if (!current(h, generation))
			return;
		s.error = t("settings.readFailed", { error: String(error) });
	} finally {
		if (current(h, generation)) {
			s.loading = false;
			h.refreshSettings();
		}
	}
}
export function reloadSettings(h: SettingsFlowHost): void {
	if (h.state.settings.saving || h.state.settings.loading)
		return;
	if (!settingsDirtyCount(h.state.settings)) {
		void readSettings(h);
		return;
	}
	h.openMenu("settings", confirmDialogSpec({
		title: t("settings.reloadConfirm"),
		onConfirm: () => {
			h.closeDialogs();
			void readSettings(h);
		},
		onCancel: () => h.closeDialogs(),
	}));
}
export function editSetting(h: SettingsFlowHost, key: string): void {
	const s = h.state.settings;
	if (s.loading || s.saving)
		return;
	const generation = s.generation;
	if (key === "keyScope") {
		h.openMenu("settings", {
			title: t("settings.keyScope"), items: KEY_SCOPES.map(scopeTitle), initialIndex: KEY_SCOPES.indexOf(s.keyScope), hints: hints(),
			onSelect: (index) => {
				h.closeDialogs();
				if (current(h, generation))
					s.keyScope = KEY_SCOPES[index]!;
				h.refreshSettings();
			},
			onCancel: () => h.closeDialogs(),
		});
		return;
	}
	if (!s.baseline)
		return;
	const draft = settingsDraft(s)!;
	if (key === "leftColumnRatio") {
		const min = LEFT_COLUMN_RATIO_MIN * 100;
		const max = LEFT_COLUMN_RATIO_MAX * 100;
		const initial = String(Number((draft.leftColumnRatio * 100).toPrecision(15)));
		h.openPrompt("settings", {
			title: t("settings.leftWidth"), value: initial,
			subject: t("settings.widthRange", { min, max }),
			hints: [["←/→", t("settings.widthStep")], ["Enter", t("hint.choose")], ["Esc", t("hint.cancel")]],
			numeric: { min, max, error: t("settings.widthInvalid", { min, max }) },
			onSubmit: (text) => {
				const value = numericInputValue(text, min, max);
				if (value === undefined) return;
				h.closeDialogs();
				// 原值确认不做浮点往返转换，保留手写配置的小数精度。
				if (current(h, generation)) setSettingsDraft(s, "leftColumnRatio", text.trim() === initial ? draft.leftColumnRatio : value / 100);
				h.refreshSettings();
			},
			onCancel: () => h.closeDialogs(),
		});
		return;
	}
	const options = key === "locale"
		? [null, "zh", "en"] as const
		: key === "defaultScope"
			? ["current-folder", "all"] as const
			: key === "defaultSort" ? ["recent", "created", "title", "threaded"] as const : undefined;
	if (!options)
		return;
	const field = key as EditableSetting;
	const items = options.map((value) => value === null ? t("settings.system") : key === "locale" ? t(`settings.language.${value}`) : t(`settings.${key === "defaultScope" ? "scope" : "sort"}.${value}`));
	h.openMenu("settings", {
		title: t(`settings.${key}`), items, initialIndex: options.findIndex((value) => value === (draft[field] ?? null)), hints: hints(),
		onSelect: (index) => {
			h.closeDialogs();
			if (current(h, generation))
				setSettingsDraft(s, field, options[index]!);
			h.refreshSettings();
		},
		onCancel: () => h.closeDialogs(),
	});
}
export function restoreSettingsDefaults(h: SettingsFlowHost): void {
	const s = h.state.settings;
	const fields = s.category === "general" ? ["locale", "defaultScope", "defaultSort"] as const : s.category === "layout" ? ["leftColumnRatio"] as const : undefined;
	if (!fields || !s.baseline || s.loading || s.saving)
		return;
	const generation = s.generation;
	h.openMenu("settings", confirmDialogSpec({
		title: t(s.category === "layout" ? "settings.restoreLayoutConfirm" : "settings.restoreConfirm"),
		onConfirm: () => {
			h.closeDialogs();
			if (!current(h, generation))
				return;
			for (const key of fields)
				setSettingsDraft(s, key, null);
			h.refreshSettings();
		},
		onCancel: () => h.closeDialogs(),
	}));
}
export function exitSettings(h: SettingsFlowHost): void {
	const s = h.state.settings;
	if (s.saving)
		return;
	if (!settingsDirtyCount(s)) {
		h.closeSettings();
		return;
	}
	const generation = s.generation;
	h.openMenu("settings", {
		title: t("settings.unsavedTitle"), items: [t("settings.continue"), t("settings.saveExit"), t("settings.discardExit")], hints: hints(), initialIndex: 0,
		onSelect: (index) => {
			h.closeDialogs();
			if (!current(h, generation))
				return;
			if (index === 1)
				void saveSettings(h, true);
			if (index === 2)
				h.openMenu("settings", confirmDialogSpec({
					title: t("settings.discardConfirm"),
					onConfirm: () => {
						h.closeDialogs();
						if (current(h, generation))
							h.closeSettings();
					},
					onCancel: () => h.closeDialogs(),
				}));
		},
		onCancel: () => h.closeDialogs(),
	});
}
export async function saveSettings(h: SettingsFlowHost, exit = false): Promise<void> {
	const s = h.state.settings;
	if (s.saving || s.loading || !s.baseline || !h.settingsSource || s.phase !== "open" || h.isDisposed())
		return;
	if (!settingsDirtyCount(s)) {
		if (exit)
			h.closeSettings();
		return;
	}
	const generation = s.generation;
	s.saving = true;
	s.error = undefined;
	s.notice = undefined;
	h.refreshSettings();
	try {
		const result = await h.settingsSource.save(s.baseline, { ...s.patch });
		if (!current(h, generation))
			return;
		// The merged snapshot (including unrelated external edits) is the new baseline.
		s.baseline = result.snapshot;
		s.config = resolveConfig(result.snapshot.raw);
		s.patch = {};
		try {
			await h.settingsSource.apply(s.config);
			if (!current(h, generation))
				return;
			h.refreshConfig(s.config);
		} catch (error) {
			if (!current(h, generation))
				return;
			s.error = t("settings.applyFailed", { error: String(error) });
		}
		s.notice = result.warnings.length ? t("settings.savedWarning", { warning: result.warnings.join("; ") }) : t("settings.saved");
		// Keep errors/warnings visible rather than losing them on save-and-exit.
		if (exit && !s.error && !result.warnings.length)
			h.closeSettings();
	} catch (error) {
		if (current(h, generation))
			s.error = t("settings.saveFailed", { error: String(error) });
	} finally {
		if (current(h, generation)) {
			s.saving = false;
			h.refreshSettings();
		}
	}
}
