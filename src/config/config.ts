/**
 * User configuration loading.
 *
 * Reads `~/.pi/agent/lazy-panel.json` (if present) and merges it over the
 * built-in defaults. Only this module should know where the file lives.
 *
 * TODO: implement loadConfig() / resolveKeymap().
 */

import type { Keymap, UserConfig } from "../types.ts";
import { DEFAULT_KEYMAP } from "./keymap.ts";

/** Fully resolved configuration used at runtime. */
export interface ResolvedConfig {
	keymap: Keymap;
	defaultScope: NonNullable<UserConfig["defaultScope"]>;
	defaultSort: NonNullable<UserConfig["defaultSort"]>;
	leftColumnRatio: number;
}

export const DEFAULT_CONFIG: ResolvedConfig = {
	keymap: DEFAULT_KEYMAP,
	defaultScope: "current-folder",
	defaultSort: "recent",
	leftColumnRatio: 0.25,
};

/**
 * Load user config from disk and merge over defaults.
 * @param _agentDir pi agent directory (usually ~/.pi/agent)
 */
export async function loadConfig(_agentDir: string): Promise<ResolvedConfig> {
	// TODO: read CONFIG_FILE_NAME, validate, deep-merge keymap per pane.
	return DEFAULT_CONFIG;
}
