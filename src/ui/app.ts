/**
 * Root panel component: the three panes, focus, key dispatch and the footer /
 * search bar. Opened from src/index.ts via `ctx.ui.custom(...)`.
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
 * The panel coordinates; the parts it delegates to live next to it:
 *   - ./state.ts            all mutable UI state (`PanelState`)
 *   - ./ports.ts            the injected `DataSource` / `ActionSource`: this layer does no I/O
 *   - ./flows/              every command that opens a prompt / menu or calls an action (Enter, d, r, e, T, …)
 *   - ./tree-view.ts        TREE rows, folds and outline
 *   - ./content-viewport.ts CONTENT blocks, layout, scrolling (zz) and line matches
 *   - ./key-sequencer.ts    multi-key sequences such as `gg`
 *   - ./panes/, ./widgets/  rendering
 * What stays here ties the panes together: loading the session under the
 * cursor, the tree cursor driving the content highlight, `/` search in each
 * pane, the tree dialog, the mouse and render.
 *
 * Keys: the first open overlay (`overlays`) takes them; otherwise
 * key → KeySequencer (the focused pane's scope, then global) → ActionId →
 * `dispatch`. The default bindings are listed in docs/keybindings.md.
 *
 * 面板只做协调：弹窗流程在 flows/，TREE / CONTENT 的视图状态在 tree-view.ts / content-viewport.ts；
 * 每个快捷键的行为见 docs/keybindings.md，这里不再重复。
 */

import type { Theme } from "@earendil-works/pi-coding-agent";
import type { Component, Focusable, TuiMouseEvent, TuiMouseEventResult } from "@earendil-works/pi-tui";
import { type Binding, compileKeymap, labelsFor, labelsForFocus, matchesKeyId, resolveKeys } from "../config/keys.ts";
import { DEFAULT_KEYMAP, FOCUS_ACTIONS, isDisabledIn, paneTitleText, TREE_DIALOG_FOOTER, treeDialogHintText } from "../config/keymap.ts";
import { LEFT_COLUMN_RATIO, PANE_IDS, SESSION_SORT_MODES, SPINNER_INTERVAL_MS, TREE_DIALOG_SCOPE } from "../constants.ts";
import { t } from "../i18n/index.ts";
import { clamp, findLastIndex, indicesWhere } from "../utils/indices.ts";
import { sessionFileKey } from "../utils/session-file-key.ts";
import { cycleMatch, firstMatchFrom, highlightTerms, matchSessionRow, matchTreeRow, parseSearchQuery, stepMatch } from "../data/search.ts";
import { findSessionIndex } from "../data/sessions.ts";
import { applyTreeFold, defaultFolded, filterTreeRows, nearestListedIndex } from "../data/tree-fold.ts";
import type {
	ActionId,
	ContextUsageInfo,
	EnterOutcome,
	KeyHint,
	Keymap,
	ListScope,
	PaneId,
	PanelMode,
	PaneSearch,
	SearchView,
	SessionInfo,
	SessionRow,
	TreeFilter,
	TreeRow,
} from "../types.ts";
import { ContentViewport } from "./content-viewport.ts";
import { toggleArchive, togglePin } from "./flows/archive-flows.ts";
import type { FlowHost } from "./flows/host.ts";
import {
	confirmCloneSession,
	confirmDeleteSession,
	confirmShareSession,
	copyLastReply,
	openCompactInput,
	openContextUsage,
	openImportInput,
	openNewSessionInput,
	openRenameInput,
	openSessionInfo,
	resumeSession,
	startExport,
	startFork,
} from "./flows/session-flows.ts";
import { copyEntryText, copyTreeNode, openLabelInput, openTreeFilterMenu, restoreTreeNode, type TreeTarget } from "./flows/tree-flows.ts";
import { fit, sideBySide } from "./frame.ts";
import { KeySequencer } from "./key-sequencer.ts";
import { hitTest, listVisibleRows, type MouseTarget, panelGeometry } from "./mouse.ts";
import { renderContentPane } from "./panes/content-pane.ts";
import { clampFirst, renderSessionsPane, scrollOffset, sessionAtLine, sessionFirstLine, sessionLineCount } from "./panes/sessions-pane.ts";
import { renderTreePane } from "./panes/tree-pane.ts";
import type { ActionSource, DataSource } from "./ports.ts";
import { applySessionFileState, createInitialState, type PanelState } from "./state.ts";
import { TreeView } from "./tree-view.ts";
import { ChangelogDialog } from "./widgets/changelog-dialog.ts";
import { ContextUsageDialog } from "./widgets/context-usage-dialog.ts";

import { renderFooter } from "./widgets/footer.ts";
import { buildHelpLines, compactKeys, helpViewport, overlayHelp } from "./widgets/help-overlay.ts";
import { InputDialog, type InputDialogSpec } from "./widgets/input-dialog.ts";

import { renderSearchStatus, SearchBar } from "./widgets/search-bar.ts";
import { SelectDialog, type SelectDialogSpec } from "./widgets/select-dialog.ts";
import { SessionInfoDialog } from "./widgets/session-info-dialog.ts";
import { TreeDialog } from "./widgets/tree-dialog.ts";

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
	/** Extension version, shown muted at the far right of the footer. */
	version?: string;
	/** pi's `branchSummary.skipPrompt`: TREE Enter restores without asking (no summary). */
	skipSummaryPrompt?: boolean;
	/**
	 * File of the session pi currently has open. On the first load the SESSIONS
	 * cursor starts on it (a brand-new session is not listed yet, so the cursor
	 * stays on the first row); `d` refuses to delete it, like pi's /resume.
	 */
	currentSessionFile?: string;
}

/** Delay before (re)loading the session under the cursor while the user is still moving. */
const SESSION_LOAD_DEBOUNCE_MS = 40;

/**
 * A dialog or overlay drawn over the panes. `LazyPanel.overlays` lists them in
 * the order they take the keys; see there for how the four users read it.
 */
interface Overlay {
	isOpen(): boolean;
	/** Every key while this is the first open overlay. */
	handleInput(data: string): void;
	/** Draw it over the rendered panel lines. */
	draw(lines: string[], width: number): string[];
	/** Footer hints of the overlay that currently owns the keyboard. */
	hints(): KeyHint[];
	/** Drawn under the other overlays: the tree dialog, which T / Enter open a prompt / menu on top of. */
	base?: boolean;
}

/**
 * Where the focused pane was when `/` opened the search bar: the live search
 * looks for the first match from here, Esc in the bar comes back here.
 */
interface SearchOrigin {
	pane: PaneId;
	/** Cursor row of the sessions list, row index in the whole tree, or first visible content line. */
	index: number;
	/** Tree pane: the row itself and the folds as they were (jumping to a match unfolds branches). */
	entryId?: string;
	folded?: Set<string>;
}

export class LazyPanel implements Component, Focusable {
	readonly state: PanelState;
	readonly keymap: Keymap;
	private readonly bindings: Binding[];
	private sessions: SessionRow[] = [];
	/** Discard out-of-order list / metadata reads. */
	private sessionListRequest = 0;
	/** TREE pane: the whole tree of the loaded session, the visible rows once folded, their outline and the fold rules. */
	private readonly treeView: TreeView;
	/** CONTENT pane: blocks of the branch on show, their layout, scrolling and the `/` matches. */
	private readonly contentViewport: ContentViewport;
	private status: string | undefined;
	private loadedSessionFile: string | undefined;
	/** Request identity prevents an older filter load from replacing the latest choice. */
	private pendingTreeFilter: { filter: TreeFilter } | undefined;
	/** Session to put the cursor on at the first load (see `LazyPanelOptions.currentSessionFile`); cleared once used. */
	private locateSessionFile: string | undefined;
	/** Session pi has open (see `LazyPanelOptions.currentSessionFile`): the one `d` must not delete. */
	private readonly currentSessionFile: string | undefined;
	private disposed = false;
	private readonly ratio: number;
	private readonly searchBar: SearchBar;
	/** Shared centered text prompt: labelling a node, the custom summary instructions, renaming a session. */
	private readonly inputDialog: InputDialog;
	/** Shared centered menu: the "Summarize branch?" choice and the delete confirmation. */
	private readonly selectDialog: SelectDialog;
	/** Full tree in a big box (`a` in the tree pane) with its own cursor, live search and the filter keys. */
	private readonly treeDialog: TreeDialog;
	/** `i` in SESSIONS: the read-only Session Info box. */
	private readonly infoDialog: SessionInfoDialog;
	/** `u` in SESSIONS: the read-only Context usage box. */
	private readonly usageDialog: ContextUsageDialog;
	/** `@`: pi's changelog in a big scrollable box. */
	private readonly changelogDialog: ChangelogDialog;
	/** What the dialog flows (./flows/) get from the panel; see `FlowHost`. */
	private readonly flowHost: FlowHost;
	/**
	 * Every dialog / overlay, in the order they take the keys: the first open one
	 * gets every key (`handleInput`) and gives the footer its hints (`renderBottom`),
	 * any open one blocks the mouse, and `render` draws the open ones bottom-up
	 * (`overlaysBottomUp`). Only the tree dialog can have another one open on top
	 * of it (T / Enter's prompt or menu), so it comes last here and first there.
	 *
	 * 所有弹窗按"谁先拿按键"排列：按键、footer 提示、鼠标屏蔽、叠加绘制都从这一份列表来，新增弹窗只改这里。
	 */
	private readonly overlays: Overlay[];
	/** `overlays` in drawing order: the base layer (the tree dialog) first, then the rest in list order. */
	private readonly overlaysBottomUp: Overlay[];
	/** Cached changelog markdown so a second `@` opens instantly (only the first render is slow). */
	private changelogMd: string | undefined;
	/** Ticker that rotates the changelog loading spinner while the markdown is fetched / rendered. */
	private changelogSpinner: ReturnType<typeof setInterval> | undefined;
	/** True while an Enter action is waiting for pi (keys are ignored, the panel is hidden). */
	private entering = false;
	/** Keys of an unfinished multi-key sequence such as "gg" (panes and tree dialog alike). */
	private readonly keys: KeySequencer;
	private _focused = false;
	/** Debounced reload of tree + content after the sessions cursor moved. */
	private sessionLoadTimer: ReturnType<typeof setTimeout> | undefined;
	private sessionLoadPromise: Promise<void> | undefined;
	private sessionLoadResolve: (() => void) | undefined;
	/** Terminal width from the last render, used to size the help overlay when clamping its scroll. */
	private lastWidth = 80;
	/** Set while the search bar is open (`mode === "search"`). */
	private searchOrigin: SearchOrigin | undefined;

