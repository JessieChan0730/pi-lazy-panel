/**
 * Root panel component.
 *
 * Owns the three panes, focus state, key dispatch and the footer / search bar.
 * Opened from src/index.ts via `ctx.ui.custom(...)`.
 *
 * Layout (see docs/design.md):
 *
 *      25%              75%
 *   ┌──────────┬────────────────────┐
 *   │ SESSIONS │                    │
 *   ├──────────┤      CONTENT       │
 *   │   TREE   │                    │
 *   └──────────┴────────────────────┘
 *   │ NORMAL │ / Search  ? Help ... │   <- footer, or the search bar in search mode
 *
 * This layer does no I/O: all data arrives through the injected `DataSource`
 * so the panel stays testable with plain objects.
 *
 * Key handling (本任务范围):
 *   - 按键 → resolveKeys(bindings, focus, pending) → ActionId → dispatch()
 *   - 支持多键序列（"gg"）：前缀匹配时把按键放进 pending 缓冲，等待下一键
 *   - Tab / Shift+Tab 切换焦点，C / A 切换 Current ↔ All，? 帮助，/ 搜索栏
 *   - 面板内的动作（移动光标、删除…）只做分发，具体实现留给后续任务
 */

import type { Theme } from "@earendil-works/pi-coding-agent";
import type { Component, Focusable } from "@earendil-works/pi-tui";
import { type Binding, compileKeymap, matchesKeyId, resolveKeys } from "../config/keys.ts";
import { DEFAULT_KEYMAP } from "../config/keymap.ts";
import { LEFT_COLUMN_RATIO, PANE_IDS } from "../constants.ts";
import type {
	ActionId,
	ContentBlock,
	Keymap,
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
import { helpLineCount, overlayHelp } from "./widgets/help-overlay.ts";
import { renderSearchStatus, SearchBar } from "./widgets/search-bar.ts";

/** Mutable UI state of the panel. Kept in one place for easy debugging. */
export interface PanelState {
	focus: PaneId;
	mode: PanelMode;
	/** Index of the highlighted row per list pane. */
	cursor: Record<PaneId, number>;
	/** Sessions selected with <space> for batch operations. */
	selectedSessionFiles: Set<string>;
	/** Last submitted search query ("" = no active search). */
	searchQuery: string;
	/** Pane the active search applies to. */
	searchPane: PaneId | undefined;
	scope: ListScope;
	sort: SessionSortMode;
	treeFilter: TreeFilter;
	/** Whether the `?` overlay is open, and its scroll offset. */
	helpOpen: boolean;
	helpScroll: number;
}

export function createInitialState(overrides: Partial<PanelState> = {}): PanelState {
	return {
		focus: "sessions",
		mode: "normal",
		cursor: { sessions: 0, tree: 0, content: 0 },
		selectedSessionFiles: new Set(),
		searchQuery: "",
		searchPane: undefined,
		scope: "current-folder",
		sort: "recent",
		treeFilter: "default",
		helpOpen: false,
		helpScroll: 0,
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
	/** Resolved keymap (defaults deep-merged with the user file). */
	keymap?: Keymap;
	initialState?: Partial<PanelState>;
	leftColumnRatio?: number;
	/** Initial footer status, e.g. config warnings. */
	status?: string;
}

/** Max time between keys of a multi-key sequence such as "gg". */
const PENDING_TIMEOUT_MS = 1000;

export class LazyPanel implements Component, Focusable {
	readonly state: PanelState;
	readonly keymap: Keymap;
	private readonly bindings: Binding[];
	private sessions: SessionRow[] = [];
	private tree: TreeRow[] = [];
	private content: ContentBlock[] = [];
	private status: string | undefined;
	private loadedSessionFile: string | undefined;
	private disposed = false;
	private readonly ratio: number;
	private readonly searchBar: SearchBar;
	/** Raw key chunks of an unfinished multi-key sequence. */
	private pending: string[] = [];
	private pendingTimer: ReturnType<typeof setTimeout> | undefined;
	private _focused = false;

	constructor(private readonly o: LazyPanelOptions) {
		this.state = createInitialState(o.initialState);
		this.keymap = o.keymap ?? DEFAULT_KEYMAP;
		this.bindings = compileKeymap(this.keymap);
		this.ratio = o.leftColumnRatio ?? LEFT_COLUMN_RATIO;
		this.status = o.status;
		this.searchBar = new SearchBar({
			theme: o.theme,
			onSubmit: (q) => this.submitSearch(q),
			onCancel: () => this.cancelSearch(),
			onChange: () => this.o.requestRender(),
		});
	}

	/** Focusable: forwarded to the search input so the IME cursor lands in the bar. */
	get focused(): boolean {
		return this._focused;
	}
	set focused(v: boolean) {
		this._focused = v;
		this.searchBar.focused = v && this.state.mode === "search";
	}

	// -----------------------------------------------------------------------
	// Data loading
	// -----------------------------------------------------------------------

	/** Load sessions, then the tree + content for the cursor session. */
	async load(): Promise<void> {
		this.setStatus("loading sessions…");
		try {
			this.sessions = await this.o.data.listSessions(this.state.scope, this.state.sort);
			this.state.cursor.sessions = Math.min(this.state.cursor.sessions, Math.max(0, this.sessions.length - 1));
			this.setStatus(undefined);
		} catch (err) {
			this.setStatus(`failed to list sessions: ${(err as Error).message}`);
		}
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
			this.setStatus(`failed to open session: ${(err as Error).message}`);
		}
		this.o.requestRender();
	}

	private setStatus(s: string | undefined): void {
		this.status = s;
		this.o.requestRender();
	}

	// -----------------------------------------------------------------------
	// Input
	// -----------------------------------------------------------------------

	handleInput(data: string): void {
		if (this.disposed) return;

		// 搜索模式：所有按键交给输入框（Enter/Esc 由 SearchBar 回调处理）。
		if (this.state.mode === "search") {
			this.searchBar.handleInput(data);
			return;
		}

		// 帮助弹窗打开时只响应关闭 / 滚动。
		if (this.state.helpOpen) {
			this.handleHelpInput(data);
			return;
		}

		// Esc 优先：清掉半截序列或当前搜索结果。
		if (matchesKeyId(data, "escape")) {
			if (this.pending.length) {
				this.clearPending();
				return;
			}
			if (this.state.searchQuery) {
				this.clearSearch();
				return;
			}
			this.close();
			return;
		}

		const pressed = [...this.pending, data];
		const result = resolveKeys(this.bindings, this.state.focus, pressed);
		if (result.kind === "pending") {
			this.pending = pressed;
			this.armPendingTimer();
			this.o.requestRender();
			return;
		}
		this.clearPending();
		if (result.kind === "action") {
			this.dispatch(result.action);
		}
	}

	private armPendingTimer(): void {
		if (this.pendingTimer) clearTimeout(this.pendingTimer);
		this.pendingTimer = setTimeout(() => {
			this.pendingTimer = undefined;
			if (this.pending.length) {
				this.pending = [];
				this.o.requestRender();
			}
		}, PENDING_TIMEOUT_MS);
	}

	private clearPending(): void {
		this.pending = [];
		if (this.pendingTimer) {
			clearTimeout(this.pendingTimer);
			this.pendingTimer = undefined;
		}
	}

	private handleHelpInput(data: string): void {
		const total = helpLineCount(this.keymap, this.state.focus);
		// 关闭：Esc、q，或用户绑定给 help 的那个键（默认 ?）。
		const closes = matchesKeyId(data, "escape") || matchesKeyId(data, "q") || this.isAction(data, "global", "help");
		if (closes) {
			this.state.helpOpen = false;
			this.state.helpScroll = 0;
		} else if (matchesKeyId(data, "j") || matchesKeyId(data, "down")) {
			this.state.helpScroll = Math.min(this.state.helpScroll + 1, Math.max(0, total - 1));
		} else if (matchesKeyId(data, "k") || matchesKeyId(data, "up")) {
			this.state.helpScroll = Math.max(0, this.state.helpScroll - 1);
		} else {
			return;
		}
		this.o.requestRender();
	}

	/** Does a single raw key resolve to `action` in `scope`? */
	private isAction(data: string, scope: "global" | PaneId, action: ActionId): boolean {
		const r = resolveKeys(this.bindings, scope, [data]);
		return r.kind === "action" && r.action === action;
	}

	/**
	 * Execute one logical action. Only the generic actions of this task are
	 * implemented; pane-specific ones show a short "not yet" status so the user
	 * can see the binding was recognised.
	 */
	dispatch(action: ActionId): void {
		switch (action) {
			case "quit":
				this.close();
				return;
			case "focus-next":
				this.cycleFocus(1);
				return;
			case "focus-prev":
				this.cycleFocus(-1);
				return;
			case "toggle-scope":
				this.toggleScope();
				return;
			case "help":
				this.state.helpOpen = true;
				this.state.helpScroll = 0;
				this.o.requestRender();
				return;
			case "search":
				this.openSearch();
				return;
			case "search-next":
			case "search-prev":
				// 匹配/跳转在后续任务实现；这里先提示当前状态。
				this.setStatus(this.state.searchQuery ? `search: "${this.state.searchQuery}" (matching comes in a later task)` : "no active search — press / first");
				return;
			default:
				this.setStatus(`${action}: not implemented yet`);
				return;
		}
	}

	private cycleFocus(delta: 1 | -1): void {
		const i = PANE_IDS.indexOf(this.state.focus);
		const next = PANE_IDS[(i + delta + PANE_IDS.length) % PANE_IDS.length]!;
		this.state.focus = next;
		this.o.requestRender();
	}

	private toggleScope(): void {
		this.state.scope = this.state.scope === "all" ? "current-folder" : "all";
		// 切换范围后光标回到顶部并重新拉取会话列表。
		this.state.cursor.sessions = 0;
		this.state.selectedSessionFiles.clear();
		void this.load();
	}

	// -----------------------------------------------------------------------
	// Search mode
	// -----------------------------------------------------------------------

	private openSearch(): void {
		this.state.mode = "search";
		this.searchBar.reset(this.state.searchQuery);
		this.searchBar.focused = this._focused;
		this.o.requestRender();
	}

	private submitSearch(query: string): void {
		const q = query.trim();
		this.state.mode = "normal";
		this.searchBar.focused = false;
		this.state.searchQuery = q;
		this.state.searchPane = q ? this.state.focus : undefined;
		this.o.requestRender();
	}

	private cancelSearch(): void {
		this.state.mode = "normal";
		this.searchBar.focused = false;
		this.o.requestRender();
	}

	private clearSearch(): void {
		this.state.searchQuery = "";
		this.state.searchPane = undefined;
		this.o.requestRender();
	}

	// -----------------------------------------------------------------------
	// Lifecycle
	// -----------------------------------------------------------------------

	private close(): void {
		if (this.disposed) return;
		this.disposed = true;
		this.clearPending();
		this.o.onClose();
	}

	dispose(): void {
		this.disposed = true;
		this.clearPending();
	}

	invalidate(): void {
		// Nothing cached across renders yet.
	}

	// -----------------------------------------------------------------------
	// Render
	// -----------------------------------------------------------------------

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

		let lines = sideBySide(left, right, leftW, rightW);
		if (this.state.helpOpen) {
			lines = overlayHelp(lines, { keymap: this.keymap, focus: this.state.focus, scroll: this.state.helpScroll, theme }, width);
		}
		return [...lines, this.renderBottom(width)].map((l) => fit(l, width));
	}

	/** Footer row: search bar while typing, search status after Enter, otherwise hints. */
	private renderBottom(width: number): string {
		if (this.state.mode === "search") {
			return this.searchBar.render(width)[0] ?? "";
		}
		if (this.state.searchQuery) {
			return renderSearchStatus({ query: this.state.searchQuery, current: 0, total: 0, theme: this.o.theme }, width);
		}
		const pendingHint = this.pending.length ? `pending: ${this.pending.join("")}` : undefined;
		const status = pendingHint ?? this.status;
		return renderFooter(
			{ mode: this.state.mode, focus: this.state.focus, keymap: this.keymap, theme: this.o.theme, ...(status ? { status } : {}) },
			width,
		)[0]!;
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
