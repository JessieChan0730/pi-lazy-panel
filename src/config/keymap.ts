/**
 * Default keymap.
 *
 * Bindings follow docs/design.md and lazygit / vim conventions.
 * Users can override any of these via `~/.pi/agent/lazy-panel.json`
 * (see ./config.ts). Chord syntax (see ./keys.ts):
 *   "j"          single key            "ctrl+d"   modifier combo
 *   "G"          uppercase = shift+g   "gg"       two-key sequence
 *   "ctrl+w h"   space-separated multi-step sequence
 *
 * 默认键位是纯数据；解析/匹配逻辑在 keys.ts，合并用户配置在 config.ts。
 */

import { TREE_DIALOG_SCOPE } from "../constants.ts";
import { t } from "../i18n/index.ts";
import type { ActionId, KeyScope, Keymap, PaneId } from "../types.ts";

export const DEFAULT_KEYMAP: Keymap = {
	// 每个 scope 里 key 的书写顺序 = ? 帮助里的展示顺序（buildScopeLines 遍历 Object.keys），
	// 所以按使用频率排：高频在前。键位解析和顺序无关，footer 另有 FOOTER_HINTS 顺序，互不影响。
	global: {
		search: "/",
		// 面板切换参考 lazygit：h/l 前后切换，1/2/3 直接跳到对应编号的面板。
		"focus-next": ["l", "tab"],
		"focus-prev": "h",
		"focus-sessions": "1",
		"focus-tree": "2",
		"focus-content": "3",
		"search-next": "n",
		"search-prev": "N",
		// C / A 各自只切到一种范围，不做 toggle。
		"scope-current": "C",
		"scope-all": "A",
		help: "?",
		// 和 pi 的 /changelog 一样查看 pi 的更新日志（居中大弹窗，可滚动）。
		changelog: "@",
		quit: ["q", "ctrl+c"],
	},

	sessions: {
		"session-resume": "return",
		"move-down": ["j", "down"],
		"move-up": ["k", "up"],
		"go-top": "gg",
		"go-bottom": "G",
		"session-new": "n",
		"session-delete": "d",
		"session-rename": "r",
		"session-sort": "s",
		"session-info": "i",
		"session-toggle-select": "space",
		// c 压缩光标所在会话（对应 /compact）；C（大写）是全局 scope-current，不冲突。
		"session-compact": "c",
		"session-fork": "o",
		"session-clone": "y",
		"session-copy-last-reply": "Y",
		"scroll-content-down": "J",
		"scroll-content-up": "K",
		"session-export": "e",
		"session-import": "I",
		"session-share": "S",
	},

	tree: {
		"tree-restore": "return",
		"move-down": ["j", "down"],
		"move-up": ["k", "up"],
		"go-top": "gg",
		"go-bottom": "G",
		// 折叠 / 展开光标所在的分支段（vim 的 za）。
		"tree-fold": "z",
		// 小面板只显示部分数据，搜索 / 过滤放在 a 打开的完整树对话框里。
		"tree-open": "a",
		// 打标签用 T，和 pi 自带 /tree 的 shift+T 一致；这样 l 留给全局的“下一个面板”。
		"tree-label": "T",
		"tree-copy": "y",
	},

	// 只读面板：只保留上下滚动 + 顶部/底部（搜索 / 帮助等走 global）。
	content: {
		"move-down": ["j", "down"],
		"move-up": ["k", "up"],
		"go-top": "gg",
		"go-bottom": "G",
	},

	// 树对话框（a 打开）：这里只放对话框独有的键；j/k、gg/G、Enter、y、T、z 沿用 tree 面板的绑定，
	// `/` 沿用 global 的 search（在对话框里是聚焦顶部的搜索框）。过滤键和 pi /tree 的 ctrl+d/t/u/l/a 一一对应，
	// 所以 l 在对话框里是 labeled 过滤而不是"下一个面板"（h 没有对话框绑定，切面板在这里被关掉）。
	[TREE_DIALOG_SCOPE]: {
		"tree-filter-default": "d",
		"tree-filter-no-tools": "t",
		"tree-filter-user": "u",
		"tree-filter-labeled": "l",
		"tree-filter-all": "a",
		"tree-dialog-close": "q",
	},
};

/** Short description of `action`, shown in the help overlay (localised). */
export function actionDescription(action: ActionId): string {
	return t(`action.${action}`);
}

/**
 * Actions of outer scopes that do nothing while `scope` has the keys.
 * Inside the tree dialog, pane switching, list scope, n / N, quitting the
 * panel, `?` (every key is on the dialog's own hint row), `a` (the dialog
 * is already open) and `@` (the changelog) are switched off.
 *
 * 外层 scope 里在这里关掉的动作：对话框里 h/1/2/3/Tab 等不再切换面板（l 被对话框自己的
 * labeled 过滤遮住了），? 也不开帮助——对话框底部一行已经列全了它的键。
 */
