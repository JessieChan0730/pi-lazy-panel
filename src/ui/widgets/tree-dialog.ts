/**
 * Tree dialog — the full conversation tree in a big centered box, opened with
 * `a` from the tree pane (the small pane only shows a slice). Layout follows
 * the `prefix + g` picker of herdr: search box on top, the tree in the middle.
 * Key hints live in the panel footer only (no repeated row inside the box).
 *
 *   ┌─ TREE ─────────────────────────────── 3/12 · default ─┐
 *   │ 搜索: hello▏                                           │
 *   ├────────────────────────────────────────────────────────┤
 *   │ ›    • 22:18 [system]                                  │
 *   │   ├⊟ 22:18 user: hi                                    │
 *   │   │     22:18 assistant: Hello!                        │
 *   │   └⊞ • 22:19 user: hi                                  │
 *   └────────────────────────────────────────────────────────┘
 *
 * The widget owns the search field, the cursor and the rendering; the rows it
 * lists (already filtered, searched and folded) come from the panel through
 * `open` / `setRows`, and the keys are resolved by the panel (app.ts) against
 * the `tree-dialog` key scope. Search is live: every keystroke reports the
 * query through `onQueryChange` and the panel answers with `setRows`. Esc in
 * the search row hands the keys back to the list and keeps the query (the rows
 * stay narrowed; `/` again edits it, deleting the text clears it), Enter does
 * nothing there; an idle search row shows the query, or a `/ to search` hint
 * when empty.
 *
 * 完整树对话框：搜索框 / 光标 / 画法在这里，行的过滤、搜索、折叠都由 app.ts 算好传进来，
 * 按键也由 app.ts 按 tree-dialog scope 解析后调用这里的方法。搜索框里 Esc 只是回到列表，
 * 关键字保留；Enter 在搜索框里没有含义。
 */

import type { Theme } from "@earendil-works/pi-coding-agent";
import { t } from "../../i18n/index.ts";
import type { KeyHint, TreeFilter, TreeRow } from "../../types.ts";
import { clamp } from "../../utils/indices.ts";
import { cursorTone } from "../cursor-tone.ts";
import { boxCell, boxContains, centeredRect, FRAME_DIVIDER, frame, overlayCentered, type BoxRect } from "../frame.ts";
import { renderTreeRow } from "../panes/tree-pane.ts";
import { scrollOffset } from "../panes/sessions-pane.ts";
import { treePrefixes } from "../tree-lines.ts";
import { PromptBar } from "./prompt-bar.ts";
import { searchLabel } from "./search-bar.ts";

/** Title on the top border of the dialog (localised). */
export function treeDialogTitle(): string {
	return t("dialog.treeTitle");
}

/** Hints while the search row has the keys (Esc goes back to the list, the query stays). */
export function treeSearchHints(): KeyHint[] {
	return [["Esc", t("hint.backToList")]];
}

/** What the dialog shows; passed to `open`. */
export interface TreeDialogSpec {
	/** Rows to list, top to bottom (already filtered by the panel, descendants of folded rows left out). */
	rows: TreeRow[];
	/** Folded rows, drawn with `⊞` (the pane's fold state, see ../../data/tree-fold.ts). */
	folded?: ReadonlySet<string>;
	/** Cursor position when the dialog opens (clamped into `rows`). */
	initialIndex?: number;
	/** Active filter, shown in the title bar next to the position. */
	filter: TreeFilter;
	/** Hints on the bottom row and in the footer while the list has the keys (built from the resolved keymap). */
	hints?: KeyHint[];
	/** Label of the key that focuses the search row, for the idle row's `/ to search` hint. */
	searchKey?: string;
	/** Live search: called with the new query after every change; the panel answers with `setRows`. */
	onQueryChange?: (query: string) => void;
}

export interface TreeDialogOptions {
	theme: Theme;
	/** Called after every change so the panel can re-render. */
	onChange: () => void;
}

