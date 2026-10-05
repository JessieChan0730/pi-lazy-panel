/** Settings navigation and draft state, owned by PanelState. */

import { resolveConfig, type ResolvedConfig } from "../config/config.ts";
import type { ConfigSnapshot, GeneralSettingsPatch } from "../config/config-store.ts";
import type { KeyScope } from "../types.ts";

export const SETTINGS_CATEGORIES = ["general", "layout", "keybindings", "theme"] as const;
export type SettingsCategory = (typeof SETTINGS_CATEGORIES)[number];
export type SettingsRegion = "categories" | "list" | "buttons";
export type GeneralSetting = keyof GeneralSettingsPatch;

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
	patch: GeneralSettingsPatch;
	loading: boolean;
	saving: boolean;
	error: string | undefined;
	notice: string | undefined;
}

export function createSettingsState(): SettingsState {
	return {
		phase: "closed", category: "general", region: "categories", keyScope: "global", positions: {},
		button: 0, generation: 0, baseline: undefined, config: undefined, patch: {},
		loading: false, saving: false, error: undefined, notice: undefined,
	};
}

export function settingsDirtyCount(state: SettingsState): number {
	return Object.keys(state.patch).length;
}

/** A null is deletion intent, not a serializable configuration value. */
export function settingsDraft(state: SettingsState): ResolvedConfig | undefined {
	if (!state.baseline) return state.config;
	const raw = { ...state.baseline.raw };
	for (const [key, value] of Object.entries(state.patch)) {
		if (value === null) delete raw[key];
		else raw[key] = value;
	}
	return resolveConfig(raw);
}

export function setSettingsDraft<K extends GeneralSetting>(state: SettingsState, key: K, value: GeneralSettingsPatch[K]): void {
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
