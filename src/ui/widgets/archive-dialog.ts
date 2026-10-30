/**
 * Archive dialog — the archived sessions of every directory in one big box,
 * opened with the global `X`. It is deliberately a management view, not a
 * second sessions pane: there is no content preview and no resume; Enter
 * restores a session (back into SESSIONS), R restores every visible one, and
 * d / D delete files permanently.
 *
 *   ┌─ ARCHIVE ───────────────── 2/5 · Updated · Current project (~…) ┐
 *   │ / to search                                                    │
 *   ├────────────────────────────────────────────────────────────────┤
 *   │ › Fix the router              ~/code/panel  10-22 14:03          │
 *   │   Notes from the trip         ~/notes       10-21 09:12          │
 *   └────────────────────────────────────────────────────────────────┘
 *    ARCHIVE │ / search  j/k move  Enter restore  R restore all  s sort …
 *
 * The rows come from the panel (all archived sessions, newest update first);
 * the dialog owns the live search, sorting, project filter, cursor and mouse.
 * It opens scoped to the current project (the directory pi was started in) so
 * another project's archives stay behind the `p` menu. `/` filters live,
 * `s` cycles updated / created / title, `p` asks the panel for its project
 * menu. The panel resolves the keys (global scope) and passes them in; this
 * widget only has the list's own d / D / R / s / p / q / Esc.
 *
 * 归档管理框：只列出已归档会话，不查看、不进入。搜索 / 排序 / 项目筛选 / 光标和画法在这里，
 * 恢复和删除的 I/O 由 app.ts 的流程完成（删除始终带确认，恢复不弹确认）。
 */

import { resolve } from "node:path";
import type { Theme } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { matchesKeyId } from "../../config/keys.ts";
import { matchSessionRow, parseSearchQuery } from "../../data/search.ts";
import { findSessionIndex, sessionTitle, sortSessions } from "../../data/sessions.ts";
import { t } from "../../i18n/index.ts";
import type { KeyHint, SessionRow, SessionSortMode } from "../../types.ts";
import { formatShortDate, shortenPath } from "../../utils/format.ts";
import { clamp } from "../../utils/indices.ts";
import { sessionFileKey } from "../../utils/session-file-key.ts";
import { cursorTone } from "../cursor-tone.ts";
import { boxCell, boxContains, centeredRect, fit, frame, FRAME_DIVIDER, overlayCentered, type BoxRect } from "../frame.ts";
import { scrollOffset } from "../panes/sessions-pane.ts";
import { PromptBar } from "./prompt-bar.ts";
import { searchLabel } from "./search-bar.ts";

/** The sort modes the archive box cycles through; "threaded" has no meaning here. */
type ArchiveSortMode = Extract<SessionSortMode, "recent" | "created" | "title">;

const ARCHIVE_SORT_MODES: readonly ArchiveSortMode[] = ["recent", "created", "title"];

/** Rows above the list (search + divider) plus the two borders; hints live in the footer. */
const CHROME_ROWS = 4;

/** What the dialog shows; passed to `open`. */
export interface ArchiveDialogSpec {
	/** Archived sessions from every directory (the dialog filters / sorts them itself). */
	rows: SessionRow[];
	/**
	 * Working directory of the pi session that opened the panel. The box opens
	 * with this as its project filter (undefined = all projects) so `p` is only
	 * needed to reach another project's archives.
	 */
	currentProject?: string;
	/** Label of the key that focuses the search row, for the idle row's `/ to search` hint. */
	searchKey?: string;
	/** Enter (one row) / R (every visible row): restore these rows (the panel keeps the dialog open). */
	onRestore: (rows: readonly SessionRow[]) => void;
	/** d / D: delete these rows (the panel confirms first). */
	onDelete: (rows: readonly SessionRow[]) => void;
	/** p: open the project menu (the panel owns it). */
	onProjectMenu: () => void;
	/** Esc / q: close the box. */
	onClose: () => void;
}

export interface ArchiveDialogOptions {
	theme: Theme;
	/** Called after every change so the panel can re-render. */
	onChange: () => void;
}

