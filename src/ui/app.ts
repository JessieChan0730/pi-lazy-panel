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
 *   - TREE：y 复制节点全文（走注入的 ActionSource），T 居中弹出 Label 输入框（类似 lazygit 的 commit 弹窗），回车保存 / Esc 取消 / 空值清除；
 *     z 折叠 / 展开光标所在的分支段（旁支默认折叠、活动分支展开，段内按 z 折叠所在段并跳到段头）；
 *     a 打开完整树对话框（顶部搜索框、中间完整树、底部提示；和小面板共用折叠状态）。小面板不做 / 搜索和 d/t/u/l/a 过滤，按 / 只在 footer 提示去对话框
 *   - 树对话框里的按键按 tree-dialog scope 解析（对话框自己的键 → tree 面板的键 → global）：j/k/gg/G 移动、y / T / Enter 和面板一样但作用于
 *     对话框光标、z 折叠、d/t/u/l/a 过滤（重新加载树，面板同步）、/ 聚焦顶部搜索框实时过滤（Esc 退出搜索框但关键字和结果保留、再按 / 接着改，
 *     Enter 在搜索框里没有含义；搜索期间折叠全部打开，删光关键字或关对话框后恢复）、列表上 q / Esc 关闭并让面板光标跳到对话框选中的行
 *     （藏在折叠段里就展开它）；? 在对话框里关掉，它的键都在底部一行
 *   - Enter：SESSIONS 里切到光标所在会话（/resume）；TREE 里以光标节点为叶子恢复（/tree restore）：先居中弹出
 *     Summarize branch? 三选菜单（No summary / Summarize / Summarize with custom prompt，自定义指令再弹一个输入框），
 *     光标就在活动叶子上或 pi 设置了 branchSummary.skipPrompt 时不问、直接进入；
 *     成功后关闭面板，失败原因留在 footer 里、面板不关；等待 pi 切换 / 写摘要期间面板隐藏且不响应按键
 *   - 其余面板动作（删除、fork…）只做分发，具体实现留给后续任务
 */

import type { Theme } from "@earendil-works/pi-coding-agent";
import type { Component, Focusable } from "@earendil-works/pi-tui";
import { type Binding, compileKeymap, labelsFor, labelsForFocus, matchesKeyId, resolveKeys } from "../config/keys.ts";
import { DEFAULT_KEYMAP, FOCUS_ACTIONS, isDisabledIn, PANE_TITLES, TREE_DIALOG_FOOTER, TREE_DIALOG_HINT_TEXT } from "../config/keymap.ts";
import { LEFT_COLUMN_RATIO, PANE_IDS, SUMMARIZING_STATUS, TREE_DIALOG_SCOPE } from "../constants.ts";
import { matchTreeRow, parseSearchQuery } from "../data/search.ts";
import { findSessionIndex } from "../data/sessions.ts";
import {
	applyTreeFold,
	defaultFolded,
	filterTreeRows,
	foldedAncestors,
	foldTarget,
	nearestListedIndex,
} from "../data/tree-fold.ts";
import type {
	ActionId,
	ContentBlock,
	EnterOutcome,
	KeyHint,
	Keymap,
	ListScope,
	PaneId,
	PanelMode,
	RestoreOptions,
	SessionRow,
	SessionSortMode,
	TreeFilter,
	TreeRow,
} from "../types.ts";
import { fit, sideBySide } from "./frame.ts";
import { type ContentLayout, layoutContent, maxScroll, renderContentPane } from "./panes/content-pane.ts";
import { renderSessionsPane } from "./panes/sessions-pane.ts";
import { renderTreePane } from "./panes/tree-pane.ts";
import { type OutlinePrefix, treeOutline } from "./tree-outline.ts";
import { renderFooter } from "./widgets/footer.ts";
import { compactKeys, helpLineCount, overlayHelp } from "./widgets/help-overlay.ts";
import { InputDialog } from "./widgets/input-dialog.ts";
import { LABEL_DIALOG_HINTS, LABEL_DIALOG_TITLE } from "./widgets/label-dialog.ts";
import {
	CUSTOM_PROMPT_HINTS,
	CUSTOM_PROMPT_INDEX,
	CUSTOM_PROMPT_TITLE,
	SUMMARY_MENU,
	SUMMARY_MENU_HINTS,
	SUMMARY_MENU_TITLE,
} from "./widgets/restore-dialog.ts";
import { renderSearchStatus, SearchBar } from "./widgets/search-bar.ts";
import { SelectDialog } from "./widgets/select-dialog.ts";
import { TreeDialog } from "./widgets/tree-dialog.ts";

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
		treeFolded: new Set(),
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
 * 面板本身不做 I/O：复制、打标签、恢复会话都通过这里交给 actions 层。
 */
