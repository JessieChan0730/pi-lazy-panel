/**
 * pi's own settings that change how the panel behaves.
 *
 * The extension context exposes no settings API, so this reads pi's
 * `~/.pi/agent/settings.json` (plus the project's `.pi/settings.json`)
 * through pi's `SettingsManager`, the same way pi does. `SettingsManager.create`
 * only reads the files (it takes the lock briefly and writes nothing). Only
 * this module should know about pi's settings file.
 *
 * 目前用到两项：`branchSummary.skipPrompt`（为 true 时 pi 内置 /tree 不问 No summary /
 * Summarize，直接不做摘要；面板的 TREE Enter 照做）和 `treeFilterMode`（内置 /tree 打开时的
 * 默认过滤，面板的 TREE 以它作为初始过滤）。读不到就按 pi 的默认值来。
 */

import { SettingsManager } from "@earendil-works/pi-coding-agent";
import type { TreeFilter } from "../types.ts";

export interface PiSettings {
	/** `branchSummary.skipPrompt`: skip the "Summarize branch?" menu and restore without a summary. */
	skipBranchSummaryPrompt: boolean;
	/** `treeFilterMode`: the filter pi's /tree opens with, in the panel's naming (`labeled-only` → `labeled`). */
	treeFilter: TreeFilter;
}

/** pi's defaults, used when the settings cannot be read. */
export const DEFAULT_PI_SETTINGS: PiSettings = { skipBranchSummaryPrompt: false, treeFilter: "default" };

/** pi's `treeFilterMode` values mapped to the panel's `TreeFilter`. */
const TREE_FILTER_OF: Record<string, TreeFilter> = {
	default: "default",
	"no-tools": "no-tools",
	"user-only": "user-only",
	"labeled-only": "labeled",
	all: "all",
};

/**
 * Read the settings the panel cares about.
 * @param cwd session working directory (for the project-level file)
 * @param agentDir pi agent directory (usually ~/.pi/agent)
 * @param projectTrusted whether pi trusts the project (untrusted projects ignore `.pi/settings.json`)
 */
export function loadPiSettings(cwd: string, agentDir: string, projectTrusted = true): PiSettings {
	try {
		const manager = SettingsManager.create(cwd, agentDir, { projectTrusted });
		return {
			skipBranchSummaryPrompt: manager.getBranchSummarySkipPrompt(),
			// pi 自己已经把非法值归到 "default"，这里只是换成面板的命名。
			treeFilter: TREE_FILTER_OF[manager.getTreeFilterMode()] ?? "default",
		};
	} catch {
		return DEFAULT_PI_SETTINGS;
	}
}