/** Rows above the list (search + divider) plus the two borders; hints live in the footer. */
const CHROME_ROWS = 4;

export class TreeDialog {
	private spec: TreeDialogSpec | undefined;
	private rows: TreeRow[] = [];
	private folded: ReadonlySet<string> = new Set();
	private index = 0;
	private query = "";
	private _searchFocused = false;
	private _focused = false;
	/** 上一次绘制时对话框在屏幕上的位置（`overlay()` 里记）；鼠标命中只认这一份，没画过就点不到。 */
	private boxRect: BoxRect | undefined;
	/** The search field on the top row. */
	private readonly search: PromptBar;

	constructor(private readonly o: TreeDialogOptions) {
		this.search = new PromptBar({
			theme: o.theme,
			label: searchLabel(),
			hints: [],
			// Enter 在搜索框里没有含义；Esc 把按键交还给列表，关键字保留（再按 / 接着改）。
			onSubmit: () => {},
			onCancel: () => this.leaveSearch(),
			onChange: () => this.syncQuery(),
		});
	}

	/** True between `open` and `close`. */
	get isOpen(): boolean {
		return this.spec !== undefined;
	}

	/** Footer hints while the dialog is open: the search row's while it has the keys, else the list's. */
	get hints(): KeyHint[] {
		if (!this.spec) return [];
		return this._searchFocused ? treeSearchHints() : (this.spec.hints ?? []);
	}

	/** Index of the highlighted row. */
	get selectedIndex(): number {
		return this.index;
	}

	/** The highlighted row, if any. */
	get selectedRow(): TreeRow | undefined {
		return this.rows[this.index];
	}

	/** Current search text ("" = no search). */
	get searchQuery(): string {
		return this.query;
	}

	/** Whether keys go to the search row rather than the list. */
	get searchFocused(): boolean {
		return this._searchFocused;
	}

	/** Focusable propagation (IME cursor): reaches the search field only while it has the keys. */
	get focused(): boolean {
		return this._focused;
	}
	set focused(v: boolean) {
		this._focused = v;
		this.search.focused = v && this._searchFocused;
	}

	open(spec: TreeDialogSpec): void {
		this.spec = spec;
		this.rows = spec.rows;
		this.folded = spec.folded ?? new Set();
		this.index = clamp(spec.initialIndex ?? 0, 0, Math.max(0, spec.rows.length - 1));
		this.query = "";
		this._searchFocused = false;
		this.boxRect = undefined;
		this.search.reset("");
		this.search.focused = false;
	}

	/** Drop the dialog without firing a callback. */
	close(): void {
		this.spec = undefined;
		this._searchFocused = false;
		this.boxRect = undefined;
		this.search.focused = false;
	}

	/** Replace the listed rows (after a search / filter / fold / label change) and put the cursor on `index`. */
	setRows(rows: TreeRow[], folded: ReadonlySet<string>, index: number): void {
		this.rows = rows;
		this.folded = folded;
		this.index = clamp(index, 0, Math.max(0, rows.length - 1));
		this.o.onChange();
	}

