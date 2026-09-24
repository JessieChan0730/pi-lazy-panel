/**
 * Tree pane (left, bottom).
 *
 * Lists the `TreeRow[]` of the session highlighted in the sessions pane as a
 * folded outline (prefixes from ../tree-outline.ts, fold rules in
 * ../../data/tree-fold.ts):
 *
 *   ›  • 22:18 [system]
 *      • 22:18 user: hi
 *      • 22:19 assistant: Hi! I'm ready to help with ...
 *      ▸ 22:20 user: try again
 *      ▾ • 22:21 [system]
 *          • 22:21 user: hi
 *          • 22:21 assistant: …
 *
 * A `▸` row is a folded side branch (its rows are hidden; `z` unfolds it), `▾`
 * an open one, `─` a dead-end alternative; rows inside a branch are indented
 * two columns per level, at most four levels (`… ` beyond). Side branches start
 * folded, the active branch open. The pane renders whatever rows it is given —
 * the panel hides the folded descendants and passes the outline prefixes; the
 * full tree with pi-style guide lines lives in the tree dialog (`a`,
 * ../widgets/tree-dialog.ts). The cursor is highlighted, nodes off the active
 * branch are dimmed. While a `/` search is active in the pane the matching
 * rows get their hits painted (see ../search-highlight.ts) and the header
 * counts them; folded matches are unfolded by the panel when jumped to.
 */

import type { Theme } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { t } from "../../i18n/index.ts";
import type { SearchView, TreeFilter, TreeRow } from "../../types.ts";
import { formatTime } from "../../utils/format.ts";
import { fit, frame, metaBudget } from "../frame.ts";
import { highlightLine, matchStyle, type RowHighlight, searchMeta } from "../search-highlight.ts";
import { type OutlinePrefix, treeOutline } from "../tree-outline.ts";
import { clampFirst, scrollOffset } from "./sessions-pane.ts";

export interface TreePaneProps {
	/** Rows to list (folded branches already hidden). */
	rows: TreeRow[];
	/** Outline prefix per entry id (see ../tree-outline.ts); derived from `rows` alone when omitted. */
	outline?: ReadonlyMap<string, OutlinePrefix>;
	cursor: number;
	/** First visible row; defaults to a cursor-centered window when omitted (keyboard). */
	first?: number;
	focused: boolean;
	/** Active tree filter (set in the tree dialog); shown in the header when it is not the default. */
	filter?: TreeFilter;
	/** Active `/` search of this pane (indices into `rows`): matching rows are highlighted, the header shows the count. */
	search?: SearchView;
	/** Shown when no session is selected / loading. */
	emptyMessage?: string;
	/** Frame title; the panel passes "[2] TREE" so the jump key is visible. */
	title?: string;
	theme: Theme;
}

const NO_PREFIX: OutlinePrefix = { indent: "", marker: "" };

export function renderTreePane(p: TreePaneProps, width: number, height: number): string[] {
	const { theme } = p;
	const inner = width - 2;
	const visible = Math.max(1, height - 2);
	const body: string[] = [];

	if (p.rows.length === 0) {
		body.push(theme.fg("muted", ` ${p.emptyMessage ?? t("pane.treeEmpty")}`));
	} else {
		const outline = p.outline ?? treeOutline(p.rows, new Set());
		// 滚轮滚动时用给定的 first（不动光标）；否则按光标居中。
		const first = clampFirst(p.first ?? scrollOffset(p.cursor, p.rows.length, visible), p.rows.length, visible);
		for (let i = first; i < Math.min(p.rows.length, first + visible); i++) {
			const row = p.rows[i]!;
			const search = p.search;
			const highlight = search?.matches.has(i) ? { terms: search.terms, current: i === search.current } : undefined;
			body.push(renderTreeRow(row, styleOutline(outline.get(row.entryId) ?? NO_PREFIX, theme), inner, i === p.cursor, theme, highlight));
		}
	}

	const title = p.title ?? "TREE";
	const budget = metaBudget(width, title);
	const meta = p.search ? searchMeta(p.search.position, p.search.total, budget) : treeMeta(p.rows.length, p.cursor, p.filter ?? "default", budget);
	return frame(body, {
		width,
		height,
		title,
		...(meta ? { meta } : {}),
		border: (s) => theme.fg(p.focused ? "borderAccent" : "border", s),
		titleStyle: (s) => (p.focused ? theme.bold(theme.fg("accent", s)) : theme.fg("muted", s)),
		metaStyle: (s) => theme.fg("dim", s),
	});
}

