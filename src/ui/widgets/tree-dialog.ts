/**
 * Tree dialog — the full conversation tree in a big centered box, opened with
 * `a` from the tree pane (the small pane only shows a slice). Layout follows
 * the `prefix + g` picker of herdr: search box on top, the tree in the middle,
 * key hints at the bottom.
 *
 *   ┌─ TREE ─────────────────────────────── 3/12 · default ─┐
 *   │ 搜索: hello▏                                           │
 *   ├────────────────────────────────────────────────────────┤
 *   │ ›    • 22:18 [system]                                  │
 *   │   ├⊟ 22:18 user: hi                                    │
 *   │   │     22:18 assistant: Hello!                        │
 *   │   └⊞ • 22:19 user: hi                                  │
 *   ├────────────────────────────────────────────────────────┤
 *   │ / search   j/↓/k/↑ move   Enter restore   z fold   …   │
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
import { visibleWidth } from "@earendil-works/pi-tui";
import { t } from "../../i18n/index.ts";
import type { KeyHint, TreeFilter, TreeRow } from "../../types.ts";
import { FRAME_DIVIDER, frame, overlayCentered } from "../frame.ts";
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

/** Rows above (search + divider) and below (divider + hints) the list, plus the two borders. */
const CHROME_ROWS = 6;

export class TreeDialog {
	private spec: TreeDialogSpec | undefined;
	private rows: TreeRow[] = [];
	private folded: ReadonlySet<string> = new Set();
	private index = 0;
	private query = "";
	private _searchFocused = false;
	private _focused = false;
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
		this.search.reset("");
		this.search.focused = false;
	}

	/** Drop the dialog without firing a callback. */
	close(): void {
		this.spec = undefined;
		this._searchFocused = false;
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

	/** gg / G and absolute moves, clamped into the listed rows. */
	moveTo(index: number): void {
		const next = clamp(index, 0, Math.max(0, this.rows.length - 1));
		if (next === this.index) return;
		this.index = next;
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

	/** Esc in the search row: hand the keys back to the list; the query (and the narrowed rows) stay. */
	private leaveSearch(): void {
		this._searchFocused = false;
		this.search.focused = false;
		this.o.onChange();
	}

	/** Box size for a `termW` × `termH` terminal: as big as it gets with a 2-column / 1-row margin. */
	static size(termW: number, termH: number): { width: number; height: number } {
		return { width: Math.max(24, termW - 4), height: Math.max(CHROME_ROWS + 1, termH - 2) };
	}

	/** Render the box itself, every line exactly `width` columns and `height` lines tall. */
	render(width: number, height: number): string[] {
		const { theme } = this.o;
		const rows = this.rows;
		const inner = width - 2;
		const visible = Math.max(1, height - CHROME_ROWS);

		const body: string[] = [` ${this.renderSearchRow(inner - 1)}`, FRAME_DIVIDER];
		if (rows.length === 0) {
			body.push(theme.fg("muted", this.query ? ` ${t("dialog.treeNoMatches")}` : ` ${t("pane.treeEmpty")}`));
		} else {
			const prefixes = treePrefixes(rows, this.folded);
			const first = scrollOffset(this.index, rows.length, visible);
			for (let i = first; i < Math.min(rows.length, first + visible); i++) {
				body.push(renderTreeRow(rows[i]!, theme.fg("dim", prefixes[i]!), inner, i === this.index, theme));
			}
		}
		while (body.length < visible + 2) body.push("");
		body.push(FRAME_DIVIDER, ` ${renderHints(this.hints, theme, inner - 1)}`);

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
	overlay(lines: string[], termW: number): string[] {
		const { width, height } = TreeDialog.size(termW, lines.length);
		return overlayCentered(lines, this.render(width, height), width, termW);
	}
}

/** `key text   key text …`, dropping the hints that do not fit in `width` (like the footer). */
function renderHints(hints: KeyHint[], theme: Theme, width: number): string {
	const parts: string[] = [];
	let used = 0;
	for (const [k, t] of hints) {
		const part = `${theme.bold(theme.fg("accent", k))} ${theme.fg("muted", t)}`;
		const w = visibleWidth(part) + (parts.length ? 3 : 0);
		if (used + w > width) break;
		parts.push(part);
		used += w;
	}
	return parts.join("   ");
}

function clamp(n: number, min: number, max: number): number {
	return Math.max(min, Math.min(max, n));
}