/** One project choice in the `p` menu (undefined = all projects). */
export interface ArchiveProjectChoice {
	label: string;
	value: string | undefined;
}

export class ArchiveDialog {
	private spec: ArchiveDialogSpec | undefined;
	private allRows: SessionRow[] = [];
	private visible: SessionRow[] = [];
	private index = 0;
	private query = "";
	private sort: ArchiveSortMode = "recent";
	private project: string | undefined;
	private currentProject: string | undefined;
	private _searchFocused = false;
	private _focused = false;
	/** 上一次绘制时对话框在屏幕上的位置（`overlay()` 里记）；鼠标命中只认这一份，没画过就点不到。 */
	private boxRect: BoxRect | undefined;
	/** The search field on the top row. */
	private readonly search: PromptBar;

	constructor(private readonly o: ArchiveDialogOptions) {
		this.search = new PromptBar({
			theme: o.theme,
			label: searchLabel(),
			hints: [],
			// Enter 在搜索框里只是"结束输入、留着筛选"；再按 / 可以接着改。
			onSubmit: () => this.leaveSearch(),
			onCancel: () => this.leaveSearch(),
			onChange: () => this.syncQuery(),
		});
	}

	/** True between `open` and `close`. */
	get isOpen(): boolean {
		return this.spec !== undefined;
	}

	/** Footer hints while the dialog is open. */
	get hints(): KeyHint[] {
		if (!this.spec) return [];
		if (this._searchFocused) return [["Esc", t("hint.backToList")]];
		const searchKey = this.spec.searchKey ?? "/";
		return [
			[searchKey, t("archive.search")],
			["j/k/↑↓", t("hint.move")],
			["Enter", t("archive.restore")],
			["R", t("archive.restoreAll")],
			["s", t("archive.sort")],
			["p", t("archive.project")],
			["d", t("archive.delete")],
			["D", t("archive.deleteAll")],
			["Esc/q", t("hint.close")],
		];
	}

	/** Rows currently listed after the search and project filters. */
	get rows(): readonly SessionRow[] {
		return this.visible;
	}

	/** The highlighted row, if any. */
	get selectedRow(): SessionRow | undefined {
		return this.visible[this.index];
	}

	/** Index of the highlighted row among the filtered rows. */
	get selectedIndex(): number {
		return this.index;
	}

	/** Current search text ("" = no search). */
	get searchQuery(): string {
		return this.query;
	}

	/** Whether keys go to the search row rather than the list. */
	get searchFocused(): boolean {
		return this._searchFocused;
	}

	/** Filtered project (undefined = all projects). */
	get projectFilter(): string | undefined {
		return this.project;
	}

	/** Focusable propagation (IME cursor): reaches the search field only while it has the keys. */
	get focused(): boolean {
		return this._focused;
	}
	set focused(v: boolean) {
		this._focused = v;
		this.search.focused = v && this._searchFocused;
	}

	/** Every project that owns an archived row, deduplicated and sorted for the `p` menu. */
	get projects(): string[] {
		const seen = new Set<string>();
		const out: string[] = [];
		for (const row of this.allRows) {
			if (!row.cwd) continue;
			const key = projectKey(row.cwd);
			if (seen.has(key)) continue;
			seen.add(key);
			out.push(row.cwd);
		}
		return out.sort((a, b) => shortenPath(a).localeCompare(shortenPath(b), undefined, { sensitivity: "base" }));
	}

	/** Items of the `p` menu: the current project first, then all projects, then every other archived project. */
	get projectChoices(): ArchiveProjectChoice[] {
		const choices: ArchiveProjectChoice[] = [];
		if (this.currentProject) {
			choices.push({ label: t("archive.currentProject", { path: shortenPath(this.currentProject) }), value: this.currentProject });
		}
		choices.push({ label: t("archive.allProjects"), value: undefined });
		for (const project of this.projects) {
			if (this.currentProject && projectKey(project) === projectKey(this.currentProject)) continue;
			choices.push({ label: shortenPath(project) || project, value: project });
		}
		return choices;
	}

