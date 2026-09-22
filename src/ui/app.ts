/**
 * Root panel component.
 *
 * Owns the three panes, focus state, key dispatch and the footer / search bar.
 * Opened from src/index.ts via `ctx.ui.custom(...)`.
 *
 * Layout (see docs/design.md):
 *
 *      25%              75%
 *   ┌──────────────┬────────────────────┐
 *   │ [1] SESSIONS │                    │
 *   ├──────────────┤    [3] CONTENT     │
 *   │ [2] TREE     │                    │
 *   └──────────────┴────────────────────┘
 *   │ NORMAL │ / Search  ? Help ...     │   <- footer, or the search bar in search mode
 *
 * This layer does no I/O: all data arrives through the injected `DataSource`
 * so the panel stays testable with plain objects.
 *
 * Key handling (本任务范围):
 *   - 按键 → resolveKeys(bindings, focus, pending) → ActionId → dispatch()
 *   - 支持多键序列（"gg"）：前缀匹配时把按键放进 pending 缓冲，等待下一键
 *   - h / l 前后切换焦点，1 / 2 / 3 直接跳到对应面板（面板标题显示 "[1] SESSIONS"）
 *   - C 切到 Current folder，A 切到 All（各自只做单向切换），? 帮助，/ 搜索栏
 *   - j/k、gg/G：SESSIONS / TREE 移动光标，CONTENT 按行滚动；SESSIONS 里 J/K 滚动右侧内容
 *   - SESSIONS 光标变化 → 重新加载 TREE + CONTENT；TREE 光标变化 → CONTENT 高亮并滚到对应消息
 *   - TREE：y 复制节点全文（走注入的 ActionSource），T 居中弹出 Label 输入框（类似 lazygit 的 commit 弹窗），回车保存 / Esc 取消 / 空值清除
 *   - 其余面板动作（删除、fork…）只做分发，具体实现留给后续任务
 */

import type { Theme } from "@earendil-works/pi-coding-agent";
import type { Component, Focusable } from "@earendil-works/pi-tui";
import { type Binding, compileKeymap, labelsFor, matchesKeyId, resolveKeys } from "../config/keys.ts";
import { DEFAULT_KEYMAP, FOCUS_ACTIONS, PANE_TITLES } from "../config/keymap.ts";
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
import { type ContentLayout, layoutContent, maxScroll, renderContentPane } from "./panes/content-pane.ts";
import { renderSessionsPane } from "./panes/sessions-pane.ts";
import { renderTreePane } from "./panes/tree-pane.ts";
import { renderFooter } from "./widgets/footer.ts";
import { helpLineCount, overlayHelp } from "./widgets/help-overlay.ts";
import { InputDialog } from "./widgets/input-dialog.ts";
import { LABEL_DIALOG_HINTS, LABEL_DIALOG_TITLE } from "./widgets/label-dialog.ts";
import { renderSearchStatus, SearchBar } from "./widgets/search-bar.ts";

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
		contentHighlight: undefined,
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

/**
 * Side effects injected by the entry point (they wrap src/actions/*).
 * 面板本身不做 I/O：复制、打标签都通过这里交给 actions 层。
 */
export interface ActionSource {
	/** Copy the node's full text to the clipboard; `false` = the entry has no text. */
	copyNodeText(sessionFile: string, entryId: string): Promise<boolean>;
	/** Set, or clear with `undefined`, the label of a node. */
	setNodeLabel(sessionFile: string, entryId: string, label: string | undefined): Promise<void>;
}

