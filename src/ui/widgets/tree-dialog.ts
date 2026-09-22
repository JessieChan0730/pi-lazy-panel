/**
 * Tree dialog — the full conversation tree in a big centered box, opened with
 * `a` from the tree pane (the small pane only shows a slice). Layout follows
 * the `prefix + g` picker of herdr: search box on top, the tree in the middle,
 * key hints at the bottom.
 *
 *   ┌─ TREE ─────────────────────────────── 3/12 · default ─┐
 *   │ 搜索: ▏                                                │
 *   ├────────────────────────────────────────────────────────┤
 *   │ ›    • 22:18 [system]                                  │
 *   │   ├⊟ 22:18 user: hi                                    │
 *   │   │     22:18 assistant: Hello!                        │
 *   │   └⊟ • 22:19 user: hi                                  │
 *   │        • 22:19 assistant: …                            │
 *   ├────────────────────────────────────────────────────────┤
 *   │ Esc/q close                                            │
 *   └────────────────────────────────────────────────────────┘
 *
 * This task ships the box itself: rows come from the panel (already filtered,
 * folded branches left out — the dialog shares the pane's fold state and draws
 * folded rows with `⊞`), the cursor starts on the pane's node and the guide
 * lines are the uncapped ones from ../tree-lines.ts. Search, filters
 * (d/t/u/L/a), j/k, z, y, T and Enter inside the dialog are the next task;
 * only Esc / q (close) work now and every other key is swallowed.
 *
 * 完整树对话框：本任务只做 UI，快捷键除了关闭都留给下个任务。折叠状态和小面板共用。
 */

import type { Theme } from "@earendil-works/pi-coding-agent";
import { matchesKeyId } from "../../config/keys.ts";
import type { KeyHint, TreeFilter, TreeRow } from "../../types.ts";
import { FRAME_DIVIDER, frame, overlayCentered } from "../frame.ts";
import { renderTreeRow } from "../panes/tree-pane.ts";
import { scrollOffset } from "../panes/sessions-pane.ts";
import { treePrefixes } from "../tree-lines.ts";
import { PromptBar } from "./prompt-bar.ts";
import { SEARCH_LABEL } from "./search-bar.ts";

export const TREE_DIALOG_TITLE = "TREE";

/** Keys that work inside the dialog today (shown on its bottom row and in the footer). */
export const TREE_DIALOG_HINTS: KeyHint[] = [["Esc/q", "close"]];

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
	/** Esc / q. */
	onClose: () => void;
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
	private index = 0;
	/** The search field on the top row; static until the search task wires it up. */
	private readonly search: PromptBar;

	constructor(private readonly o: TreeDialogOptions) {
		this.search = new PromptBar({
			theme: o.theme,
			label: SEARCH_LABEL,
			hints: [],
			onSubmit: () => {},
			onCancel: () => {},
			onChange: () => this.o.onChange(),
		});
	}

	/** True between `open` and `close`. */
	get isOpen(): boolean {
		return this.spec !== undefined;
	}

	/** Footer hints while the dialog is open (empty when closed). */
	get hints(): KeyHint[] {
		return this.spec ? TREE_DIALOG_HINTS : [];
	}

	/** Index of the highlighted row. */
	get selectedIndex(): number {
		return this.index;
	}

	open(spec: TreeDialogSpec): void {
		this.spec = spec;
		this.index = clamp(spec.initialIndex ?? 0, 0, Math.max(0, spec.rows.length - 1));
		this.search.reset("");
	}

	/** Drop the dialog without firing a callback. */
	close(): void {
		this.spec = undefined;
	}

	handleInput(data: string): void {
		const spec = this.spec;
		if (!spec) return;
		if (matchesKeyId(data, "escape") || matchesKeyId(data, "q")) {
			spec.onClose();
			return;
		}
		// 其余按键（搜索、过滤、移动…）下个任务实现；现在一律吞掉，不能漏到面板去。
	}

	/** Box size for a `termW` × `termH` terminal: as big as it gets with a 2-column / 1-row margin. */
	static size(termW: number, termH: number): { width: number; height: number } {
		return { width: Math.max(24, termW - 4), height: Math.max(CHROME_ROWS + 1, termH - 2) };
	}

	/** Render the box itself, every line exactly `width` columns and `height` lines tall. */
	render(width: number, height: number): string[] {
		const { theme } = this.o;
		const rows = this.spec?.rows ?? [];
		const inner = width - 2;
		const visible = Math.max(1, height - CHROME_ROWS);

		const body: string[] = [` ${this.search.render(inner - 1)[0] ?? ""}`, FRAME_DIVIDER];
		if (rows.length === 0) {
			body.push(theme.fg("muted", " No entries."));
		} else {
			const prefixes = treePrefixes(rows, this.spec?.folded);
			const first = scrollOffset(this.index, rows.length, visible);
			for (let i = first; i < Math.min(rows.length, first + visible); i++) {
				body.push(renderTreeRow(rows[i]!, theme.fg("dim", prefixes[i]!), inner, i === this.index, theme));
			}
		}
		while (body.length < visible + 2) body.push("");
		body.push(FRAME_DIVIDER, ` ${renderHints(TREE_DIALOG_HINTS, theme)}`);

		const position = rows.length ? `${this.index + 1}/${rows.length}` : "0/0";
		return frame(body, {
			width,
			height,
			title: TREE_DIALOG_TITLE,
			meta: `${position} · ${this.spec?.filter ?? "default"}`,
			border: (s) => theme.fg("borderAccent", s),
			titleStyle: (s) => theme.bold(theme.fg("accent", s)),
			metaStyle: (s) => theme.fg("dim", s),
		});
	}

	/** Composite the box centered over the already-rendered panel `lines`. */
	overlay(lines: string[], termW: number): string[] {
		const { width, height } = TreeDialog.size(termW, lines.length);
		return overlayCentered(lines, this.render(width, height), width, termW);
	}
}

function renderHints(hints: KeyHint[], theme: Theme): string {
	return hints.map(([k, t]) => `${theme.bold(theme.fg("accent", k))} ${theme.fg("muted", t)}`).join("   ");
}

function clamp(n: number, min: number, max: number): number {
	return Math.max(min, Math.min(max, n));
}
