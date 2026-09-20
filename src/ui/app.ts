/**
 * Root panel component.
 *
 * Owns the three panes, focus management, the footer, the search bar and the
 * modal dialogs. Opened from src/index.ts via `ctx.ui.custom(...)`.
 *
 * Layout (see 计划.md):
 *
 *      25%              75%
 *   ┌──────────┬────────────────────┐
 *   │ SESSIONS │                    │
 *   ├──────────┤      CONTENT       │
 *   │   TREE   │                    │
 *   └──────────┴────────────────────┘
 *   │ NORMAL │ / Search  ? Help ... │   <- footer / search bar
 *
 * TODO: implement as a pi-tui Component (render(width) + handleInput(data)).
 */

import type { PaneId, PanelMode } from "../types.ts";

/** Mutable UI state of the panel. Kept in one place for easy debugging. */
export interface PanelState {
	focus: PaneId;
	mode: PanelMode;
	/** Index of the highlighted row per list pane. */
	cursor: Record<PaneId, number>;
	/** Sessions selected with <space> for batch operations. */
	selectedSessionFiles: Set<string>;
	searchQuery: string;
}

export function createInitialState(): PanelState {
	return {
		focus: "sessions",
		mode: "normal",
		cursor: { sessions: 0, tree: 0, content: 0 },
		selectedSessionFiles: new Set(),
		searchQuery: "",
	};
}

// TODO: export class LazyPanel implements Component { ... }