export interface LazyPanelOptions {
	theme: Theme;
	data: DataSource;
	/** Optional: without it y / T report that actions are unavailable. */
	actions?: ActionSource;
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

/** Delay before (re)loading the session under the cursor while the user is still moving. */
const SESSION_LOAD_DEBOUNCE_MS = 40;

export class LazyPanel implements Component, Focusable {
	readonly state: PanelState;
	readonly keymap: Keymap;
	private readonly bindings: Binding[];
	private sessions: SessionRow[] = [];
	private tree: TreeRow[] = [];
	private content: ContentBlock[] = [];
	/** Leaf entry the current `content` branch ends at (undefined = session's own leaf). */
	private contentLeaf: string | undefined;
	private status: string | undefined;
	private loadedSessionFile: string | undefined;
	private disposed = false;
	private readonly ratio: number;
	private readonly searchBar: SearchBar;
	/** Shared centered text prompt: labelling a node now, renaming a session later. */
	private readonly inputDialog: InputDialog;
	/** Node being labelled while `mode === "label"`. */
	private labelTarget: { file: string; entryId: string } | undefined;
	/** Raw key chunks of an unfinished multi-key sequence. */
	private pending: string[] = [];
	private pendingTimer: ReturnType<typeof setTimeout> | undefined;
	private _focused = false;
	/** Debounced reload of tree + content after the sessions cursor moved. */
	private sessionLoadTimer: ReturnType<typeof setTimeout> | undefined;
	private sessionLoadPromise: Promise<void> | undefined;
	private sessionLoadResolve: (() => void) | undefined;
	/** Content layout cache keyed by blocks identity / width / highlight. */
	private layoutCache: { blocks: ContentBlock[]; inner: number; highlight: string | undefined; layout: ContentLayout } | undefined;
	/** Viewport of the content pane as of the last render, used to clamp scrolling. */
	private contentView = { inner: 60, visible: 10 };

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
		this.inputDialog = new InputDialog({
			theme: o.theme,
			onChange: () => this.o.requestRender(),
		});
	}

