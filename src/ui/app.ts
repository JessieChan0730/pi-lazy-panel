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
 *   - C 切到 Current folder，A 切到 All（各自只做单向切换），? 帮助
 *   - / 搜索（lazygit 风格，只作用于当前聚焦的面板，每个面板各记各的关键字）：底部出现搜索栏，输入时实时跳到
 *     原位置之后的第一个匹配，Enter 保留关键字退出输入栏，Esc 清掉关键字并回到原位置；之后 n / N 在匹配之间
 *     往下 / 往上跳并回绕（搜索生效期间 n / N 优先于面板自己的同键绑定），normal 模式下 Esc 清掉当前面板的搜索。
 *     列表不过滤只跳转：SESSIONS 按 名称 / 预览（模型 / 路径只通过 model: / path:，after: / before: 限定时间），
 *     TREE 按 label / 正文（tag: / role: 限定；目标藏在折叠段里时展开它的祖先，右侧跟着高亮），CONTENT 按渲染后的
 *     正文行（只有自由文本，跳转把该行滚到面板顶部）。命中的文字高亮、当前匹配加强调，标题右侧显示 2/7 matches
 *   - j/k、gg/G：SESSIONS / TREE 移动光标，CONTENT 按行滚动；SESSIONS 里 J/K 滚动右侧内容
 *   - SESSIONS 光标变化 → 重新加载 TREE + CONTENT；TREE 光标变化 → CONTENT 高亮并滚到对应消息
 *   - TREE：y 复制节点全文（走注入的 ActionSource），T 居中弹出 Label 输入框（类似 lazygit 的 commit 弹窗），回车保存 / Esc 取消 / 空值清除；
 *     z 折叠 / 展开光标所在的分支段（旁支默认折叠、活动分支展开，段内按 z 折叠所在段并跳到段头）；
 *     a 打开完整树对话框（顶部搜索框、中间完整树、底部提示；和小面板共用折叠状态）。小面板不做 d/t/u/l/a 过滤
 *   - 树对话框里的按键按 tree-dialog scope 解析（对话框自己的键 → tree 面板的键 → global）：j/k/gg/G 移动、y / T / Enter 和面板一样但作用于
 *     对话框光标、z 折叠、d/t/u/l/a 过滤（重新加载树，面板同步）、/ 聚焦顶部搜索框实时过滤（Esc 退出搜索框但关键字和结果保留、再按 / 接着改，
 *     Enter 在搜索框里没有含义；搜索期间折叠全部打开，删光关键字或关对话框后恢复）、列表上 q / Esc 关闭并让面板光标跳到对话框选中的行
 *     （藏在折叠段里就展开它）；? 在对话框里关掉，它的键都在底部一行
 *   - Enter：SESSIONS 里切到光标所在会话（/resume）；TREE 里以光标节点为叶子恢复（/tree restore）：先居中弹出
 *     Summarize branch? 三选菜单（No summary / Summarize / Summarize with custom prompt，自定义指令再弹一个输入框），
 *     光标就在活动叶子上或 pi 设置了 branchSummary.skipPrompt 时不问、直接进入；
 *     成功后关闭面板，失败原因留在 footer 里、面板不关；等待 pi 切换 / 写摘要期间面板隐藏且不响应按键
 *   - SESSIONS：d 删除（先弹 Yes / No 确认框，默认停在 No，y / n 直接选；当前打开的会话拒绝删除；删完重新拉列表、光标夹回范围内），
 *     r 重命名（居中输入框，预填当前名字，空值清除；改完重新拉列表、光标留在同一会话上），
 *     s 循环切换排序（recent → created → title → threaded，光标跟着同一会话走），i 会话信息弹窗（y 复制全部内容，Esc 关闭）
 *   - space 多选：d 在有选中时批量删除（跳过当前会话，失败的留在列表和选中里），选中多个时 r / o / y / e / S 拒绝；
 *     Esc 先清空选中再退出。@（global）打开 pi 的 changelog 弹窗（j/k 滚动，Esc / q / @ 关闭）
 */

import type { Theme } from "@earendil-works/pi-coding-agent";
import type { Component, Focusable } from "@earendil-works/pi-tui";
import { stripTerminalSequences } from "@earendil-works/pi-tui";
import { type Binding, compileKeymap, labelsFor, labelsForFocus, matchesKeyId, resolveKeys } from "../config/keys.ts";
import { DEFAULT_KEYMAP, FOCUS_ACTIONS, isDisabledIn, PANE_TITLES, TREE_DIALOG_FOOTER, TREE_DIALOG_HINT_TEXT } from "../config/keymap.ts";
import { LEFT_COLUMN_RATIO, PANE_IDS, SESSION_SORT_MODES, SPINNER_INTERVAL_MS, SUMMARIZING_STATUS, TREE_DIALOG_SCOPE } from "../constants.ts";
import { highlightTerms, matchesTokens, matchSessionRow, matchTreeRow, parseSearchQuery, searchTokens } from "../data/search.ts";
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
	DeleteMethod,
	EnterOutcome,
	ExportFormat,
	ExportTarget,
	ForkPoint,
	KeyHint,
	Keymap,
	ListScope,
	PaneId,
	PanelMode,
	PaneSearch,
	RestoreOptions,
	SearchView,
	SessionInfo,
	SessionRow,
	SessionSortMode,
	ShareResult,
	TreeFilter,
	TreeRow,
} from "../types.ts";
import { fit, sideBySide } from "./frame.ts";
import { type ContentLayout, layoutContent, maxScroll, renderContentPane } from "./panes/content-pane.ts";
import { renderSessionsPane } from "./panes/sessions-pane.ts";
import { renderTreePane } from "./panes/tree-pane.ts";
import { type OutlinePrefix, treeOutline } from "./tree-outline.ts";
import { ChangelogDialog } from "./widgets/changelog-dialog.ts";
import { COMPACT_DIALOG_HINTS, COMPACT_DIALOG_TITLE } from "./widgets/compact-dialog.ts";
import {
	CLONE_SESSION_TITLE,
	confirmDialogSpec,
	DELETE_SESSION_TITLE,
	FORK_SESSION_TITLE,
	IMPORT_SESSION_TITLE,
	OVERWRITE_FILE_TITLE,
	SHARE_SESSION_TITLE,
} from "./widgets/confirm-dialog.ts";
import { EXPORT_FORMAT_HINTS, EXPORT_FORMAT_TITLE, EXPORT_FORMATS, EXPORT_PATH_HINTS, EXPORT_PATH_TITLE } from "./widgets/export-dialog.ts";
import { renderFooter } from "./widgets/footer.ts";
import { FORK_DIALOG_HINTS, FORK_DIALOG_TITLE } from "./widgets/fork-dialog.ts";
import { compactKeys, helpLineCount, overlayHelp } from "./widgets/help-overlay.ts";
import { IMPORT_DIALOG_HINTS, IMPORT_DIALOG_SUBJECT, IMPORT_DIALOG_TITLE } from "./widgets/import-dialog.ts";
import { InputDialog } from "./widgets/input-dialog.ts";
import { LABEL_DIALOG_HINTS, LABEL_DIALOG_TITLE } from "./widgets/label-dialog.ts";
import { NEW_SESSION_DIALOG_HINTS, NEW_SESSION_DIALOG_TITLE } from "./widgets/new-session-dialog.ts";
import { RENAME_DIALOG_HINTS, RENAME_DIALOG_TITLE } from "./widgets/rename-dialog.ts";
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
import { SessionInfoDialog } from "./widgets/session-info-dialog.ts";
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
}

