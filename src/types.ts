/**
 * Shared type definitions for pi-lazy-panel.
 *
 * Keep this file free of runtime code — types only.
 */

import type { KEY_SCOPES, PANE_IDS, SESSION_SORT_MODES } from "./constants.ts";

// ---------------------------------------------------------------------------
// Panes / focus
// ---------------------------------------------------------------------------

/** One of the three focusable panes. */
export type PaneId = (typeof PANE_IDS)[number];

/** Which set of sessions the sessions pane lists. */
export type ListScope = "current-folder" | "all";

/** Sort order of the sessions pane (mirrors pi's /resume picker; `s` cycles them in `SESSION_SORT_MODES` order). */
export type SessionSortMode = (typeof SESSION_SORT_MODES)[number];

/**
 * Input mode of the panel, shown in the footer (vim-like). `restore` = the
 * summary menu / custom prompt of TREE Enter is open, `tree` = the full tree
 * dialog (`a` in the tree pane) is open, `confirm` / `rename` / `info` = the
 * delete confirmation, the Rename prompt or the Session Info dialog is open;
 * `export` / `import` / `share` = the dialogs of SESSIONS `e` / `I` / `S`.
 */
export type PanelMode =
	| "normal"
	| "search"
	| "label"
	| "restore"
	| "tree"
	| "confirm"
	| "rename"
	| "info"
	| "new"
	| "fork"
	| "clone"
	| "export"
	| "import"
	| "share"
	| "visual"
	| "preview";

/** A `key description` pair shown as a hint in the footer or a prompt bar. */
export type KeyHint = [key: string, text: string];

/**
 * What Enter did (SESSIONS resume / TREE restore):
 * `switched` = pi now shows another session, `restored` = the leaf moved to the
 * chosen node, `unchanged` = pi was already there. Failures throw instead.
 */
export type EnterOutcome = "switched" | "restored" | "unchanged";

/**
 * How a session file was removed (SESSIONS `d`, same as pi's /resume):
 * `trash` = moved to the system trash by the `trash` CLI, `unlink` = deleted
 * for good because `trash` was unavailable or failed.
 */
export type DeleteMethod = "trash" | "unlink";

/** File format of SESSIONS `e` (pi's /export): the whole tree as HTML, or the active branch as JSONL. */
export type ExportFormat = "html" | "jsonl";

/** Where an export would be written, resolved from what the user typed (blank = pi's default name in the cwd). */
export interface ExportTarget {
	/** Absolute output path. */
	path: string;
	/** A file is already there (the panel asks before overwriting it). */
	exists: boolean;
}

/** What SESSIONS `S` (pi's /share) produced: the pi.dev viewer link and the gist behind it. */
export interface ShareResult {
	url: string;
	gistUrl: string;
}

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
	/**
	 * Nearest ancestor that is also a row, undefined for roots. Entries that
	 * never become rows (labels, hidden by the filter…) are skipped over, so the
	 * rows always form a consistent forest the UI can draw guide lines for.
	 */
	parentId?: string;
	role: "user" | "assistant" | "system" | "tool";
	/**
	 * Coarse category used by the tree filters (same split as pi's /tree):
	 * `message` user / assistant, `tool` tool results, `system` structural
	 * entries always shown (system prompt, bash, compaction, branch summary),
	 * `meta` bookkeeping hidden by default (model / thinking / name changes).
	 */
	kind: "message" | "tool" | "system" | "meta";
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

/**
 * Tree filters (mirror /tree ctrl+d/t/u/l/a: `no-tools` is pi's ctrl+t,
 * `labeled` pi's `labeled-only`). Set from the tree dialog (d/t/u/l/a); the
 * pane shows the same filtered tree.
 */
export type TreeFilter = "default" | "no-tools" | "user-only" | "labeled" | "all";

/** A message block rendered in the content (right) pane. */
export interface ContentBlock {
	entryId: string;
	role: "user" | "assistant";
	timestamp: number;
	/** Raw markdown to render. */
	markdown: string;
}

/** A user message the `/fork` selector can fork before (entry id + one-line preview). */
export interface ForkPoint {
	entryId: string;
	text: string;
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
 *   name:foo model:opus path:bar tag:scan role:user after:2026-09-01 before:2026-09-20
 * plus free text.
 */
export interface SearchQuery {
	text: string;
	name?: string;
	model?: string;
	path?: string;
	tag?: string;
	/** Tree rows: the role (`user`, `assistant`, `system`, `tool`) must contain it. */
	role?: string;
	after?: Date;
	before?: Date;
}

/**
 * The `/` search active in one pane (lazygit-style: the rows are not filtered,
 * the cursor jumps between the matches with n / N). Kept per pane, so switching
 * panes does not lose a query.
 *
 * 每个面板各自的搜索状态：列表不过滤，只在匹配之间跳转。
 */
export interface PaneSearch {
	/** Raw query as typed after `/`. */
	query: string;
	/**
	 * Matches, ascending: row indices for the list panes (the sessions list; the
	 * whole tree, folded rows included) and body-line indices of the rendered
	 * layout for the content pane.
	 */
	matches: number[];
	/** Position in `matches` of the current match (the content pane's scroll target), -1 when there is none. */
	current: number;
}

/**
 * What a pane paints for the search active in it: which of the rows / lines it
 * renders match, which one is the current match, the terms to highlight and
 * the counts for its header ("2/7 matches").
 */
export interface SearchView {
	/** Terms to highlight on matching rows (free-text tokens and qualifier values). */
	terms: string[];
	/** Indices, in what the pane renders, of the matching rows (list panes) or body lines (content pane). */
	matches: ReadonlySet<number>;
	/** Index of the current match, undefined when the cursor is not on one. */
	current: number | undefined;
	/** 1-based position of the current match among the matches, 0 when there is none. */
	position: number;
	total: number;
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
	| "tree-open"
	| "tree-fold"
	// tree dialog only (the dialog also uses the tree pane's actions and the global `search`)
	| "tree-filter-default"
	| "tree-filter-no-tools"
	| "tree-filter-user"
	| "tree-filter-labeled"
	| "tree-filter-all"
	| "tree-dialog-close";
// content pane is read-only and only uses the shared navigation actions
// (move-down / move-up / go-top / go-bottom) plus the global search, see docs/design.md.
// Tree filters (d/t/u/l/a) live in the tree dialog (`tree-open`), which also has
// its own live-filtering search row; `/` in the panes jumps between matches.

/**
 * A single key chord in pi-tui key syntax, e.g. "j", "ctrl+d", "tab".
 * Multi-key sequences are written either verbatim when every step is one
 * printable character ("gg", "yy") or space-separated ("ctrl+w h").
 * An uppercase letter ("G") means shift + that letter.
 */
export type KeyChord = string;

/**
 * Binding scope: the global scope, one pane, or the tree dialog. Keys are
 * resolved innermost first: `tree-dialog` → `tree` → `global` inside the
 * dialog, `<pane>` → `global` in a pane (see `scopeChain` in config/keys.ts).
 */
export type KeyScope = (typeof KEY_SCOPES)[number];

/** Keymap for one scope (a pane, the tree dialog or the global scope). */
export type PaneKeymap = Partial<Record<ActionId, KeyChord | KeyChord[]>>;

/** Full keymap: global bindings plus per-scope overrides. */
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