	open(spec: ArchiveDialogSpec): void {
		this.spec = spec;
		this.allRows = spec.rows;
		this.currentProject = spec.currentProject;
		this.query = "";
		this.sort = "recent";
		// 默认只看当前项目；`p` 菜单里第一项是当前项目，第二项才是所有项目。
		this.project = spec.currentProject;
		this.index = 0;
		this._searchFocused = false;
		this.boxRect = undefined;
		this.search.reset("");
		this.search.focused = false;
		this.rebuild(undefined, 0);
	}

	/** Drop the dialog without firing a callback. */
	close(): void {
		this.spec = undefined;
		this.allRows = [];
		this.visible = [];
		this._searchFocused = false;
		this.boxRect = undefined;
		this.search.focused = false;
	}

	/**
	 * Drop rows the panel just restored / deleted without re-reading every
	 * directory: the operation already succeeded, so these rows cannot still be
	 * archived. Filters, sort and the cursor position stay.
	 */
	removeRows(files: readonly string[]): void {
		if (!this.spec || files.length === 0) return;
		const keep = this.selectedRow?.file;
		const removed = new Set(files.map(sessionFileKey));
		this.allRows = this.allRows.filter((row) => !removed.has(sessionFileKey(row.file)));
		this.rebuild(keep, this.index);
		this.o.onChange();
	}

	/** Apply a project choice from the `p` menu. */
	setProject(project: string | undefined): void {
		if (this.project === project) return;
		this.project = project;
		this.rebuild(this.selectedRow?.file, 0);
		this.o.onChange();
	}

	/** `/`: give the keys to the search row, cursor after the current query so typing extends it. */
	focusSearch(): void {
		if (!this.spec) return;
		this._searchFocused = true;
		this.search.reset(this.query, true);
		this.search.focused = this._focused;
		this.o.onChange();
	}

	/** A key while the search row has them (Enter / Esc come back through the prompt's callbacks). */
	handleSearchInput(data: string): void {
		this.search.handleInput(data);
	}

	/** Esc in the search row（以及点击列表 / 按 Enter）：交还按键，筛选结果留着。 */
	leaveSearch(): void {
		if (!this._searchFocused) return;
		this._searchFocused = false;
		this.search.focused = false;
		this.o.onChange();
	}

	/** Keys while the list has them. Global search / archive-open / close are handled by the panel first. */
	handleInput(data: string): void {
		const spec = this.spec;
		if (!spec) return;
		if (matchesKeyId(data, "escape") || matchesKeyId(data, "q")) {
			spec.onClose();
			return;
		}
		if (matchesKeyId(data, "return")) {
			const row = this.selectedRow;
			if (row) spec.onRestore([row]);
			return;
		}
		// R 恢复筛选后仍可见的全部行（`D` 的对称操作）。恢复不删数据，所以不弹确认，只在 footer 报数量。
		if (matchesKeyId(data, "shift+r")) {
			if (this.visible.length) spec.onRestore(this.visible);
			return;
		}
		// shift+d before d: shift+d is "delete every visible row", d is the cursor row.
		if (matchesKeyId(data, "shift+d")) {
			if (this.visible.length) spec.onDelete(this.visible);
			return;
		}
		if (matchesKeyId(data, "d")) {
			const row = this.selectedRow;
			if (row) spec.onDelete([row]);
			return;
		}
		if (matchesKeyId(data, "s")) {
			this.cycleSort();
			return;
		}
		if (matchesKeyId(data, "p")) {
			spec.onProjectMenu();
			return;
		}
		if (matchesKeyId(data, "/")) {
			this.focusSearch();
			return;
		}
		if (matchesKeyId(data, "j") || matchesKeyId(data, "down")) {
			this.move(1);
			return;
		}
		if (matchesKeyId(data, "k") || matchesKeyId(data, "up")) {
			this.move(-1);
			return;
		}
		if (matchesKeyId(data, "g")) {
			this.moveTo(0);
			return;
		}
		if (matchesKeyId(data, "shift+g")) {
			this.moveTo(Number.MAX_SAFE_INTEGER);
			return;
		}
		// 其他按键一律吞掉，不能漏到下面的面板去。
	}

	/** j / k: move the cursor by `delta` rows, clamped. */
	move(delta: number): void {
		this.moveTo(this.index + delta);
	}

