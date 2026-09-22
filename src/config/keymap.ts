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

import type { ActionId, KeyScope, Keymap, PaneId } from "../types.ts";

export const DEFAULT_KEYMAP: Keymap = {
	global: {
		// 面板切换参考 lazygit：h/l 前后切换，1/2/3 直接跳到对应编号的面板。
		"focus-next": ["l", "tab"],
		"focus-prev": "h",
		"focus-sessions": "1",
		"focus-tree": "2",
		"focus-content": "3",
		// C / A 各自只切到一种范围，不做 toggle。
		"scope-current": "C",
		"scope-all": "A",
		help: "?",
		quit: ["q", "ctrl+c"],
		search: "/",
		"search-next": "n",
		"search-prev": "N",
	},

	sessions: {
		"move-down": ["j", "down"],
		"move-up": ["k", "up"],
		"go-top": "gg",
		"go-bottom": "G",
		"scroll-content-down": "J",
		"scroll-content-up": "K",
		"session-resume": "return",
		"session-delete": "d",
		"session-rename": "r",
		"session-fork": "o",
		"session-toggle-select": "space",
		"session-export": "e",
		"session-import": "I",
		"session-share": "S",
		"session-clone": "y",
		"session-copy-last-reply": "Y",
		"session-sort": "s",
		"session-new": "n",
		"session-info": "i",
	},

	tree: {
		"move-down": ["j", "down"],
		"move-up": ["k", "up"],
		"go-top": "gg",
		"go-bottom": "G",
		"tree-restore": "return",
		"tree-copy": "y",
		// 打标签用 T，和 pi 自带 /tree 的 shift+T 一致；这样 l 留给全局的“下一个面板”。
		"tree-label": "T",
		// 小面板只显示部分数据，搜索 / 过滤放在 a 打开的完整树对话框里。
		"tree-open": "a",
		// 折叠 / 展开光标所在的分支段（vim 的 za）。
		"tree-fold": "z",
	},

	// 只读面板：只保留上下滚动 + 顶部/底部（搜索 / 帮助等走 global）。
	content: {
		"move-down": ["j", "down"],
		"move-up": ["k", "up"],
		"go-top": "gg",
		"go-bottom": "G",
	},
};

/** Short English description of every action, shown in the help overlay. */
export const ACTION_DESCRIPTIONS: Record<ActionId, string> = {
	"focus-next": "Focus next pane",
	"focus-prev": "Focus previous pane",
	"focus-sessions": "Focus sessions pane",
	"focus-tree": "Focus tree pane",
	"focus-content": "Focus content pane",
	"scope-current": "Scope: Current folder",
	"scope-all": "Scope: All",
	help: "Toggle this help",
	quit: "Quit the panel",
	search: "Search in the focused pane",
	"search-next": "Next search match",
	"search-prev": "Previous search match",
	"move-down": "Move cursor down",
	"move-up": "Move cursor up",
	"go-top": "Go to top",
	"go-bottom": "Go to bottom",
	"scroll-content-down": "Scroll content pane down",
	"scroll-content-up": "Scroll content pane up",
	"session-resume": "Resume session",
	"session-delete": "Delete session(s)",
	"session-rename": "Rename session",
	"session-fork": "Fork session and open the fork",
	"session-toggle-select": "Toggle multi-select",
	"session-export": "Export to HTML / JSONL",
	"session-import": "Import from JSONL",
	"session-share": "Share as private GitHub Gist",
	"session-clone": "Clone active branch to a new session",
	"session-copy-last-reply": "Copy last assistant reply",
	"session-sort": "Cycle sort: threaded / recent / fuzzy",
	"session-new": "New session",
	"session-info": "Session info",
	"tree-restore": "Restore conversation to this node (asks about a branch summary)",
	"tree-copy": "Copy node text",
	"tree-label": "Add / edit label",
	"tree-open": "Open the full tree dialog (search / filters live there)",
	"tree-fold": "Fold / unfold the branch under the cursor (inside a branch: fold it and jump to its head)",
};

/**
 * Global actions that do nothing in a given pane. The small tree pane only
 * shows a slice of the tree, so `/` search (and n / N) are left to the tree
 * dialog; pressing them in the pane just points at `a`.
 *
 * 小面板里禁用的全局动作：按下时 footer 提示去对话框里用，? 帮助里也不列出。
 */
export const DISABLED_GLOBAL_ACTIONS: Partial<Record<PaneId, ActionId[]>> = {
	tree: ["search", "search-next", "search-prev"],
};

/** Is `action` (a global binding) switched off while `pane` is focused? */
export function isDisabledIn(pane: PaneId, action: ActionId): boolean {
	return DISABLED_GLOBAL_ACTIONS[pane]?.includes(action) ?? false;
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
	/** Description for the merged line. */
	text: string;
}

export const HELP_GROUPS: HelpGroup[] = [
	{ actions: ["focus-prev", "focus-next"], text: "Focus previous / next pane" },
	{ actions: ["focus-sessions", "focus-tree", "focus-content"], text: "Focus pane by number" },
	{ actions: ["scope-current", "scope-all"], text: "Scope: current folder / all" },
	{ actions: ["search-next", "search-prev"], text: "Next / previous search match" },
	{ actions: ["go-top", "go-bottom"], text: "Go to top / bottom" },
	{ actions: ["scroll-content-down", "scroll-content-up"], text: "Scroll content pane down / up" },
];

/** Actions shown as footer hints per pane, in display order (first few that fit). */
export const FOOTER_HINTS: Record<PaneId, ActionId[]> = {
	sessions: ["search", "help", "focus-next", "scope-current", "scope-all", "session-resume", "session-delete", "session-rename", "quit"],
	tree: ["help", "focus-next", "tree-restore", "tree-fold", "tree-open", "tree-label", "tree-copy", "quit"],
	content: ["search", "help", "focus-next", "go-top", "go-bottom", "quit"],
};

/** Display names of scopes in the help overlay. */
export const SCOPE_TITLES: Record<KeyScope, string> = {
	global: "Global",
	sessions: "Sessions pane",
	tree: "Tree pane",
	content: "Content pane",
};

/** Pane title shown in the frame header; the panel prefixes it with the jump key ("[1] SESSIONS"). */
export const PANE_TITLES: Record<PaneId, string> = {
	sessions: "SESSIONS",
	tree: "TREE",
	content: "CONTENT",
};

/** Action that focuses each pane, used to derive the "[1]" prefix from the resolved keymap. */
export const FOCUS_ACTIONS: Record<PaneId, ActionId> = {
	sessions: "focus-sessions",
	tree: "focus-tree",
	content: "focus-content",
};