/**
 * Header meta of the tree pane: "2/12", or "2/12 · user-only" while a filter
 * other than the default is active (the filter is chosen in the tree dialog,
 * so the pane says why rows are missing). Degrades to the position alone when
 * the header is too narrow; an empty tree only names the filter.
 */
export function treeMeta(total: number, cursor: number, filter: TreeFilter, budget: number): string {
	const pos = total ? `${Math.min(cursor + 1, total)}/${total}` : "";
	const name = t(`filter.${filter}`);
	const candidates = filter === "default" ? [pos] : total ? [`${pos} · ${name}`, pos] : [name, ""];
	return candidates.find((c) => visibleWidth(c) <= budget) ?? "";
}

/** Indent as dim as guide lines; the fold marker a notch brighter so a folded branch still shows on a dimmed row. */
function styleOutline(prefix: OutlinePrefix, theme: Theme): string {
	return theme.fg("dim", prefix.indent) + theme.fg("muted", prefix.marker);
}

/**
 * One tree line, laid out like pi's /tree: `› ` cursor marker, the (already
 * styled) outline or guide-line prefix, `• ` on the active path, `[label]`,
 * time, `role: ` (omitted for system rows whose text already is a
 * `[system]`-style tag) and the text truncated to what is left. Shared with
 * the tree dialog. With `highlight` (a row matching the pane's search) the
 * terms are painted on top of the finished line.
 */
export function renderTreeRow(row: TreeRow, prefix: string, inner: number, isCursor: boolean, theme: Theme, highlight?: RowHighlight): string {
	const marker = isCursor ? "› " : "  ";
	// 和 pi 一样，活动路径上的节点在文字前加 `• `。
	const path = row.onActiveBranch ? "• " : "";
	const label = row.label ? `[${row.label}] ` : "";
	const time = `${formatTime(row.timestamp)} `;
	const role = row.role === "system" ? "" : `${t(`role.${row.role}`)}: `;
	const prefixW =
		visibleWidth(marker) + visibleWidth(prefix) + visibleWidth(path) + visibleWidth(label) + visibleWidth(time) + visibleWidth(role);
	const text = truncateToWidth(row.text, Math.max(1, inner - prefixW), "…", false);

	const roleStyle = (s: string) =>
		row.role === "user"
			? theme.fg("userMessageText", s)
			: row.role === "assistant"
				? theme.fg("accent", s)
				: theme.fg("muted", s);
	const branchStyle = (s: string) => (row.onActiveBranch ? s : theme.fg("dim", s));
	// system 行（[system] / [branch summary]: …）整行用 muted，和 pi 的 dim 标签一致。
	const textStyle = (s: string) => (row.role === "system" ? theme.fg("muted", s) : branchStyle(s));

	const line =
		theme.fg("accent", marker) +
		prefix +
		theme.fg("accent", path) +
		theme.fg("warning", label) +
		theme.fg("dim", time) +
		branchStyle(roleStyle(role)) +
		textStyle(text);
	const out = isCursor ? theme.bg("selectedBg", fit(line, inner)) : fit(line, inner);
	// 搜索命中：整行画完后再按列把关键词加上高亮，前后的颜色和光标背景都保留。
	return highlight ? highlightLine(out, highlight.terms, matchStyle(theme, highlight.current)) : out;
}
