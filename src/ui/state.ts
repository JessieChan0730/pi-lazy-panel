/**
 * All mutable UI state of the panel in one object (focus, cursors, search,
 * selection, folds, …), so it is easy to inspect and the tests can assert on
 * it. `LazyPanel` owns the only instance and hands it to the pieces it
 * delegates to.
 *
 * 面板的全部可变 UI 状态集中在这里。
 */

import type { ListScope, PaneId, PanelMode, PaneSearch, SessionSortMode, TreeFilter } from "../types.ts";

/** Mutable UI state of the panel. Kept in one place for easy debugging. */
export interface PanelState {
	focus: PaneId;
	mode: PanelMode;
	/** Index of the highlighted row per list pane (for content: first visible body line). */
	cursor: Record<PaneId, number>;
	/** entryId of the content block highlighted by the tree cursor. */
	contentHighlight: string | undefined;
	/** Sessions selected with <space> for batch operations. */
	selectedSessionFiles: Set<string>;
	/**
	 * Pinned session files in display order (newest pin first). These sit at the
	 * top of the sessions pane regardless of the sort mode; persisted to
	 * `~/.pi/agent/lazy-panel-pins.json` (see config/pins.ts).
	 */
	pinnedFiles: string[];
	/**
	 * Active `/` search per pane (absent = none). Kept per pane, so switching
	 * panes keeps each pane's query; only the focused pane's search is acted on.
	 */
	search: Partial<Record<PaneId, PaneSearch>>;
	scope: ListScope;
	sort: SessionSortMode;
	/** Tree filter, chosen with d/t/u/l/a in the tree dialog; the pane lists the same filtered tree. */
	treeFilter: TreeFilter;
	/**
	 * Folded tree rows (branch-segment heads whose descendants are hidden, see
	 * data/tree-fold.ts). Reset to "side branches folded" whenever another
	 * session is loaded; kept across reloads of the same session.
	 */
	treeFolded: Set<string>;
	/** Whether the `?` overlay is open, and its scroll offset. */
	helpOpen: boolean;
	helpScroll: number;
	/**
	 * Wheel-scroll offset (first visible row) for the two list panes; null means
	 * "follow the cursor" (the keyboard default that centers the cursor). The
	 * wheel sets a number to scroll the view without moving the selection; any
	 * cursor move clears it back to null.
	 */
	listScroll: { sessions: number | null; tree: number | null };
}

export function createInitialState(overrides: Partial<PanelState> = {}): PanelState {
	return {
		focus: "sessions",
		mode: "normal",
		cursor: { sessions: 0, tree: 0, content: 0 },
		contentHighlight: undefined,
		selectedSessionFiles: new Set(),
		pinnedFiles: [],
		search: {},
		scope: "current-folder",
		sort: "recent",
		treeFilter: "default",
		treeFolded: new Set(),
		helpOpen: false,
		helpScroll: 0,
		listScroll: { sessions: null, tree: null },
		...overrides,
	};
}
