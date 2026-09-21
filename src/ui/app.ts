/**
 * Root panel component.
 *
 * Owns the three panes, focus state, and the footer. Opened from src/index.ts
 * via `ctx.ui.custom(...)`.
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
 * This layer does no I/O: all data arrives through the injected `DataSource`
 * so the panel stays testable with plain objects.
 *
 * Current step: static rendering only. The only key handled is a way out
 * (q / Escape / ctrl+c) so the user can close the panel; every other key is
 * wired up in a later task.
 */

import type { Theme } from "@earendil-works/pi-coding-agent";
import { type Component, matchesKey } from "@earendil-works/pi-tui";
import { LEFT_COLUMN_RATIO } from "../constants.ts";
import type {
	ContentBlock,
	ListScope,
	PaneId,
	PanelMode,
	SessionRow,
	SessionSortMode,
	TreeFilter,
	TreeRow,
} from "../types.ts";
import { fit, sideBySide } from "./frame.ts";
import { renderContentPane } from "./panes/content-pane.ts";
import { renderSessionsPane } from "./panes/sessions-pane.ts";
import { renderTreePane } from "./panes/tree-pane.ts";
import { renderFooter } from "./widgets/footer.ts";

/** Mutable UI state of the panel. Kept in one place for easy debugging. */
export interface PanelState {
	focus: PaneId;
	mode: PanelMode;
	/** Index of the highlighted row per list pane. */
	cursor: Record<PaneId, number>;
	/** Sessions selected with <space> for batch operations. */
	selectedSessionFiles: Set<string>;
	searchQuery: string;
	scope: ListScope;
	sort: SessionSortMode;
	treeFilter: TreeFilter;
}

export function createInitialState(overrides: Partial<PanelState> = {}): PanelState {
	return {
		focus: "sessions",
		mode: "normal",
		cursor: { sessions: 0, tree: 0, content: 0 },
		selectedSessionFiles: new Set(),
		searchQuery: "",
		scope: "current-folder",
		sort: "recent",
		treeFilter: "default",
		...overrides,
	};
}

/** Async loaders injected by the entry point (they wrap src/data/*). */
export interface DataSource {
	listSessions(scope: ListScope, sort: SessionSortMode): Promise<SessionRow[]>;
	loadTree(sessionFile: string, filter: TreeFilter): Promise<TreeRow[]>;
	loadContent(sessionFile: string, leafEntryId?: string): Promise<ContentBlock[]>;
}

export interface LazyPanelOptions {
	theme: Theme;
	data: DataSource;
	/** Terminal height available to the panel, re-read on every render. */
	getHeight: () => number;
	requestRender: () => void;
	onClose: () => void;
	initialState?: Partial<PanelState>;
	leftColumnRatio?: number;
}

export class LazyPanel implements Component {
	readonly state: PanelState;
	private sessions: SessionRow[] = [];
	private tree: TreeRow[] = [];
	private content: ContentBlock[] = [];
	private status: string | undefined;
	private loadedSessionFile: string | undefined;
	private disposed = false;
	private readonly ratio: number;

	constructor(private readonly o: LazyPanelOptions) {
		this.state = createInitialState(o.initialState);
		this.ratio = o.leftColumnRatio ?? LEFT_COLUMN_RATIO;
	}

	/** Load sessions, then the tree + content for the cursor session. */
	async load(): Promise<void> {
		this.status = "loading sessions…";
		this.o.requestRender();
		try {
			this.sessions = await this.o.data.listSessions(this.state.scope, this.state.sort);
			this.state.cursor.sessions = Math.min(this.state.cursor.sessions, Math.max(0, this.sessions.length - 1));
			this.status = undefined;
		} catch (err) {
			this.status = `failed to list sessions: ${(err as Error).message}`;
		}
		this.o.requestRender();
		await this.loadSelectedSession();
	}

	/** Reload tree and content for the session under the cursor. */
	async loadSelectedSession(): Promise<void> {
		const row = this.sessions[this.state.cursor.sessions];
		if (!row) {
			this.tree = [];
			this.content = [];
			this.loadedSessionFile = undefined;
			this.o.requestRender();
			return;
		}
		const file = row.file;
		try {
			const [tree, content] = await Promise.all([
				this.o.data.loadTree(file, this.state.treeFilter),
				this.o.data.loadContent(file),
			]);
			if (this.disposed) return;
			// Ignore stale results if the cursor moved meanwhile.
			if (this.sessions[this.state.cursor.sessions]?.file !== file) return;
			this.tree = tree;
			this.content = content;
			this.loadedSessionFile = file;
			// Put the tree cursor on the active leaf, like /tree does.
			const leafIdx = findLastIndex(tree, (r) => r.onActiveBranch);
			this.state.cursor.tree = leafIdx >= 0 ? leafIdx : 0;
			this.state.cursor.content = 0;
		} catch (err) {
			this.tree = [];
			this.content = [];
			this.status = `failed to open session: ${(err as Error).message}`;
		}
		this.o.requestRender();
	}

	handleInput(data: string): void {
		// Static step: only an exit path. All other bindings come in the next task.
		if (matchesKey(data, "q") || matchesKey(data, "escape") || matchesKey(data, "ctrl+c")) {
			this.close();
		}
	}

	private close(): void {
		if (this.disposed) return;
		this.disposed = true;
		this.o.onClose();
	}

	dispose(): void {
		this.disposed = true;
	}

	invalidate(): void {
		// Nothing cached across renders yet.
	}

	render(width: number): string[] {
		const height = Math.max(8, this.o.getHeight());
		const footerH = 1;
		const bodyH = height - footerH;
		const leftW = Math.max(24, Math.min(width - 30, Math.floor(width * this.ratio)));
		const rightW = width - leftW;
		const sessionsH = Math.max(4, Math.floor(bodyH / 2));
		const treeH = bodyH - sessionsH;
		const { theme } = this.o;
		const selectedSession = this.sessions[this.state.cursor.sessions];

		const left = [
			...renderSessionsPane(
				{
					rows: this.sessions,
					cursor: this.state.cursor.sessions,
					focused: this.state.focus === "sessions",
					scope: this.state.scope,
					sort: this.state.sort,
					selected: this.state.selectedSessionFiles,
					theme,
				},
				leftW,
				sessionsH,
			),
			...renderTreePane(
				{
					rows: this.tree,
					cursor: this.state.cursor.tree,
					focused: this.state.focus === "tree",
					filter: this.state.treeFilter,
					emptyMessage: this.emptyMessage(selectedSession),
					theme,
				},
				leftW,
				treeH,
			),
		];

		const right = renderContentPane(
			{
				blocks: this.content,
				scroll: this.state.cursor.content,
				focused: this.state.focus === "content",
				emptyMessage: this.emptyMessage(selectedSession),
				theme,
			},
			rightW,
			bodyH,
		);

		const lines = sideBySide(left, right, leftW, rightW);
		const footer = renderFooter({ mode: this.state.mode, focus: this.state.focus, theme, ...(this.status ? { status: this.status } : {}) }, width);
		return [...lines, ...footer].map((l) => fit(l, width));
	}

	private emptyMessage(selected: SessionRow | undefined): string {
		if (!selected) return "Select a session.";
		if (this.loadedSessionFile !== selected.file) return "Loading…";
		return "Nothing to show.";
	}
}

function findLastIndex<T>(arr: T[], pred: (t: T) => boolean): number {
	for (let i = arr.length - 1; i >= 0; i--) if (pred(arr[i]!)) return i;
	return -1;
}
