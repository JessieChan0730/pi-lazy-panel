/** Settings menus and persistence orchestration. Widgets never read or write files. */
import { resolveConfig, type ResolvedConfig, type SettingsPatch } from "../../config/config.ts";
import type { KeymapPatchValue } from "../../config/config-store.ts";
import { chordLabel, conflictKey, keymapConflicts, labelsFor, parseChord, type KeyConflict } from "../../config/keys.ts";
import { actionDescription, DEFAULT_KEYMAP, scopeTitle } from "../../config/keymap.ts";
import { KEY_SCOPES, LEFT_COLUMN_RATIO_MAX, LEFT_COLUMN_RATIO_MIN } from "../../constants.ts";
import { t } from "../../i18n/index.ts";
import type { ActionId, KeyChord, KeyHint, KeyScope } from "../../types.ts";
import { keymapDraftChords, restoreKeymapDraft, setKeymapDraft, setSettingsDraft, settingsDirtyCount, settingsDraft, settingsRetryKind, type EditableSetting, type SettingsState } from "../settings-state.ts";
import { confirmDialogSpec } from "../widgets/confirm-dialog.ts";
import { numericInputValue } from "../widgets/input-dialog.ts";
import type { SettingsFlowHost } from "./host.ts";
function current(h: SettingsFlowHost, generation: number): boolean {
	return !h.isDisposed() && h.state.settings.phase === "open" && h.state.settings.generation === generation;
}
function hints(): KeyHint[] {
	return [["j/k", t("hint.move")], ["Enter", t("hint.choose")], ["Esc", t("hint.cancel")]];
}
/**
 * Every edit goes through here: the draft is written and immediately persisted.
 * A value that round-trips to the on-disk one leaves no draft (setSettingsDraft /
 * setKeymapDraft drop it), so nothing is written for a no-op pick.
 *
 * 每一次改动都由这里落盘：草稿与磁盘一致时什么都不做。保存进行中（saving）时
 * setSettingsDraft 会直接返回，极快地连改两项时第二次选择可能被丢掉——每次落盘
 * 只是一次本地文件写 + initI18n，窗口很小，这里不引入排队。
 */
function commitDraft(h: SettingsFlowHost): void {
	if (settingsDirtyCount(h.state.settings)) {
		void saveSettings(h);
		return;
	}
	// 选回磁盘上已有的值 = 没有改动（草稿被 setSettingsDraft 清掉了）：上一次的失败也一并
	// 清掉，没有东西可重试了，别留一条没有重试按钮的错误。
	h.state.settings.error = undefined;
	h.refreshSettings();
}
/**
 * Retry whatever the last commit failed at: a failed read is re-read, a failed
 * write (or a theme pi refused to switch to) re-runs the commit routine — which
 * keeps the draft, so the retry has something to write.
 */
export function retrySettings(h: SettingsFlowHost): void {
	const kind = settingsRetryKind(h.state.settings);
	if (kind === "read") void readSettings(h);
	else if (kind === "commit") void saveSettings(h);
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
	// 主题是 pi 的状态、不走配置草稿：读它当前的主题列表和已保存的主题，并丢掉上一次
	// 切换失败留下的待重试主题（`r` 重新加载要回到 pi 真正生效的那个主题）。每次打开都
	// 重新扫描列表，新丢进 pi 主题目录的文件立刻可见。
	s.themeDraft = undefined;
	s.themes = h.themeSource?.list() ?? [];
	s.activeTheme = h.themeSource?.savedName();
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
				if (current(h, generation)) {
					if (s.keyScope !== KEY_SCOPES[index]) s.notice = undefined;
					s.keyScope = KEY_SCOPES[index]!;
				}
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
				commitDraft(h);
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
			commitDraft(h);
		},
		onCancel: () => h.closeDialogs(),
	});
}

