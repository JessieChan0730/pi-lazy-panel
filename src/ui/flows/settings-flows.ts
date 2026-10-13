/** Settings menus and persistence orchestration. Widgets never read or write files. */
import { resolveConfig } from "../../config/config.ts";
import { chordLabel, parseChord } from "../../config/keys.ts";
import { actionDescription, DEFAULT_KEYMAP, scopeTitle } from "../../config/keymap.ts";
import { KEY_SCOPES, LEFT_COLUMN_RATIO_MAX, LEFT_COLUMN_RATIO_MIN } from "../../constants.ts";
import { t } from "../../i18n/index.ts";
import type { ActionId, KeyHint } from "../../types.ts";
import { keymapDraftChords, setKeymapDraft, setSettingsDraft, settingsDirtyCount, settingsDraft, type EditableSetting } from "../settings-state.ts";
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
	// 主题是 pi 的状态、不走草稿：这里只把 pi 当前的主题列表和活动主题读进来，
	// 每次打开设置页都重新扫描一遍（新丢进 ~/.pi/agent/themes 的文件立刻可见）。
	s.themes = h.themeSource?.list() ?? [];
	s.activeTheme = h.themeSource?.theme.name;
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
	if (key === "theme") {
		openThemePicker(h, generation);
		return;
	}
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
	if (s.category === "keybindings") {
		if (s.baseline) openBindingEditor(h, key as ActionId);
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

/**
 * Theme picker. Unlike every other page this one does not draft: the panel has
 * no theme of its own (see docs/theme.md), so picking a theme means switching
 * pi's theme, which pi persists in its own settings.json and applies at once
 * (the panel repaints on pi's theme change, and `applyTheme` requests one too).
 * Only listed themes are offered, so `set` failing is a real error worth a notice.
 */
function openThemePicker(h: SettingsFlowHost, generation: number): void {
	const s = h.state.settings;
	if (!h.themeSource) {
		s.error = t("settings.themeUnavailable");
		h.refreshSettings();
		return;
	}
	if (!s.themes.length) {
		s.error = t("settings.themeEmpty");
		h.refreshSettings();
		return;
	}
	const active = s.activeTheme;
	h.openMenu("settings", {
		title: t("settings.category.theme"),
		items: s.themes.map((ref) => ref.name === active ? t("settings.themeActive", { name: ref.name }) : ref.name),
		initialIndex: Math.max(0, s.themes.findIndex((ref) => ref.name === active)),
		hints: hints(),
		onSelect: (index) => {
			h.closeDialogs();
			if (!current(h, generation)) return;
			const name = s.themes[index]?.name;
			if (name === undefined || name === active) {
				h.refreshSettings();
				return;
			}
			applyTheme(h, generation, name);
		},
		onCancel: () => h.closeDialogs(),
	});
}

function applyTheme(h: SettingsFlowHost, generation: number, name: string): void {
	const s = h.state.settings;
	const result = h.themeSource?.set(name);
	if (!current(h, generation)) return;
	if (!result?.success) {
		s.error = t("settings.themeApplyFailed", { error: result?.error ?? name });
		h.refreshSettings();
		return;
	}
	s.activeTheme = name;
	s.notice = t("settings.themeApplied", { name });
	h.refreshSettings();
}

/**
 * Edit the key bindings of one action in the current scope: a menu to add a
 * chord (recorded by pressing the keys), remove an existing one, unbind the
 * action or reset it to the built-in default. Mutations reopen the menu so the
 * list stays visible for the next edit.
 */
export function openBindingEditor(h: SettingsFlowHost, action: ActionId): void {
	const s = h.state.settings;
	if (!s.baseline || s.loading || s.saving) return;
	const scope = s.keyScope;
	const generation = s.generation;
	const chords = keymapDraftChords(s, scope, action);
	const removeOffset = 1;
	const unbindIndex = removeOffset + chords.length;
	const resetIndex = unbindIndex + 1;
	const items = [t("settings.key.add"), ...chords.map((c) => t("settings.key.remove", { key: chordLabel(c) })), t("settings.key.unbind"), t("settings.key.reset")];
	h.openMenu("settings", {
		title: actionDescription(action), subject: scopeTitle(scope), items, hints: hints(),
		onSelect: (index) => {
			h.closeDialogs();
			if (!current(h, generation)) return;
			if (index === 0) {
				openAddBinding(h, action, chords);
				return;
			}
			if (index === unbindIndex) setKeymapDraft(s, scope, action, "unbind");
			else if (index === resetIndex) setKeymapDraft(s, scope, action, "reset");
			else setKeymapDraft(s, scope, action, chords.filter((_, i) => i !== index - removeOffset));
			h.refreshSettings();
			openBindingEditor(h, action);
		},
		onCancel: () => h.closeDialogs(),
	});
}

/**
 * Record one binding for `action`: the prompt captures key presses instead of
 * text (`InputDialog`'s `capture` mode), so the user presses the key they want
 * — including multi-key sequences like `gg`, confirmed with Enter — and never
 * has to know pi's chord syntax.
 */
function openAddBinding(h: SettingsFlowHost, action: ActionId, chords: string[]): void {
	const s = h.state.settings;
	const scope = s.keyScope;
	const generation = s.generation;
	h.openPrompt("settings", {
		title: t("settings.key.addTitle"), subject: scopeTitle(scope),
		capture: true, placeholder: t("settings.key.press"),
		hints: [["Enter", t("settings.key.save")], ["Backspace", t("settings.key.undo")], ["Esc", t("hint.cancel")]],
		onSubmit: (text) => {
			const chord = text.trim();
			if (!parseChord(chord)) return;
			h.closeDialogs();
			if (current(h, generation) && !chords.includes(chord)) setKeymapDraft(s, scope, action, [...chords, chord]);
			h.refreshSettings();
			if (current(h, generation)) openBindingEditor(h, action);
		},
		onCancel: () => {
			h.closeDialogs();
			if (current(h, generation)) openBindingEditor(h, action);
		},
	});
}

export function restoreSettingsDefaults(h: SettingsFlowHost): void {
	const s = h.state.settings;
	if (s.category === "keybindings") {
		restoreScopeBindings(h);
		return;
	}
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

/** Reset every action in the current scope back to its built-in default binding. */
function restoreScopeBindings(h: SettingsFlowHost): void {
	const s = h.state.settings;
	if (!s.baseline || s.loading || s.saving)
		return;
	const scope = s.keyScope;
	const generation = s.generation;
	const userScope = (s.baseline.raw.keymap as Record<string, Record<string, unknown>> | undefined)?.[scope];
	const actions = new Set([...Object.keys(userScope ?? {}), ...Object.keys(s.patch.keymap?.[scope] ?? {}), ...Object.keys(DEFAULT_KEYMAP[scope])]);
	h.openMenu("settings", confirmDialogSpec({
		title: t("settings.restoreScopeConfirm", { scope: scopeTitle(scope) }),
		onConfirm: () => {
			h.closeDialogs();
			if (!current(h, generation))
				return;
			for (const action of actions)
				setKeymapDraft(s, scope, action as ActionId, "reset");
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