	/** Focusable: forwarded to the active prompt so the IME cursor lands in the bar. */
	get focused(): boolean {
		return this._focused;
	}
	set focused(v: boolean) {
		this._focused = v;
		this.searchBar.focused = v && this.state.mode === "search";
		this.inputDialog.focused = v && this.inputDialog.isOpen;
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
			this.setContent([], undefined);
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
			this.setContent(content, undefined);
			this.loadedSessionFile = file;
			// Put the tree cursor on the active leaf, like /tree does.
			const leafIdx = findLastIndex(tree, (r) => r.onActiveBranch);
			this.state.cursor.tree = leafIdx >= 0 ? leafIdx : 0;
			this.state.cursor.content = 0;
			// 树光标落在活动叶子上，右侧内容同步滚到并高亮这条消息。
			await this.syncContentToTree();
		} catch (err) {
			this.tree = [];
			this.setContent([], undefined);
			this.setStatus(`failed to open session: ${(err as Error).message}`);
		}
		this.o.requestRender();
	}

	/**
	 * Debounced `loadSelectedSession`: holding j/k in the sessions pane only
	 * opens the session the cursor finally rests on. Returns a promise that
	 * settles once that load has finished (handy for tests).
	 */
	scheduleSessionLoad(): Promise<void> {
		if (this.sessionLoadTimer) clearTimeout(this.sessionLoadTimer);
		if (!this.sessionLoadPromise) {
			this.sessionLoadPromise = new Promise<void>((resolve) => {
				this.sessionLoadResolve = resolve;
			});
		}
		// 只推迟定时器，复用同一个 promise：连续按 j 只会真正加载最后停下的那个会话。
		this.sessionLoadTimer = setTimeout(() => {
			const resolve = this.sessionLoadResolve;
			this.sessionLoadTimer = undefined;
			this.sessionLoadPromise = undefined;
			this.sessionLoadResolve = undefined;
			void this.loadSelectedSession().finally(() => resolve?.());
		}, SESSION_LOAD_DEBOUNCE_MS);
		return this.sessionLoadPromise;
	}

	private setContent(blocks: ContentBlock[], leaf: string | undefined): void {
		this.content = blocks;
		this.contentLeaf = leaf;
		this.layoutCache = undefined;
	}

	/**
	 * Make the content pane follow the tree cursor.
	 *
	 * 选中的节点已经在当前显示的分支里 → 只高亮并滚动到那条消息；
	 * 节点在活动分支上但没有消息框（工具结果、空回复等）→ 保持显示完整活动分支，高亮它前面最近的一条消息；
	 * 节点在另一条分支上 → 重新加载“以该节点为叶子”的分支再高亮。
	 */
	private async syncContentToTree(): Promise<void> {
		const node = this.tree[this.state.cursor.tree];
		const file = this.loadedSessionFile ?? this.sessions[this.state.cursor.sessions]?.file;
		if (!node || !file) {
			this.state.contentHighlight = undefined;
			this.o.requestRender();
			return;
		}
		const shown = this.content.some((b) => b.entryId === node.entryId);
		// 需要的分支：活动分支用 undefined（会话自己的叶子），否则以该节点为叶子。
		const wantLeaf = node.onActiveBranch ? undefined : node.entryId;
		if (!shown && this.contentLeaf !== wantLeaf) {
			try {
				const content = await this.o.data.loadContent(file, wantLeaf);
				if (this.disposed) return;
				// 光标又动了 / 会话换了：丢弃这次结果。
				if (this.tree[this.state.cursor.tree]?.entryId !== node.entryId || this.loadedSessionFile !== file) return;
				this.setContent(content, wantLeaf);
			} catch (err) {
				this.setStatus(`failed to load branch: ${(err as Error).message}`);
				return;
			}
		}
		this.highlightContent(node.entryId);
	}

	/** Highlight the block for `entryId` (or the nearest block before it in the tree) and scroll it to the top. */
	private highlightContent(entryId: string): void {
		const shown = new Set(this.content.map((b) => b.entryId));
		let targetId: string | undefined = shown.has(entryId) ? entryId : undefined;
		if (!targetId) {
			// 没有对应消息块的节点：沿 tree 往上找最近的一条有消息块的节点。
			for (let i = this.state.cursor.tree - 1; i >= 0 && !targetId; i--) {
				const id = this.tree[i]?.entryId;
				if (id && shown.has(id)) targetId = id;
			}
			targetId ??= this.content[this.content.length - 1]?.entryId;
		}
		this.state.contentHighlight = targetId;
		if (targetId) {
			const start = this.contentLayout().starts.get(targetId) ?? 0;
			this.state.cursor.content = Math.min(start, this.contentMaxScroll());
		}
		this.o.requestRender();
	}

	/** Cached layout of the current content for the last rendered width. */
	private contentLayout(): ContentLayout {
		const { inner } = this.contentView;
		const highlight = this.state.contentHighlight;
		const c = this.layoutCache;
		if (c && c.blocks === this.content && c.inner === inner && c.highlight === highlight) return c.layout;
		const layout = layoutContent(this.content, inner, this.o.theme, highlight);
		this.layoutCache = { blocks: this.content, inner, highlight, layout };
		return layout;
	}

	private contentMaxScroll(): number {
		return maxScroll(this.contentLayout().lines.length, this.contentView.visible);
	}

	/** Remember the content viewport for this render (so keys can clamp against it) and return the layout. */
	private contentLayoutFor(inner: number, visible: number): ContentLayout {
		this.contentView = { inner: Math.max(1, inner), visible: Math.max(1, visible) };
		const layout = this.contentLayout();
		// 窗口变小后原来的滚动位置可能越界，这里顺手夹回来。
		this.state.cursor.content = clamp(this.state.cursor.content, 0, maxScroll(layout.lines.length, this.contentView.visible));
		return layout;
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

		// 居中输入弹窗打开时（打标签等）：同理全部交给弹窗。
		if (this.inputDialog.isOpen) {
			this.inputDialog.handleInput(data);
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
			case "focus-sessions":
				this.setFocus("sessions");
				return;
			case "focus-tree":
				this.setFocus("tree");
				return;
			case "focus-content":
				this.setFocus("content");
				return;
			case "scope-current":
				this.setScope("current-folder");
				return;
			case "scope-all":
				this.setScope("all");
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
			case "move-down":
				this.moveCursor(1);
				return;
			case "move-up":
				this.moveCursor(-1);
				return;
			case "go-top":
				this.moveCursorTo(0);
				return;
			case "go-bottom":
				this.moveCursorTo(Number.MAX_SAFE_INTEGER);
				return;
			case "scroll-content-down":
				this.scrollContent(this.contentPageStep());
				return;
			case "scroll-content-up":
				this.scrollContent(-this.contentPageStep());
				return;
			case "tree-copy":
				void this.copyTreeNode();
				return;
			case "tree-label":
				this.openLabelInput();
				return;
			default:
				this.setStatus(`${action}: not implemented yet`);
				return;
		}
	}

	// -----------------------------------------------------------------------
	// Cursor movement
	// -----------------------------------------------------------------------

	/** j/k: list panes move the cursor one row, the content pane scrolls one line. */
	private moveCursor(delta: number): void {
		if (this.state.focus === "content") {
			this.scrollContent(delta);
			return;
		}
		this.moveCursorTo(this.state.cursor[this.state.focus] + delta);
	}

	/** gg/G and absolute moves; the index is clamped to the focused list. */
	private moveCursorTo(index: number): void {
		const pane = this.state.focus;
		if (pane === "content") {
			this.setContentScroll(index);
			return;
		}
		const rows = pane === "sessions" ? this.sessions : this.tree;
		const next = clamp(index, 0, rows.length - 1);
		if (next === this.state.cursor[pane]) return;
		this.state.cursor[pane] = next;
		this.o.requestRender();
		// 联动：会话变了要重新加载 tree/content；树节点变了右侧跟着高亮。
		if (pane === "sessions") void this.scheduleSessionLoad();
		else void this.syncContentToTree();
	}

	private scrollContent(delta: number): void {
		this.setContentScroll(this.state.cursor.content + delta);
	}

	private setContentScroll(line: number): void {
		const next = clamp(line, 0, this.contentMaxScroll());
		if (next === this.state.cursor.content) return;
		this.state.cursor.content = next;
		this.o.requestRender();
	}

	/** J/K from the sessions pane scroll the content pane by half a viewport. */
	private contentPageStep(): number {
		return Math.max(1, Math.floor(this.contentView.visible / 2));
	}

	private cycleFocus(delta: 1 | -1): void {
		const i = PANE_IDS.indexOf(this.state.focus);
		this.setFocus(PANE_IDS[(i + delta + PANE_IDS.length) % PANE_IDS.length]!);
	}

	private setFocus(pane: PaneId): void {
		this.state.focus = pane;
		this.o.requestRender();
	}

	/** Switch the list scope; C / A are one-way so pressing the current one is a no-op. */
	private setScope(scope: ListScope): void {
		if (this.state.scope === scope) return;
		this.state.scope = scope;
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
	// Tree node actions: copy / label
	// -----------------------------------------------------------------------

	/** Tree row under the cursor plus the file it belongs to, or undefined with a footer hint. */
	private currentTreeNode(): { file: string; row: TreeRow } | undefined {
		const row = this.tree[this.state.cursor.tree];
		const file = this.loadedSessionFile;
		if (!row || !file) {
			this.setStatus("no tree node selected");
			return undefined;
		}
		return { file, row };
	}

	/** y: copy the node's full text (like /tree ctrl+x). */
	private async copyTreeNode(): Promise<void> {
		const target = this.currentTreeNode();
		if (!target) return;
		if (!this.o.actions) {
			this.setStatus("copy: actions unavailable");
			return;
		}
		try {
			const copied = await this.o.actions.copyNodeText(target.file, target.row.entryId);
			if (this.disposed) return;
			this.setStatus(copied ? "copied node text to clipboard" : "selected entry has no text to copy");
		} catch (err) {
			this.setStatus(`copy failed: ${(err as Error).message}`);
		}
	}

	/** T: open the label dialog pre-filled with the node's current label. */
	private openLabelInput(): void {
		const target = this.currentTreeNode();
		if (!target) return;
		if (!this.o.actions) {
			this.setStatus("label: actions unavailable");
			return;
		}
		this.labelTarget = { file: target.file, entryId: target.row.entryId };
		this.state.mode = "label";
		// 弹窗标题右侧显示是给哪条消息打标签。
		this.inputDialog.open({
			title: LABEL_DIALOG_TITLE,
			value: target.row.label ?? "",
			subject: `${target.row.role}: ${target.row.text}`,
			hints: LABEL_DIALOG_HINTS,
			onSubmit: (v) => void this.submitLabel(v),
			onCancel: () => this.cancelLabel(),
		});
		this.inputDialog.focused = this._focused;
		this.o.requestRender();
	}

	/** Enter in the label prompt: persist, then reload the tree so the row shows the new label. */
	private async submitLabel(value: string): Promise<void> {
		const target = this.labelTarget;
		this.closeLabelInput();
		if (!target || !this.o.actions) return;
		const label = value.trim() || undefined;
		try {
			await this.o.actions.setNodeLabel(target.file, target.entryId, label);
			if (this.disposed) return;
			this.setStatus(label ? `label set: ${label}` : "label removed");
		} catch (err) {
			this.setStatus(`label failed: ${(err as Error).message}`);
			return;
		}
		await this.reloadTree(target.file, target.entryId);
	}

	private cancelLabel(): void {
		this.closeLabelInput();
		this.o.requestRender();
	}

	private closeLabelInput(): void {
		this.state.mode = "normal";
		this.inputDialog.close();
		this.inputDialog.focused = false;
		this.labelTarget = undefined;
	}

	/**
	 * Re-read the tree of `file` (same filter) and keep the cursor on `entryId`.
	 * 在 labeled 过滤下清掉 label 会让这一行消失，此时光标夹回范围内并同步右侧高亮。
	 */
	private async reloadTree(file: string, entryId: string): Promise<void> {
		try {
			const tree = await this.o.data.loadTree(file, this.state.treeFilter);
			if (this.disposed || this.loadedSessionFile !== file) return;
			this.tree = tree;
			const idx = tree.findIndex((r) => r.entryId === entryId);
			this.state.cursor.tree = idx >= 0 ? idx : clamp(this.state.cursor.tree, 0, Math.max(0, tree.length - 1));
			await this.syncContentToTree();
		} catch (err) {
			this.setStatus(`failed to reload tree: ${(err as Error).message}`);
		}
		this.o.requestRender();
	}

	// -----------------------------------------------------------------------
	// Lifecycle
	// -----------------------------------------------------------------------

	private close(): void {
		if (this.disposed) return;
		this.disposed = true;
		this.clearPending();
		this.clearSessionLoad();
		this.o.onClose();
	}

	dispose(): void {
		this.disposed = true;
		this.clearPending();
		this.clearSessionLoad();
	}

	private clearSessionLoad(): void {
		if (this.sessionLoadTimer) clearTimeout(this.sessionLoadTimer);
		this.sessionLoadTimer = undefined;
		this.sessionLoadResolve?.();
		this.sessionLoadResolve = undefined;
		this.sessionLoadPromise = undefined;
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
					title: this.paneTitle("sessions"),
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
					title: this.paneTitle("tree"),
					theme,
				},
				leftW,
				treeH,
			),
		];

		const right = renderContentPane(
			{
				blocks: this.content,
				layout: this.contentLayoutFor(rightW - 2, bodyH - 2),
				scroll: this.state.cursor.content,
				focused: this.state.focus === "content",
				emptyMessage: this.emptyMessage(selectedSession),
				title: this.paneTitle("content"),
				theme,
				...(this.state.contentHighlight ? { highlightEntryId: this.state.contentHighlight } : {}),
			},
			rightW,
			bodyH,
		);

		let lines = sideBySide(left, right, leftW, rightW);
		if (this.state.helpOpen) {
			lines = overlayHelp(lines, { keymap: this.keymap, focus: this.state.focus, scroll: this.state.helpScroll, theme }, width);
		}
		// 输入弹窗打开时画在三个面板上面（lazygit commit 弹窗的效果）。
		if (this.inputDialog.isOpen) {
			lines = this.inputDialog.overlay(lines, width);
		}
		return [...lines, this.renderBottom(width)].map((l) => fit(l, width));
	}

	/** Footer row: search bar while typing, the dialog's keys in label mode, search status after Enter, otherwise hints. */
	private renderBottom(width: number): string {
		if (this.state.mode === "search") {
			return this.searchBar.render(width)[0] ?? "";
		}
		const footer = { mode: this.state.mode, focus: this.state.focus, keymap: this.keymap, scope: this.state.scope, theme: this.o.theme };
		// 弹窗打开时 footer 只显示弹窗自己的按键提示（如 Enter save / Esc cancel / empty removes）。
		if (this.inputDialog.isOpen) {
			return renderFooter({ ...footer, hints: this.inputDialog.hints }, width)[0]!;
		}
		if (this.state.searchQuery) {
			return renderSearchStatus({ query: this.state.searchQuery, current: 0, total: 0, theme: this.o.theme }, width);
		}
		const pendingHint = this.pending.length ? `pending: ${this.pending.join("")}` : undefined;
		const status = pendingHint ?? this.status;
		return renderFooter({ ...footer, ...(status ? { status } : {}) }, width)[0]!;
	}

	private emptyMessage(selected: SessionRow | undefined): string {
		if (!selected) return "Select a session.";
		if (this.loadedSessionFile !== selected.file) return "Loading…";
		return "Nothing to show.";
	}

	/** "[1] SESSIONS": the jump key comes from the resolved keymap, so rebinding shows up here. */
	private paneTitle(pane: PaneId): string {
		const key = labelsFor(this.keymap, "global", FOCUS_ACTIONS[pane])[0];
		return key ? `[${key}] ${PANE_TITLES[pane]}` : PANE_TITLES[pane];
	}
}

function findLastIndex<T>(arr: T[], pred: (t: T) => boolean): number {
	for (let i = arr.length - 1; i >= 0; i--) if (pred(arr[i]!)) return i;
	return -1;
}

function clamp(n: number, min: number, max: number): number {
	return Math.max(min, Math.min(max, n));
}
