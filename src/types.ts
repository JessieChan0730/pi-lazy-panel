/**
 * Shared type definitions for pi-lazy-panel.
 *
 * Keep this file free of runtime code — types only.
 */

import type { PANE_IDS } from "./constants.ts";

// ---------------------------------------------------------------------------
// Panes / focus
// ---------------------------------------------------------------------------

/** One of the three focusable panes. */
export type PaneId = (typeof PANE_IDS)[number];

/** Which set of sessions the sessions pane lists. */
export type ListScope = "current-folder" | "all";

/** Sort order of the sessions pane (mirrors pi's /resume picker). */
export type SessionSortMode = "threaded" | "recent" | "fuzzy";

/** Input mode of the panel, shown in the footer (vim-like). */
export type PanelMode = "normal" | "search" | "visual" | "preview";

// ---------------------------------------------------------------------------
// Data rows
// ---------------------------------------------------------------------------

/** A row in the sessions (left-top) pane. */
export interface SessionRow {
	/** Absolute path to the session .jsonl file. */
	file: string;
	/** Session UUID. */
	id: string;
	/** User-defined display name, if any (/name). */
	name?: string;
	/** Working directory the session was created in. */
	cwd: string;
	/** Model id last used in the session, if known. */
	model?: string;
	/** Short preview of the first user message. */
	preview: string;
	createdAt: number;
	updatedAt: number;
	messageCount: number;
}

/** A row in the tree (left-bottom) pane. */
export interface TreeRow {
	/** Entry id inside the session. */
	entryId: string;
	parentId?: string;
	depth: number;
	role: "user" | "assistant" | "system" | "tool";
	/** User-defined label on this entry (/tree shift+t). */
	label?: string;
	/** Truncated single-line text. */
	text: string;
	timestamp: number;
	/** Whether this entry is on the currently active branch. */
	onActiveBranch: boolean;
}

/** Tree pane filters (mirror /tree ctrl+d/t/u/l/a). */
export type TreeFilter = "default" | "tools" | "user-only" | "labeled" | "all";

/** A message block rendered in the content (right) pane. */
export interface ContentBlock {
	entryId: string;
	role: "user" | "assistant";
	timestamp: number;
	/** Raw markdown to render. */
	markdown: string;
}

/** Data shown in the Session Info dialog (mirrors /session). */
export interface SessionInfo {
	name?: string;
	model?: string;
	messages: number;
	tokens: number;
	cost: number;
	createdAt: number;
	updatedAt: number;
	path: string;
	id: string;
}

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

/**
 * Parsed search query. Supports GitHub-style qualifiers:
 *   name:foo model:opus path:bar tag:scan after:2026-09-01 before:2026-09-20
 * plus free text.
 */
export interface SearchQuery {
	text: string;
	name?: string;
	model?: string;
	path?: string;
	tag?: string;
	after?: Date;
	before?: Date;
}

// ---------------------------------------------------------------------------
// Keymap
// ---------------------------------------------------------------------------

/** Logical actions the panel can perform. Keys are bound to these. */
export type ActionId =
	// global
	| "focus-next"
	| "focus-prev"
	| "toggle-scope"
	| "help"
	| "quit"
	| "search"
	| "search-next"
	| "search-prev"
	// list navigation
	| "move-down"
	| "move-up"
	| "go-top"
	| "go-bottom"
	| "scroll-content-down"
	| "scroll-content-up"
	// sessions pane
	| "session-resume"
	| "session-delete"
	| "session-rename"
	| "session-fork"
	| "session-toggle-select"
	| "session-export"
	| "session-import"
	| "session-share"
	| "session-clone"
	| "session-copy-last-reply"
	| "session-sort"
	| "session-new"
	| "session-info"
	// tree pane
	| "tree-restore"
	| "tree-copy"
	| "tree-label"
	| "tree-filter-default"
	| "tree-filter-tools"
	| "tree-filter-user"
	| "tree-filter-labeled"
	| "tree-filter-all"
	// content pane (vim-like)
	| "cursor-left"
	| "cursor-right"
	| "word-forward"
	| "word-backward"
	| "center-cursor"
	| "preview-toggle"
	| "yank"
	| "yank-line";

/** A single key chord, e.g. "j", "ctrl+d", "gg", "shift+s". */
export type KeyChord = string;

/** Keymap for one pane (or the global scope). */
export type PaneKeymap = Partial<Record<ActionId, KeyChord | KeyChord[]>>;

/** Full keymap: global bindings plus per-pane overrides. */
export interface Keymap {
	global: PaneKeymap;
	sessions: PaneKeymap;
	tree: PaneKeymap;
	content: PaneKeymap;
}

// ---------------------------------------------------------------------------
// User config
// ---------------------------------------------------------------------------

/** Shape of `~/.pi/agent/lazy-panel.json`. All fields optional. */
export interface UserConfig {
	keymap?: Partial<Keymap>;
	defaultScope?: ListScope;
	defaultSort?: SessionSortMode;
	leftColumnRatio?: number;
}
