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
		"focus-next": "tab",
		"focus-prev": "shift+tab",
		"toggle-scope": ["C", "A"],
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
		"tree-label": "l",
		"tree-filter-default": "d",
		"tree-filter-tools": "t",
		"tree-filter-user": "u",
		"tree-filter-labeled": "L",
		"tree-filter-all": "a",
	},

	content: {
		"move-down": ["j", "down"],
		"move-up": ["k", "up"],
		"cursor-left": ["h", "left"],
		"cursor-right": ["l", "right"],
		"word-forward": "e",
		"word-backward": "b",
		"go-top": "gg",
		"go-bottom": "G",
		"center-cursor": "zz",
		"preview-toggle": "v",
		yank: "y",
		"yank-line": "yy",
	},
};

/** Short English description of every action, shown in the help overlay. */
export const ACTION_DESCRIPTIONS: Record<ActionId, string> = {
	"focus-next": "Focus next pane",
	"focus-prev": "Focus previous pane",
	"toggle-scope": "Toggle scope: Current folder / All",
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
	"tree-restore": "Restore conversation to this node",
	"tree-copy": "Copy node text",
	"tree-label": "Add / edit label",
	"tree-filter-default": "Filter: default",
	"tree-filter-tools": "Filter: tools",
	"tree-filter-user": "Filter: user messages only",
	"tree-filter-labeled": "Filter: labeled only",
	"tree-filter-all": "Filter: everything",
	"cursor-left": "Cursor left",
	"cursor-right": "Cursor right",
	"word-forward": "Word forward",
	"word-backward": "Word backward",
	"center-cursor": "Center cursor line",
	"preview-toggle": "Toggle preview mode",
	yank: "Yank selection",
	"yank-line": "Yank line",
};

/** Actions shown as footer hints per pane, in display order (first few that fit). */
export const FOOTER_HINTS: Record<PaneId, ActionId[]> = {
	sessions: ["search", "help", "focus-next", "toggle-scope", "session-resume", "session-delete", "session-rename", "quit"],
	tree: ["search", "help", "focus-next", "tree-restore", "tree-label", "tree-copy", "quit"],
	content: ["search", "help", "focus-next", "yank", "preview-toggle", "go-top", "quit"],
};

/** Display names of scopes in the help overlay. */
export const SCOPE_TITLES: Record<KeyScope, string> = {
	global: "Global",
	sessions: "Sessions pane",
	tree: "Tree pane",
	content: "Content pane",
};
