/**
 * Default keymap.
 *
 * Bindings follow the plan in 计划.md and lazygit / vim conventions.
 * Users can override any of these via `~/.pi/agent/lazy-panel.json`
 * (see ./config.ts). Chords use pi-tui key syntax ("ctrl+d", "shift+s")
 * and multi-key sequences are written verbatim ("gg", "yy").
 */

import type { Keymap } from "../types.ts";

export const DEFAULT_KEYMAP: Keymap = {
	global: {
		"focus-next": "tab",
		"focus-prev": "shift+tab",
		"toggle-scope": ["C", "A"],
		help: "?",
		quit: "q",
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