/**
 * Theme picker. Unlike every other picker this one shows pi's themes rather than
 * a fixed list; picking one switches pi right away (pi persists it in its own
 * settings.json), so there is no preview and no save step (see docs/theme.md).
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
		initialIndex: Math.max(0, s.themes.findIndex((ref) => ref.name === (s.themeDraft ?? active))),
		hints: hints(),
		onSelect: (index) => {
			h.closeDialogs();
			if (!current(h, generation)) return;
			const name = s.themes[index]?.name;
			if (name !== undefined) applyTheme(h, name);
		},
		onCancel: () => h.closeDialogs(),
	});
}

/**
 * Switch pi to the picked theme on the spot: `set` goes through pi's own
 * `ctx.ui.setTheme`, which persists the choice in pi's settings.json. A failure
 * (pi refused the theme) keeps the name as the pending change, so the panel can
 * report it and `s` can retry the switch. Picking the theme pi already has means
 * "never mind" — it drops a pending failed switch.
 */
function applyTheme(h: SettingsFlowHost, name: string): void {
	const s = h.state.settings;
	if (name === s.activeTheme) {
		if (s.themeDraft === undefined) {
			h.refreshSettings();
			return;
		}
		s.themeDraft = undefined;
		s.error = undefined;
		s.notice = undefined;
		h.refreshSettings();
		return;
	}
	if (!h.themeSource) {
		s.error = t("settings.themeUnavailable");
		h.refreshSettings();
		return;
	}
	const switched = h.themeSource.set(name);
	if (switched.success) {
		s.activeTheme = name;
		s.themeDraft = undefined;
		s.error = undefined;
		s.notice = t("settings.themeApplied", { name });
	} else {
		s.themeDraft = name;
		s.error = t("settings.themeApplyFailed", { error: switched.error ?? name });
		s.notice = undefined;
	}
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
			// 只有这次改动新引进来的冲突才拦人：编辑前先记一份（文件里本来就有的冲突不算）。
			const previous = draftEntry(s, scope, action);
			const before = conflictKeys(s, scope, action);
			if (index === unbindIndex) setKeymapDraft(s, scope, action, "unbind");
			else if (index === resetIndex) setKeymapDraft(s, scope, action, "reset");
			else setKeymapDraft(s, scope, action, chords.filter((_, i) => i !== index - removeOffset));
			finishBindingEdit(h, scope, action, generation, previous, before);
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
			if (!current(h, generation)) return;
			const previous = draftEntry(s, scope, action);
			const before = conflictKeys(s, scope, action);
			if (!chords.includes(chord)) setKeymapDraft(s, scope, action, [...chords, chord]);
			finishBindingEdit(h, scope, action, generation, previous, before);
		},
		onCancel: () => {
			h.closeDialogs();
			if (current(h, generation)) openBindingEditor(h, action);
		},
	});
}

/**
 * 一次键位改动之后的闸门：只有"按得出来"的绑定才落盘。
 *
 * 同一个作用域里先精确匹配上的那条拿走按键（见 `resolveKeys`），所以后一个同键绑定是静默
 * 失效的 —— 而这很容易造出来：在排在占用者下面的动作上 Add key 就是。这类 `dead` 冲突交给
 * 用户决定（从占用者手里抢过来 / 取消这次改动）；`steals` 按得出来，但会让另一个动作的同键
 * 不再触发，落盘成功后补一句提示。
 *
 * `before` 是编辑前的冲突集合：文件里本来就有的冲突（手工写重复的键）不该拦住一次无关的编辑。
 */
function finishBindingEdit(h: SettingsFlowHost, scope: KeyScope, action: ActionId, generation: number, previous: KeymapPatchValue | undefined, before: ReadonlySet<string>): void {
	const s = h.state.settings;
	const draft = settingsDraft(s);
	if (!s.baseline || !draft || !current(h, generation)) return;
	const conflicts = keymapConflicts(draft.keymap[scope], action).filter((conflict) => !before.has(conflictKey(conflict)));
	const dead = conflicts.filter((conflict) => conflict.kind === "dead");
	if (dead.length) {
		openConflictMenu(h, scope, action, generation, previous, dead);
		return;
	}
	const stolen = conflicts.find((conflict) => conflict.kind === "steals");
	saveBindingEdit(h, action, generation, stolen ? conflictNotice(stolen, action) : undefined);
}