export function createInitialState(overrides: Partial<PanelState> = {}): PanelState {
	return {
		focus: "sessions",
		mode: "normal",
		cursor: { sessions: 0, tree: 0, content: 0 },
		contentHighlight: undefined,
		selectedSessionFiles: new Set(),
		search: {},
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
	/** `i` in SESSIONS: what /session shows; undefined when the file cannot be read. */
	loadSessionInfo?(sessionFile: string): Promise<SessionInfo | undefined>;
	/** `o` in SESSIONS: the user messages the fork selector lists (empty = nothing to fork). */
	loadForkPoints?(sessionFile: string): Promise<ForkPoint[]>;
	/** `@`: pi's changelog as markdown (what /changelog shows). */
	loadChangelog?(): Promise<string>;
}

/**
 * Side effects injected by the entry point (they wrap src/actions/*).
 * 面板本身不做 I/O：复制、打标签、恢复会话、删除、改名都通过这里交给 actions 层。
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
	/** d in SESSIONS (after confirmation): remove the file; resolves to how it was removed. */
	deleteSession?(sessionFile: string): Promise<DeleteMethod>;
	/** r in SESSIONS: set the display name ("" clears it). */
	renameSession?(sessionFile: string, name: string): Promise<void>;
	/** n in SESSIONS: start a fresh session, naming it when `name` is non-empty (/new). */
	newSession?(name: string): Promise<EnterOutcome>;
	/** o in SESSIONS (after picking a message and confirming): fork before that user message and open the fork (/fork). */
	forkSession?(sessionFile: string, entryId: string): Promise<EnterOutcome>;
	/** y in SESSIONS (after confirmation): clone the active branch to a new file (/clone). */
	cloneSession?(sessionFile: string): Promise<EnterOutcome>;
	/** c in SESSIONS: compact this conversation's active branch and open it (/compact). */
	compactSession?(sessionFile: string, customInstructions?: string): Promise<EnterOutcome>;
	/** Y in SESSIONS: copy the last assistant reply to the clipboard; `false` = no reply yet. */
	copyLastReply?(sessionFile: string): Promise<boolean>;
	/** y in the Session Info dialog: copy its text to the clipboard. */
	copyText?(text: string): Promise<void>;
	/** e in SESSIONS: where an export goes for what the user typed ("" = pi's default path); synchronous, no writing. */
	exportTarget?(sessionFile: string, format: ExportFormat, input: string): ExportTarget;
	/** e in SESSIONS (once the path is picked, and confirmed when it exists): write the export, resolving to its path (/export). */
	exportSession?(sessionFile: string, format: ExportFormat, outputPath: string): Promise<string>;
	/** I in SESSIONS (after confirmation): copy a session JSONL into the session folder and switch to it (/import). */
	importSession?(input: string): Promise<EnterOutcome>;
	/** S in SESSIONS (after confirmation): upload as a secret GitHub gist (/share). */
	shareSession?(sessionFile: string): Promise<ShareResult>;
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
	 * stays on the first row); `d` refuses to delete it, like pi's /resume.
	 */
	currentSessionFile?: string;
}

/** Max time between keys of a multi-key sequence such as "gg". */
const PENDING_TIMEOUT_MS = 1000;

/** Delay before (re)loading the session under the cursor while the user is still moving. */
const SESSION_LOAD_DEBOUNCE_MS = 40;

