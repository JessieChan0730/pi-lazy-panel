/**
 * User configuration loading.
 *
 * Reads `~/.pi/agent/lazy-panel.json` (if present) and merges it over the
 * built-in defaults. Only this module should know where the file lives.
 *
 * 用户配置示例（所有字段可选）：
 * {
 *   "defaultScope": "all",
 *   "keymap": {
 *     "global":   { "help": "F1", "toggle-scope": ["C", "A", "ctrl+space"] },
 *     "sessions": { "session-delete": "ctrl+d", "session-share": null }
 *   }
 * }
 * 同一个 action 的用户键位会整体替换默认键位；值为 null 表示解绑。
 */

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { CONFIG_FILE_NAME, PANE_IDS } from "../constants.ts";
import type { ActionId, KeyChord, Keymap, KeyScope, PaneKeymap, UserConfig, UserPaneKeymap } from "../types.ts";
import { DEFAULT_KEYMAP } from "./keymap.ts";

/** Fully resolved configuration used at runtime. */
export interface ResolvedConfig {
	keymap: Keymap;
	defaultScope: NonNullable<UserConfig["defaultScope"]>;
	defaultSort: NonNullable<UserConfig["defaultSort"]>;
	leftColumnRatio: number;
	/** Non-fatal problems found while reading the user file (shown in the footer). */
	warnings: string[];
}

export const DEFAULT_CONFIG: ResolvedConfig = {
	keymap: DEFAULT_KEYMAP,
	defaultScope: "current-folder",
	defaultSort: "recent",
	leftColumnRatio: 0.25,
	warnings: [],
};

const KEY_SCOPES: KeyScope[] = ["global", ...PANE_IDS];

/**
 * Load user config from disk and merge over defaults.
 * A missing file yields the defaults; a broken file yields the defaults plus a warning.
 * @param agentDir pi agent directory (usually ~/.pi/agent)
 */
export async function loadConfig(agentDir: string): Promise<ResolvedConfig> {
	const file = join(agentDir, CONFIG_FILE_NAME);
	let raw: string;
	try {
		raw = await readFile(file, "utf8");
	} catch (err) {
		if ((err as NodeJS.ErrnoException).code === "ENOENT") return DEFAULT_CONFIG;
		return { ...DEFAULT_CONFIG, warnings: [`config: cannot read ${file}: ${(err as Error).message}`] };
	}
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch (err) {
		return { ...DEFAULT_CONFIG, warnings: [`config: invalid JSON in ${file}: ${(err as Error).message}`] };
	}
	return resolveConfig(parsed);
}

/** Pure merge step, separated from I/O so it can be unit-tested. */
export function resolveConfig(user: unknown): ResolvedConfig {
	const warnings: string[] = [];
	if (!isRecord(user)) {
		return { ...DEFAULT_CONFIG, warnings: ["config: top level must be an object"] };
	}
	const u = user as UserConfig;

	const defaultScope =
		u.defaultScope === "all" || u.defaultScope === "current-folder" ? u.defaultScope : DEFAULT_CONFIG.defaultScope;
	if (u.defaultScope !== undefined && defaultScope !== u.defaultScope) warnings.push(`config: unknown defaultScope "${String(u.defaultScope)}"`);

	const defaultSort =
		u.defaultSort === "threaded" || u.defaultSort === "recent" || u.defaultSort === "fuzzy" ? u.defaultSort : DEFAULT_CONFIG.defaultSort;
	if (u.defaultSort !== undefined && defaultSort !== u.defaultSort) warnings.push(`config: unknown defaultSort "${String(u.defaultSort)}"`);

	let leftColumnRatio = DEFAULT_CONFIG.leftColumnRatio;
	if (u.leftColumnRatio !== undefined) {
		if (typeof u.leftColumnRatio === "number" && u.leftColumnRatio >= 0.15 && u.leftColumnRatio <= 0.6) {
			leftColumnRatio = u.leftColumnRatio;
		} else {
			warnings.push("config: leftColumnRatio must be a number between 0.15 and 0.6");
		}
	}

	const keymap = mergeKeymap(DEFAULT_KEYMAP, u.keymap, warnings);
	return { keymap, defaultScope, defaultSort, leftColumnRatio, warnings };
}

/**
 * Deep-merge the user keymap over the defaults, scope by scope, action by action.
 * 用户为某个 action 提供的键位整体替换默认值（不是追加），null 表示解绑。
 */
export function mergeKeymap(base: Keymap, user: UserConfig["keymap"], warnings: string[] = []): Keymap {
	const out = {} as Keymap;
	for (const scope of KEY_SCOPES) out[scope] = { ...base[scope] };
	if (user === undefined) return out;
	if (!isRecord(user)) {
		warnings.push("config: keymap must be an object");
		return out;
	}
	for (const [scopeName, paneMap] of Object.entries(user)) {
		if (!KEY_SCOPES.includes(scopeName as KeyScope)) {
			warnings.push(`config: unknown keymap scope "${scopeName}"`);
			continue;
		}
		if (!isRecord(paneMap)) {
			warnings.push(`config: keymap.${scopeName} must be an object`);
			continue;
		}
		const target: PaneKeymap = out[scopeName as KeyScope];
		for (const [action, value] of Object.entries(paneMap as UserPaneKeymap)) {
			if (value === null) {
				delete target[action as ActionId];
				continue;
			}
			if (isChordValue(value)) {
				target[action as ActionId] = value;
			} else {
				warnings.push(`config: keymap.${scopeName}.${action} must be a string, string[] or null`);
			}
		}
	}
	return out;
}

function isChordValue(v: unknown): v is KeyChord | KeyChord[] {
	if (typeof v === "string") return v.trim().length > 0;
	return Array.isArray(v) && v.length > 0 && v.every((c) => typeof c === "string" && c.trim().length > 0);
}

function isRecord(v: unknown): v is Record<string, unknown> {
	return typeof v === "object" && v !== null && !Array.isArray(v);
}