	constructor(private readonly o: LazyPanelOptions) {
		this.state = createInitialState(o.initialState);
		this.keymap = o.keymap ?? DEFAULT_KEYMAP;
		this.bindings = compileKeymap(this.keymap);
		this.keys = new KeySequencer(this.bindings, () => this.o.requestRender());
		this.treeView = new TreeView(this.state);
		this.contentViewport = new ContentViewport({ theme: o.theme, state: this.state, onChange: () => this.o.requestRender() });
		this.ratio = o.leftColumnRatio ?? LEFT_COLUMN_RATIO;
		this.status = o.status;
		this.locateSessionFile = o.currentSessionFile;
		this.currentSessionFile = o.currentSessionFile;
		this.searchBar = new SearchBar({
			theme: o.theme,
			onSubmit: (q) => this.submitSearch(q),
			onCancel: () => this.cancelSearch(),
			// 每敲一个键就实时搜索（Enter / Esc 的回调先于这里触发，那时已经退出搜索模式）。
			onChange: () => this.onSearchInput(),
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
		this.infoDialog = new SessionInfoDialog({ theme: o.theme });
		this.usageDialog = new ContextUsageDialog({ theme: o.theme });
		this.changelogDialog = new ChangelogDialog({ theme: o.theme, onClose: () => this.closeChangelog() });
		this.overlays = [
			widgetOverlay(this.inputDialog),
			widgetOverlay(this.selectDialog),
			widgetOverlay(this.infoDialog),
			widgetOverlay(this.usageDialog),
			{
				isOpen: () => this.changelogDialog.isOpen,
				handleInput: (data) => this.handleChangelogInput(data),
				draw: (lines, width) => this.changelogDialog.overlay(lines, width),
				hints: () => this.changelogDialog.hints,
			},
			{
				isOpen: () => this.state.helpOpen,
				handleInput: (data) => this.handleHelpInput(data),
				draw: (lines, width) => {
					this.syncHelpViewport(width, lines.length);
					return overlayHelp(lines, { keymap: this.keymap, focus: this.state.focus, cursor: this.state.helpCursor, scroll: this.state.helpScroll, theme: this.o.theme }, width);
				},
				hints: () => [
					["j/k/↑↓", t("hint.move")],
					["Enter", t("help.run")],
					[compactKeys([...new Set(["Esc", "q", ...labelsFor(this.keymap, "global", "help")])]), t("hint.close")],
				],
			},
			{
				isOpen: () => this.treeDialog.isOpen,
				handleInput: (data) => this.handleTreeDialogInput(data),
				draw: (lines, width) => this.treeDialog.overlay(lines, width, this.state.showLabelTimestamps),
				hints: () => this.treeDialog.hints,
				base: true,
			},
		];
		this.overlaysBottomUp = [...this.overlays.filter((ov) => ov.base), ...this.overlays.filter((ov) => !ov.base)];
		// flows 拿到的面板能力：都转发给面板自己的私有方法，flows 本身不存任何状态。
		this.flowHost = {
			state: this.state,
			data: o.data,
			actions: o.actions,
			currentSessionFile: o.currentSessionFile,
			skipSummaryPrompt: o.skipSummaryPrompt ?? false,
			isDisposed: () => this.disposed,
			archiveViewHint: () => this.archiveViewHint(),
			setStatus: (text) => this.setStatus(text),
			sessionRows: () => this.sessions,
			currentSessionRow: () => this.currentSessionRow(),
			openPrompt: (mode, spec) => this.openPrompt(mode, spec),
			openMenu: (mode, spec) => this.openMenu(mode, spec),
			closeDialogs: () => this.closeDialogs(),
			openInfo: (info, onCopy) => this.openInfo(info, onCopy),
			openUsage: (info, onCopy) => this.openUsage(info, onCopy),
			dialogMaxRows: () => this.dialogMaxRows(),
			enter: (what, run, progress) => this.enter(what, run, progress),
			relist: (keepFile) => this.listSessions(keepFile),
			followSessionsCursor: () => this.followSessionsCursor(),
			reloadTree: (file, entryId) => this.reloadTree(file, entryId),
			setTreeFilter: (filter) => this.setTreeFilter(filter),
			refreshSession: (file) => this.refreshSession(file),
		};
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
		this.setStatus(t("status.loadingSessions"));
		// 首次加载：光标落到 pi 当前打开的会话上（新会话还没列出来时就留在第一行）。
		// 之后 C / A 切范围重新加载时不再定位，光标照旧回到顶部。
		const keep = this.locateSessionFile;
		this.locateSessionFile = undefined;
		if (await this.listSessions(keep)) {
			const archived = keep && [...this.state.archivedFiles].some((f) => sessionFileKey(f) === sessionFileKey(keep));
			this.setStatus(archived && this.state.sessionView === "normal" ? t("status.currentSessionArchived", { hint: this.archiveViewHint() }) : undefined);
			await this.loadSelectedSession();
		}
	}

	/**
	 * Re-read the sessions list and put the cursor on `keepFile` (or clamp it),
	 * recomputing the pane's search matches; the tree + content follow only if
	 * the session under the cursor changed. Resolves to false when the listing
	 * failed (reported in the footer, the old rows stay).
	 *
	 * 删除 / 改名 / 换排序之后重新拉列表：光标尽量留在同一个会话上，只有光标下的会话
	 * 真的变了（比如删掉的那个）才重新加载 TREE / CONTENT。
	 */
	private async listSessions(keepFile: string | undefined, view = this.state.sessionView): Promise<boolean> {
		const request = ++this.sessionListRequest;
		const { scope, sort } = this.state;
		try {
			const files = this.o.data.loadSessionState ? await this.o.data.loadSessionState() : undefined;
			const pinned = files?.pinned ?? this.state.pinnedFiles;
			const archived = files ? new Set(files.archived) : this.state.archivedFiles;
			const rows = await this.o.data.listSessions(scope, sort, pinned, { view, archived });
			if (this.disposed || request !== this.sessionListRequest) return false;
			if (files) applySessionFileState(this.state, files);
			this.state.sessionView = view;
			this.sessions = rows;
		} catch (err) {
			if (this.disposed || request !== this.sessionListRequest) return false;
			this.setStatus(t("status.listFailed", { error: (err as Error).message }));
			return false;
		}
		// 多选里已经不在列表中的会话（被删掉、换了范围）一并去掉。
		const listed = new Set(this.sessions.map((r) => r.file));
		for (const file of this.state.selectedSessionFiles) if (!listed.has(file)) this.state.selectedSessionFiles.delete(file);
		const idx = findSessionIndex(this.sessions, keepFile);
		this.state.cursor.sessions = idx >= 0 ? idx : clamp(this.state.cursor.sessions, 0, Math.max(0, this.sessions.length - 1));
		// 列表变了（首次加载、C / A 切范围、删除 / 改名 / 排序）：SESSIONS 的搜索结果按新列表重算，关键字保留。
		this.refreshSearch("sessions");
		this.o.requestRender();
		return true;
	}

	/** After the list changed: reload TREE + CONTENT when another session ended up under the cursor. */
	private async followSessionsCursor(): Promise<void> {
		if (this.sessions[this.state.cursor.sessions]?.file !== this.loadedSessionFile) await this.loadSelectedSession();
	}

	/** Reload tree and content for the session under the cursor. */
	async loadSelectedSession(): Promise<void> {
		this.pendingTreeFilter = undefined;
		const row = this.sessions[this.state.cursor.sessions];
		if (!row) {
			this.setTree([], new Set());
			this.state.cursor.tree = 0;
			this.state.listScroll.tree = null;
			this.contentViewport.setBlocks([], undefined);
			this.contentViewport.highlight(undefined);
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
			this.contentViewport.setBlocks(content, undefined);
			this.loadedSessionFile = file;
			// Put the tree cursor on the active leaf, like /tree does.
			const leafIdx = findLastIndex(this.treeView.visible, (r) => r.onActiveBranch);
			this.state.cursor.tree = leafIdx >= 0 ? leafIdx : 0;
			this.state.cursor.content = 0;
			// 树光标落在活动叶子上，右侧内容同步滚到并高亮这条消息。
			await this.syncContentToTree();
		} catch (err) {
			if (this.disposed || this.sessions[this.state.cursor.sessions]?.file !== file) return;
			this.setTree([], new Set());
			this.contentViewport.setBlocks([], undefined);
			this.contentViewport.highlight(undefined);
			this.setStatus(t("status.openFailed", { error: (err as Error).message }));
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

	/** Replace the tree and its fold state, then refresh what the pane lists. */
	private setTree(rows: TreeRow[], folded: Set<string>): void {
		this.treeView.set(rows, folded);
		// 树换了（换会话、打标签、换过滤）：TREE 的搜索结果按新树重算。
		this.refreshSearch("tree");
	}

	/**
	 * Make the content pane follow the tree cursor.
	 *
	 * 选中的节点已经在当前显示的分支里 → 只高亮并滚动到那条消息；
	 * 节点在活动分支上但没有消息框（工具结果、空回复等）→ 保持显示完整活动分支，高亮它前面最近的一条消息；
	 * 节点在另一条分支上 → 重新加载“以该节点为叶子”的分支再高亮。
	 */
	private async syncContentToTree(): Promise<void> {
		const node = this.treeView.cursorRow();
		const file = this.loadedSessionFile ?? this.sessions[this.state.cursor.sessions]?.file;
		if (!node || !file) {
			this.state.contentHighlight = undefined;
			this.o.requestRender();
			return;
		}
		const shown = this.contentViewport.blocks.some((b) => b.entryId === node.entryId);
		// 需要的分支：活动分支用 undefined（会话自己的叶子），否则以该节点为叶子。
		const wantLeaf = node.onActiveBranch ? undefined : node.entryId;
		if (!shown && this.contentViewport.leaf !== wantLeaf) {
			try {
				const content = await this.o.data.loadContent(file, wantLeaf);
				if (this.disposed) return;
				// 光标又动了 / 会话换了：丢弃这次结果。
				if (this.treeView.cursorRow()?.entryId !== node.entryId || this.loadedSessionFile !== file) return;
				this.contentViewport.setBlocks(content, wantLeaf);
			} catch (err) {
				this.setStatus(t("status.loadBranchFailed", { error: (err as Error).message }));
				return;
			}
		}
		this.highlightContent(node.entryId);
	}

	/** Highlight the block for `entryId` (or the nearest block before it in the tree) and scroll it to the top. */
	private highlightContent(entryId: string): void {
		const blocks = this.contentViewport.blocks;
		const shown = new Set(blocks.map((b) => b.entryId));
		let targetId: string | undefined = shown.has(entryId) ? entryId : undefined;
		if (!targetId) {
			// 没有对应消息块的节点：沿 tree 往上找最近的一条有消息块的节点。
			for (let i = this.state.cursor.tree - 1; i >= 0 && !targetId; i--) {
				const id = this.treeView.visible[i]?.entryId;
				if (id && shown.has(id)) targetId = id;
			}
			targetId ??= blocks[blocks.length - 1]?.entryId;
		}
		this.contentViewport.highlight(targetId);
	}

	private toggleLabelTimestamps(): void {
		this.state.showLabelTimestamps = !this.state.showLabelTimestamps;
		this.setStatus(this.state.showLabelTimestamps ? t("status.labelTimesShown") : t("status.labelTimesHidden"));
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

		// 持久化期间不接受重复操作，避免连按归档误作用到下一行。
		if (this.entering || this.state.sessionStateBusy) return;

		// 搜索模式：所有按键交给输入框（Enter/Esc 由 SearchBar 回调处理）。
		if (this.state.mode === "search") {
			this.searchBar.handleInput(data);
			return;
		}

		// 有弹窗打开时按键全部交给它（输入框、菜单、会话信息、changelog、帮助、树对话框，顺序见 overlays）。
		const overlay = this.activeOverlay();
		if (overlay) {
			overlay.handleInput(data);
			return;
		}

		// Esc 优先：清掉半截序列或当前面板的搜索结果。
		if (matchesKeyId(data, "escape")) {
			if (this.keys.hasPending) {
				this.keys.clear();
				return;
			}
			if (this.state.search[this.state.focus]) {
				this.clearSearch(this.state.focus);
				return;
			}
			// SESSIONS 有多选时 Esc 先清空选中，再按一次才退出面板（lazygit 的做法）。
			if (this.state.focus === "sessions" && this.state.selectedSessionFiles.size > 0) {
				this.clearSelection();
				return;
			}
			if (this.state.sessionView === "archived") {
				void this.toggleArchiveView();
				return;
			}
			this.close();
			return;
		}

		// 搜索生效期间 n / N（global 的 search-next / search-prev）优先于面板自己的同键绑定
		// （SESSIONS 里 n 本来是 new session），和 lazygit 搜索模式里的 n / N 一致。
		if (!this.keys.hasPending && this.state.search[this.state.focus]) {
			const g = resolveKeys(this.bindings, "global", [data]);
			if (g.kind === "action" && (g.action === "search-next" || g.action === "search-prev")) {
				this.dispatch(g.action);
				return;
			}
		}

		const result = this.keys.feed(this.state.focus, data);
		if (result.kind === "action") this.dispatch(result.action);
	}

	/** The dialog / overlay that has the keys: the first open one in `overlays`. */
	private activeOverlay(): Overlay | undefined {
		return this.overlays.find((ov) => ov.isOpen());
	}

	/** Keys while the changelog box is open: it scrolls / closes itself, and the `@` key (whatever it is bound to) closes it too. */
	private handleChangelogInput(data: string): void {
		if (this.isAction(data, "global", "changelog")) this.closeChangelog();
		else this.changelogDialog.handleInput(data);
		this.o.requestRender();
	}

	private handleHelpInput(data: string): void {
		// 关闭：Esc、q，或用户绑定给 help 的那个键（默认 ?）。
		const closes = matchesKeyId(data, "escape") || matchesKeyId(data, "q") || this.isAction(data, "global", "help");
		if (closes) {
			this.closeHelp();
			return;
		} else if (matchesKeyId(data, "j") || matchesKeyId(data, "down")) {
			this.state.helpCursor++;
		} else if (matchesKeyId(data, "k") || matchesKeyId(data, "up")) {
			this.state.helpCursor--;
		} else if (matchesKeyId(data, "return")) {
			this.syncHelpViewport(this.lastWidth, Math.max(8, this.o.getHeight()) - 1);
			const entries = buildHelpLines(this.keymap, this.state.focus).filter((line) => line.kind === "binding");
			const entry = entries[this.state.helpCursor];
			if (!entry) return;
			// 直接分发动作，不重放键位（搜索中的 n、自定义同键覆盖都不能改变所选命令）。
			// 先关帮助，确认框/输入框照常由原有 flow 打开；本次 Enter 不再交给新弹窗。
			this.closeHelp();
			this.dispatch(entry.action);
			return;
		} else {
			return;
		}
		this.syncHelpViewport(this.lastWidth, Math.max(8, this.o.getHeight()) - 1);
		this.o.requestRender();
	}

	private syncHelpViewport(width: number, height: number): void {
		const view = helpViewport(this.keymap, this.state.focus, width, height, this.state.helpCursor, this.state.helpScroll);
		this.state.helpCursor = view.cursor;
		this.state.helpScroll = view.scroll;
	}

	private closeHelp(): void {
		this.state.helpOpen = false;
		this.state.helpCursor = 0;
		this.state.helpScroll = 0;
		this.keys.clear();
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

	/**
	 * Show the text prompt of a flow in `mode`. The prompt and the menu are
	 * never up together, so the menu (if any) closes first; the prompt gets the
	 * IME cursor while the panel has focus.
	 */
	private openPrompt(mode: PanelMode, spec: InputDialogSpec): void {
		this.selectDialog.close();
		this.state.mode = mode;
		this.inputDialog.open(spec);
		this.inputDialog.focused = this._focused;
		this.o.requestRender();
	}

	/** Show the menu of a flow (a picker, a confirmation, an alert) in `mode`; the text prompt (if any) closes first. */
	private openMenu(mode: PanelMode, spec: SelectDialogSpec): void {
		this.inputDialog.close();
		this.inputDialog.focused = false;
		this.state.mode = mode;
		this.selectDialog.open(spec);
		this.o.requestRender();
	}

	/**
	 * End a flow: close its prompt / menu and go back to the base mode (`tree`
	 * while the tree dialog is still open under it).
	 *
	 * 所有弹窗流程（打标签、恢复、删除、改名、fork、导出……）都从这里收尾；流程的目标由各自的回调闭包带着，不再存字段。
	 */
	private closeDialogs(): void {
		this.state.mode = this.baseMode();
		this.selectDialog.close();
		this.inputDialog.close();
		this.inputDialog.focused = false;
		this.o.requestRender();
	}

	private openHelp(): void {
		this.keys.clear();
		this.state.helpOpen = true;
		this.state.helpCursor = 0;
		this.state.helpScroll = 0;
		this.o.requestRender();
	}

	// -----------------------------------------------------------------------
	// Mouse (light adaptation; the keyboard stays primary)
	// -----------------------------------------------------------------------

	/**
	 * 鼠标只做三件事：滚轮 / 三指滚动指针下的面板；单击切焦点并选中列表项；
	 * 双击 SESSIONS 进入会话、双击 TREE 折叠 / 展开分支。press / drag / move 不处理，
	 * 交回终端做文本选择。注意：只有 pi 跑在 fullscreen TUI 模式下才会收到鼠标事件，
	 * regular（默认）模式由终端自己处理滚动 / 选择，见 docs/issues.md。
	 */
	handleMouse(event: TuiMouseEvent): TuiMouseEventResult | undefined {
		if (this.disposed || this.entering) return undefined;
		// 搜索输入 / 各类弹窗打开时：吞掉面板区域的滚轮和点击，避免误动下面的列表，但不做交互。
		if (this.state.sessionStateBusy || this.state.mode !== "normal" || this.activeOverlay()) {
			return event.type === "wheel" || event.type === "click" ? { handled: true } : undefined;
		}
		if (event.type === "wheel") return this.handleWheel(event);
		if (event.type === "click") return this.handleClick(event);
		return undefined;
	}

	/** Map an event to the pane / row under the pointer, using the same window offsets as render(). */
	private hitTarget(event: TuiMouseEvent): MouseTarget | undefined {
		const height = Math.max(8, this.o.getHeight());
		const visible = listVisibleRows(height);
		const target = hitTest({
			width: event.width,
			height,
			ratio: this.ratio,
			x: event.x,
			y: event.y,
			sessionsFirst: this.listFirst("sessions", visible.sessions),
			// SESSIONS 按行命中：总数是渲染的行数（会话 2 行 + 分隔线），命中的行号再翻译回会话下标。
			sessionsTotal: sessionLineCount(this.sessions.length, this.pinnedCount()),
			treeFirst: this.listFirst("tree", visible.tree),
			treeTotal: this.treeView.visible.length,
		});
		if (target?.pane === "sessions" && target.row !== undefined) {
			// 分隔线 / 留白行 → undefined：点它只切焦点、不移光标。
			const index = sessionAtLine(target.row, this.sessions.length, this.pinnedCount());
			return { pane: "sessions", ...(index !== undefined ? { row: index } : { row: undefined }) };
		}
		return target;
	}

	/** How many of the leading (sorted-to-front) sessions are pinned; drives the group rules and line geometry. */
	private pinnedCount(): number {
		if (this.state.sessionView === "archived" || this.state.pinnedFiles.length === 0) return 0;
		const pinned = new Set(this.state.pinnedFiles.map(sessionFileKey));
		return this.sessions.filter((r) => pinned.has(sessionFileKey(r.file))).length;
	}

	/** First visible line/row of a list pane: the wheel offset when set, else the cursor-centered window; always clamped. */
	private listFirst(pane: "sessions" | "tree", visible: number): number {
		const override = this.state.listScroll[pane];
		if (pane === "sessions") {
			// SESSIONS 在"行空间"里滚动：总数含分隔线，居中用光标所在会话的首行。
			const total = sessionLineCount(this.sessions.length, this.pinnedCount());
			const cursorLine = sessionFirstLine(this.state.cursor.sessions, this.sessions.length, this.pinnedCount());
			const raw = override ?? scrollOffset(cursorLine, total, visible);
			return clampFirst(raw, total, visible);
		}
		const total = this.treeView.visible.length;
		const raw = override ?? scrollOffset(this.state.cursor.tree, total, visible);
		return clampFirst(raw, total, visible);
	}

	/** Wheel: scroll the pane under the pointer without changing focus or the selection (click owns those). */
	private handleWheel(event: TuiMouseEvent): TuiMouseEventResult {
		const delta = event.wheelDelta ?? 0;
		if (delta === 0) return { handled: true };
		const target = this.hitTarget(event);
		if (target?.pane === "sessions") this.scrollList("sessions", delta);
		else if (target?.pane === "tree") this.scrollList("tree", delta);
		else if (target?.pane === "content") this.contentViewport.scrollBy(delta);
		return { handled: true };
	}

	/** Scroll a list pane's viewport by `delta` rows, leaving the selection where it is (wheel only). */
	private scrollList(pane: "sessions" | "tree", delta: number): void {
		const visible = listVisibleRows(Math.max(8, this.o.getHeight()))[pane];
		// SESSIONS 的滚动范围是渲染行数（含分隔线）。
		const total = pane === "sessions" ? sessionLineCount(this.sessions.length, this.pinnedCount()) : this.treeView.visible.length;
		const next = clampFirst(this.listFirst(pane, visible) + delta, total, visible);
		if (next === this.state.listScroll[pane]) return;
		this.state.listScroll[pane] = next;
		this.o.requestRender();
	}

	/** Click: focus the pane under the pointer + select the row; double-click enters (sessions) / folds (tree). */
	private handleClick(event: TuiMouseEvent): TuiMouseEventResult {
		const target = this.hitTarget(event);
		if (!target) return { handled: true };
		const double = (event.clickCount ?? 1) >= 2;
		// 点在面板任意位置都切焦点到对应面板（含边框 / 空白处）。
		this.setFocus(target.pane);
		if (target.pane === "sessions") {
			if (target.row !== undefined) this.setSessionsCursor(target.row);
			if (double) void resumeSession(this.flowHost); // 双击进入会话（等价于 Enter / resume）
		} else if (target.pane === "tree") {
			if (target.row !== undefined) this.setTreeCursor(target.row);
			if (double) this.toggleTreeFold(); // 双击折叠 / 展开分支
		}
		return { handled: true };
	}

	/**
	 * Execute one logical action of the panes (the tree dialog has its own,
	 * `dispatchInTreeDialog`). Every ActionId is listed, so adding one without
	 * handling it here fails the type check.
	 */
	dispatch(action: ActionId): void {
		if (this.disposed || this.state.sessionStateBusy) return;
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
				void this.setScope("current-folder");
				return;
			case "scope-all":
				void this.setScope("all");
				return;
			case "help":
				this.openHelp();
				return;
			case "search":
				this.openSearch();
				return;
			case "search-next":
				this.stepSearch(1);
				return;
			case "search-prev":
				this.stepSearch(-1);
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
				this.contentViewport.scrollBy(this.contentViewport.pageStep());
				return;
			case "scroll-content-up":
				this.contentViewport.scrollBy(-this.contentViewport.pageStep());
				return;
			case "content-center":
				// zz：让高亮消息落在窗口正中（允许滚过末尾）；没有高亮的消息时提示一下。
				if (!this.contentViewport.center()) this.setStatus(t("status.noContentSelected"));
				return;
			case "content-copy":
				void this.copyContentBlock();
				return;
			case "tree-copy":
				void copyTreeNode(this.flowHost, this.currentTreeNode());
				return;
			case "tree-toggle-label-time":
				this.toggleLabelTimestamps();
				return;
			case "tree-label":
				openLabelInput(this.flowHost, this.currentTreeNode());
				return;
			case "tree-filter-menu":
				openTreeFilterMenu(this.flowHost, this.loadedSessionFile);
				return;
			case "tree-open":
				this.openTreeDialog();
				return;
			case "tree-fold":
				this.toggleTreeFold();
				return;
			case "session-resume":
				void resumeSession(this.flowHost);
				return;
			case "tree-restore":
				restoreTreeNode(this.flowHost, this.currentTreeNode());
				return;
			case "session-delete":
				confirmDeleteSession(this.flowHost);
				return;
			case "session-rename":
				openRenameInput(this.flowHost);
				return;
			case "session-sort":
				void this.cycleSort();
				return;
			case "session-info":
				void openSessionInfo(this.flowHost);
				return;
			case "session-context-usage":
				void openContextUsage(this.flowHost);
				return;
			case "session-new":
				openNewSessionInput(this.flowHost);
				return;
			case "session-fork":
				void startFork(this.flowHost);
				return;
			case "session-clone":
				confirmCloneSession(this.flowHost);
				return;
			case "session-compact":
				openCompactInput(this.flowHost);
				return;
			case "session-copy-last-reply":
				void copyLastReply(this.flowHost);
				return;
			case "session-export":
				startExport(this.flowHost);
				return;
			case "session-import":
				openImportInput(this.flowHost, "");
				return;
			case "session-share":
				confirmShareSession(this.flowHost);
				return;
			case "session-toggle-select":
				this.toggleSelect();
				return;
			case "session-archive":
			case "session-archive-view":
				if (this.state.focus !== "sessions") {
					this.setStatus(t("status.notImplemented", { action }));
					return;
				}
				if (action === "session-archive") void toggleArchive(this.flowHost);
				else void this.toggleArchiveView();
				return;
			case "session-pin":
				void togglePin(this.flowHost);
				return;
			case "changelog":
				void this.openChangelog();
				return;
			case "tree-filter-default":
			case "tree-filter-no-tools":
			case "tree-filter-user":
			case "tree-filter-labeled":
			case "tree-filter-all":
			case "tree-dialog-close":
				// 只在树对话框里有意义（dispatchInTreeDialog）；用户把它们绑到面板 scope 时提示一下。
				this.setStatus(t("status.notImplemented", { action }));
				return;
			default: {
				// 新增 ActionId 却忘了在上面处理时这里编译不过；运行时只可能是用户配置里写错的动作名（config 不校验名字）。
				const unknown: never = action;
				this.setStatus(t("status.notImplemented", { action: String(unknown) }));
				return;
			}
		}
	}

	// -----------------------------------------------------------------------
	// Cursor movement
	// -----------------------------------------------------------------------

	/** j/k: list panes move the cursor one row, the content pane scrolls one line. */
	private moveCursor(delta: number): void {
		if (this.state.focus === "content") {
			this.contentViewport.scrollBy(delta);
			return;
		}
		this.moveCursorTo(this.state.cursor[this.state.focus] + delta);
	}

	/** gg/G and absolute moves; the index is clamped to the focused list. */
	private moveCursorTo(index: number): void {
		const pane = this.state.focus;
		if (pane === "content") this.contentViewport.scrollTo(index);
		else if (pane === "sessions") this.setSessionsCursor(index);
		else this.setTreeCursor(index);
	}

	/** Move the sessions cursor (clamped) and reload TREE + CONTENT for the session it lands on. */
	private setSessionsCursor(index: number): void {
		// 光标一动就取消滚轮的独立滚动，重新按光标居中。
		this.state.listScroll.sessions = null;
		const next = clamp(index, 0, Math.max(0, this.sessions.length - 1));
		if (next === this.state.cursor.sessions) {
			this.o.requestRender();
			return;
		}
		this.state.cursor.sessions = next;
		this.o.requestRender();
		void this.scheduleSessionLoad();
	}

	/** Move the tree cursor (clamped, an index into the visible rows) and make the content pane follow. */
	private setTreeCursor(index: number): void {
		this.state.listScroll.tree = null;
		const next = this.treeView.clampIndex(index);
		if (next === this.state.cursor.tree) {
			this.o.requestRender();
			return;
		}
		this.state.cursor.tree = next;
		this.o.requestRender();
		void this.syncContentToTree();
	}

	/** y (content pane): copy the highlighted message's full text (same as TREE y). */
	private copyContentBlock(): Promise<void> {
		const file = this.loadedSessionFile;
		const entryId = this.state.contentHighlight;
		if (!file || !entryId) {
			this.setStatus(t("status.noContentSelected"));
			return Promise.resolve();
		}
		return copyEntryText(this.flowHost, file, entryId);
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
	private async setScope(scope: ListScope): Promise<void> {
		if (this.state.scope === scope || this.state.sessionStateBusy) return;
		const previous = this.state.scope;
		this.state.scope = scope;
		this.state.sessionStateBusy = true;
		this.setStatus(t("status.loadingSessions"));
		try {
			if (!await this.listSessions(undefined)) {
				this.state.scope = previous;
				return;
			}
			this.state.cursor.sessions = 0;
			this.state.listScroll.sessions = null;
			this.state.selectedSessionFiles.clear();
			this.refreshSearch("sessions");
			this.setStatus(undefined);
			await this.loadSelectedSession();
		} finally {
			this.state.sessionStateBusy = false;
			this.o.requestRender();
		}
	}

	/** X changes only visibility; directory scope and sorting stay the same. */
	private async toggleArchiveView(): Promise<void> {
		if (this.state.sessionStateBusy) return;
		const { sessionView, scope } = this.state;
		const next = sessionView === "normal" ? "archived" : "normal";
		this.state.sessionViewPositions[sessionView] = {
			scope,
			file: this.sessions[this.state.cursor.sessions]?.file,
			index: this.state.cursor.sessions,
			scroll: this.state.listScroll.sessions,
			query: this.state.search.sessions?.query ?? "",
		};
		const position = this.state.sessionViewPositions[next];
		const sameScope = position?.scope === scope;
		if (this.sessionLoadTimer) clearTimeout(this.sessionLoadTimer);
		this.sessionLoadTimer = undefined;
		this.state.sessionStateBusy = true;
		this.setStatus(t("status.loadingSessions"));
		try {
			if (!await this.listSessions(sameScope ? position.file : undefined, next)) return;
			const index = findSessionIndex(this.sessions, sameScope ? position.file : undefined);
			this.state.cursor.sessions = index >= 0 ? index : clamp(sameScope ? position.index : 0, 0, Math.max(0, this.sessions.length - 1));
			this.state.listScroll.sessions = sameScope ? position.scroll : null;
			this.state.selectedSessionFiles.clear();
			if (position?.query) this.state.search.sessions = { query: position.query, matches: [], current: -1 };
			else delete this.state.search.sessions;
			this.refreshSearch("sessions");
			this.setStatus(undefined);
			await this.followSessionsCursor();
		} finally {
			this.state.sessionStateBusy = false;
			this.o.requestRender();
		}
	}

	private archiveViewHint(): string {
		const key = labelsForFocus(this.keymap, "sessions", "session-archive-view")[0];
		return key ? t("hint.viewArchive", { key }) : "";
	}

	private archiveHints(): KeyHint[] {
		const actions: [ActionId, string][] = [
			["session-archive-view", t("hint.normalSessions")],
			["session-archive", t("hint.unarchive")],
			["session-resume", t("footer.session-resume")],
			["search", t("footer.search")],
			["help", t("footer.help")],
			["quit", t("footer.quit")],
		];
		return actions.flatMap(([action, text]) => {
			const keys = labelsForFocus(this.keymap, "sessions", action);
			return keys.length ? [[compactKeys(keys), text] as KeyHint] : [];
		});
	}

	// -----------------------------------------------------------------------
	// Search (/, n, N): lazygit-style, per pane, jump instead of filter
	// -----------------------------------------------------------------------

	/** `/`: open the bar pre-filled with the pane's query (cursor at the end) and remember where the pane is. */
	private openSearch(): void {
		const pane = this.state.focus;
		this.searchOrigin = this.snapshotOrigin(pane);
		this.state.mode = "search";
		this.searchBar.reset(this.state.search[pane]?.query ?? "", true);
		this.searchBar.focused = this._focused;
		this.o.requestRender();
	}

	/** The focused pane's position as of `/`: the live search starts looking here and Esc comes back here. */
	private snapshotOrigin(pane: PaneId): SearchOrigin {
		if (pane === "tree") {
			const row = this.treeView.cursorRow();
			// 树的匹配记的是整棵树的行号，所以原位置也换算成整棵树的行号；折叠状态一并记下。
			const index = this.treeView.cursorTreeIndex();
			return { pane, index: Math.max(0, index), ...(row ? { entryId: row.entryId } : {}), folded: new Set(this.state.treeFolded) };
		}
		return { pane, index: this.state.cursor[pane] };
	}

	/** Every keystroke in the bar: search live (Enter / Esc have already left search mode when their keystroke lands here). */
	private onSearchInput(): void {
		if (this.state.mode === "search" && this.searchOrigin) this.applyLiveSearch(this.searchBar.getValue().trim());
		this.o.requestRender();
	}

	/**
	 * Search `query` in the pane the bar was opened for and jump to the first
	 * match at or after the origin (wrapping to the first one). Every change
	 * starts over from the origin, like vim's incsearch: an empty query, or one
	 * without matches, puts the pane back where it was.
	 */
	private applyLiveSearch(query: string): void {
		const origin = this.searchOrigin;
		if (!origin) return;
		const pane = origin.pane;
		if (this.state.search[pane]?.query === query) return;
		if (!query) {
			delete this.state.search[pane];
			this.restoreOrigin(origin);
			return;
		}
		const matches = this.findMatches(pane, query);
		const search: PaneSearch = { query, matches, current: -1 };
		this.state.search[pane] = search;
		// 折叠先回到搜索前的样子，再为新的目标展开（上一次按键跳到的匹配可能展开了别的段）。
		if (pane === "tree" && origin.folded) this.state.treeFolded = new Set(origin.folded);
		const first = firstMatchFrom(matches, origin.index);
		if (first < 0) {
			this.restoreOrigin(origin);
			return;
		}
		search.current = first;
		this.jumpToMatch(pane, matches[first]!);
	}

	/** Enter in the bar: keep the query (the live search already jumped) and hand the keys back to the pane. */
	private submitSearch(query: string): void {
		const q = query.trim();
		// 一般情况下实时搜索已经跑过；直接回车（比如打开后没改预填的关键字）时补一次。
		if (this.searchOrigin && this.state.search[this.searchOrigin.pane]?.query !== q) this.applyLiveSearch(q);
		this.state.mode = "normal";
		this.searchBar.focused = false;
		this.searchOrigin = undefined;
		this.o.requestRender();
	}

	/** Esc in the bar: drop the query and put the pane back where `/` found it. */
	private cancelSearch(): void {
		const origin = this.searchOrigin;
		this.state.mode = "normal";
		this.searchBar.focused = false;
		this.searchOrigin = undefined;
		if (origin) {
			delete this.state.search[origin.pane];
			this.restoreOrigin(origin);
		}
		this.o.requestRender();
	}

	/** Esc in normal mode: end the pane's search, the cursor stays where it is. */
	private clearSearch(pane: PaneId): void {
		delete this.state.search[pane];
		this.o.requestRender();
	}

	/** Put the pane back to where it was when `/` was pressed (folds included for the tree). */
	private restoreOrigin(origin: SearchOrigin): void {
		switch (origin.pane) {
			case "sessions":
				this.setSessionsCursor(origin.index);
				return;
			case "tree": {
				if (origin.folded) this.state.treeFolded = new Set(origin.folded);
				this.treeView.refresh();
				const idx = this.treeView.indexOf(origin.entryId);
				this.placeTreeCursor(idx >= 0 ? idx : this.state.cursor.tree);
				return;
			}
			case "content":
				this.contentViewport.scrollTo(origin.index);
				return;
		}
	}

	/** Put the tree cursor on visible row `index` and sync the content pane even if the index did not change (the rows under it may have). */
	private placeTreeCursor(index: number): void {
		this.state.cursor.tree = this.treeView.clampIndex(index);
		this.o.requestRender();
		void this.syncContentToTree();
	}

	/** Matches of `query` in `pane`: row indices of the sessions list / the whole tree, or body lines of the content layout. */
	private findMatches(pane: PaneId, query: string): number[] {
		if (pane === "content") return this.contentViewport.matches(query);
		const parsed = parseSearchQuery(query);
		if (pane === "sessions") return indicesWhere(this.sessions, (r) => matchSessionRow(r, parsed));
		return indicesWhere(this.treeView.rows, (r) => matchTreeRow(r, parsed));
	}

	/** Recompute a list pane's matches after its rows changed; the query stays. */
	private refreshSearch(pane: "sessions" | "tree"): void {
		const search = this.state.search[pane];
		if (!search) return;
		search.matches = this.findMatches(pane, search.query);
		search.current = search.matches.length ? clamp(search.current, 0, search.matches.length - 1) : -1;
	}

	/** Up-to-date matches of a pane's search (the content pane's follow the layout). */
	private matchesOf(pane: PaneId, search: PaneSearch): number[] {
		if (pane === "content") {
			search.matches = this.contentViewport.matches(search.query);
			search.current = search.matches.length ? clamp(search.current, 0, search.matches.length - 1) : -1;
		}
		return search.matches;
	}

	/**
	 * n / N: the next / previous match of the focused pane's search, wrapping
	 * around. The list panes count from the cursor (vim's n / N), the content
	 * pane from the match it last jumped to (its scroll position cannot always
	 * reach the match, so it is no cursor).
	 */
	private stepSearch(delta: 1 | -1): void {
		const pane = this.state.focus;
		const search = this.state.search[pane];
		if (!search) {
			this.setStatus(t("status.noActiveSearch"));
			return;
		}
		const matches = this.matchesOf(pane, search);
		if (matches.length === 0) {
			this.setStatus(t("status.noMatches"));
			return;
		}
		// 列表面板从光标数起（vim 的 n / N）；CONTENT 没有光标，从上次跳到的匹配数起。
		const next =
			pane === "content"
				? cycleMatch(search.current, delta, matches.length)
				: stepMatch(matches, pane === "sessions" ? this.state.cursor.sessions : this.treeView.cursorTreeIndex(), delta);
		search.current = next;
		this.jumpToMatch(pane, matches[next]!);
	}

	/** Move the pane to match `index`: the sessions cursor, a tree row (unfolding what hides it), or the content line scrolled to the top. */
	private jumpToMatch(pane: PaneId, index: number): void {
		switch (pane) {
			case "sessions":
				this.setSessionsCursor(index);
				return;
			case "tree": {
				const row = this.treeView.rows[index];
				if (!row) return;
				// 目标藏在折叠段里：展开它的祖先，右侧内容跟着高亮。
				this.treeView.reveal(row.entryId);
				this.placeTreeCursor(this.treeView.indexOf(row.entryId));
				return;
			}
			case "content":
				this.contentViewport.scrollTo(index);
				return;
		}
	}

	/**
	 * What a pane paints for its search: the matches as indices into what it
	 * renders (the tree pane lists the folded tree, so its matches are mapped
	 * onto the visible rows), the current match and the header counts. For the
	 * list panes the current match is the one the cursor is on, if any.
	 */
	private searchView(pane: PaneId): SearchView | undefined {
		const search = this.state.search[pane];
		if (!search) return undefined;
		const terms = highlightTerms(parseSearchQuery(search.query));
		const matches = this.matchesOf(pane, search);
		const total = matches.length;
		if (pane === "sessions") {
			const pos = matches.indexOf(this.state.cursor.sessions);
			return { terms, matches: new Set(matches), current: pos >= 0 ? this.state.cursor.sessions : undefined, position: pos + 1, total };
		}
		if (pane === "tree") {
			const matched = new Set(matches.map((i) => this.treeView.rows[i]?.entryId));
			const visible = new Set<number>();
			this.treeView.visible.forEach((r, i) => {
				if (matched.has(r.entryId)) visible.add(i);
			});
			const pos = matches.indexOf(this.treeView.cursorTreeIndex());
			return { terms, matches: visible, current: pos >= 0 ? this.state.cursor.tree : undefined, position: pos + 1, total };
		}
		const current = search.current >= 0 ? matches[search.current] : undefined;
		return { terms, matches: new Set(matches), current, position: search.current + 1, total };
	}

	/** Footer hints while a search is active: the keys of `search-next` / `search-prev` (global) and Esc. */
	private searchHints(): KeyHint[] {
		const out: KeyHint[] = [];
		const next = labelsFor(this.keymap, "global", "search-next")[0];
		const prev = labelsFor(this.keymap, "global", "search-prev")[0];
		if (next) out.push([next, "next"]);
		if (prev) out.push([prev, "prev"]);
		out.push(["Esc", "clear"]);
		return out;
	}

	// -----------------------------------------------------------------------
	// Tree node under the cursor, tree reloads (y / T / Enter live in flows/tree-flows.ts)
	// -----------------------------------------------------------------------

	/** Tree row under the pane's cursor plus the file it belongs to, or undefined with a footer hint. */
	private currentTreeNode(): TreeTarget | undefined {
		const row = this.treeView.cursorRow();
		const file = this.loadedSessionFile;
		if (!row || !file) {
			this.setStatus(t("status.noTreeNode"));
			return undefined;
		}
		return { file, row };
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
			this.treeView.keepCursorOn(entryId);
			if (this.treeDialog.isOpen) this.refreshTreeDialog(entryId);
			await this.syncContentToTree();
		} catch (err) {
			this.setStatus(t("status.reloadTreeFailed", { error: (err as Error).message }));
		}
		this.o.requestRender();
	}

	/**
	 * `file` changed on disk (a rename appends a session_info entry): when it is
	 * the loaded session reload its tree with the cursor kept on its node (the
	 * `all` filter lists the new entry), otherwise follow the sessions cursor.
	 */
	private async refreshSession(file: string): Promise<void> {
		if (file === this.loadedSessionFile) {
			const entryId = this.treeView.cursorRow()?.entryId;
			if (entryId) await this.reloadTree(file, entryId);
		} else {
			await this.followSessionsCursor();
		}
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
		const row = this.treeView.cursorRow();
		if (!row) {
			this.setStatus(t("status.noTreeNode"));
			return;
		}
		const target = this.toggleFold(this.treeView.rows, row.entryId);
		if (!target) return;
		this.treeView.refresh();
		this.state.cursor.tree = Math.max(0, this.treeView.indexOf(target));
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
		const target = this.treeView.toggleFold(base, entryId);
		if (!target) this.setStatus(t("status.nothingToFold"));
		return target;
	}

	// -----------------------------------------------------------------------
	// Tree dialog (a): the full tree in a big box
	// -----------------------------------------------------------------------

	/** a: show the whole tree of the loaded session with the cursor on the pane's node (same fold state as the pane). */
	private openTreeDialog(): void {
		if (!this.loadedSessionFile) {
			this.setStatus(t("status.noSessionLoaded"));
			return;
		}
		this.state.mode = "tree";
		this.treeView.dropSuspendedFolds();
		// 面板里的旧提示（比如"按 a 打开对话框"）到这里已经没用了，别留在对话框下面。
		this.status = undefined;
		const searchKey = labelsForFocus(this.keymap, TREE_DIALOG_SCOPE, "search")[0];
		this.treeDialog.open({
			// 刚打开时没有搜索，列出的行和小面板一样。
			rows: this.treeView.visible,
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
		// 搜索期间折叠是清空的：对话框一关搜索也就结束了，恢复搜索前的折叠状态（再展开选中行所在的段）。
		this.treeView.resumeFolds();
		if (row) this.treeView.reveal(row.entryId);
		else this.treeView.refresh();
		this.treeView.keepCursorOn(row?.entryId);
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
			out.push([compactKeys(keys), treeDialogHintText(group[0]!)]);
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
			if (this.keys.hasPending) this.keys.clear();
			else this.closeTreeDialog();
			return;
		}
		const result = this.keys.feed(TREE_DIALOG_SCOPE, data);
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
				void copyTreeNode(this.flowHost, this.dialogTreeNode());
				return;
			case "tree-toggle-label-time":
				this.toggleLabelTimestamps();
				return;
			case "tree-label":
				openLabelInput(this.flowHost, this.dialogTreeNode());
				return;
			case "tree-restore":
				restoreTreeNode(this.flowHost, this.dialogTreeNode());
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
			this.setStatus(t("status.noTreeNode"));
			return undefined;
		}
		return { file, row };
	}

	/** Rows of the dialog before folding: the tree, narrowed to the search matches (re-parented) while a query is active. */
	private dialogBaseRows(): TreeRow[] {
		const raw = this.treeDialog.searchQuery;
		if (!raw) return this.treeView.rows;
		const query = parseSearchQuery(raw);
		return filterTreeRows(this.treeView.rows, (r) => matchTreeRow(r, query));
	}

	/** Recompute what the dialog lists (search → fold) and keep its cursor on `keepEntryId` or the nearest listed ancestor. */
	private refreshTreeDialog(keepEntryId: string | undefined): void {
		const rows = applyTreeFold(this.dialogBaseRows(), this.state.treeFolded);
		this.treeDialog.setRows(rows, this.state.treeFolded, nearestListedIndex(rows, this.treeView.rows, keepEntryId));
	}

	/**
	 * Live search: every keystroke in the search row lands here. Like pi's
	 * /tree, a search clears the folds so every match is visible; the fold state
	 * from before the search comes back once the query is empty again (or the
	 * dialog closes).
	 */
	private onDialogQueryChange(query: string): void {
		const keep = this.treeDialog.selectedRow?.entryId;
		if (query) this.treeView.suspendFolds();
		else this.treeView.resumeFolds();
		this.treeView.refresh();
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
			this.setStatus(t("status.noTreeNode"));
			return;
		}
		const target = this.toggleFold(this.dialogBaseRows(), row.entryId);
		if (!target) return;
		this.treeView.refresh();
		this.refreshTreeDialog(target);
	}

	/** t / u / l / a: switch to `filter`, or back to default when it is already active (pi's toggles). */
	private toggleTreeFilter(filter: TreeFilter): Promise<void> {
		const current = this.pendingTreeFilter?.filter ?? this.state.treeFilter;
		return this.setTreeFilter(current === filter ? "default" : filter);
	}

	/**
	 * d (and the toggles): reload the tree with `filter`. Folds are cleared like
	 * pi does (a folded side branch would hide the labeled rows `l` asks for);
	 * the cursor stays on its row or the nearest listed ancestor.
	 */
	private async setTreeFilter(filter: TreeFilter): Promise<void> {
		const file = this.loadedSessionFile;
		if (!file) return;
		// 选回已显示的模式也要取消旧请求；菜单选择是设置，不是 toggle。
		this.pendingTreeFilter = undefined;
		if (filter === this.state.treeFilter) return;
		const request = { filter };
		this.pendingTreeFilter = request;
		try {
			const tree = await this.o.data.loadTree(file, filter);
			if (this.disposed || this.loadedSessionFile !== file || this.pendingTreeFilter !== request) return;
			const previousRows = this.treeView.rows;
			const keep = this.treeDialog.isOpen ? this.treeDialog.selectedRow?.entryId : this.treeView.cursorRow()?.entryId;
			// 加载成功才改状态，避免失败后标题与实际列表不一致。两个视图始终共用这一份过滤。
			this.state.treeFilter = filter;
			this.treeView.dropSuspendedFolds();
			this.setTree(tree, new Set());
			this.state.cursor.tree = nearestListedIndex(this.treeView.visible, previousRows, keep);
			this.state.listScroll.tree = null;
			if (this.treeDialog.isOpen) {
				this.treeDialog.setFilter(filter);
				this.refreshTreeDialog(this.treeView.cursorRow()?.entryId);
			} else {
				await this.syncContentToTree();
			}
			this.o.requestRender();
		} catch (err) {
			if (this.disposed || this.loadedSessionFile !== file || this.pendingTreeFilter !== request) return;
			this.setStatus(t("status.reloadTreeFailed", { error: (err as Error).message }));
		} finally {
			if (this.pendingTreeFilter === request) this.pendingTreeFilter = undefined;
		}
	}

	// -----------------------------------------------------------------------
	// Sessions pane: selection, sort, the info box, changelog (@) — the dialog flows live in flows/session-flows.ts
	// -----------------------------------------------------------------------

	/** Session row under the cursor, or undefined with a footer hint. */
	private currentSessionRow(): SessionRow | undefined {
		const row = this.sessions[this.state.cursor.sessions];
		if (!row) this.setStatus(t("status.noSessionSelected"));
		return row;
	}

	/** space: toggle the session under the cursor in the multi-selection. */
	private toggleSelect(): void {
		const row = this.currentSessionRow();
		if (!row) return;
		const selected = this.state.selectedSessionFiles;
		if (selected.has(row.file)) selected.delete(row.file);
		else selected.add(row.file);
		this.o.requestRender();
	}

	private clearSelection(): void {
		this.state.selectedSessionFiles.clear();
		this.setStatus(t("status.selectionCleared"));
	}

	/** @: show pi's changelog. Rendering the whole file is slow, so the box opens with a loading spinner first. */
	private async openChangelog(): Promise<void> {
		const load = this.o.data.loadChangelog;
		if (!load) {
			this.setStatus(t("status.changelogUnavailable"));
			return;
		}
		this.state.mode = "changelog";
		this.status = undefined;
		// 已经加载过：直接用缓存内容打开，渲染结果按宽度缓存，秒开，不再显示加载中。
		if (this.changelogMd !== undefined) {
			this.changelogDialog.setContent(this.changelogMd);
			this.o.requestRender();
			return;
		}
		// 首次打开：Markdown 渲染整份 changelog（几千行）是同步的、比较慢。先画出"加载中"的弹窗
		// （底部转方块 + 文案），让反馈在那次卡顿渲染之前先出现。
		this.changelogDialog.openLoading();
		this.startChangelogSpinner();
		this.o.requestRender();
		let markdown: string;
		try {
			markdown = await load();
		} catch (err) {
			this.stopChangelogSpinner();
			if (this.disposed) return;
			this.changelogDialog.close();
			this.state.mode = this.baseMode();
			this.setStatus(t("status.changelogFailed", { error: (err as Error).message }));
			return;
		}
		// 先让"加载中"那一帧画出来，再做同步的重渲染（否则两次 requestRender 可能被合并，加载提示看不见）。
		await new Promise((resolve) => setTimeout(resolve, 0));
		// 加载期间用户可能已经关掉弹窗或退出了面板。
		if (this.disposed || !this.changelogDialog.isLoading) {
			this.stopChangelogSpinner();
			return;
		}
		this.stopChangelogSpinner();
		this.changelogMd = markdown;
		this.changelogDialog.setContent(markdown);
		this.o.requestRender();
	}

	private closeChangelog(): void {
		this.stopChangelogSpinner();
		this.changelogDialog.close();
		this.state.mode = this.baseMode();
		this.o.requestRender();
	}

	/** Rotate the changelog loading spinner one frame every SPINNER_INTERVAL_MS. */
	private startChangelogSpinner(): void {
		this.stopChangelogSpinner();
		const timer = setInterval(() => {
			this.changelogDialog.advanceSpinner();
			this.o.requestRender();
		}, SPINNER_INTERVAL_MS);
		// unref：加载很快时不让这个定时器拖住进程（尤其是测试）。
		timer.unref?.();
		this.changelogSpinner = timer;
	}

	private stopChangelogSpinner(): void {
		if (this.changelogSpinner) clearInterval(this.changelogSpinner);
		this.changelogSpinner = undefined;
	}

	/** Rows a centered menu may show at once before it scrolls: leave room for borders + footer. */
	private dialogMaxRows(): number {
		return Math.max(1, this.o.getHeight() - 6);
	}

	/** s: the next sort order (recent → created → title → threaded → …); the cursor follows its session. */
	private async cycleSort(): Promise<void> {
		const i = SESSION_SORT_MODES.indexOf(this.state.sort);
		const next = SESSION_SORT_MODES[(i + 1) % SESSION_SORT_MODES.length]!;
		this.state.sort = next;
		const keep = this.sessions[this.state.cursor.sessions]?.file;
		if (await this.listSessions(keep)) this.setStatus(t("status.sort", { sort: t(`sort.${next}`) }));
		await this.followSessionsCursor();
	}

	/** The read-only Session Info box (i): `onCopy` gets its text on y, Esc / q close it. */
	private openInfo(info: SessionInfo, onCopy: (text: string) => void): void {
		this.state.mode = "info";
		this.infoDialog.open({ info, onCopy, onClose: () => this.closeSessionInfo() });
		this.o.requestRender();
	}

	private closeSessionInfo(): void {
		this.state.mode = this.baseMode();
		this.infoDialog.close();
		this.o.requestRender();
	}

	/** Context usage (u): y copies the current view; Enter previews a category, Esc returns one level. */
	private openUsage(info: ContextUsageInfo, onCopy: (text: string) => void): void {
		this.state.mode = "usage";
		this.usageDialog.open({ info, onCopy, onClose: () => this.closeUsage() });
		this.o.requestRender();
	}

	private closeUsage(): void {
		this.state.mode = this.baseMode();
		this.usageDialog.close();
		this.o.requestRender();
	}

	// -----------------------------------------------------------------------
	// Handing control to pi: Enter (resume / restore), n, o, y, c, I
	// -----------------------------------------------------------------------

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
		const verb = t(`enter.${what}`);
		this.setStatus(progress ?? t("status.working", { what: verb }));
		this.o.setHidden?.(true);
		try {
			await run();
			if (this.disposed) return;
			this.close();
		} catch (err) {
			if (this.disposed) return;
			this.o.setHidden?.(false);
			this.setStatus(t("status.workFailed", { what: verb, error: (err as Error).message }));
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
		this.keys.clear();
		this.clearSessionLoad();
		this.o.onClose();
	}

	dispose(): void {
		this.disposed = true;
		this.stopChangelogSpinner();
		this.keys.clear();
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
		this.lastWidth = width;
		const height = Math.max(8, this.o.getHeight());
		const { leftW, rightW, bodyH, sessionsH, treeH } = panelGeometry(width, height, this.ratio);
		const { theme } = this.o;
		const selectedSession = this.sessions[this.state.cursor.sessions];
		const sessionsSearch = this.searchView("sessions");
		const treeSearch = this.searchView("tree");
		// 列表窗口的首行：滚轮滚动时用独立偏移，否则按光标居中（和 hitTarget 一致）。
		const visibleRows = listVisibleRows(height);

		const left = [
			...renderSessionsPane(
				{
					rows: this.sessions,
					cursor: this.state.cursor.sessions,
					first: this.listFirst("sessions", visibleRows.sessions),
					focused: this.state.focus === "sessions",
					scope: this.state.scope,
					sort: this.state.sort,
					selected: this.state.selectedSessionFiles,
					pinnedCount: this.pinnedCount(),
					title: this.paneTitle("sessions"),
					theme,
					...(this.currentSessionFile ? { currentFile: this.currentSessionFile } : {}),
					...(sessionsSearch ? { search: sessionsSearch } : {}),
				},
				leftW,
				sessionsH,
			),
			...renderTreePane(
				{
					rows: this.treeView.visible,
					outline: this.treeView.outline,
					cursor: this.state.cursor.tree,
					first: this.listFirst("tree", visibleRows.tree),
					focused: this.state.focus === "tree",
					showLabelTimestamps: this.state.showLabelTimestamps,
					filter: this.state.treeFilter,
					emptyMessage: this.emptyMessage(selectedSession),
					title: this.paneTitle("tree"),
					theme,
					...(treeSearch ? { search: treeSearch } : {}),
				},
				leftW,
				treeH,
			),
		];

		// 先排版（缓存按宽度失效），CONTENT 的搜索结果跟着这份排版算。
		const layout = this.contentViewport.layoutFor(rightW - 2, bodyH - 2);
		const contentSearch = this.searchView("content");
		const right = renderContentPane(
			{
				blocks: this.contentViewport.blocks,
				layout,
				scroll: this.state.cursor.content,
				focused: this.state.focus === "content",
				emptyMessage: this.emptyMessage(selectedSession),
				title: this.paneTitle("content"),
				theme,
				...(this.state.contentHighlight ? { highlightEntryId: this.state.contentHighlight } : {}),
				...(contentSearch ? { search: contentSearch } : {}),
			},
			rightW,
			bodyH,
		);

		let lines = sideBySide(left, right, leftW, rightW);
		// 弹窗按层叠顺序画：树对话框在最底下（输入框 / 菜单可以开在它上面），其余按 overlays 的顺序往上叠。
		for (const overlay of this.overlaysBottomUp) {
			if (overlay.isOpen()) lines = overlay.draw(lines, width);
		}
		return [...lines, this.renderBottom(width)].map((l) => fit(l, width));
	}

	/** Footer row: search bar while typing, the open dialog's keys, the search status of the focused pane, otherwise hints. */
	private renderBottom(width: number): string {
		if (this.state.mode === "search") {
			return this.searchBar.render(width)[0] ?? "";
		}
		const footer = {
			mode: this.state.mode,
			focus: this.state.focus,
			keymap: this.keymap,
			scope: this.state.scope,
			theme: this.o.theme,
			// 版本号常驻在 footer 最右侧（搜索状态行除外）。
			...(this.o.version ? { version: this.o.version } : {}),
		};
		const pendingHint = this.keys.hasPending ? t("status.pending", { keys: this.keys.pendingKeys }) : undefined;
		const status = pendingHint ?? this.status;
		// 和按键分发使用同一个最上层弹窗；不能退回显示当前不可用的面板按键。
		const overlay = this.overlays.find((ov) => ov.isOpen());
		if (overlay) {
			return renderFooter({
				...footer,
				modal: true,
				hints: overlay.hints(),
				...(this.state.helpOpen ? { modeLabel: t("help.titlePrefix") } : {}),
				...(status ? { status } : {}),
			}, width)[0]!;
		}
		// 当前面板有搜索生效：显示关键字、位置 / 数量和 n / N / Esc 提示（别的面板的搜索不显示）。
		const search = this.state.search[this.state.focus];
		const view = search ? this.searchView(this.state.focus) : undefined;
		if (search && view) {
			return renderSearchStatus(
				{ query: search.query, position: view.position, total: view.total, hints: this.searchHints(), theme: this.o.theme, ...(status ? { status } : {}) },
				width,
			);
		}
		return renderFooter({
			...footer,
			...(this.state.sessionView === "archived" && this.state.focus === "sessions" ? { hints: this.archiveHints() } : {}),
			...(status ? { status } : {}),
		}, width)[0]!;
	}

	private emptyMessage(selected: SessionRow | undefined): string {
		if (!selected) return t("pane.selectSession");
		if (this.loadedSessionFile !== selected.file) return t("pane.loading");
		return t("pane.nothingToShow");
	}

	/** "[1] SESSIONS": the jump key comes from the resolved keymap, so rebinding shows up here. */
	private paneTitle(pane: PaneId): string {
		const key = labelsFor(this.keymap, "global", FOCUS_ACTIONS[pane])[0];
		const title = pane === "sessions" && this.state.sessionView === "archived" ? t("pane.archivedSessionsTitle") : paneTitleText(pane);
		return key ? `[${key}] ${title}` : title;
	}
}

/** The `Overlay` of a dialog widget that handles its own keys and brings its own footer hints. */
function widgetOverlay(widget: {
	readonly isOpen: boolean;
	readonly hints: KeyHint[];
	handleInput(data: string): void;
	overlay(lines: string[], termW: number): string[];
}): Overlay {
	return {
		isOpen: () => widget.isOpen,
		handleInput: (data) => widget.handleInput(data),
		draw: (lines, width) => widget.overlay(lines, width),
		hints: () => widget.hints,
	};
}
