/** Settings navigation and draft state, owned by PanelState. */

import { resolveConfig, type ResolvedConfig } from "../config/config.ts";
import { applyKeymapPatch, type ConfigSnapshot, type KeymapPatchValue, type SettingsPatch } from "../config/config-store.ts";
import type { ActionId, KeyChord, KeyScope } from "../types.ts";
import type { ThemeRef } from "./ports.ts";

export const SETTINGS_CATEGORIES = ["general", "layout", "keybindings", "theme"] as const;
export type SettingsCategory = (typeof SETTINGS_CATEGORIES)[number];
export type SettingsRegion = "categories" | "list" | "buttons";
export type EditableSetting = keyof SettingsPatch;

export interface SettingsPosition {
	cursor: number;
	scroll: number;
	detailScroll: number;
}

export interface SettingsState {
	phase: "closed" | "open";
	category: SettingsCategory;
	region: SettingsRegion;
	keyScope: KeyScope;
	positions: Partial<Record<SettingsCategory | KeyScope, SettingsPosition>>;
	button: number;
	/** Every open/read/close invalidates older asynchronous callbacks. */
	generation: number;
	baseline: ConfigSnapshot | undefined;
	config: ResolvedConfig | undefined;
	/**
	 * Theme page: pi's themes as of the last read, the name of the theme pi has
	 * saved, and the preview picked in the picker but not saved yet. None of it
	 * goes into the config patch — pi owns the theme (see docs/theme.md) — but the
	 * preview counts as one unsaved change and is dropped when the page closes.
	 */
	themes: readonly ThemeRef[];
	activeTheme: string | undefined;
	themeDraft: string | undefined;
	patch: SettingsPatch;
	loading: boolean;
	saving: boolean;
	error: string | undefined;
	notice: string | undefined;
}

export function createSettingsState(): SettingsState {
	return {
		phase: "closed", category: "general", region: "categories", keyScope: "global", positions: {},
		button: 0, generation: 0, baseline: undefined, config: undefined, themes: [], activeTheme: undefined, themeDraft: undefined, patch: {},
		loading: false, saving: false, error: undefined, notice: undefined,
	};
}

export function settingsDirtyCount(state: SettingsState): number {
	// 主题预览也是一处未保存的改动（保存时才写进 pi），所以计入数量、退出时要挽留。
	let count = state.themeDraft === undefined ? 0 : 1;
	for (const [key, value] of Object.entries(state.patch)) {
		if (key === "keymap") for (const actions of Object.values(value as NonNullable<SettingsPatch["keymap"]>)) count += Object.keys(actions!).length;
		else count++;
	}
	return count;
}

/** Does the draft change the binding of `action` in `scope` (shows the `*` marker)? */
export function keymapActionDirty(state: SettingsState, scope: KeyScope, action: ActionId): boolean {
	return state.patch.keymap?.[scope]?.[action] !== undefined;
}

/** Chords currently bound to `action` in `scope` by the draft, as raw chord strings. */
export function keymapDraftChords(state: SettingsState, scope: KeyScope, action: ActionId): KeyChord[] {
	const draft = settingsDraft(state);
	return toChordArray(draft?.keymap[scope][action]);
}

/** A null is deletion intent, not a serializable configuration value. */
export function settingsDraft(state: SettingsState): ResolvedConfig | undefined {
	if (!state.baseline) return state.config;
	const raw = { ...state.baseline.raw };
	for (const [key, value] of Object.entries(state.patch)) {
		if (key === "keymap") continue; // 嵌套 keymap diff 单独合并，见下。
		if (value === null) delete raw[key];
		else raw[key] = value;
	}
	if (state.patch.keymap) {
		const applied = applyKeymapPatch(raw.keymap, state.patch.keymap);
		if (Object.keys(applied).length) raw.keymap = applied;
		else delete raw.keymap;
	}
	return resolveConfig(raw);
}

export function setSettingsDraft<K extends EditableSetting>(state: SettingsState, key: K, value: SettingsPatch[K]): void {
	if (!state.baseline || state.loading || state.saving) return;
	const present = Object.hasOwn(state.baseline.raw, key);
	// 改回隐式默认值也应清除草稿，不把没有 override 的字段变成显式配置。
	const baselineValue = present ? state.baseline.raw[key] : resolveConfig(state.baseline.raw)[key];
	const unchanged = value === null ? !present : baselineValue === value;
	if (unchanged) delete state.patch[key];
	else Object.assign(state.patch, { [key]: value });
	state.error = undefined;
	state.notice = undefined;
}

/** What a key binding edit should become, relative to the on-disk user config. */
export type KeymapDraftEdit = KeyChord[] | "unbind" | "reset";

/**
 * Record one key binding edit for `action` in `scope`. The draft entry is kept
 * only when it actually differs from the on-disk user file, so round-tripping
 * back to the baseline clears the `*` marker (mirrors setSettingsDraft).
 */
export function setKeymapDraft(state: SettingsState, scope: KeyScope, action: ActionId, edit: KeymapDraftEdit): void {
	if (!state.baseline || state.loading || state.saving) return;
	const normalized = Array.isArray(edit) && edit.length === 0 ? "unbind" : edit;
	const base = baselineBinding(state, scope, action);
	let entry: KeymapPatchValue | undefined;
	if (normalized === "reset") entry = base.has ? { reset: true } : undefined;
	else if (normalized === "unbind") entry = base.value === null ? undefined : { unbind: true };
	else entry = sameChords(base, normalized) ? undefined : { set: normalized };
	const keymap = { ...(state.patch.keymap ?? {}) };
	const scopeMap = { ...(keymap[scope] ?? {}) };
	if (entry === undefined) delete scopeMap[action];
	else scopeMap[action] = entry;
	if (Object.keys(scopeMap).length) keymap[scope] = scopeMap;
	else delete keymap[scope];
	if (Object.keys(keymap).length) state.patch.keymap = keymap;
	else delete state.patch.keymap;
	state.error = undefined;
	state.notice = undefined;
}

/** The on-disk user binding for one (scope, action), used to decide if a draft edit is a real change. */
function baselineBinding(state: SettingsState, scope: KeyScope, action: ActionId): { has: boolean; value: unknown } {
	const keymap = state.baseline?.raw.keymap;
	if (!isRecord(keymap)) return { has: false, value: undefined };
	const scopeMap = keymap[scope];
	if (!isRecord(scopeMap) || !Object.hasOwn(scopeMap, action)) return { has: false, value: undefined };
	return { has: true, value: scopeMap[action] };
}

function sameChords(base: { has: boolean; value: unknown }, chords: KeyChord[]): boolean {
	if (!base.has || base.value === null) return false;
	const current = toChordArray(base.value);
	return current.length === chords.length && current.every((c, i) => c === chords[i]);
}

function toChordArray(value: unknown): KeyChord[] {
	if (typeof value === "string") return [value];
	if (Array.isArray(value)) return value.filter((c): c is string => typeof c === "string");
	return [];
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