export const DISABLED_ACTIONS: Partial<Record<KeyScope, ActionId[]>> = {
	[TREE_DIALOG_SCOPE]: [
		"focus-next",
		"focus-prev",
		"focus-sessions",
		"focus-tree",
		"focus-content",
		"scope-current",
		"scope-all",
		"search-next",
		"search-prev",
		"help",
		"quit",
		"tree-open",
		"changelog",
	],
};

/** Is `action` (bound in an outer scope) switched off while `scope` is focused? */
export function isDisabledIn(scope: KeyScope, action: ActionId): boolean {
	return DISABLED_ACTIONS[scope]?.includes(action) ?? false;
}

/**
 * Actions merged into a single help line (`?` overlay).
 *
 * 帮助面板里同类操作合并成一行，省空间：例如 1/2/3 显示成 `1..3  Focus pane by number`。
 * 合并只影响帮助展示，不影响键位解析。组内只要有 ≥2 个动作在当前 scope 绑定了键位就合并，
 * 否则退回单条展示；用户自定义键位一样会如实显示。
 */
export interface HelpGroup {
	/** Member actions, in the order their keys are listed. */
	actions: ActionId[];
	/** i18n key (under `helpGroup.`) for the merged line's description. */
	key: string;
}

/** Localised description of a merged help line. */
export function helpGroupText(group: HelpGroup): string {
	return t(`helpGroup.${group.key}`);
}

export const HELP_GROUPS: HelpGroup[] = [
	{ actions: ["focus-prev", "focus-next"], key: "focus" },
	{ actions: ["focus-sessions", "focus-tree", "focus-content"], key: "focusNumber" },
	{ actions: ["scope-current", "scope-all"], key: "scope" },
	{ actions: ["search-next", "search-prev"], key: "searchStep" },
	{ actions: ["go-top", "go-bottom"], key: "topBottom" },
	{ actions: ["scroll-content-down", "scroll-content-up"], key: "scrollContent" },
	{
		actions: ["tree-filter-default", "tree-filter-no-tools", "tree-filter-user", "tree-filter-labeled", "tree-filter-all"],
		key: "filters",
	},
];

/**
 * Actions shown as footer hints per pane, in display order (first few that fit).
 *
 * 只留最常用的键，长尾（排序 / 信息 / 压缩 / fork / clone / 复制 / 导出 / 导入 / 分享 / changelog）
 * 都收进 ? 帮助里，避免 footer 挤满一串半高频的键。
 */
export const FOOTER_HINTS: Record<PaneId, ActionId[]> = {
	sessions: ["search", "focus-next", "scope-current", "scope-all", "session-resume", "session-delete", "session-rename", "session-new", "help", "quit"],
	tree: ["search", "focus-next", "tree-restore", "tree-fold", "tree-open", "help", "quit"],
	content: ["search", "focus-next", "go-top", "go-bottom", "help", "quit"],
};

/**
 * Hint rows of the tree dialog (its bottom row and the footer), in display
 * order — the first ones survive a narrow terminal, so `q close` comes before
 * the filters; an inner array is one merged hint such as `d/t/u/l/a filter`.
 * Keys come from the resolved keymap (`tree-dialog` scope, then `tree`, then
 * `global`), the wording from treeDialogHintText().
 */
export const TREE_DIALOG_FOOTER: ActionId[][] = [
	["search"],
	["move-down", "move-up"],
	["tree-restore"],
	["tree-dialog-close"],
	["tree-fold"],
	["tree-filter-default", "tree-filter-no-tools", "tree-filter-user", "tree-filter-labeled", "tree-filter-all"],
	["tree-copy"],
	["tree-label"],
];

/** Wording of a TREE_DIALOG_FOOTER hint (localised), keyed by its first action. */
export function treeDialogHintText(action: ActionId): string {
	return t(`treeHint.${action}`);
}

/** Display name of a scope in the help overlay (localised). */
export function scopeTitle(scope: KeyScope): string {
	return t(`scopeTitle.${scope}`);
}

/** Pane title shown in the frame header (localised); the panel prefixes it with the jump key ("[1] SESSIONS"). */
export function paneTitleText(pane: PaneId): string {
	return t(`pane.${pane}Title`);
}

/** Action that focuses each pane, used to derive the "[1]" prefix from the resolved keymap. */
export const FOCUS_ACTIONS: Record<PaneId, ActionId> = {
	sessions: "focus-sessions",
	tree: "focus-tree",
	content: "focus-content",
};