export interface ActionSource {
	/** Copy the node's full text to the clipboard; `false` = the entry has no text. */
	copyNodeText(sessionFile: string, entryId: string): Promise<boolean>;
	/** Set, or clear with `undefined`, the label of a node. */
	setNodeLabel(sessionFile: string, entryId: string, label: string | undefined): Promise<void>;
	/** Enter in SESSIONS: make pi show this session (/resume). Rejects with the reason on failure. */
	resumeSession(sessionFile: string): Promise<EnterOutcome>;
	/**
	 * Enter in TREE: continue the conversation from this node (/tree restore),
	 * switching session first if needed; `options` is the summary choice.
	 */
	restoreNode(sessionFile: string, entryId: string, options: RestoreOptions): Promise<EnterOutcome>;
}

export interface LazyPanelOptions {
	theme: Theme;
	data: DataSource;
	/** Optional: without it y / T / Enter report that actions are unavailable. */
	actions?: ActionSource;
	/** Terminal height available to the panel, re-read on every render. */
	getHeight: () => number;
	requestRender: () => void;
	onClose: () => void;
	/**
	 * Temporarily hide / show the panel while pi switches sessions, so prompts pi
	 * raises meanwhile (e.g. "session cwd not found") are visible and get the keys.
	 */
	setHidden?: (hidden: boolean) => void;
	/** Resolved keymap (defaults deep-merged with the user file). */
	keymap?: Keymap;
	initialState?: Partial<PanelState>;
	leftColumnRatio?: number;
	/** Initial footer status, e.g. config warnings. */
	status?: string;
	/** pi's `branchSummary.skipPrompt`: TREE Enter restores without asking (no summary). */
	skipSummaryPrompt?: boolean;
	/**
	 * File of the session pi currently has open. On the first load the SESSIONS
	 * cursor starts on it (a brand-new session is not listed yet, so the cursor
	 * stays on the first row).
	 */
	currentSessionFile?: string;
}

/** Max time between keys of a multi-key sequence such as "gg". */
const PENDING_TIMEOUT_MS = 1000;

/** Delay before (re)loading the session under the cursor while the user is still moving. */
const SESSION_LOAD_DEBOUNCE_MS = 40;

/** Node TREE Enter is restoring to while its menu / custom prompt is open. */
interface RestoreTarget {
	file: string;
	entryId: string;
	/** "role: text" of the node, shown in the dialog title bars. */
	subject: string;
}

/** A tree row plus the session it belongs to: what y / T / Enter act on (the pane's cursor row, or the dialog's). */
interface TreeTarget {
	file: string;
	row: TreeRow;
}