	/** Put the cursor straight on `index` (clamped) — what gg / G and mouse clicks use. */
	moveTo(index: number): void {
		const next = clamp(index, 0, Math.max(0, this.visible.length - 1));
		if (next === this.index) return;
		this.index = next;
		this.o.onChange();
	}

	/** Wheel: move the cursor, but only while the pointer is over the dialog (like the panes). */
	wheel(x: number, y: number, delta: number): void {
		if (delta !== 0 && this.boxRect && boxContains(this.boxRect, x, y)) this.move(delta);
	}

	/**
	 * 屏幕上 (x, y) 命中的东西：列表行返回行号，搜索行返回 "search"，
	 * 分隔线 / 列表末尾之后的补白行 / 框外返回 undefined。鼠标单击选中、双击 Enter 都用它。
	 */
	indexAt(x: number, y: number): number | "search" | undefined {
		const rect = this.boxRect;
		const cell = rect ? boxCell(rect, x, y) : undefined;
		if (!rect || !cell) return undefined;
		if (cell.row === 0) return "search"; // 正文第 0 行是搜索框
		const line = cell.row - 2; // 第 1 行是分隔线，列表从第 2 行开始
		const visible = this.visibleRows(rect.height);
		if (line < 0 || line >= visible) return undefined;
		const index = scrollOffset(this.index, this.visible.length, visible) + line;
		return index < this.visible.length ? index : undefined;
	}

	/**
	 * Box size for a `termW` × `termH` terminal: 3 columns / 2 rows of breathing
	 * room on every side, capped so it stays a dialog instead of a wall of rows
	 * (the list scrolls). Filling the body edge to edge made the top / bottom
	 * borders look clipped against the terminal.
	 */
	static size(termW: number, termH: number): { width: number; height: number } {
		return { width: Math.max(24, Math.min(termW - 6, 108)), height: Math.max(CHROME_ROWS + 1, Math.min(termH - 4, 32)) };
	}

	/** Render the box itself, every line exactly `width` columns and `height` lines tall. */
	render(width: number, height: number): string[] {
		const { theme } = this.o;
		const inner = width - 2;
		const visible = this.visibleRows(height);

		const body: string[] = [` ${this.renderSearchRow(inner - 1)}`, FRAME_DIVIDER];
		if (this.visible.length === 0) {
			// 只有整个归档都空时才是"暂无归档"；当前项目没行但别处有，仍算筛选无匹配。
			const message = this.allRows.length === 0 ? t("archive.empty") : t("archive.noMatches");
			body.push(theme.fg("muted", ` ${message}`));
		} else {
			const first = scrollOffset(this.index, this.visible.length, visible);
			for (let i = first; i < Math.min(this.visible.length, first + visible); i++) {
				body.push(this.renderRow(this.visible[i]!, inner, i === this.index, theme));
			}
		}
		while (body.length < visible + 2) body.push("");

		const position = this.visible.length ? `${this.index + 1}/${this.visible.length}` : "0/0";
		return frame(body, {
			width,
			height,
			title: t("archive.title"),
			meta: `${position} · ${this.sortLabel()} · ${this.projectLabel()}`,
			border: (s) => theme.fg("borderAccent", s),
			titleStyle: (s) => theme.bold(theme.fg("accent", s)),
			metaStyle: (s) => theme.fg("dim", s),
		});
	}

	/** Composite the box centered over the already-rendered panel `lines`. */
	overlay(lines: string[], termW: number): string[] {
		const { width, height } = ArchiveDialog.size(termW, lines.length);
		const box = this.render(width, height);
		// 记下这次画出来的位置：鼠标的点按（indexAt / wheel）只认它，画哪儿就点哪儿。
		this.boxRect = centeredRect(termW, lines.length, width, box.length);
		return overlayCentered(lines, box, width, termW, (s) => this.o.theme.fg("dim", s), this.boxRect.top);
	}

	/** After every keystroke in the search row: filter live, then re-render. */
	private syncQuery(): void {
		const query = this.search.getValue();
		if (query !== this.query) {
			this.query = query;
			this.rebuild(this.selectedRow?.file, 0);
		}
		this.o.onChange();
	}

