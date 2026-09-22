/**
 * pi's own settings that change how the panel behaves.
 *
 * The extension context exposes no settings API, so this reads pi's
 * `~/.pi/agent/settings.json` (plus the project's `.pi/settings.json`)
 * through pi's `SettingsManager`, the same way pi does. `SettingsManager.create`
 * only reads the files (it takes the lock briefly and writes nothing). Only
 * this module should know about pi's settings file.
 *
 * 目前只用到 `branchSummary.skipPrompt`：为 true 时 pi 内置 /tree 不问 No summary /
 * Summarize，直接不做摘要；面板的 TREE Enter 照做。读不到就按 pi 的默认值来。
 */

import { SettingsManager } from "@earendil-works/pi-coding-agent";

export interface PiSettings {
	/** `branchSummary.skipPrompt`: skip the "Summarize branch?" menu and restore without a summary. */
	skipBranchSummaryPrompt: boolean;
}

/** pi's defaults, used when the settings cannot be read. */
export const DEFAULT_PI_SETTINGS: PiSettings = { skipBranchSummaryPrompt: false };

/**
 * Read the settings the panel cares about.
 * @param cwd session working directory (for the project-level file)
 * @param agentDir pi agent directory (usually ~/.pi/agent)
 * @param projectTrusted whether pi trusts the project (untrusted projects ignore `.pi/settings.json`)
 */
export function loadPiSettings(cwd: string, agentDir: string, projectTrusted = true): PiSettings {
	try {
		const manager = SettingsManager.create(cwd, agentDir, { projectTrusted });
		return { skipBranchSummaryPrompt: manager.getBranchSummarySkipPrompt() };
	} catch {
		return DEFAULT_PI_SETTINGS;
	}
}