export class LazyPanel implements Component, Focusable {
	readonly state: PanelState;
	readonly keymap: Keymap;
	private readonly bindings: Binding[];
	private sessions: SessionRow[] = [];
	/** Whole (filtered) tree of the loaded session; `visibleTree` is what the pane lists once folded branches are hidden. */
	private tree: TreeRow[] = [];
	private visibleTree: TreeRow[] = [];
	/** Outline prefixes of `tree` for the pane, recomputed together with `visibleTree`. */
	private treeOutline: ReadonlyMap<string, OutlinePrefix> = new Map();
	private content: ContentBlock[] = [];
	/** Leaf entry the current `content` branch ends at (undefined = session's own leaf). */
	private contentLeaf: string | undefined;
	private status: string | undefined;
	private loadedSessionFile: string | undefined;
	/** Session to put the cursor on at the first load (see `LazyPanelOptions.currentSessionFile`); cleared once used. */
	private locateSessionFile: string | undefined;
	private disposed = false;
	private readonly ratio: number;
	private readonly searchBar: SearchBar;
	/** Shared centered text prompt: labelling a node, the custom summary instructions, renaming a session later. */
	private readonly inputDialog: InputDialog;
	/** Shared centered menu: the "Summarize branch?" choice now, confirmations and pickers later. */
	private readonly selectDialog: SelectDialog;
	/** Full tree in a big box (`a` in the tree pane) with its own cursor, live search and the filter keys. */
	private readonly treeDialog: TreeDialog;
	/**
	 * Fold state from before the dialog's search started: a search shows every
	 * match, so folds are cleared meanwhile and restored when the query is gone.
	 */
	private foldedBeforeSearch: Set<string> | undefined;
	/** Node being labelled while `mode === "label"`. */
	private labelTarget: { file: string; entryId: string } | undefined;
	/** Node being restored to while `mode === "restore"`. */
	private restoreTarget: RestoreTarget | undefined;
	/** True while an Enter action is waiting for pi (keys are ignored, the panel is hidden). */
	private entering = false;
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
		this.locateSessionFile = o.currentSessionFile;
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
		this.selectDialog = new SelectDialog({
			theme: o.theme,
			onChange: () => this.o.requestRender(),
		});
		this.treeDialog = new TreeDialog({
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
		this.treeDialog.focused = v && this.treeDialog.isOpen;
	}

	// -----------------------------------------------------------------------
	// Data loading
	// -----------------------------------------------------------------------

	/** Load sessions, then the tree + content for the cursor session. */
	async load(): Promise<void> {
		this.setStatus("loading sessions…");
		try {
			this.sessions = await this.o.data.listSessions(this.state.scope, this.state.sort);
			// 首次加载：光标落到 pi 当前打开的会话上（新会话还没列出来时就留在第一行）。
			// 之后 C / A 切范围重新加载时不再定位，光标照旧回到顶部。
			if (this.locateSessionFile !== undefined) {
				const idx = findSessionIndex(this.sessions, this.locateSessionFile);
				if (idx >= 0) this.state.cursor.sessions = idx;
				this.locateSessionFile = undefined;
			}
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
			this.setTree([], new Set());
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
			// 换了会话：旁支折叠、活动分支展开（活动分支上的行因此一定可见）。
			this.setTree(tree, defaultFolded(tree));
			this.setContent(content, undefined);
			this.loadedSessionFile = file;
			// Put the tree cursor on the active leaf, like /tree does.
			const leafIdx = findLastIndex(this.visibleTree, (r) => r.onActiveBranch);
			this.state.cursor.tree = leafIdx >= 0 ? leafIdx : 0;
			this.state.cursor.content = 0;
			// 树光标落在活动叶子上，右侧内容同步滚到并高亮这条消息。
			await this.syncContentToTree();
		} catch (err) {
			this.setTree([], new Set());
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

	/** Replace the tree and its fold state, then refresh what the pane lists. */
	private setTree(rows: TreeRow[], folded: Set<string>): void {
		this.tree = rows;
		this.state.treeFolded = folded;
		this.refreshTreeView();
	}

	/** 折叠状态变了 / 树重新加载后：重新算可见行和大纲前缀（光标索引指向可见行）。 */
	private refreshTreeView(): void {
		this.visibleTree = applyTreeFold(this.tree, this.state.treeFolded);
		this.treeOutline = treeOutline(this.tree, this.state.treeFolded);
	}

	/**
	 * Make the content pane follow the tree cursor.
	 *
	 * 选中的节点已经在当前显示的分支里 → 只高亮并滚动到那条消息；
	 * 节点在活动分支上但没有消息框（工具结果、空回复等）→ 保持显示完整活动分支，高亮它前面最近的一条消息；
	 * 节点在另一条分支上 → 重新加载“以该节点为叶子”的分支再高亮。
	 */
	private async syncContentToTree(): Promise<void> {
		const node = this.visibleTree[this.state.cursor.tree];
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
				if (this.visibleTree[this.state.cursor.tree]?.entryId !== node.entryId || this.loadedSessionFile !== file) return;
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
				const id = this.visibleTree[i]?.entryId;
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

		// 正在等 pi 切换会话 / 跳转节点：面板已隐藏，这期间的按键一律忽略，避免半途关掉面板。
		if (this.entering) return;

		// 搜索模式：所有按键交给输入框（Enter/Esc 由 SearchBar 回调处理）。
		if (this.state.mode === "search") {
			this.searchBar.handleInput(data);
			return;
		}

		// 居中输入弹窗打开时（打标签、自定义摘要指令）：同理全部交给弹窗。
		if (this.inputDialog.isOpen) {
			this.inputDialog.handleInput(data);
			return;
		}

		// 居中选择菜单打开时（Summarize branch?）：j/k/Enter/Esc 都由菜单处理。
		if (this.selectDialog.isOpen) {
			this.selectDialog.handleInput(data);
			return;
		}

		// 帮助弹窗打开时只响应关闭 / 滚动。
		if (this.state.helpOpen) {
			this.handleHelpInput(data);
			return;
		}

		// 完整树对话框打开时：搜索框聚焦就全部交给输入框，否则按 tree-dialog scope 解析按键。
		if (this.treeDialog.isOpen) {
			this.handleTreeDialogInput(data);
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
		if (result.kind === "action") this.dispatch(result.action);
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

	/** Mode to return to when a label prompt / restore menu closes: `tree` while the dialog is still open. */
	private baseMode(): PanelMode {
		return this.treeDialog.isOpen ? "tree" : "normal";
	}

	private openHelp(): void {
		this.state.helpOpen = true;
		this.state.helpScroll = 0;
		this.o.requestRender();
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
				this.openHelp();
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
				void this.copyTreeNode(this.currentTreeNode());
				return;
			case "tree-label":
				this.openLabelInput(this.currentTreeNode());
				return;
			case "tree-open":
				this.openTreeDialog();
				return;
			case "tree-fold":
				this.toggleTreeFold();
				return;
			case "session-resume":
				void this.resumeSession();
				return;
			case "tree-restore":
				this.restoreTreeNode(this.currentTreeNode());
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
		const rows = pane === "sessions" ? this.sessions : this.visibleTree;
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

	/** Tree row under the pane's cursor plus the file it belongs to, or undefined with a footer hint. */
	private currentTreeNode(): TreeTarget | undefined {
		const row = this.visibleTree[this.state.cursor.tree];
		const file = this.loadedSessionFile;
		if (!row || !file) {
			this.setStatus("no tree node selected");
			return undefined;
		}
		return { file, row };
	}

	/** y: copy the node's full text (like /tree ctrl+x). */
	private async copyTreeNode(target: TreeTarget | undefined): Promise<void> {
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
	private openLabelInput(target: TreeTarget | undefined): void {
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
		this.state.mode = this.baseMode();
		this.inputDialog.close();
		this.inputDialog.focused = false;
		this.labelTarget = undefined;
	}

	/**
	 * Re-read the tree of `file` (same filter) and keep the cursor on `entryId`.
	 * 在 labeled 过滤下清掉 label 会让这一行消失，此时光标夹回范围内并同步右侧高亮。
	 * 树对话框开着的话它列出的行也跟着刷新（标签是在对话框里打的）。
	 */
	private async reloadTree(file: string, entryId: string): Promise<void> {
		try {
			const tree = await this.o.data.loadTree(file, this.state.treeFilter);
			if (this.disposed || this.loadedSessionFile !== file) return;
			// 同一个会话：保留折叠状态（不再是段头的 id 会被 applyTreeFold 忽略）。
			this.setTree(tree, this.state.treeFolded);
			const idx = this.visibleTree.findIndex((r) => r.entryId === entryId);
			this.state.cursor.tree = idx >= 0 ? idx : clamp(this.state.cursor.tree, 0, Math.max(0, this.visibleTree.length - 1));
			if (this.treeDialog.isOpen) this.refreshTreeDialog(entryId);
			await this.syncContentToTree();
		} catch (err) {
			this.setStatus(`failed to reload tree: ${(err as Error).message}`);
		}
		this.o.requestRender();
	}

	// -----------------------------------------------------------------------
	// Tree folding (z)
	// -----------------------------------------------------------------------

	/**
	 * z: fold / unfold the branch segment under the cursor. On a segment head the
	 * fold toggles; anywhere inside a segment it folds that segment and moves the
	 * cursor onto its head (vim's zc). The trunk of a single-root tree has no
	 * segment to fold.
	 */
	private toggleTreeFold(): void {
		const row = this.visibleTree[this.state.cursor.tree];
		if (!row) {
			this.setStatus("no tree node selected");
			return;
		}
		const target = this.toggleFold(this.tree, row.entryId);
		if (!target) return;
		this.refreshTreeView();
		this.state.cursor.tree = Math.max(0, this.visibleTree.findIndex((r) => r.entryId === target));
		this.o.requestRender();
		// 光标从段内跳到了段头：右侧高亮跟着变。
		if (target !== row.entryId) void this.syncContentToTree();
	}

	/**
	 * Toggle the fold of the segment `entryId` is in, looked up in `base` (the
	 * pane's tree, or the dialog's search-narrowed rows). Returns the segment
	 * head the cursor should land on, or undefined (with a footer hint) on the
	 * trunk, where nothing folds.
	 */
	private toggleFold(base: TreeRow[], entryId: string): string | undefined {
		const target = foldTarget(base, entryId);
		if (!target) {
			this.setStatus("nothing to fold here");
			return undefined;
		}
		const folded = this.state.treeFolded;
		// 光标在段头上：切换；在段内其他行：折叠所在段（此时这一段一定是展开的）。
		if (target === entryId && folded.has(target)) folded.delete(target);
		else folded.add(target);
		return target;
	}

	// -----------------------------------------------------------------------
	// Tree dialog (a): the full tree in a big box
	// -----------------------------------------------------------------------

	/** a: show the whole tree of the loaded session with the cursor on the pane's node (same fold state as the pane). */
	private openTreeDialog(): void {
		if (!this.loadedSessionFile) {
			this.setStatus("no session loaded");
			return;
		}
		this.state.mode = "tree";
		this.foldedBeforeSearch = undefined;
		// 面板里的旧提示（比如"按 a 打开对话框"）到这里已经没用了，别留在对话框下面。
		this.status = undefined;
		const searchKey = labelsForFocus(this.keymap, TREE_DIALOG_SCOPE, "search")[0];
		this.treeDialog.open({
			// 刚打开时没有搜索，列出的行和小面板一样。
			rows: this.visibleTree,
			folded: this.state.treeFolded,
			initialIndex: this.state.cursor.tree,
			filter: this.state.treeFilter,
			hints: this.treeDialogHints(),
			...(searchKey ? { searchKey } : {}),
			onQueryChange: (q) => this.onDialogQueryChange(q),
		});
		this.treeDialog.focused = this._focused;
		this.o.requestRender();
	}

	/**
	 * Esc / q on the list: back to the pane with its cursor on the dialog's row —
	 * unfolding whatever hides it, so a node found by searching stays selected
	 * and the content pane shows it. The search ends with the dialog: the folds
	 * from before it come back (then the chosen row is revealed).
	 */
	private closeTreeDialog(): void {
		const row = this.treeDialog.selectedRow;
		this.state.mode = "normal";
		this.treeDialog.close();
		this.treeDialog.focused = false;
		// 搜索期间折叠是清空的：对话框一关搜索也就结束了，恢复搜索前的折叠状态。
		if (this.foldedBeforeSearch) {
			this.state.treeFolded = this.foldedBeforeSearch;
			this.foldedBeforeSearch = undefined;
		}
		if (row) {
			for (const id of foldedAncestors(this.tree, row.entryId, this.state.treeFolded)) this.state.treeFolded.delete(id);
		}
		this.refreshTreeView();
		const idx = row ? this.visibleTree.findIndex((r) => r.entryId === row.entryId) : -1;
		this.state.cursor.tree = idx >= 0 ? idx : clamp(this.state.cursor.tree, 0, Math.max(0, this.visibleTree.length - 1));
		this.o.requestRender();
		void this.syncContentToTree();
	}

	/** Bottom row / footer hints of the dialog, from the resolved keymap (`/ search`, `d/t/u/l/a filter`…). */
	private treeDialogHints(): KeyHint[] {
		const out: KeyHint[] = [];
		for (const group of TREE_DIALOG_FOOTER) {
			const keys = group.flatMap((a) => labelsForFocus(this.keymap, TREE_DIALOG_SCOPE, a).slice(0, 1));
			// 组里只要还有一个动作绑了键就显示，文字取组里第一个动作的。
			if (keys.length === 0) continue;
			out.push([compactKeys(keys), TREE_DIALOG_HINT_TEXT[group[0]!] ?? group[0]!]);
		}
		return out;
	}

	/**
	 * Keys while the dialog is open: the search row takes them all while it is
	 * focused (Esc there only hands them back to the list); otherwise Esc closes
	 * and everything else goes through the keymap with the `tree-dialog` scope
	 * in front (then `tree`, then `global`).
	 */
	private handleTreeDialogInput(data: string): void {
		if (this.treeDialog.searchFocused) {
			this.treeDialog.handleSearchInput(data);
			return;
		}
		if (matchesKeyId(data, "escape")) {
			if (this.pending.length) this.clearPending();
			else this.closeTreeDialog();
			return;
		}
		const pressed = [...this.pending, data];
		const result = resolveKeys(this.bindings, TREE_DIALOG_SCOPE, pressed);
		if (result.kind === "pending") {
			this.pending = pressed;
			this.armPendingTimer();
			this.o.requestRender();
			return;
		}
		this.clearPending();
		if (result.kind !== "action") return;
		// 外层 scope 里在对话框中关掉的动作（切面板、退出面板、n/N…）直接吞掉。
		if (result.scope !== TREE_DIALOG_SCOPE && isDisabledIn(TREE_DIALOG_SCOPE, result.action)) return;
		this.dispatchInTreeDialog(result.action);
	}

	/** The dialog's actions: its own keys plus the tree pane's, acting on the dialog's cursor. */
	private dispatchInTreeDialog(action: ActionId): void {
		switch (action) {
			case "move-down":
				this.treeDialog.move(1);
				return;
			case "move-up":
				this.treeDialog.move(-1);
				return;
			case "go-top":
				this.treeDialog.moveTo(0);
				return;
			case "go-bottom":
				this.treeDialog.moveTo(Number.MAX_SAFE_INTEGER);
				return;
			case "search":
				this.treeDialog.focusSearch();
				return;
			case "tree-copy":
				void this.copyTreeNode(this.dialogTreeNode());
				return;
			case "tree-label":
				this.openLabelInput(this.dialogTreeNode());
				return;
			case "tree-restore":
				this.restoreTreeNode(this.dialogTreeNode());
				return;
			case "tree-fold":
				this.dialogToggleFold();
				return;
			case "tree-filter-default":
				void this.setTreeFilter("default");
				return;
			case "tree-filter-no-tools":
				void this.toggleTreeFilter("no-tools");
				return;
			case "tree-filter-user":
				void this.toggleTreeFilter("user-only");
				return;
			case "tree-filter-labeled":
				void this.toggleTreeFilter("labeled");
				return;
			case "tree-filter-all":
				void this.toggleTreeFilter("all");
				return;
			case "tree-dialog-close":
				this.closeTreeDialog();
				return;
			default:
				// 其余动作（比如 tree-open）在对话框里没有意义。
				return;
		}
	}

	/** The dialog's cursor row plus the loaded session, or undefined with a footer hint. */
	private dialogTreeNode(): TreeTarget | undefined {
		const row = this.treeDialog.selectedRow;
		const file = this.loadedSessionFile;
		if (!row || !file) {
			this.setStatus("no tree node selected");
			return undefined;
		}
		return { file, row };
	}

	/** Rows of the dialog before folding: the tree, narrowed to the search matches (re-parented) while a query is active. */
	private dialogBaseRows(): TreeRow[] {
		const raw = this.treeDialog.searchQuery;
		if (!raw) return this.tree;
		const query = parseSearchQuery(raw);
		return filterTreeRows(this.tree, (r) => matchTreeRow(r, query));
	}

	/** Recompute what the dialog lists (search → fold) and keep its cursor on `keepEntryId` or the nearest listed ancestor. */
	private refreshTreeDialog(keepEntryId: string | undefined): void {
		const rows = applyTreeFold(this.dialogBaseRows(), this.state.treeFolded);
		this.treeDialog.setRows(rows, this.state.treeFolded, nearestListedIndex(rows, this.tree, keepEntryId));
	}

	/**
	 * Live search: every keystroke in the search row lands here. Like pi's
	 * /tree, a search clears the folds so every match is visible; the fold state
	 * from before the search comes back once the query is empty again (or the
	 * dialog closes).
	 */
	private onDialogQueryChange(query: string): void {
		const keep = this.treeDialog.selectedRow?.entryId;
		if (query) {
			// 第一次开始搜索时记住原来的折叠状态；之后每次改动查询都重新清空（pi 的做法）。
			this.foldedBeforeSearch ??= new Set(this.state.treeFolded);
			this.state.treeFolded.clear();
		} else if (this.foldedBeforeSearch) {
			this.state.treeFolded = this.foldedBeforeSearch;
			this.foldedBeforeSearch = undefined;
		}
		this.refreshTreeView();
		this.refreshTreeDialog(keep);
	}

	/**
	 * z in the dialog: the pane's fold toggle on the shared fold state, with the
	 * segment head looked up in the search-narrowed rows; the cursor lands on
	 * that head.
	 */
	private dialogToggleFold(): void {
		const row = this.treeDialog.selectedRow;
		if (!row) {
			this.setStatus("no tree node selected");
			return;
		}
		const target = this.toggleFold(this.dialogBaseRows(), row.entryId);
		if (!target) return;
		this.refreshTreeView();
		this.refreshTreeDialog(target);
	}

	/** t / u / l / a: switch to `filter`, or back to default when it is already active (pi's toggles). */
	private toggleTreeFilter(filter: TreeFilter): Promise<void> {
		return this.setTreeFilter(this.state.treeFilter === filter ? "default" : filter);
	}

	/**
	 * d (and the toggles): reload the tree with `filter`. Folds are cleared like
	 * pi does (a folded side branch would hide the labeled rows `l` asks for);
	 * the cursor stays on its row or the nearest listed ancestor.
	 */
	private async setTreeFilter(filter: TreeFilter): Promise<void> {
		const file = this.loadedSessionFile;
		if (!file || filter === this.state.treeFilter) return;
		this.state.treeFilter = filter;
		this.treeDialog.setFilter(filter);
		const keep = this.treeDialog.selectedRow?.entryId;
		try {
			const tree = await this.o.data.loadTree(file, filter);
			if (this.disposed || this.loadedSessionFile !== file || this.state.treeFilter !== filter) return;
			// 换过滤后全部展开；搜索前记住的折叠状态是旧树的，一并作废。
			this.foldedBeforeSearch = undefined;
			this.setTree(tree, new Set());
			const idx = keep ? this.visibleTree.findIndex((r) => r.entryId === keep) : -1;
			this.state.cursor.tree = idx >= 0 ? idx : clamp(this.state.cursor.tree, 0, Math.max(0, this.visibleTree.length - 1));
			this.refreshTreeDialog(keep);
		} catch (err) {
			this.setStatus(`failed to reload tree: ${(err as Error).message}`);
		}
	}

	// -----------------------------------------------------------------------
	// Enter: resume a session / restore to a tree node
	// -----------------------------------------------------------------------

	/** Enter in SESSIONS: switch pi to the session under the cursor (/resume), then close. */
	private async resumeSession(): Promise<void> {
		const row = this.sessions[this.state.cursor.sessions];
		if (!row) {
			this.setStatus("no session selected");
			return;
		}
		const actions = this.o.actions;
		if (!actions) {
			this.setStatus("resume: actions unavailable");
			return;
		}
		await this.enter("resume", () => actions.resumeSession(row.file));
	}

	/**
	 * Enter in TREE: continue from the node under the cursor (/tree restore), then close.
	 *
	 * 和 pi 内置 /tree 一样先问怎么处理被放弃的分支（Summarize branch? 菜单）；光标就在
	 * 活动叶子上时 Enter 等于直接进入该会话，不问；pi 的 branchSummary.skipPrompt 打开时也不问。
	 */
	private restoreTreeNode(target: TreeTarget | undefined): void {
		if (!target) return;
		if (!this.o.actions) {
			this.setStatus("restore: actions unavailable");
			return;
		}
		const restore: RestoreTarget = {
			file: target.file,
			entryId: target.row.entryId,
			subject: `${target.row.role}: ${target.row.text}`,
		};
		if (target.row.isLeaf || this.o.skipSummaryPrompt) {
			void this.runRestore(restore, { summarize: false });
			return;
		}
		this.openSummaryMenu(restore, 0);
	}

	/** The three-way menu of /tree; `index` is where the cursor starts (Esc from the custom prompt comes back onto that entry). */
	private openSummaryMenu(target: RestoreTarget, index: number): void {
		this.restoreTarget = target;
		this.state.mode = "restore";
		this.selectDialog.open({
			title: SUMMARY_MENU_TITLE,
			items: SUMMARY_MENU.map((m) => m.label),
			initialIndex: index,
			subject: target.subject,
			hints: SUMMARY_MENU_HINTS,
			onSelect: (i) => this.chooseSummary(i),
			// Esc：退回 tree 面板，什么都不做（pi 是退回 tree 选择器）。
			onCancel: () => this.closeRestoreDialogs(),
		});
		this.o.requestRender();
	}

	/** Enter in the menu: restore right away, or ask for the custom instructions first. */
	private chooseSummary(index: number): void {
		const target = this.restoreTarget;
		const choice = SUMMARY_MENU[index]?.choice;
		this.closeRestoreDialogs();
		if (!target || !choice) return;
		switch (choice) {
			case "none":
				void this.runRestore(target, { summarize: false });
				return;
			case "summarize":
				void this.runRestore(target, { summarize: true });
				return;
			case "custom":
				this.openCustomPrompt(target);
				return;
		}
	}

	/** "Summarize with custom prompt": a one-line prompt for the summarizer instructions (pi uses a multi-line editor). */
	private openCustomPrompt(target: RestoreTarget): void {
		this.restoreTarget = target;
		this.state.mode = "restore";
		this.inputDialog.open({
			title: CUSTOM_PROMPT_TITLE,
			subject: target.subject,
			hints: CUSTOM_PROMPT_HINTS,
			onSubmit: (v) => this.submitCustomPrompt(v),
			// Esc：退回三选菜单，光标停在 custom prompt 那一项，和 pi 一致。
			onCancel: () => {
				this.closeRestoreDialogs();
				this.openSummaryMenu(target, CUSTOM_PROMPT_INDEX);
			},
		});
		this.inputDialog.focused = this._focused;
		this.o.requestRender();
	}

	/** Enter in the custom prompt: summarize with the instructions (blank = pi's default prompt). */
	private submitCustomPrompt(value: string): void {
		const target = this.restoreTarget;
		this.closeRestoreDialogs();
		if (!target) return;
		const instructions = value.trim();
		void this.runRestore(target, instructions ? { summarize: true, customInstructions: instructions } : { summarize: true });
	}

	private closeRestoreDialogs(): void {
		this.state.mode = this.baseMode();
		this.selectDialog.close();
		this.inputDialog.close();
		this.inputDialog.focused = false;
		this.restoreTarget = undefined;
		this.o.requestRender();
	}

	/** Hand the choice to the actions layer; a summary takes a while, so the footer says so meanwhile. */
	private async runRestore(target: RestoreTarget, options: RestoreOptions): Promise<void> {
		const actions = this.o.actions;
		if (!actions) return;
		await this.enter(
			"restore",
			() => actions.restoreNode(target.file, target.entryId, options),
			options.summarize ? SUMMARIZING_STATUS : undefined,
		);
	}

	/**
	 * Run an action that hands control back to pi.
	 *
	 * 等待期间把面板藏起来并忽略按键：pi 切换时可能自己弹提示（比如会话目录不存在要不要
	 * 继续），藏起来它才看得见、按键才到得了它。成功就关闭面板；失败把原因写进 footer，
	 * 面板重新显示出来。`progress` 是等待期间 footer 的文字，默认 `${what}…`。
	 */
	private async enter(what: string, run: () => Promise<EnterOutcome>, progress?: string): Promise<void> {
		if (this.entering) return;
		this.entering = true;
		this.setStatus(progress ?? `${what}…`);
		this.o.setHidden?.(true);
		try {
			await run();
			if (this.disposed) return;
			this.close();
		} catch (err) {
			if (this.disposed) return;
			this.o.setHidden?.(false);
			this.setStatus(`${what} failed: ${(err as Error).message}`);
		} finally {
			this.entering = false;
		}
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
					rows: this.visibleTree,
					outline: this.treeOutline,
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
		// 弹窗按层叠顺序画：树对话框 → 输入框 / 菜单（可以开在树对话框上面）→ 帮助。
		if (this.treeDialog.isOpen) {
			lines = this.treeDialog.overlay(lines, width);
		}
		if (this.inputDialog.isOpen) {
			lines = this.inputDialog.overlay(lines, width);
		}
		if (this.selectDialog.isOpen) {
			lines = this.selectDialog.overlay(lines, width);
		}
		if (this.state.helpOpen) {
			lines = overlayHelp(lines, { keymap: this.keymap, focus: this.state.focus, scroll: this.state.helpScroll, theme }, width);
		}
		return [...lines, this.renderBottom(width)].map((l) => fit(l, width));
	}

	/** Footer row: search bar while typing, the open dialog's keys, search status after Enter, otherwise hints. */
	private renderBottom(width: number): string {
		if (this.state.mode === "search") {
			return this.searchBar.render(width)[0] ?? "";
		}
		const footer = { mode: this.state.mode, focus: this.state.focus, keymap: this.keymap, scope: this.state.scope, theme: this.o.theme };
		const pendingHint = this.pending.length ? `pending: ${this.pending.join("")}` : undefined;
		const status = pendingHint ?? this.status;
		// 弹窗打开时 footer 只显示弹窗自己的按键提示（如 Enter save / Esc cancel / empty removes）；状态文字照常显示。
		const dialog = this.inputDialog.isOpen
			? this.inputDialog
			: this.selectDialog.isOpen
				? this.selectDialog
				: this.treeDialog.isOpen
					? this.treeDialog
					: undefined;
		if (dialog) {
			return renderFooter({ ...footer, hints: dialog.hints, ...(status ? { status } : {}) }, width)[0]!;
		}
		if (this.state.searchQuery) {
			return renderSearchStatus({ query: this.state.searchQuery, current: 0, total: 0, theme: this.o.theme }, width);
		}
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
