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

/** Input mode of the panel, shown in the footer (vim-like). `restore` = the summary menu / custom prompt of TREE Enter is open. */
export type PanelMode = "normal" | "search" | "label" | "restore" | "visual" | "preview";

/** A `key description` pair shown as a hint in the footer or a prompt bar. */
export type KeyHint = [key: string, text: string];

/**
 * What Enter did (SESSIONS resume / TREE restore):
 * `switched` = pi now shows another session, `restored` = the leaf moved to the
 * chosen node, `unchanged` = pi was already there. Failures throw instead.
 */
export type EnterOutcome = "switched" | "restored" | "unchanged";

/**
 * How TREE Enter leaves the branch it abandons — the three choices of pi's
 * `/tree`: no summary, a model-written summary of the abandoned branch, or a
 * summary written with extra instructions. Passed through to `ctx.navigateTree`.
 */
export interface RestoreOptions {
	summarize: boolean;
	/** Extra instructions for the summarizer ("Summarize with custom prompt"). */
	customInstructions?: string;
}

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
	/** Session file this one was forked from, if any (drives "threaded" sort). */
	parentFile?: string;
	/** Indentation level assigned by "threaded" sort (0 = root). */
	threadDepth?: number;
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
	/** Coarse category used by the tree filters. */
	kind: "message" | "tool" | "meta";
	/** User-defined label on this entry (/tree shift+t). */
	label?: string;
	/** Truncated single-line text. */
	text: string;
	timestamp: number;
	/** Whether this entry is on the currently active branch. */
	onActiveBranch: boolean;
	/**
	 * Restoring here would leave the conversation where it already is (the leaf,
	 * or a message followed only by bookkeeping entries — see `isEffectiveLeaf`),
	 * so Enter skips the summary menu.
	 */
	isLeaf?: boolean;
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
	| "focus-sessions"
	| "focus-tree"
	| "focus-content"
	| "scope-current"
	| "scope-all"
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
	| "tree-filter-all";
// content pane is read-only and only uses the shared navigation actions
// (move-down / move-up / go-top / go-bottom), see docs/design.md.

/**
 * A single key chord in pi-tui key syntax, e.g. "j", "ctrl+d", "tab".
 * Multi-key sequences are written either verbatim when every step is one
 * printable character ("gg", "yy") or space-separated ("ctrl+w h").
 * An uppercase letter ("G") means shift + that letter.
 */
export type KeyChord = string;

/** Binding scope: the global scope or one pane. */
export type KeyScope = "global" | PaneId;

/** Keymap for one pane (or the global scope). */
export type PaneKeymap = Partial<Record<ActionId, KeyChord | KeyChord[]>>;

/** Full keymap: global bindings plus per-pane overrides. */
export type Keymap = Record<KeyScope, PaneKeymap>;

// ---------------------------------------------------------------------------
// User config
// ---------------------------------------------------------------------------

/** Per-scope keymap in the user file. `null` unbinds an action. */
export type UserPaneKeymap = Partial<Record<ActionId, KeyChord | KeyChord[] | null>>;

/** Shape of `~/.pi/agent/lazy-panel.json`. All fields optional. */
export interface UserConfig {
	keymap?: Partial<Record<KeyScope, UserPaneKeymap>>;
	defaultScope?: ListScope;
	defaultSort?: SessionSortMode;
	leftColumnRatio?: number;
}