	/** The next sort mode, keeping the cursor on the same row when it is still visible. */
	private cycleSort(): void {
		const i = ARCHIVE_SORT_MODES.indexOf(this.sort);
		this.sort = ARCHIVE_SORT_MODES[(i + 1) % ARCHIVE_SORT_MODES.length]!;
		this.rebuild(this.selectedRow?.file, this.index);
		this.o.onChange();
	}

	/** Apply the project + query filters and sort, then restore the cursor on `keep` (else `fallbackIndex`). */
	private rebuild(keepFile: string | undefined, fallbackIndex: number): void {
		let rows = this.allRows;
		if (this.project !== undefined) {
			rows = rows.filter((row) => projectKey(row.cwd) === projectKey(this.project!));
		}
		const query = this.query.trim();
		if (query) {
			const parsed = parseSearchQuery(query);
			rows = rows.filter((row) => matchSessionRow(row, parsed));
		}
		this.visible = sortSessions(rows, this.sort);
		const keep = findSessionIndex(this.visible, keepFile);
		this.index = keep >= 0 ? keep : clamp(fallbackIndex, 0, Math.max(0, this.visible.length - 1));
	}

	private visibleRows(height: number): number {
		return Math.max(1, height - CHROME_ROWS);
	}

	private sortLabel(): string {
		switch (this.sort) {
			case "created":
				return t("archive.sortCreated");
			case "title":
				return t("archive.sortTitle");
			default:
				return t("archive.sortRecent");
		}
	}

	private projectLabel(): string {
		if (!this.project) return t("archive.allProjects");
		if (this.currentProject && projectKey(this.project) === projectKey(this.currentProject)) {
			return t("archive.currentProject", { path: shortenPath(this.project) });
		}
		return shortenPath(this.project) || this.project;
	}

	/**
	 * Top row: the live input while it has the keys; otherwise the query as
	 * plain text (no block cursor) or a hint naming the search key.
	 */
	private renderSearchRow(width: number): string {
		if (this._searchFocused) return this.search.render(width)[0] ?? "";
		const { theme } = this.o;
		const label = theme.bold(theme.fg("accent", searchLabel()));
		const key = this.spec?.searchKey ?? "/";
		const rest = this.query ? theme.fg("text", this.query) : theme.fg("dim", t("archive.toSearch", { key }));
		return `${label}${rest}`;
	}

	private renderRow(row: SessionRow, inner: number, isCursor: boolean, theme: Theme): string {
		const date = formatShortDate(row.updatedAt);
		const dateW = visibleWidth(date);
		const projectBudget = Math.max(0, Math.min(24, inner - 2 - dateW - 12));
		const project = projectBudget > 0 ? truncateToWidth(shortenPath(row.cwd), projectBudget, "…", false) : "";
		const projectW = visibleWidth(project);
		const rightW = projectW + (projectW ? 2 : 0) + dateW;
		const titleW = Math.max(1, inner - 2 - (rightW ? rightW + 1 : 0));
		const title = truncateToWidth(sessionTitle(row) || t("pane.emptySession"), titleW, "…", false);
		const tonal = cursorTone("dim", isCursor);
		const marker = isCursor ? theme.fg("accent", "› ") : "  ";
		const styledTitle = isCursor ? theme.bold(title) : title;
		const left = ` ${marker}${styledTitle}`;
		const leftW = 1 + 2 + visibleWidth(title);
		const gap = Math.max(1, inner - leftW - rightW);
		const right = (project ? theme.fg(tonal, project) + "  " : "") + theme.fg(tonal, date);
		const line = fit(left + " ".repeat(gap) + right, inner);
		if (!isCursor) return line;
		// 光标行整行刷 selectedBg；按 SGR 重置切开再逐段上色，换行/重置都不会漏掉底色。
		return line.split("\x1b[0m").map((part) => theme.bg("selectedBg", part)).join("\x1b[0m");
	}
}

/** Compare working directories the same way session identity compares files. */
function projectKey(path: string): string {
	return path ? resolve(path) : "";
}