/** pi's wording when `d` lands on the session it currently has open. */
const CURRENT_SESSION_DELETE_STATUS = "Cannot delete the currently active session";

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
	/** `@`: pi's changelog in a big scrollable box. */
	private readonly changelogDialog: ChangelogDialog;
	/** Cached changelog markdown so a second `@` opens instantly (only the first render is slow). */
	private changelogMd: string | undefined;
	/** Ticker that rotates the changelog loading spinner while the markdown is fetched / rendered. */
	private changelogSpinner: ReturnType<typeof setInterval> | undefined;
	/**
	 * Fold state from before the dialog's search started: a search shows every
	 * match, so folds are cleared meanwhile and restored when the query is gone.
	 */
	private foldedBeforeSearch: Set<string> | undefined;
	/** Node being labelled while `mode === "label"`. */
	private labelTarget: { file: string; entryId: string } | undefined;
	/** Node being restored to while `mode === "restore"`. */
	private restoreTarget: RestoreTarget | undefined;
	/** Session being renamed while `mode === "rename"`. */
	private renameTarget: SessionRow | undefined;
	/** Session the delete confirmation is about while `mode === "confirm"`. */
	private deleteTarget: SessionRow | undefined;
	/** Sessions the batch delete confirmation is about (d with a multi-selection). */
	private batchDeleteTargets: SessionRow[] | undefined;
	/** Session being forked while `mode === "fork"`: its file, title-bar subject and the user messages to pick from. */
	private forkTarget: { file: string; subject: string; points: ForkPoint[] } | undefined;
	/** Session the clone confirmation is about while `mode === "clone"`. */
	private cloneTarget: SessionRow | undefined;
	/** Session being compacted while `mode === "compact"`. */
	private compactTarget: SessionRow | undefined;
	/** Session being exported while `mode === "export"`: its file, title-bar subject, and the format once picked. */
	private exportJob: { file: string; subject: string; format?: ExportFormat } | undefined;
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
	/** Matching body lines of the content pane, per layout and query (the layout changes with the width, so the matches follow it). */
	private contentSearchCache: { layout: ContentLayout; query: string; matches: number[] } | undefined;
	/** Set while the search bar is open (`mode === "search"`). */
	private searchOrigin: SearchOrigin | undefined;

	constructor(private readonly o: LazyPanelOptions) {
		this.state = createInitialState(o.initialState);
		this.keymap = o.keymap ?? DEFAULT_KEYMAP;
		this.bindings = compileKeymap(this.keymap);
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
		this.changelogDialog = new ChangelogDialog({ theme: o.theme, onClose: () => this.closeChangelog() });
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
		// 首次加载：光标落到 pi 当前打开的会话上（新会话还没列出来时就留在第一行）。
		// 之后 C / A 切范围重新加载时不再定位，光标照旧回到顶部。
		const keep = this.locateSessionFile;
		this.locateSessionFile = undefined;
		if (await this.listSessions(keep)) this.setStatus(undefined);
		await this.loadSelectedSession();
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
	private async listSessions(keepFile: string | undefined): Promise<boolean> {
		try {
			const rows = await this.o.data.listSessions(this.state.scope, this.state.sort);
			if (this.disposed) return false;
			this.sessions = rows;
		} catch (err) {
			this.setStatus(`failed to list sessions: ${(err as Error).message}`);
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
		// 树换了（换会话、打标签、换过滤）：TREE 的搜索结果按新树重算。
		this.refreshSearch("tree");
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

		// 居中选择菜单打开时（Summarize branch?、删除确认）：j/k/Enter/Esc/y/n 都由菜单处理。
		if (this.selectDialog.isOpen) {
			this.selectDialog.handleInput(data);
			return;
		}

		// 会话信息弹窗打开时只响应 y 复制 / Esc 关闭。
		if (this.infoDialog.isOpen) {
			this.infoDialog.handleInput(data);
			return;
		}

		// changelog 弹窗：滚动 / 关闭由弹窗处理，再按一次 @（用户绑定给 changelog 的键）也关闭。
		if (this.changelogDialog.isOpen) {
			if (this.isAction(data, "global", "changelog")) this.closeChangelog();
			else this.changelogDialog.handleInput(data);
			this.o.requestRender();
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

		// Esc 优先：清掉半截序列或当前面板的搜索结果。
		if (matchesKeyId(data, "escape")) {
			if (this.pending.length) {
				this.clearPending();
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
			this.close();
			return;
		}

		// 搜索生效期间 n / N（global 的 search-next / search-prev）优先于面板自己的同键绑定
		// （SESSIONS 里 n 本来是 new session），和 lazygit 搜索模式里的 n / N 一致。
		if (this.pending.length === 0 && this.state.search[this.state.focus]) {
			const g = resolveKeys(this.bindings, "global", [data]);
			if (g.kind === "action" && (g.action === "search-next" || g.action === "search-prev")) {
				this.dispatch(g.action);
				return;
			}
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
			case "session-delete":
				this.confirmDeleteSession();
				return;
			case "session-rename":
				this.openRenameInput();
				return;
			case "session-sort":
				void this.cycleSort();
				return;
			case "session-info":
				void this.openSessionInfo();
				return;
			case "session-new":
				this.openNewSessionInput();
				return;
			case "session-fork":
				void this.startFork();
				return;
			case "session-clone":
				this.confirmCloneSession();
				return;
			case "session-compact":
				this.openCompactInput();
				return;
			case "session-copy-last-reply":
				void this.copyLastReply();
				return;
			case "session-export":
				this.startExport();
				return;
			case "session-import":
				this.openImportInput("");
				return;
			case "session-share":
				this.confirmShareSession();
				return;
			case "session-toggle-select":
				this.toggleSelect();
				return;
			case "changelog":
				void this.openChangelog();
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
		if (pane === "content") this.setContentScroll(index);
		else if (pane === "sessions") this.setSessionsCursor(index);
		else this.setTreeCursor(index);
	}

	/** Move the sessions cursor (clamped) and reload TREE + CONTENT for the session it lands on. */
	private setSessionsCursor(index: number): void {
		const next = clamp(index, 0, Math.max(0, this.sessions.length - 1));
		if (next === this.state.cursor.sessions) return;
		this.state.cursor.sessions = next;
		this.o.requestRender();
		void this.scheduleSessionLoad();
	}

	/** Move the tree cursor (clamped, an index into the visible rows) and make the content pane follow. */
	private setTreeCursor(index: number): void {
		const next = clamp(index, 0, Math.max(0, this.visibleTree.length - 1));
		if (next === this.state.cursor.tree) return;
		this.state.cursor.tree = next;
		this.o.requestRender();
		void this.syncContentToTree();
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
			const row = this.visibleTree[this.state.cursor.tree];
			// 树的匹配记的是整棵树的行号，所以原位置也换算成整棵树的行号；折叠状态一并记下。
			const index = row ? this.tree.findIndex((r) => r.entryId === row.entryId) : 0;
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
		const from = matches.findIndex((m) => m >= origin.index);
		const first = from >= 0 ? from : matches.length ? 0 : -1;
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
				this.refreshTreeView();
				const idx = origin.entryId ? this.visibleTree.findIndex((r) => r.entryId === origin.entryId) : -1;
				this.placeTreeCursor(idx >= 0 ? idx : this.state.cursor.tree);
				return;
			}
			case "content":
				this.setContentScroll(origin.index);
				return;
		}
	}

	/** Put the tree cursor on visible row `index` and sync the content pane even if the index did not change (the rows under it may have). */
	private placeTreeCursor(index: number): void {
		this.state.cursor.tree = clamp(index, 0, Math.max(0, this.visibleTree.length - 1));
		this.o.requestRender();
		void this.syncContentToTree();
	}

	/** Matches of `query` in `pane`: row indices of the sessions list / the whole tree, or body lines of the content layout. */
	private findMatches(pane: PaneId, query: string): number[] {
		if (pane === "content") return this.contentMatches(query);
		const parsed = parseSearchQuery(query);
		if (pane === "sessions") return indicesWhere(this.sessions, (r) => matchSessionRow(r, parsed));
		return indicesWhere(this.tree, (r) => matchTreeRow(r, parsed));
	}

	/**
	 * Body lines of the current content layout matching `query` (free text only:
	 * every token on the line, qualifiers mean nothing here). Cached per layout,
	 * so a resize (which re-wraps the lines) recomputes them.
	 */
	private contentMatches(query: string): number[] {
		const layout = this.contentLayout();
		const c = this.contentSearchCache;
		if (c && c.layout === layout && c.query === query) return c.matches;
		const tokens = searchTokens(parseSearchQuery(query));
		const matches = tokens.length
			? indicesWhere(layout.lines, (line, i) => layout.searchable[i] === true && matchesTokens(stripTerminalSequences(line), tokens))
			: [];
		this.contentSearchCache = { layout, query, matches };
		return matches;
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
			search.matches = this.contentMatches(search.query);
			search.current = search.matches.length ? clamp(search.current, 0, search.matches.length - 1) : -1;
		}
		return search.matches;
	}

	/** Row index in the whole tree of the pane's cursor row, -1 with no rows. */
	private treeCursorIndex(): number {
		const row = this.visibleTree[this.state.cursor.tree];
		return row ? this.tree.findIndex((r) => r.entryId === row.entryId) : -1;
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
			this.setStatus("no active search — press / first");
			return;
		}
		const matches = this.matchesOf(pane, search);
		if (matches.length === 0) {
			this.setStatus("no matches");
			return;
		}
		let next: number;
		if (pane === "content") {
			next = search.current < 0 ? (delta > 0 ? 0 : matches.length - 1) : (search.current + delta + matches.length) % matches.length;
		} else {
			const pos = pane === "sessions" ? this.state.cursor.sessions : this.treeCursorIndex();
			const i = delta > 0 ? matches.findIndex((m) => m > pos) : findLastIndex(matches, (m) => m < pos);
			next = i >= 0 ? i : delta > 0 ? 0 : matches.length - 1;
		}
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
				const row = this.tree[index];
				if (!row) return;
				// 目标藏在折叠段里：展开它的祖先，右侧内容跟着高亮。
				for (const id of foldedAncestors(this.tree, row.entryId, this.state.treeFolded)) this.state.treeFolded.delete(id);
				this.refreshTreeView();
				this.placeTreeCursor(this.visibleTree.findIndex((r) => r.entryId === row.entryId));
				return;
			}
			case "content":
				this.setContentScroll(index);
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
			const matched = new Set(matches.map((i) => this.tree[i]?.entryId));
			const visible = new Set<number>();
			this.visibleTree.forEach((r, i) => {
				if (matched.has(r.entryId)) visible.add(i);
			});
			const pos = matches.indexOf(this.treeCursorIndex());
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
	// Session actions: delete (d) / rename (r) / sort (s) / info (i)
	// -----------------------------------------------------------------------

	/** Session row under the cursor, or undefined with a footer hint. */
	private currentSessionRow(): SessionRow | undefined {
		const row = this.sessions[this.state.cursor.sessions];
		if (!row) this.setStatus("no session selected");
		return row;
	}

	/** Title of a session as the pane shows it: its name, else the first-message preview. */
	private sessionTitle(row: SessionRow): string {
		return row.name ?? row.preview ?? "(empty session)";
	}

	/**
	 * d: ask before deleting the session under the cursor. The session pi has
	 * open is refused up front, like pi's /resume (no dialog, just the message).
	 */
	private confirmDeleteSession(): void {
		if (this.state.selectedSessionFiles.size > 0) {
			this.confirmDeleteSelected();
			return;
		}
		const row = this.currentSessionRow();
		if (!row) return;
		if (!this.o.actions?.deleteSession) {
			this.setStatus("delete: actions unavailable");
			return;
		}
		// 和 pi 内置 /resume 一样：当前打开的会话直接拒绝，不弹确认框。
		if (findSessionIndex([row], this.currentSessionFile) === 0) {
			this.setStatus(CURRENT_SESSION_DELETE_STATUS);
			return;
		}
		this.deleteTarget = row;
		this.state.mode = "confirm";
		this.selectDialog.open(
			confirmDialogSpec({
				title: DELETE_SESSION_TITLE,
				subject: this.sessionTitle(row),
				onConfirm: () => void this.deleteSession(),
				onCancel: () => this.closeConfirm(),
			}),
		);
		this.o.requestRender();
	}

	/**
	 * d with a multi-selection: one confirmation for all selected sessions. The
	 * session pi has open is left out (like a single d refuses it); when that
	 * leaves nothing the footer says so without asking.
	 *
	 * 批量删除：列表顺序排好，跳过 pi 当前打开的会话，确认框标题带数量。
	 */
	private confirmDeleteSelected(): void {
		if (!this.o.actions?.deleteSession) {
			this.setStatus("delete: actions unavailable");
			return;
		}
		const rows = this.sessions.filter((r) => this.state.selectedSessionFiles.has(r.file));
		const targets = rows.filter((r) => findSessionIndex([r], this.currentSessionFile) !== 0);
		if (targets.length === 0) {
			this.setStatus(CURRENT_SESSION_DELETE_STATUS);
			return;
		}
		const skipped = rows.length - targets.length;
		// 当前打开的会话被跳过：它不会被删，也不该继续留在选中里。
		for (const r of rows) if (!targets.includes(r)) this.state.selectedSessionFiles.delete(r.file);
		this.batchDeleteTargets = targets;
		this.state.mode = "confirm";
		this.selectDialog.open(
			confirmDialogSpec({
				title: `Delete ${targets.length} session${targets.length === 1 ? "" : "s"}?`,
				subject: skipped ? `current session skipped · ${targets.map((r) => this.sessionTitle(r)).join(", ")}` : targets.map((r) => this.sessionTitle(r)).join(", "),
				onConfirm: () => void this.deleteSelected(),
				onCancel: () => this.closeConfirm(),
			}),
		);
		this.o.requestRender();
	}

	/**
	 * Yes on the batch confirmation: delete one by one; the ones that fail stay
	 * listed and selected, the first error goes to the footer.
	 */
	private async deleteSelected(): Promise<void> {
		const targets = this.batchDeleteTargets ?? [];
		this.closeConfirm();
		const remove = this.o.actions?.deleteSession;
		if (!remove || targets.length === 0) return;
		this.setStatus(`deleting ${targets.length}…`);
		let deleted = 0;
		let firstError: string | undefined;
		for (const row of targets) {
			try {
				await remove(row.file);
				deleted++;
				this.state.selectedSessionFiles.delete(row.file);
			} catch (err) {
				firstError ??= `${this.sessionTitle(row)}: ${(err as Error).message}`;
			}
			if (this.disposed) return;
		}
		const failed = targets.length - deleted;
		const summary = failed ? `deleted ${deleted}, ${failed} failed — ${firstError}` : `${deleted} session${deleted === 1 ? "" : "s"} deleted`;
		if (await this.listSessions(undefined)) this.setStatus(summary);
		await this.followSessionsCursor();
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
		this.setStatus("selection cleared");
	}

	/**
	 * Actions that only make sense for one session (rename, fork, clone, export,
	 * share) refuse while several sessions are selected. Returns true when refused.
	 */
	private refuseMultiSelect(label: string): boolean {
		if (this.state.selectedSessionFiles.size <= 1) return false;
		this.setStatus(`${label}: cannot act on multiple sessions (Esc clears the selection)`);
		return true;
	}

	/** @: show pi's changelog. Rendering the whole file is slow, so the box opens with a loading spinner first. */
	private async openChangelog(): Promise<void> {
		const load = this.o.data.loadChangelog;
		if (!load) {
			this.setStatus("changelog: unavailable");
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
			this.setStatus(`changelog failed: ${(err as Error).message}`);
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

	private closeConfirm(): void {
		this.state.mode = this.baseMode();
		this.selectDialog.close();
		this.deleteTarget = undefined;
		this.batchDeleteTargets = undefined;
		this.o.requestRender();
	}

	/** Yes in the confirmation: remove the file, then re-list with the cursor clamped (TREE / CONTENT follow). */
	private async deleteSession(): Promise<void> {
		const row = this.deleteTarget;
		this.closeConfirm();
		const remove = this.o.actions?.deleteSession;
		if (!row || !remove) return;
		this.setStatus("deleting…");
		let method: DeleteMethod;
		try {
			method = await remove(row.file);
			if (this.disposed) return;
		} catch (err) {
			this.setStatus(`delete failed: ${(err as Error).message}`);
			return;
		}
		this.state.selectedSessionFiles.delete(row.file);
		// 删掉的行没了，光标夹回范围内；光标下换了会话就重新加载右边。
		if (await this.listSessions(undefined)) this.setStatus(method === "trash" ? "session moved to trash" : "session deleted");
		await this.followSessionsCursor();
	}

	/** r: open the Rename prompt pre-filled with the session's current name. */
	private openRenameInput(): void {
		if (this.refuseMultiSelect("rename")) return;
		const row = this.currentSessionRow();
		if (!row) return;
		if (!this.o.actions?.renameSession) {
			this.setStatus("rename: actions unavailable");
			return;
		}
		this.renameTarget = row;
		this.state.mode = "rename";
		// 弹窗标题右侧显示是给哪个会话改名（首条消息预览，名字本身在输入框里）。
		this.inputDialog.open({
			title: RENAME_DIALOG_TITLE,
			value: row.name ?? "",
			subject: row.preview || row.id,
			hints: RENAME_DIALOG_HINTS,
			onSubmit: (v) => void this.submitRename(v),
			onCancel: () => this.closeRenameInput(),
		});
		this.inputDialog.focused = this._focused;
		this.o.requestRender();
	}

	/** Enter in the Rename prompt: persist, then re-list so the row shows the new name (cursor stays on it). */
	private async submitRename(value: string): Promise<void> {
		const row = this.renameTarget;
		this.closeRenameInput();
		const rename = this.o.actions?.renameSession;
		if (!row || !rename) return;
		const name = value.trim();
		try {
			await rename(row.file, name);
			if (this.disposed) return;
		} catch (err) {
			this.setStatus(`rename failed: ${(err as Error).message}`);
			return;
		}
		if (await this.listSessions(row.file)) this.setStatus(name ? `renamed: ${name}` : "name removed");
		// 改名会在会话文件里追加一条 session_info：TREE 在 all 过滤下要能看到它，光标留在原节点。
		if (row.file === this.loadedSessionFile) {
			const entryId = this.visibleTree[this.state.cursor.tree]?.entryId;
			if (entryId) await this.reloadTree(row.file, entryId);
		} else {
			await this.followSessionsCursor();
		}
	}

	private closeRenameInput(): void {
		this.state.mode = this.baseMode();
		this.inputDialog.close();
		this.inputDialog.focused = false;
		this.renameTarget = undefined;
		this.o.requestRender();
	}

	/** n: prompt for an optional name, then start a fresh session (/new) and close the panel. */
	private openNewSessionInput(): void {
		if (!this.o.actions?.newSession) {
			this.setStatus("new: actions unavailable");
			return;
		}
		this.state.mode = "new";
		this.inputDialog.open({
			title: NEW_SESSION_DIALOG_TITLE,
			value: "",
			hints: NEW_SESSION_DIALOG_HINTS,
			onSubmit: (v) => void this.submitNewSession(v),
			onCancel: () => this.closeNewSessionInput(),
		});
		this.inputDialog.focused = this._focused;
		this.o.requestRender();
	}

	/** Enter in the New session prompt: create it (naming it when non-empty), then close via `enter()`. */
	private async submitNewSession(value: string): Promise<void> {
		const create = this.o.actions?.newSession;
		this.closeNewSessionInput();
		if (!create) return;
		const name = value.trim();
		await this.enter("new", () => create(name));
	}

	private closeNewSessionInput(): void {
		this.state.mode = this.baseMode();
		this.inputDialog.close();
		this.inputDialog.focused = false;
		this.o.requestRender();
	}

	/** c: prompt for optional focus instructions, then compact the cursor session (/compact) and open it. */
	private openCompactInput(): void {
		if (this.refuseMultiSelect("compact")) return;
		const row = this.currentSessionRow();
		if (!row) return;
		if (!this.o.actions?.compactSession) {
			this.setStatus("compact: actions unavailable");
			return;
		}
		this.compactTarget = row;
		this.state.mode = "compact";
		// 标题右侧显示压缩的是哪个会话（首条消息预览）；输入框留空 = 用 pi 的默认压缩指令。
		this.inputDialog.open({
			title: COMPACT_DIALOG_TITLE,
			value: "",
			subject: row.preview || row.id,
			hints: COMPACT_DIALOG_HINTS,
			onSubmit: (v) => void this.submitCompact(v),
			onCancel: () => this.closeCompactInput(),
		});
		this.inputDialog.focused = this._focused;
		this.o.requestRender();
	}

	/** Enter in the Compact prompt: compact the session (blank = pi's default instructions), then close via `enter()`. */
	private async submitCompact(value: string): Promise<void> {
		const row = this.compactTarget;
		const compact = this.o.actions?.compactSession;
		this.closeCompactInput();
		if (!row || !compact) return;
		const instructions = value.trim();
		await this.enter("compact", () => compact(row.file, instructions || undefined));
	}

	private closeCompactInput(): void {
		this.state.mode = this.baseMode();
		this.inputDialog.close();
		this.inputDialog.focused = false;
		this.compactTarget = undefined;
		this.o.requestRender();
	}

	/** o: pick the user message to fork before (pi's /fork selector), then confirm and fork. */
	private async startFork(): Promise<void> {
		if (this.refuseMultiSelect("fork")) return;
		const row = this.currentSessionRow();
		if (!row) return;
		if (!this.o.actions?.forkSession || !this.o.data.loadForkPoints) {
			this.setStatus("fork: actions unavailable");
			return;
		}
		let points: ForkPoint[];
		try {
			points = await this.o.data.loadForkPoints(row.file);
			if (this.disposed) return;
		} catch (err) {
			this.setStatus(`fork failed: ${(err as Error).message}`);
			return;
		}
		if (points.length === 0) {
			this.setStatus("No messages to fork from");
			return;
		}
		this.forkTarget = { file: row.file, subject: this.sessionTitle(row), points };
		// 默认停在最后一条 user 消息（和 pi 内置 /fork 一致）。
		this.openForkSelector(points.length - 1);
	}

	/** The fork selector with the cursor on `index` (Esc / No on the confirmation comes back onto that message). */
	private openForkSelector(index: number): void {
		const target = this.forkTarget;
		if (!target) return;
		this.state.mode = "fork";
		this.selectDialog.open({
			title: FORK_DIALOG_TITLE,
			items: target.points.map((p) => p.text),
			initialIndex: index,
			subject: target.subject,
			hints: FORK_DIALOG_HINTS,
			// 消息多了按窗口滚动，不撑破终端。
			maxRows: this.dialogMaxRows(),
			onSelect: (i) => this.confirmFork(i),
			onCancel: () => this.closeForkDialogs(),
		});
		this.o.requestRender();
	}

	/** A picked message → the Yes / No confirmation (CLAUDE.md rule 7) before the fork happens. */
	private confirmFork(index: number): void {
		const target = this.forkTarget;
		const point = target?.points[index];
		if (!target || !point) {
			this.closeForkDialogs();
			return;
		}
		this.state.mode = "fork";
		this.selectDialog.open(
			confirmDialogSpec({
				title: FORK_SESSION_TITLE,
				subject: point.text,
				onConfirm: () => void this.runFork(target.file, point.entryId),
				// Esc / No：退回选择器，光标停在刚选中的那条消息上。
				onCancel: () => this.openForkSelector(index),
			}),
		);
		this.o.requestRender();
	}

	/** Confirmed: fork before the picked message (pi puts its text back into the fork's editor), then close. */
	private async runFork(file: string, entryId: string): Promise<void> {
		const fork = this.o.actions?.forkSession;
		this.closeForkDialogs();
		if (!fork) return;
		await this.enter("fork", () => fork(file, entryId));
	}

	private closeForkDialogs(): void {
		this.state.mode = this.baseMode();
		this.selectDialog.close();
		this.forkTarget = undefined;
		this.o.requestRender();
	}

	/** y: confirm, then clone the active branch of the session under the cursor to a new file (/clone). */
	private confirmCloneSession(): void {
		if (this.refuseMultiSelect("clone")) return;
		const row = this.currentSessionRow();
		if (!row) return;
		if (!this.o.actions?.cloneSession) {
			this.setStatus("clone: actions unavailable");
			return;
		}
		this.cloneTarget = row;
		this.state.mode = "clone";
		this.selectDialog.open(
			confirmDialogSpec({
				title: CLONE_SESSION_TITLE,
				subject: this.sessionTitle(row),
				onConfirm: () => void this.runClone(),
				onCancel: () => this.closeCloneConfirm(),
			}),
		);
		this.o.requestRender();
	}

	private async runClone(): Promise<void> {
		const row = this.cloneTarget;
		const clone = this.o.actions?.cloneSession;
		this.closeCloneConfirm();
		if (!row || !clone) return;
		await this.enter("clone", () => clone(row.file));
	}

	private closeCloneConfirm(): void {
		this.state.mode = this.baseMode();
		this.selectDialog.close();
		this.cloneTarget = undefined;
		this.o.requestRender();
	}

	/** Y: copy the last assistant reply of the session under the cursor to the clipboard (/copy). */
	private async copyLastReply(): Promise<void> {
		const row = this.currentSessionRow();
		if (!row) return;
		const copy = this.o.actions?.copyLastReply;
		if (!copy) {
			this.setStatus("copy: actions unavailable");
			return;
		}
		try {
			const copied = await copy(row.file);
			if (this.disposed) return;
			this.setStatus(copied ? "copied last reply" : "no assistant reply to copy");
		} catch (err) {
			this.setStatus(`copy failed: ${(err as Error).message}`);
		}
	}

	/** e: pick HTML / JSONL, then the output path, for the session under the cursor (/export). */
	private startExport(): void {
		if (this.refuseMultiSelect("export")) return;
		const row = this.currentSessionRow();
		if (!row) return;
		if (!this.o.actions?.exportSession || !this.o.actions.exportTarget) {
			this.setStatus("export: actions unavailable");
			return;
		}
		this.exportJob = { file: row.file, subject: this.sessionTitle(row) };
		this.openExportMenu(0);
	}

	/** The format menu with the cursor on `index` (Esc from the path prompt comes back onto the chosen format). */
	private openExportMenu(index: number): void {
		const job = this.exportJob;
		if (!job) return;
		this.state.mode = "export";
		this.selectDialog.open({
			title: EXPORT_FORMAT_TITLE,
			items: EXPORT_FORMATS.map((f) => f.label),
			initialIndex: index,
			subject: job.subject,
			hints: EXPORT_FORMAT_HINTS,
			onSelect: (i) => {
				const format = EXPORT_FORMATS[i]?.format;
				if (format) this.openExportPath(format);
			},
			onCancel: () => this.closeExportDialogs(),
		});
		this.o.requestRender();
	}

	/**
	 * The output-path prompt, pre-filled with pi's default (or `value`, what the
	 * user typed before backing out of the overwrite confirmation).
	 */
	private openExportPath(format: ExportFormat, value?: string): void {
		const job = this.exportJob;
		const resolveTarget = this.o.actions?.exportTarget;
		if (!job || !resolveTarget) return;
		job.format = format;
		this.selectDialog.close();
		this.state.mode = "export";
		this.inputDialog.open({
			title: EXPORT_PATH_TITLE,
			// 预填 pi 的默认路径（绝对路径），用户一眼能看到会写到哪里；改成目录就在里面用默认文件名。
			value: value ?? resolveTarget(job.file, format, "").path,
			subject: job.subject,
			hints: EXPORT_PATH_HINTS,
			onSubmit: (v) => this.submitExportPath(v),
			// Esc：退回格式菜单，光标停在刚选的格式上。
			onCancel: () => {
				this.inputDialog.close();
				this.inputDialog.focused = false;
				this.openExportMenu(EXPORT_FORMATS.findIndex((f) => f.format === format));
			},
		});
		this.inputDialog.focused = this._focused;
		this.o.requestRender();
	}

	/** Enter in the path prompt: export right away, or ask first when a file is already there. */
	private submitExportPath(value: string): void {
		const job = this.exportJob;
		const format = job?.format;
		const resolveTarget = this.o.actions?.exportTarget;
		this.inputDialog.close();
		this.inputDialog.focused = false;
		if (!job || !format || !resolveTarget) {
			this.closeExportDialogs();
			return;
		}
		const target = resolveTarget(job.file, format, value);
		if (!target.exists) {
			void this.runExport(job.file, format, target.path);
			return;
		}
		// 覆盖已有文件是破坏性操作，先确认（CLAUDE.md 第 7 条）；No / Esc 退回路径输入框，保留刚才输入的内容。
		this.state.mode = "export";
		this.selectDialog.open(
			confirmDialogSpec({
				title: OVERWRITE_FILE_TITLE,
				subject: target.path,
				onConfirm: () => void this.runExport(job.file, format, target.path),
				onCancel: () => this.openExportPath(format, value),
			}),
		);
		this.o.requestRender();
	}

	/** Write the export; the panel stays open and the footer says where the file went. */
	private async runExport(file: string, format: ExportFormat, path: string): Promise<void> {
		const write = this.o.actions?.exportSession;
		this.closeExportDialogs();
		if (!write) return;
		this.setStatus("exporting…");
		try {
			const written = await write(file, format, path);
			if (this.disposed) return;
			this.setStatus(`exported to ${written}`);
		} catch (err) {
			if (this.disposed) return;
			this.setStatus(`export failed: ${(err as Error).message}`);
		}
	}

	private closeExportDialogs(): void {
		this.state.mode = this.baseMode();
		this.selectDialog.close();
		this.inputDialog.close();
		this.inputDialog.focused = false;
		this.exportJob = undefined;
		this.o.requestRender();
	}

	/** I: ask for the JSONL to import (`value` = what was typed before backing out of the confirmation). */
	private openImportInput(value: string): void {
		if (!this.o.actions?.importSession) {
			this.setStatus("import: actions unavailable");
			return;
		}
		this.selectDialog.close();
		this.state.mode = "import";
		this.inputDialog.open({
			title: IMPORT_DIALOG_TITLE,
			value,
			subject: IMPORT_DIALOG_SUBJECT,
			hints: IMPORT_DIALOG_HINTS,
			onSubmit: (v) => this.confirmImport(v),
			onCancel: () => this.closeImportDialogs(),
		});
		this.inputDialog.focused = this._focused;
		this.o.requestRender();
	}

	/** Enter in the import prompt: confirm like pi's /import ("Replace current session with …?"). */
	private confirmImport(value: string): void {
		this.inputDialog.close();
		this.inputDialog.focused = false;
		const path = value.trim();
		if (!path) {
			this.closeImportDialogs();
			this.setStatus("import: no file given");
			return;
		}
		this.state.mode = "import";
		this.selectDialog.open(
			confirmDialogSpec({
				title: IMPORT_SESSION_TITLE,
				subject: path,
				onConfirm: () => void this.runImport(path),
				// Esc / No：退回输入框，保留刚才输入的路径。
				onCancel: () => this.openImportInput(value),
			}),
		);
		this.o.requestRender();
	}

	/** Confirmed: copy the file into the session folder and switch to it, closing the panel via `enter()`. */
	private async runImport(input: string): Promise<void> {
		const load = this.o.actions?.importSession;
		this.closeImportDialogs();
		if (!load) return;
		await this.enter("import", () => load(input));
	}

	private closeImportDialogs(): void {
		this.state.mode = this.baseMode();
		this.selectDialog.close();
		this.inputDialog.close();
		this.inputDialog.focused = false;
		this.o.requestRender();
	}

	/** S: confirm (the session leaves the machine), then upload it as a secret gist (/share). */
	private confirmShareSession(): void {
		if (this.refuseMultiSelect("share")) return;
		const row = this.currentSessionRow();
		if (!row) return;
		if (!this.o.actions?.shareSession) {
			this.setStatus("share: actions unavailable");
			return;
		}
		this.state.mode = "share";
		this.selectDialog.open(
			confirmDialogSpec({
				title: SHARE_SESSION_TITLE,
				subject: this.sessionTitle(row),
				onConfirm: () => void this.runShare(row.file),
				onCancel: () => this.closeShareConfirm(),
			}),
		);
		this.o.requestRender();
	}

	/** Upload, then put the viewer link on the clipboard (a long link may not fit the footer) and show it. */
	private async runShare(file: string): Promise<void> {
		const share = this.o.actions?.shareSession;
		this.closeShareConfirm();
		if (!share) return;
		this.setStatus("sharing…");
		let result: ShareResult;
		try {
			result = await share(file);
			if (this.disposed) return;
		} catch (err) {
			if (this.disposed) return;
			this.setStatus(`share failed: ${(err as Error).message}`);
			return;
		}
		const copy = this.o.actions?.copyText;
		try {
			if (!copy) throw new Error("no clipboard");
			await copy(result.url);
			if (this.disposed) return;
			this.setStatus(`share URL copied: ${result.url}`);
		} catch {
			if (this.disposed) return;
			this.setStatus(`shared: ${result.url}`);
		}
	}

	private closeShareConfirm(): void {
		this.state.mode = this.baseMode();
		this.selectDialog.close();
		this.o.requestRender();
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
		if (await this.listSessions(keep)) this.setStatus(`sort: ${next}`);
		await this.followSessionsCursor();
	}

	/** i: load what /session shows for the session under the cursor and open the info box. */
	private async openSessionInfo(): Promise<void> {
		const row = this.currentSessionRow();
		if (!row) return;
		const load = this.o.data.loadSessionInfo;
		if (!load) {
			this.setStatus("session info: unavailable");
			return;
		}
		let info: SessionInfo | undefined;
		try {
			info = await load(row.file);
		} catch (err) {
			this.setStatus(`session info failed: ${(err as Error).message}`);
			return;
		}
		if (this.disposed) return;
		if (!info) {
			this.setStatus(`session info failed: cannot read ${row.file}`);
			return;
		}
		this.state.mode = "info";
		this.infoDialog.open({
			info,
			onCopy: (text) => void this.copySessionInfo(text),
			onClose: () => this.closeSessionInfo(),
		});
		this.o.requestRender();
	}

	/** y in the info box: the whole text goes to the clipboard, the box stays open. */
	private async copySessionInfo(text: string): Promise<void> {
		const copy = this.o.actions?.copyText;
		if (!copy) {
			this.setStatus("copy: actions unavailable");
			return;
		}
		try {
			await copy(text);
			if (this.disposed) return;
			this.setStatus("copied session info to clipboard");
		} catch (err) {
			this.setStatus(`copy failed: ${(err as Error).message}`);
		}
	}

	private closeSessionInfo(): void {
		this.state.mode = this.baseMode();
		this.infoDialog.close();
		this.o.requestRender();
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
		this.stopChangelogSpinner();
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
		const sessionsSearch = this.searchView("sessions");
		const treeSearch = this.searchView("tree");

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
					...(sessionsSearch ? { search: sessionsSearch } : {}),
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
					...(treeSearch ? { search: treeSearch } : {}),
				},
				leftW,
				treeH,
			),
		];

		// 先排版（缓存按宽度失效），CONTENT 的搜索结果跟着这份排版算。
		const layout = this.contentLayoutFor(rightW - 2, bodyH - 2);
		const contentSearch = this.searchView("content");
		const right = renderContentPane(
			{
				blocks: this.content,
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
		if (this.infoDialog.isOpen) {
			lines = this.infoDialog.overlay(lines, width);
		}
		if (this.changelogDialog.isOpen) {
			lines = this.changelogDialog.overlay(lines, width);
		}
		if (this.state.helpOpen) {
			lines = overlayHelp(lines, { keymap: this.keymap, focus: this.state.focus, scroll: this.state.helpScroll, theme }, width);
		}
		return [...lines, this.renderBottom(width)].map((l) => fit(l, width));
	}

	/** Footer row: search bar while typing, the open dialog's keys, the search status of the focused pane, otherwise hints. */
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
				: this.infoDialog.isOpen
					? this.infoDialog
					: this.changelogDialog.isOpen
						? this.changelogDialog
						: this.treeDialog.isOpen
							? this.treeDialog
							: undefined;
		if (dialog) {
			return renderFooter({ ...footer, hints: dialog.hints, ...(status ? { status } : {}) }, width)[0]!;
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

/** Indices of the elements `pred` accepts, ascending. */
function indicesWhere<T>(arr: T[], pred: (t: T, i: number) => boolean): number[] {
	const out: number[] = [];
	arr.forEach((t, i) => {
		if (pred(t, i)) out.push(i);
	});
	return out;
}

function clamp(n: number, min: number, max: number): number {
	return Math.max(min, Math.min(max, n));
}