/** `dead` 冲突的收尾：把选择交给用户 —— 从占用者手里抢过来，或者取消这次改动。 */
function openConflictMenu(h: SettingsFlowHost, scope: KeyScope, action: ActionId, generation: number, previous: KeymapPatchValue | undefined, dead: KeyConflict[]): void {
	const s = h.state.settings;
	const first = dead[0]!;
	const ownerLabel = actionDescription(first.other);
	h.openMenu("settings", {
		title: t("settings.keyConflict.title", { key: chordLabel(first.chord), action: ownerLabel }),
		subject: actionDescription(action),
		items: [t("settings.keyConflict.take", { action: ownerLabel }), t("settings.keyConflict.cancel")],
		hints: hints(),
		onSelect: (index) => {
			h.closeDialogs();
			if (!current(h, generation)) return;
			if (index !== 0) {
				cancelBindingEdit(h, scope, action, generation, previous);
				return;
			}
			// 抢过来：先把这串键从每个占用者手里摘掉（摘空了就是解绑），再落盘我们的改动。
			// 同一个占用者可能占着多条（两条冲突指向同一个动作），先合并再写，免得后一次覆盖前一次。
			const releases = new Map<ActionId, KeyChord[]>();
			for (const conflict of dead) {
				const chords = releases.get(conflict.other) ?? keymapDraftChords(s, scope, conflict.other);
				releases.set(conflict.other, chords.filter((chord) => chord !== conflict.otherChord));
			}
			for (const [owner, remaining] of releases) setKeymapDraft(s, scope, owner, remaining);
			saveBindingEdit(h, action, generation, conflictNotice(first, action));
		},
		onCancel: () => {
			h.closeDialogs();
			cancelBindingEdit(h, scope, action, generation, previous);
		},
	});
}

/** 取消一次被拦下的改动：草稿还原成编辑前那份（错误 / 提示不动），回到绑定菜单。 */
function cancelBindingEdit(h: SettingsFlowHost, scope: KeyScope, action: ActionId, generation: number, previous: KeymapPatchValue | undefined): void {
	if (!current(h, generation)) return;
	restoreKeymapDraft(h.state.settings, scope, action, previous);
	openBindingEditor(h, action);
}

/** 落盘这次键位改动，成功且没有错误时回到绑定菜单；冲突提示追加在具体设置结果后面。 */
function saveBindingEdit(h: SettingsFlowHost, action: ActionId, generation: number, notice?: string): void {
	void saveSettings(h).then(() => {
		const s = h.state.settings;
		if (!current(h, generation) || s.error) return;
		if (notice) s.notice = [s.notice, notice].filter((text): text is string => !!text).join(" · ");
		openBindingEditor(h, action);
	});
}

/** `steals` 的提示文案：这串键现在归谁，谁不再触发它。 */
function conflictNotice(conflict: KeyConflict, owner: ActionId): string {
	return t("settings.keyConflict.stolen", { key: chordLabel(conflict.chord), action: actionDescription(owner), other: actionDescription(conflict.other) });
}

/** 这个 (scope, action) 当前的草稿条目；编辑前捕获，取消时原样还原。 */
function draftEntry(s: SettingsState, scope: KeyScope, action: ActionId): KeymapPatchValue | undefined {
	return s.patch.keymap?.[scope]?.[action];
}

/** 当前草稿里 `action` 的冲突集合 —— 改动前后各取一次，差集才是这次引进来的。 */
function conflictKeys(s: SettingsState, scope: KeyScope, action: ActionId): Set<string> {
	const draft = settingsDraft(s);
	return new Set(keymapConflicts(draft?.keymap[scope] ?? {}, action).map(conflictKey));
}