	/** Update the filter shown in the title bar. */
	setFilter(filter: TreeFilter): void {
		if (this.spec) this.spec.filter = filter;
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

	/** j / k: move the cursor by `delta` rows, clamped. */
	move(delta: number): void {
		this.moveTo(this.index + delta);
	}

	/** gg / G, 方向键和鼠标点击：把光标放到 `index`（夹取到列出的行里）。 */
	moveTo(index: number): void {
		const next = clamp(index, 0, Math.max(0, this.rows.length - 1));
		if (next === this.index) return;
		this.index = next;
		this.o.onChange();
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
		if (line < 0 || line >= visible) return undefined; // 分隔线或更靠下的补白
		const index = scrollOffset(this.index, this.rows.length, visible) + line;
		return index < this.rows.length ? index : undefined; // 列表末尾之后的补白行
	}

	/** Wheel: move the cursor, but only while the pointer is over the dialog (like the panes). */
	wheel(x: number, y: number, delta: number): void {
		if (delta !== 0 && this.boxRect && boxContains(this.boxRect, x, y)) this.move(delta);
	}

	/** Esc in the search row（以及点击列表）：把按键交还给列表，关键字和过滤结果都留着。 */
	leaveSearch(): void {
		if (!this._searchFocused) return;
		this._searchFocused = false;
		this.search.focused = false;
		this.o.onChange();
	}

	/** After every keystroke in the search row: report a changed query, then re-render. */
	private syncQuery(): void {
		const q = this.search.getValue();
		if (q !== this.query) {
			this.query = q;
			this.spec?.onQueryChange?.(q);
		}
		this.o.onChange();
	}

	/** 列表一次能列出几行（渲染和鼠标命中共用，免得两边算得不一样）。 */
	private visibleRows(height: number): number {
		return Math.max(1, height - CHROME_ROWS);
	}

	/** Box size for a `termW` × `termH` terminal: as big as it gets with a 2-column / 1-row margin. */
	static size(termW: number, termH: number): { width: number; height: number } {
		return { width: Math.max(24, termW - 4), height: Math.max(CHROME_ROWS + 1, termH - 2) };
	}

	/** Render the box itself, every line exactly `width` columns and `height` lines tall. */
	render(width: number, height: number, showLabelTimestamps = false): string[] {
		const { theme } = this.o;
		const rows = this.rows;
		const inner = width - 2;
		const visible = this.visibleRows(height);

		const body: string[] = [` ${this.renderSearchRow(inner - 1)}`, FRAME_DIVIDER];
		if (rows.length === 0) {
			body.push(theme.fg("muted", this.query ? ` ${t("dialog.treeNoMatches")}` : ` ${t("pane.treeEmpty")}`));
		} else {
			const prefixes = treePrefixes(rows, this.folded);
			const first = scrollOffset(this.index, rows.length, visible);
			for (let i = first; i < Math.min(rows.length, first + visible); i++) {
				// 树线整段 dim；光标行和面板一样提亮一档，否则底色上的树线看不见了。
				const prefix = theme.fg(cursorTone("dim", i === this.index), prefixes[i]!);
				body.push(renderTreeRow(rows[i]!, prefix, inner, i === this.index, theme, undefined, showLabelTimestamps));
			}
		}
		while (body.length < visible + 2) body.push("");

		const position = rows.length ? `${this.index + 1}/${rows.length}` : "0/0";
		return frame(body, {
			width,
			height,
			title: treeDialogTitle(),
			meta: `${position} · ${t(`filter.${this.spec?.filter ?? "default"}`)}`,
			border: (s) => theme.fg("borderAccent", s),
			titleStyle: (s) => theme.bold(theme.fg("accent", s)),
			metaStyle: (s) => theme.fg("dim", s),
		});
	}

	/**
	 * Top row: the live input while it has the keys; otherwise the query as
	 * plain text (no block cursor) or a hint naming the search key.
	 */
	private renderSearchRow(width: number): string {
		if (this._searchFocused) return this.search.render(width)[0] ?? "";
		const { theme } = this.o;
		const label = theme.bold(theme.fg("accent", searchLabel()));
		const key = this.spec?.searchKey;
		const rest = this.query ? theme.fg("text", this.query) : key ? theme.fg("dim", t("dialog.toSearch", { key })) : "";
		return `${label}${rest}`;
	}

	/** Composite the box centered over the already-rendered panel `lines`. */
	overlay(lines: string[], termW: number, showLabelTimestamps = false): string[] {
		const { width, height } = TreeDialog.size(termW, lines.length);
		const box = this.render(width, height, showLabelTimestamps);
		// 记下这次画出来的位置：鼠标的点按（indexAt / wheel）只认它，画哪儿就点哪儿。
		this.boxRect = centeredRect(termW, lines.length, width, box.length);
		return overlayCentered(lines, box, width, termW, (s) => this.o.theme.fg("dim", s), this.boxRect.top);
	}
}
