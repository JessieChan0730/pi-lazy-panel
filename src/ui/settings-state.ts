/** Settings navigation and transition state, owned by PanelState (no configuration draft yet). */

import type { KeyScope } from "../types.ts";

export const SETTINGS_CATEGORIES = ["general", "layout", "keybindings", "theme"] as const;
export type SettingsCategory = (typeof SETTINGS_CATEGORIES)[number];
export type SettingsRegion = "categories" | "list" | "buttons";

export interface SettingsPosition {
	cursor: number;
	scroll: number;
	detailScroll: number;
}

export interface SettingsState {
	phase: "closed" | "opening" | "open" | "closing";
	progress: number;
	category: SettingsCategory;
	region: SettingsRegion;
	keyScope: KeyScope;
	positions: Partial<Record<SettingsCategory | KeyScope, SettingsPosition>>;
}

export function createSettingsState(): SettingsState {
	return {
		phase: "closed",
		progress: 0,
		category: "general",
		region: "categories",
		keyScope: "global",
		positions: {},
	};
}