export function restoreSettingsDefaults(h: SettingsFlowHost): void {
	const s = h.state.settings;
	if (s.loading || s.saving)
		return;
	// 主题页的 d 撤掉切换失败的那个主题（它没有"默认值"可还原，成功切换过的也没得撤）。
	if (s.category === "theme") {
		if (s.themeDraft === undefined) return;
		const generation = s.generation;
		h.openMenu("settings", confirmDialogSpec({
			title: t("settings.restoreThemeConfirm"),
			onConfirm: () => {
				h.closeDialogs();
				if (!current(h, generation)) return;
				s.themeDraft = undefined;
				s.error = undefined;
				s.notice = undefined;
				h.refreshSettings();
			},
			onCancel: () => h.closeDialogs(),
		}));
		return;
	}
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
			commitDraft(h);
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
			commitDraft(h);
		},
		onCancel: () => h.closeDialogs(),
	}));
}
// 正常路径上改动都已经落盘，只有上一次提交失败时才会走到这个菜单（草稿还在）。
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
		title: t("settings.unsavedTitle"), items: [t("settings.continue"), t("settings.retryExit"), t("settings.discardExit")], hints: hints(), initialIndex: 0,
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
						if (!current(h, generation))
							return;
						// 放弃就是真的丢掉：没写成功的草稿和没切过去的主题都不再留着。
						s.patch = {};
						s.themeDraft = undefined;
						s.error = undefined;
						h.closeSettings();
					},
					onCancel: () => h.closeDialogs(),
				}));
		},
		onCancel: () => h.closeDialogs(),
	});
}
/** Use the committed values, after apply has switched the UI language. */
function appliedNotices(config: ResolvedConfig, patch: SettingsPatch): string[] {
	const notices: string[] = [];
	for (const key of Object.keys(patch) as EditableSetting[]) {
		if (key === "keymap") {
			for (const scope of KEY_SCOPES) {
				for (const action of Object.keys(patch.keymap?.[scope] ?? {}) as ActionId[]) {
					notices.push(t("settings.keyApplied", {
						scope: scopeTitle(scope), action: actionDescription(action),
						value: labelsFor(config.keymap, scope, action).join(" / ") || t("settings.unbound"),
					}));
				}
			}
			continue;
		}
		const setting = t(key === "leftColumnRatio" ? "settings.leftWidth" : `settings.${key}`);
		const value = key === "locale"
			? (config.locale ? t(`settings.language.${config.locale}`) : t("settings.system"))
			: key === "leftColumnRatio"
				? `${Number((config.leftColumnRatio * 100).toFixed(2))}%`
				: key === "defaultScope" ? t(`settings.scope.${config.defaultScope}`) : t(`settings.sort.${config.defaultSort}`);
		notices.push(t("settings.settingApplied", { setting, value }));
	}
	return notices;
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
	const patch = { ...s.patch };
	s.saving = true;
	s.error = undefined;
	s.notice = undefined;
	h.refreshSettings();
	try {
		const result = await h.settingsSource.save(s.baseline, patch);
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
		// 主题不在面板的配置文件里：待重试的切换单独交给 pi（它写自己的 settings.json）。
		// 放在 apply 之后，失败也不盖掉上面的错误；失败时保留 themeDraft，`s` 可以再试。
		let themeNotice: string | undefined;
		if (s.themeDraft !== undefined) {
			const name = s.themeDraft;
			const switched = h.themeSource?.set(name);
			if (switched?.success) {
				s.activeTheme = name;
				s.themeDraft = undefined;
				themeNotice = t("settings.themeApplied", { name });
			} else if (!s.error) {
				s.error = t("settings.themeApplyFailed", { error: switched?.error ?? name });
			}
		}
		s.notice = [
			...(!s.error ? appliedNotices(s.config, patch) : []),
			themeNotice,
			result.warnings.length ? t("settings.savedWarning", { warning: result.warnings.join("; ") }) : undefined,
		].filter((text): text is string => !!text).join(" · ") || undefined;
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
